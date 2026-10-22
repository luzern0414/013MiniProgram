import {
  copyOptions,
  optionsDraft,
  optionsPayload,
  optionsInteger,
} from "./product-options.mjs";
const unknownResult = (e) =>
  !e?.code ||
  [
    "NETWORK",
    "NETWORK_ERROR",
    "TIMEOUT",
    "UNKNOWN",
    "INVALID_RESPONSE",
    "SERVER_ERROR",
    "INTERNAL_ERROR",
  ].includes(e.code);
export function optionsErrorText(error) {
  const message =
    {
      STATE_CONFLICT: "信息已变化，请重新读取并核对后保存",
      FORBIDDEN: "你没有当前门店的维护权限，请联系店主",
      UNAUTHENTICATED: "登录已过期，请重新登录",
      VALIDATION_ERROR: "配置不符合要求，请核对名称、组合及选择数量",
    }[error?.code] ||
    error?.message ||
    "操作失败，请稍后重试";
  return `${message}${error?.requestId ? `（编号 ${error.requestId}）` : ""}`;
}
export function createOptionsController({
  state,
  request,
  storeId,
  productId,
  canEdit = () => true,
  onChanged = async () => {},
}) {
  Object.assign(state, {
    draft: null,
    previousDraft: null,
    previousInventory: {},
    inventory: {},
    loading: false,
    busy: false,
    blocked: false,
    readOnly: !canEdit(),
    error: "",
    notice: "",
  });
  let alive = true,
    generation = 0;
  const context = () => ({
    store: storeId(),
    product: productId(),
    ticket: ++generation,
  });
  const current = (c) =>
    alive &&
    c.ticket === generation &&
    c.store === storeId() &&
    c.product === productId();
  const path = (c) =>
    `/merchant/products/${encodeURIComponent(c.product)}/options`;
  const apply = (data) => {
    state.draft = optionsDraft(data);
    state.inventory = Object.fromEntries(
      data.modifiers.map((m) => [m.id, String(m.available)]),
    );
  };
  async function read(c) {
    const data = await request(
      `${path(c)}?storeId=${encodeURIComponent(c.store)}`,
    );
    if (!current(c)) return false;
    apply(data);
    return true;
  }
  async function load() {
    if (!alive || state.busy || state.loading) return false;
    const c = context();
    state.loading = true;
    state.error = "";
    state.notice = "";
    try {
      const previous = state.draft && copyOptions(state.draft);
      const previousInventory = copyOptions(state.inventory);
      const data = await request(
        `${path(c)}?storeId=${encodeURIComponent(c.store)}`,
      );
      if (!current(c)) return false;
      // Validate before replacing anything; failed recovery retains the original draft.
      optionsDraft(data);
      if (previous) await onChanged();
      if (!current(c)) return false;
      apply(data);
      if (previous) {
        state.previousDraft = previous;
        state.previousInventory = previousInventory;
      }
      state.blocked = false;
      state.readOnly = !canEdit();
      return true;
    } catch (e) {
      if (current(c)) {
        state.error = optionsErrorText(e);
        if (e?.code === "FORBIDDEN") state.readOnly = true;
      }
      return false;
    } finally {
      if (current(c)) state.loading = false;
    }
  }
  async function write(inventoryId) {
    if (
      !alive ||
      state.busy ||
      state.loading ||
      state.blocked ||
      state.readOnly ||
      !canEdit() ||
      !state.draft
    )
      return false;
    const c = context();
    let sent = false;
    state.busy = true;
    state.error = "";
    state.notice = "";
    try {
      let data,
        endpoint = path(c),
        method = "PUT";
      if (inventoryId) {
        const item = state.draft.modifiers.find((m) => m.id === inventoryId);
        if (!item) throw new Error("请先保存新增加料后再调整库存");
        data = {
          storeId: c.store,
          expectedAvailable: item.available,
          available: optionsInteger(
            state.inventory[inventoryId],
            2000000000 - item.reserved,
            "可售库存",
          ),
        };
        endpoint = `/merchant/modifiers/${encodeURIComponent(inventoryId)}/inventory`;
        method = "PATCH";
      } else data = optionsPayload(c.store, state.draft);
      const previous = copyOptions(state.draft);
      sent = true;
      const result = await request(endpoint, { method, data });
      if (!current(c)) return false;
      if (inventoryId) {
        // An inventory-only update must not replace unsaved configuration edits.
        Object.assign(
          state.draft.modifiers.find((m) => m.id === inventoryId),
          { available: result.available, reserved: result.reserved },
        );
        state.inventory[inventoryId] = String(result.available);
      } else {
        state.previousDraft = previous;
        state.previousInventory = copyOptions(state.inventory);
        // A committed PUT still needs a real read before another operation.
        state.blocked = true;
        if (!(await read(c))) return false;
      }
      await onChanged();
      if (!current(c)) return false;
      state.blocked = false;
      state.notice = inventoryId ? "加料库存已保存" : "规格与口味已保存";
      return true;
    } catch (e) {
      if (current(c)) {
        state.blocked =
          sent &&
          (state.blocked || e?.code === "STATE_CONFLICT" || unknownResult(e));
        if (e?.code === "FORBIDDEN" || e?.code === "UNAUTHENTICATED")
          state.readOnly = true;
        state.error =
          optionsErrorText(e) +
          (sent && unknownResult(e)
            ? "；保存结果未确认，请重新读取并核对，勿重复提交"
            : "");
      }
      return false;
    } finally {
      if (current(c)) state.busy = false;
    }
  }
  return {
    load,
    save: () => write(),
    saveInventory: (id) => write(id),
    dispose() {
      alive = false;
      generation++;
    },
  };
}
