const copy = (value) => JSON.parse(JSON.stringify(value));
const addressFields = ["name", "phone", "region", "detail", "point", "isDefault"];
const addressKeys = ["id", ...addressFields, "revision", "deletedAt", "createdAt", "updatedAt"];
const pointKeys = ["system", "latitudeE6", "longitudeE6", "source", "confirmedAt"];
const kinds = ["CREATE", "UPDATE", "DEFAULT", "DELETE"];
const asString = (value) => typeof value === "string" && !!value.trim();
const id = (value) => typeof value === "string" && value.length >= 1 && value.length <= 200;
const revision = (value) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 2_000_000_000;
const exactKeys = (value, keys) =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const utc = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))
    return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
};
const validPoint = (value) => {
  if (value === null) return true;
  if (!exactKeys(value, pointKeys)) return false;
  return (
    value.system === "WGS84" &&
    Number.isInteger(value.latitudeE6) &&
    value.latitudeE6 >= -90_000_000 &&
    value.latitudeE6 <= 90_000_000 &&
    Number.isInteger(value.longitudeE6) &&
    value.longitudeE6 >= -180_000_000 &&
    value.longitudeE6 <= 180_000_000 &&
    ["DEVICE", "MANUAL"].includes(value.source) &&
    utc(value.confirmedAt)
  );
};
const text = (value, min, max) =>
  typeof value === "string" &&
  value === value.trim() &&
  value.length >= min &&
  value.length <= max &&
  !/\p{Cc}/u.test(value);
export function validAddress(value) {
  if (!exactKeys(value, addressKeys)) return false;
  return (
    id(value.id) &&
    text(value.name, 1, 40) &&
    typeof value.phone === "string" &&
    /^1[3-9]\d{9}$/.test(value.phone) &&
    text(value.region, 2, 100) &&
    text(value.detail, 2, 200) &&
    validPoint(value.point) &&
    typeof value.isDefault === "boolean" &&
    revision(value.revision) &&
    (value.deletedAt === null || utc(value.deletedAt)) &&
    utc(value.createdAt) &&
    utc(value.updatedAt) &&
    (!value.deletedAt || value.isDefault === false)
  );
}
const validList = (value) =>
  !!value &&
  exactKeys(value, ["items", "bookRevision", "limit"]) &&
  Array.isArray(value.items) &&
  value.items.every(validAddress) &&
  revision(value.bookRevision) &&
  value.limit === 20;
const validDetail = (value) =>
  !!value &&
  exactKeys(value, ["address", "bookRevision"]) &&
  validAddress(value.address) &&
  revision(value.bookRevision);
export const addressStorageKey = (userId) =>
  "customer-address:v1:" + encodeURIComponent(userId);
export const addressLocked = (...locks) => locks.some(Boolean);
const storageError = "地址恢复记录无法读取，请核对原操作；核对前不能新增或修改地址。";
const recoveryError = "原操作结果尚未确认，请重新登录同一账号后显式恢复核对。";
const storageSaveError = "地址进度储存失败，尚未发送请求；请检查本机储存后重试。";
const storageClearError = "地址操作已核对，但恢复记录清理失败；请再次核对，不能开始新的地址操作。";
const requestIdText = (error) => (error?.requestId ? "（编号 " + error.requestId + "）" : "");
const friendly = (error) => {
  const base =
    error?.code === "VALIDATION_ERROR"
      ? error.message || "请检查填写的地址信息"
      : error?.code === "ADDRESS_CHANGED"
        ? "地址已有变化，请先读取最新内容，再明确确认是否使用新版本"
        : error?.code === "ADDRESS_LIMIT"
          ? "收货地址已达到 20 个上限，请删除不需要的地址后再新增"
          : error?.code === "ADDRESS_DELETED"
            ? "这个地址已被删除，请查看最新内容后再决定是否新增"
            : error?.code === "IDEMPOTENCY_CONFLICT"
              ? "原操作与本机恢复记录不一致，请保留记录并联系工作人员核对"
              : error?.code === "UNAUTHENTICATED"
                ? "登录已过期，请重新登录原账号后继续核对"
                : error?.code === "FORBIDDEN"
                  ? "当前账号不能操作这个地址"
                  : error?.message || "地址服务暂时不可用，请稍后重试";
  return base + requestIdText(error);
};
const explicitFirstRejection = (error) =>
  (error?.code === "VALIDATION_ERROR" && error.status === 400) ||
  (["ADDRESS_CHANGED", "ADDRESS_LIMIT", "ADDRESS_DELETED"].includes(error?.code) &&
    error.status === 409);
const pathFor = (kind, addressId) => {
  if (kind === "CREATE") return "/customer/addresses";
  const base = "/customer/addresses/" + encodeURIComponent(addressId);
  return kind === "UPDATE" ? base : base + "/" + kind.toLowerCase();
};
const bodyFor = (kind, supplied, bookRevision) => {
  const expectedBookRevision =
    supplied.expectedBookRevision === undefined ? bookRevision : supplied.expectedBookRevision;
  if (!revision(expectedBookRevision))
    throw Object.assign(Error("地址簿版本不正确，请重新读取"), {
      code: "VALIDATION_ERROR",
      status: 400,
    });
  const point = supplied.point === undefined ? null : supplied.point;
  if (!validPoint(point))
    throw Object.assign(Error("配送点格式不正确，请重新确认"), {
      code: "VALIDATION_ERROR",
      status: 400,
    });
  const normalized = {
    name: typeof supplied.name === "string" ? supplied.name.trim() : supplied.name,
    phone: supplied.phone,
    region: typeof supplied.region === "string" ? supplied.region.trim() : supplied.region,
    detail: typeof supplied.detail === "string" ? supplied.detail.trim() : supplied.detail,
    point: point === null ? null : copy(point),
    isDefault: supplied.isDefault,
  };
  if (kind === "CREATE" || kind === "UPDATE") {
    if (
      !text(normalized.name, 1, 40) ||
      typeof normalized.phone !== "string" ||
      !/^1[3-9]\d{9}$/.test(normalized.phone) ||
      !text(normalized.region, 2, 100) ||
      !text(normalized.detail, 2, 200) ||
      typeof normalized.isDefault !== "boolean"
    )
      throw Object.assign(Error("请检查收货人、手机号码和地址信息"), {
        code: "VALIDATION_ERROR",
        status: 400,
      });
  }
  if (kind === "CREATE") return { expectedBookRevision, ...normalized };
  const expectedRevision = supplied.expectedRevision;
  if (!revision(expectedRevision))
    throw Object.assign(Error("地址版本不正确，请重新读取"), {
      code: "VALIDATION_ERROR",
      status: 400,
    });
  if (kind === "UPDATE")
    return { expectedBookRevision, expectedRevision, ...normalized };
  return { expectedBookRevision, expectedRevision };
};
const validAttempt = (attempt, userId) => {
  if (
    !exactKeys(attempt, [
      "schemaVersion",
      "userId",
      "kind",
      "addressId",
      "key",
      "method",
      "path",
      "body",
    ]) ||
    attempt.schemaVersion !== 1 ||
    attempt.userId !== userId ||
    !kinds.includes(attempt.kind) ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(attempt.key)
  )
    return false;
  if (attempt.kind === "CREATE") {
    if (attempt.addressId !== null || attempt.method !== "POST") return false;
  } else if (!id(attempt.addressId) || attempt.method !== (attempt.kind === "UPDATE" ? "PUT" : "POST"))
    return false;
  if (attempt.path !== pathFor(attempt.kind, attempt.addressId)) return false;
  const body = attempt.body;
  if (attempt.kind === "CREATE")
    return exactKeys(body, ["expectedBookRevision", ...addressFields]) &&
      revision(body.expectedBookRevision) &&
      bodyFor("CREATE", body, body.expectedBookRevision) !== null;
  if (attempt.kind === "UPDATE")
    return exactKeys(body, ["expectedBookRevision", "expectedRevision", ...addressFields]) &&
      revision(body.expectedBookRevision) &&
      revision(body.expectedRevision) &&
      bodyFor("UPDATE", body, body.expectedBookRevision) !== null;
  return exactKeys(body, ["expectedBookRevision", "expectedRevision"]) &&
    revision(body.expectedBookRevision) &&
    revision(body.expectedRevision);
};
export function readAddressAttempt(storage, userId) {
  try {
    const raw = storage.get(addressStorageKey(userId));
    if (raw === undefined) return { attempt: null, error: "" };
    if (raw === "" || raw === null) throw Error();
    const attempt = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!validAttempt(attempt, userId)) throw Error();
    return { attempt: copy(attempt), error: "" };
  } catch {
    return { attempt: null, error: storageError };
  }
}
const blankForm = () => ({
  id: "",
  expectedBookRevision: 0,
  expectedRevision: 0,
  name: "",
  phone: "",
  region: "",
  detail: "",
  point: null,
  isDefault: false,
  busy: false,
  error: "",
  pointNotice: "",
});
const sortItems = (items) =>
  [...items].sort((left, right) => {
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
    if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1;
    return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
  });
const validResponse = (response, attempt) => {
  if (
    !exactKeys(response, ["operation", "address", "bookRevision", "replayed"]) ||
    typeof response.replayed !== "boolean" ||
    !revision(response.bookRevision) ||
    !validAddress(response.address) ||
    !exactKeys(response.operation, [
      "kind",
      "addressId",
      "addressRevision",
      "bookRevision",
      "succeededAt",
    ]) ||
    response.operation.kind !== attempt.kind ||
    response.operation.bookRevision !== attempt.body.expectedBookRevision + 1 ||
    response.operation.addressRevision !==
      (attempt.kind === "CREATE" ? 0 : attempt.body.expectedRevision + 1) ||
    !id(response.operation.addressId) ||
    response.operation.addressId !== response.address.id ||
    !revision(response.operation.addressRevision) ||
    !revision(response.operation.bookRevision) ||
    !utc(response.operation.succeededAt) ||
    (attempt.addressId !== null && response.operation.addressId !== attempt.addressId) ||
    response.address.revision < response.operation.addressRevision ||
    response.bookRevision < response.operation.bookRevision ||
    (!response.replayed && attempt.kind !== "DELETE" && response.address.deletedAt !== null)
  )
    return false;
  return true;
};
const resultLater = (response) =>
  response.address.revision > response.operation.addressRevision ||
  (!!response.address.deletedAt && response.operation.kind !== "DELETE");

export function createCustomerAddresses({
  state,
  storage,
  request,
  context,
  key = () =>
    globalThis.crypto?.randomUUID?.() ||
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2),
  locked = () => false,
}) {
  const initial = context();
  const identity = initial?.userId;
  if (!asString(identity)) throw Error("顾客身份缺失");
  const restored = readAddressAttempt(storage, identity);
  Object.assign(state, {
    items: [],
    bookRevision: 0,
    limit: 20,
    loading: false,
    busy: false,
    blocked: !!(restored.attempt || restored.error),
    corrupt: !!restored.error,
    pending: restored.attempt,
    error: restored.error,
    notice: "",
    review: false,
    reviewReady: false,
    reviewError: "",
    reviewBookRevision: null,
    reviewAddress: null,
    latestAddress: null,
    editor: "",
    form: blankForm(),
    confirmation: false,
    writeConfirmed: false,
    disposed: false,
  });
  let alive = true;
  let generation = 0;
  const snapshot = () => {
    const value = context();
    return { userId: value?.userId, identity: value?.identity };
  };
  const current = (value) => {
    const now = snapshot();
    return alive && now.userId === value.userId && now.identity === value.identity;
  };
  const fail = (message, error = "") => {
    state.error = error ? message + "；" + error : message;
  };
  function save(attempt) {
    try {
      storage.set(addressStorageKey(identity), copy(attempt));
    } catch {
      throw Error(storageSaveError);
    }
    const actual = readAddressAttempt(storage, identity);
    if (actual.error || JSON.stringify(actual.attempt) !== JSON.stringify(attempt))
      throw Error(storageSaveError);
    state.pending = copy(attempt);
    state.blocked = true;
  }
  function clear() {
    storage.remove(addressStorageKey(identity));
    const actual = readAddressAttempt(storage, identity);
    if (actual.error || actual.attempt) throw Error(storageClearError);
    state.pending = null;
    state.blocked = false;
  }
  function discover() {
    if (!alive) return;
    const found = readAddressAttempt(storage, identity);
    if (found.error) {
      state.pending = null;
      state.corrupt = true;
      state.blocked = true;
      state.error = found.error;
    } else if (found.attempt) {
      state.pending = copy(found.attempt);
      state.blocked = true;
      state.corrupt = false;
      if (!state.error) state.error = recoveryError;
    }
  }
  const upsert = (value) => {
    state.items = sortItems(
      state.items.filter((item) => item.id !== value.id && item.deletedAt === null),
    );
    if (value.deletedAt === null) state.items = sortItems([...state.items, copy(value)]);
  };
  async function readList(snapshotContext, { publish = true } = {}) {
    const value = await request("/customer/addresses");
    if (!current(snapshotContext)) return false;
    if (!validList(value)) throw Error("地址列表返回不完整，请重新读取。");
    if (publish) {
      state.items = sortItems(value.items.filter((item) => item.deletedAt === null));
      state.bookRevision = value.bookRevision;
      state.limit = value.limit;
    }
    return copy(value);
  }
  async function reloadAfterWrite(response) {
    state.bookRevision = response.bookRevision;
    state.latestAddress = copy(response.address);
    upsert(response.address);
    state.writeConfirmed = true;
    try {
      const latest = await readList(snapshot());
      if (latest === false) return true;
      state.notice = response.replayed
        ? resultLater(response)
          ? "原操作已完成，地址之后有变更，请查看最新内容。"
          : "原操作已完成，已读取当前地址。"
        : "地址已保存，并已读取最新列表。";
    } catch (error) {
      state.error = "地址已保存，但最新列表读取失败，请重新加载。" + requestIdText(error);
    }
    return true;
  }
  async function applyResponse(response, attempt, snapshotContext) {
    if (!current(snapshotContext)) return false;
    if (!validResponse(response, attempt))
      throw Error("地址操作返回不完整，结果仍待核对，不能解锁。");
    state.latestAddress = copy(response.address);
    state.bookRevision = response.bookRevision;
    upsert(response.address);
    try {
      clear();
    } catch (error) {
      fail(String(error.message || error), friendly({ requestId: error.requestId }));
      return false;
    }
    state.review = false;
    state.reviewReady = false;
    state.reviewAddress = null;
    return reloadAfterWrite(response);
  }
  async function send(attempt, snapshotContext) {
    const response = await request(attempt.path, {
      method: attempt.method,
      headers: { "Idempotency-Key": attempt.key },
      data: copy(attempt.body),
    });
    return applyResponse(response, attempt, snapshotContext);
  }
  async function write(kind, addressId, supplied, currentAddress = null) {
    if (!alive || state.busy || state.loading || state.corrupt || state.pending) {
      if (state.pending) state.error = recoveryError;
      return false;
    }
    if (state.blocked || locked()) {
      if (state.error) state.notice = state.error;
      return false;
    }
    const snapshotContext = snapshot();
    if (!snapshotContext.userId || snapshotContext.userId !== identity) return false;
    state.busy = true;
    state.form.busy = true;
    state.error = "";
    state.notice = "";
    state.writeConfirmed = false;
    let attempt;
    let saved = false;
    try {
      const body = bodyFor(kind, supplied, state.bookRevision);
      attempt = {
        schemaVersion: 1,
        userId: identity,
        kind,
        addressId: addressId || null,
        key: key(),
        method: kind === "UPDATE" ? "PUT" : "POST",
        path: pathFor(kind, addressId || ""),
        body,
      };
      if (!validAttempt(attempt, identity))
        throw Object.assign(Error("地址请求不完整"), { code: "VALIDATION_ERROR", status: 400 });
      save(attempt);
      saved = true;
      return await send(copy(attempt), snapshotContext);
    } catch (error) {
      if (!current(snapshotContext)) return false;
      if (saved && explicitFirstRejection(error)) {
        state.error = friendly(error);
        if (["ADDRESS_CHANGED", "ADDRESS_DELETED"].includes(error.code)) {
          state.review = true;
          state.reviewReady = false;
          state.reviewError = "";
        }
        try {
          clear();
        } catch (clearError) {
          fail(state.error, String(clearError.message || clearError));
        }
      } else {
        state.blocked = true;
        const message = friendly(error);
        fail(message, saved ? "原操作结果尚未确认，请保留原操作并恢复核对。" : "");
      }
      return false;
    } finally {
      if (current(snapshotContext)) {
        state.busy = false;
        state.form.busy = false;
      }
    }
  }
  const controller = {
    state,
    discover,
    async load() {
      if (!alive || state.loading) return false;
      const snapshotContext = snapshot();
      state.loading = true;
      try {
        const result = await readList(snapshotContext);
        if (!result) return false;
        if (!state.pending && !state.corrupt) state.error = "";
        return true;
      } catch (error) {
        if (current(snapshotContext)) state.error = friendly(error);
        return false;
      } finally {
        if (current(snapshotContext)) state.loading = false;
      }
    },
    async get(addressId) {
      if (!alive || !id(addressId) || state.loading) return false;
      const snapshotContext = snapshot();
      state.loading = true;
      try {
        const result = await request("/customer/addresses/" + encodeURIComponent(addressId));
        if (!current(snapshotContext)) return false;
        if (!validDetail(result)) throw Error("地址返回不完整，请重新读取。");
        state.latestAddress = copy(result.address);
        state.bookRevision = result.bookRevision;
        return true;
      } catch (error) {
        if (current(snapshotContext)) state.error = friendly(error);
        return false;
      } finally {
        if (current(snapshotContext)) state.loading = false;
      }
    },
    beginCreate() {
      if (!alive || state.pending || state.blocked) return false;
      state.form = { ...blankForm(), expectedBookRevision: state.bookRevision };
      state.editor = "create";
      state.review = false;
      state.reviewReady = false;
      state.error = "";
      state.notice = "";
      return true;
    },
    beginEdit(value) {
      if (!alive || state.pending || state.blocked || !validAddress(value)) return false;
      state.form = {
        id: value.id,
        expectedBookRevision: state.bookRevision,
        expectedRevision: value.revision,
        name: value.name,
        phone: value.phone,
        region: value.region,
        detail: value.detail,
        point: value.point ? copy(value.point) : null,
        isDefault: value.isDefault,
        busy: false,
        error: "",
        pointNotice: "",
      };
      state.editor = "edit";
      state.review = false;
      state.reviewReady = false;
      state.error = "";
      state.notice = "";
      return true;
    },
    cancelEdit() {
      state.editor = "";
      state.form = blankForm();
      state.review = false;
      state.reviewReady = false;
      state.reviewAddress = null;
      state.error = "";
      state.notice = "";
    },
    async create(values = state.form) {
      const result = await write("CREATE", null, values);
      if (result) state.editor = "";
      return result;
    },
    async update(addressId = state.form.id, values = state.form, value = null) {
      const result = await write("UPDATE", addressId, {
        ...values,
        expectedRevision:
          values.expectedRevision ?? value?.revision ?? state.latestAddress?.revision,
      }, value);
      if (result) state.editor = "";
      return result;
    },
    async setDefault(value) {
      if (!validAddress(value)) return false;
      return write("DEFAULT", value.id, {
        expectedBookRevision: state.bookRevision,
        expectedRevision: value.revision,
      }, value);
    },
    async remove(value) {
      if (!validAddress(value)) return false;
      return write("DELETE", value.id, {
        expectedBookRevision: state.bookRevision,
        expectedRevision: value.revision,
      }, value);
    },
    async reloadForReview() {
      if (!alive || state.loading) return false;
      const snapshotContext = snapshot();
      const targetId =
        state.pending?.addressId || state.form.id || state.latestAddress?.id || null;
      state.loading = true;
      state.reviewReady = false;
      state.reviewError = "";
      try {
        const list = await readList(snapshotContext);
        if (!list) return false;
        let detail = null;
        if (targetId) {
          const value = await request("/customer/addresses/" + encodeURIComponent(targetId));
          if (!current(snapshotContext)) return false;
          if (!validDetail(value)) throw Error("地址返回不完整，请重新读取。");
          detail = value;
        }
        state.reviewBookRevision = detail?.bookRevision ?? list.bookRevision;
        state.reviewAddress = detail?.address ?? null;
        state.latestAddress = detail?.address ?? state.latestAddress;
        state.reviewReady = true;
        state.notice = "已读取最新地址；请核对后再明确选择是否使用最新版本。";
        if (!state.pending) state.error = "";
        return true;
      } catch (error) {
        if (current(snapshotContext)) {
          state.reviewError = friendly(error);
          state.error = state.reviewError;
        }
        return false;
      } finally {
        if (current(snapshotContext)) state.loading = false;
      }
    },
    acceptReview() {
      if (!alive || state.pending || state.blocked || !state.reviewReady) return false;
      state.form.expectedBookRevision = state.reviewBookRevision;
      if (state.form.id && state.reviewAddress?.id === state.form.id)
        state.form.expectedRevision = state.reviewAddress.revision;
      state.review = false;
      state.reviewReady = false;
      state.reviewError = "";
      state.notice = "已明确使用最新版本；原编辑内容保持不变。";
      return true;
    },
    async recover(action = "read") {
      if (!alive || state.busy || state.corrupt || !state.pending) return false;
      if (action !== "read" && action !== "replay") return false;
      const snapshotContext = snapshot();
      const attempt = copy(state.pending);
      state.busy = true;
      state.error = "";
      state.notice = "";
      try {
        if (action === "read") {
          const list = await readList(snapshotContext);
          if (!list) return false;
          if (attempt.addressId) {
            const detail = await request(
              "/customer/addresses/" + encodeURIComponent(attempt.addressId),
            );
            if (!current(snapshotContext)) return false;
            if (!validDetail(detail)) throw Error("地址返回不完整，请重新核对。");
            state.latestAddress = copy(detail.address);
          }
          state.blocked = true;
          state.notice = "已读取最新内容；原操作结果仍待确认，请恢复原操作核对。";
          return true;
        }
        const response = await request(attempt.path, {
          method: attempt.method,
          headers: { "Idempotency-Key": attempt.key },
          data: copy(attempt.body),
        });
        return await applyResponse(response, attempt, snapshotContext);
      } catch (error) {
        if (current(snapshotContext)) {
          state.blocked = true;
          state.pending = attempt;
          fail(friendly(error), recoveryError);
        }
        return false;
      } finally {
        if (current(snapshotContext)) state.busy = false;
      }
    },
    dispose() {
      alive = false;
      generation++;
      Object.assign(state, {
        items: [],
        bookRevision: 0,
        loading: false,
        busy: false,
        blocked: false,
        corrupt: false,
        pending: null,
        error: "",
        notice: "",
        review: false,
        reviewReady: false,
        reviewError: "",
        reviewBookRevision: null,
        reviewAddress: null,
        latestAddress: null,
        editor: "",
        form: blankForm(),
        confirmation: false,
        writeConfirmed: false,
        disposed: true,
      });
    },
  };
  return controller;
}
export { friendly as addressErrorText };
