const text = (value, max, label) => {
  const result = String(value || "").trim();
  if (!result || result.length > max)
    throw new Error(`请填写1至${max}个字符的${label}`);
  return result;
};
const integer = (value, max, label) => {
  if (
    String(value).trim() === "" ||
    !Number.isInteger(Number(value)) ||
    Number(value) < 0 ||
    Number(value) > max
  )
    throw new Error(`${label}需为0至${max}的整数`);
  return Number(value);
};
export const selectableCategories = (settings, storeId) =>
  (settings?.categories || []).filter(
    (c) =>
      c.enabled &&
      (c.visibleStoreIds === null || c.visibleStoreIds.includes(storeId)),
  );
export const selectableUnits = (settings) =>
  (settings?.units || []).filter((u) => u.enabled);
export function catalogPayload(storeId, kind, target, form) {
  const payload = {
    storeId,
    name: text(
      form.name,
      kind === "categories" ? 80 : 20,
      kind === "categories" ? "分类名称" : "单位名称",
    ),
  };
  if (!target) return payload;
  payload.expectedRevision = integer(target.revision, 2000000000, "版本");
  payload.enabled = !!form.enabled;
  if (kind === "categories") {
    payload.sort = integer(form.sort, 100000, "排序");
    payload.visibleStoreIds = form.allStores
      ? null
      : [...new Set(form.visibleStoreIds || [])];
  }
  return payload;
}
export function catalogErrorText(error) {
  const message =
    {
      STATE_CONFLICT: "信息已被修改或选项已停用，请重新加载并核对后保存",
      NAME_CONFLICT: "该名称已存在，请更换名称",
      REFERENCE_CONFLICT: "仍有商品引用，无法删除，请先调整商品或停用",
      FORBIDDEN: "你没有维护品牌分类与单位的权限，请联系拥有全部门店权限的店主",
      UNAUTHENTICATED: "登录已过期，请重新登录",
    }[error?.code] ||
    error?.message ||
    "操作失败，请稍后重试";
  return `${message}${error?.requestId ? `（编号 ${error.requestId}）` : ""}`;
}
const uncertain = (e) =>
  [
    "NETWORK",
    "NETWORK_ERROR",
    "TIMEOUT",
    "UNKNOWN",
    "INVALID_RESPONSE",
    "SERVER_ERROR",
    "INTERNAL_ERROR",
  ].includes(e?.code);
function writeError(state, e) {
  state.blocked = e?.code === "STATE_CONFLICT" || uncertain(e);
  state.uncertainResult = uncertain(e);
  state.error =
    catalogErrorText(e) +
    (uncertain(e) ? "；未能确认保存结果，请刷新列表核对，勿重复提交" : "");
}
export function createCatalogController({ state, request, storeId }) {
  Object.assign(state, {
    settings: null,
    loading: false,
    busy: false,
    error: "",
    notice: "",
    mode: "",
    kind: "categories",
    target: null,
    form: {},
    blocked: false,
  });
  async function load() {
    if (state.loading || state.busy) return false;
    const scope = storeId();
    state.loading = true;
    state.error = "";
    state.settings = null;
    try {
      const result = await request(
        `/merchant/catalog-settings?storeId=${encodeURIComponent(scope)}`,
      );
      if (scope !== storeId()) return false;
      state.settings = result;
      return true;
    } catch (e) {
      if (scope === storeId()) state.error = catalogErrorText(e);
      return false;
    } finally {
      state.loading = false;
    }
  }
  function open(kind, target = null) {
    if (state.busy || state.loading || !state.settings?.canManageBrand) return;
    state.kind = kind;
    state.target = target ? { ...target } : null;
    state.mode = target ? "edit" : "create";
    state.blocked = false;
    state.uncertainResult = false;
    state.error = "";
    state.notice = "";
    state.form = {
      name: target?.name || "",
      enabled: target?.enabled ?? true,
      sort: String(target?.sort || 0),
      allStores: target?.visibleStoreIds == null,
      visibleStoreIds: [...(target?.visibleStoreIds || [])],
    };
  }
  function close() {
    if (!state.busy) {
      state.mode = "";
      state.target = null;
      state.error = "";
    }
  }
  async function reloadEditor() {
    const { kind, target, uncertainResult } = state;
    if (!(await load())) return;
    const latest =
      target && state.settings[kind].find((i) => i.id === target.id);
    if (uncertainResult && !target) {
      close();
      state.notice = "已刷新，请先核对列表中的新增结果";
    } else if (target && !latest) {
      close();
      state.notice = "该记录已删除，请核对列表";
    } else if (state.settings.canManageBrand) open(kind, latest || null);
    else close();
  }
  async function save(remove = false) {
    if (
      state.busy ||
      state.loading ||
      state.blocked ||
      !state.settings?.canManageBrand ||
      !state.mode
    )
      return false;
    const scope = storeId(),
      target = state.target;
    state.error = "";
    state.notice = "";
    try {
      const data = remove
        ? { storeId: scope, expectedRevision: target.revision }
        : catalogPayload(scope, state.kind, target, state.form);
      state.busy = true;
      const result = await request(
        `/merchant/${state.kind}${target ? "/" + encodeURIComponent(target.id) : ""}`,
        { method: remove ? "DELETE" : target ? "PATCH" : "POST", data },
      );
      if (scope !== storeId()) return false;
      state.settings[state.kind] = state.settings[state.kind].filter(
        (i) => i.id !== result.id,
      );
      if (!remove) state.settings[state.kind].push(result);
      state.settings.categories.sort(
        (a, b) => a.sort - b.sort || a.id.localeCompare(b.id),
      );
      state.busy = false;
      close();
      state.notice = remove ? "已删除" : "已保存";
      return true;
    } catch (e) {
      if (scope === storeId()) writeError(state, e);
      return false;
    } finally {
      state.busy = false;
    }
  }
  return { load, open, close, reloadEditor, save };
}
export function productPayload(storeId, target, form, settings) {
  if (!settings) throw new Error("请重新加载分类与单位后再保存");
  const payload = {
    storeId,
    name: text(form.name, 100, "商品名称"),
    description: String(form.description || "").trim(),
    imageUrl: String(form.imageUrl || "").trim() || null,
  };
  if (payload.description.length > 1000)
    throw new Error("商品描述最多1000个字符");
  if (
    payload.imageUrl &&
    (payload.imageUrl.length > 2000 ||
      !/^https?:\/\/\S+$/i.test(payload.imageUrl))
  )
    throw new Error("请填写有效的商品图片地址");
  if (!target || form.categoryId !== target.categoryId) {
    if (
      !selectableCategories(settings, storeId).some(
        (c) => c.id === form.categoryId,
      )
    )
      throw new Error("请选择当前门店可用的分类");
    payload.categoryId = form.categoryId;
  }
  if (!target || form.unitId !== (target.unitId || "")) {
    if (!selectableUnits(settings).some((u) => u.id === form.unitId))
      throw new Error("请选择有效的售卖单位");
    payload.unitId = form.unitId;
  }
  if (target) payload.isAvailable = !!form.isAvailable;
  else {
    if (!form.skus?.length || form.skus.length > 20)
      throw new Error("请保留1至20种规格");
    payload.skus = form.skus.map((s) => {
      const price = String(s.price);
      if (!/^\d+(\.\d{1,2})?$/.test(price) || Number(price) > 20000000)
        throw new Error("售价需为0至20000000元，最多两位小数");
      return {
        name: text(s.name, 80, "规格名称"),
        priceFen: Math.round(Number(price) * 100),
        stock: integer(s.stock, 2000000000, "库存"),
      };
    });
  }
  return payload;
}
export function createProductController({
  state,
  request,
  storeId,
  onSaved = () => {},
}) {
  Object.assign(state, {
    settings: null,
    loading: false,
    busy: false,
    error: "",
    blocked: false,
    mode: "",
    target: null,
    form: {},
  });
  let generation = 0;
  async function load() {
    const scope = storeId(),
      ticket = ++generation;
    state.loading = true;
    state.settings = null;
    state.error = "";
    try {
      const data = await request(
        `/merchant/catalog-settings?storeId=${encodeURIComponent(scope)}`,
      );
      if (scope !== storeId() || ticket !== generation) return false;
      state.settings = data;
      return true;
    } catch (e) {
      if (scope === storeId() && ticket === generation)
        state.error = catalogErrorText(e);
      return false;
    } finally {
      if (ticket === generation) state.loading = false;
    }
  }
  async function open(target = null) {
    if (state.busy) return;
    state.target = target ? { ...target } : null;
    state.mode = target ? "edit" : "create";
    state.blocked = false;
    state.uncertainResult = false;
    state.form = {
      name: target?.name || "",
      description: target?.description || "",
      imageUrl: target?.imageUrl || "",
      categoryId: target?.categoryId || "",
      unitId: target?.unitId || "",
      isAvailable: target?.isAvailable ?? true,
      skus: [{ name: "标准", price: "", stock: "0" }],
    };
    await load();
  }
  function close() {
    if (!state.busy) {
      generation++;
      state.mode = "";
      state.loading = false;
      state.settings = null;
    }
  }
  async function reload() {
    if (state.busy || state.loading) return;
    const scope = storeId();
    state.busy = true;
    state.error = "";
    try {
      const catalog = await request(
        `/merchant/products?storeId=${encodeURIComponent(scope)}`,
      );
      if (scope !== storeId()) return;
      const latest =
        state.target && catalog.products.find((p) => p.id === state.target.id);
      if (!state.target || !latest) {
        state.busy = false;
        close();
        await onSaved();
        return;
      }
      if (!(await load())) return;
      state.target = { ...latest };
      Object.assign(state.form, {
        name: latest.name,
        description: latest.description || "",
        imageUrl: latest.imageUrl || "",
        categoryId: latest.categoryId,
        unitId: latest.unitId || "",
        isAvailable: latest.isAvailable,
      });
      state.blocked = false;
      state.uncertainResult = false;
    } catch (e) {
      if (scope === storeId())
        state.error = catalogErrorText(e) + "；请重新加载并核对保存结果";
    } finally {
      state.busy = false;
    }
  }
  async function save() {
    if (state.busy || state.loading || state.blocked || !state.mode)
      return false;
    const scope = storeId();
    let writing = false;
    state.busy = true;
    state.error = "";
    try {
      if (!(await load())) return false;
      const data = productPayload(
        scope,
        state.target,
        state.form,
        state.settings,
      );
      writing = true;
      await request(
        `/merchant/products${state.target ? "/" + encodeURIComponent(state.target.id) : ""}`,
        { method: state.target ? "PATCH" : "POST", data },
      );
      if (scope !== storeId()) return false;
      state.busy = false;
      close();
      await onSaved();
      return true;
    } catch (e) {
      if (scope === storeId()) {
        if (writing) writeError(state, e);
        else state.error = catalogErrorText(e);
      }
      return false;
    } finally {
      state.busy = false;
    }
  }
  return { open, close, load, reload, save };
}
