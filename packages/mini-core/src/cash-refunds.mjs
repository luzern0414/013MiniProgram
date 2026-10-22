// One pending attempt per identity, across stores. Never infer POST success from GET.
export const refundLocked = (...locks) => locks.some(Boolean);
export const refundStorageKey = (userId) => `cash-refund:v1:${userId}`;
const copy = (value) => JSON.parse(JSON.stringify(value));
export function refundAmount(text, order) {
  const value = String(text).trim();
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value))
    throw Error("请输入退款金额，最多两位小数");
  const [whole, fraction = ""] = value.split(".");
  const fen = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  const available = order?.cashReceipt?.amountFen - (order?.refundedFen ?? 0);
  if (
    !Number.isSafeInteger(fen) ||
    fen <= 0 ||
    !Number.isSafeInteger(available) ||
    fen > available
  )
    throw Error("本次退款须大于零且不超过当前可退金额");
  return fen;
}
export function readRefundAttempt(storage, userId) {
  try {
    const raw = storage.get(refundStorageKey(userId));
    if (raw === undefined) return { attempt: null, error: "" };
    const a = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (
      a?.version !== 1 ||
      a.userId !== userId ||
      !["storeId", "orderId", "key", "reason"].every(
        (k) => typeof a[k] === "string" && a[k].trim(),
      ) ||
      a.reason !== a.reason.trim() ||
      a.reason.length > 500 ||
      a.key.length > 120 ||
      !Number.isSafeInteger(a.amountFen) ||
      a.amountFen < 1 ||
      !["unknown", "rejected", "confirmed"].includes(a.phase)
    )
      throw Error();
    return { attempt: copy(a), error: "" };
  } catch {
    return {
      attempt: null,
      error: "退款恢复记录无法读取，请联系店主核对原退款；核对前不能新增退款。",
    };
  }
}
export function createCashRefund({
  state,
  storage,
  request,
  context,
  beforeNew,
  onOrder = (order) => {},
  key = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
}) {
  const identity = context().userId;
  const restored = readRefundAttempt(storage, identity);
  Object.assign(state, {
    amount: "",
    reason: "",
    busy: false,
    blocked: !!(restored.attempt || restored.error),
    attempt: restored.attempt,
    error: restored.error,
    corrupt: !!restored.error,
    notice: "",
    expanded: !!restored.attempt,
    review: false,
  });
  let alive = true;
  const current = (c) =>
    alive &&
    context().userId === c.userId &&
    context().storeId === c.storeId &&
    (!context().order || context().order.id === c.orderId);
  const explain = (e) =>
    `${e.message || "操作失败"}${e.code ? `（${e.code}）` : ""}${e.requestId ? ` 编号 ${e.requestId}` : ""}`;
  function save(a) {
    storage.set(refundStorageKey(identity), copy(a));
    const actual = readRefundAttempt(storage, identity);
    if (actual.error || JSON.stringify(actual.attempt) !== JSON.stringify(a))
      throw Error("退款进度保存失败，请检查存储后重试");
  }
  function clear() {
    storage.remove(refundStorageKey(identity));
    const actual = readRefundAttempt(storage, identity);
    if (actual.error || actual.attempt)
      throw Error("退款已核对，但恢复记录未能清理，请重试核对");
    state.attempt = null;
    state.blocked = false;
  }
  function confirmedReceipt() {
    clear();
    Object.assign(state, {
      expanded: false,
      review: false,
      amount: "",
      reason: "",
      error: "",
      notice: "现金退款已登记，已读取最新凭证",
    });
  }
  function scope() {
    const c = context();
    const a = state.attempt;
    if (
      c.userId !== identity ||
      (a &&
        (a.userId !== c.userId ||
          a.storeId !== c.storeId ||
          (c.order && c.order.id !== a.orderId)))
    )
      throw Error("请在原账号及原门店核对退款");
    return { ...c, orderId: c.order?.id || a?.orderId };
  }
  async function read(c) {
    const id = state.attempt?.orderId || c.order?.id;
    if (!id) throw Error("请先选择原退款订单");
    const value = await request(`/orders/${encodeURIComponent(id)}`);
    if (!current(c)) return false;
    if (
      value?.id !== id ||
      value.storeId !== c.storeId ||
      !value.cashReceipt ||
      !Array.isArray(value.cashRefunds)
    )
      throw Error("退款凭证读取不完整，请重新核对");
    onOrder(value);
    return true;
  }
  async function load() {
    if (!alive || state.busy || state.corrupt) return false;
    state.busy = true;
    let c;
    try {
      c = scope();
      if (!(await read(c))) return false;
      state.error = "";
      if (state.attempt?.phase === "confirmed") confirmedReceipt();
      else if (state.attempt?.phase === "rejected") {
        clear();
        state.notice = "已重新读取可退余额，可以修改金额后核对新退款。";
      } else if (state.attempt)
        state.notice = "已读取最新明细；本次结果尚未确认，请恢复原退款核对。";
      return true;
    } catch (e) {
      if (!c || current(c)) state.error = explain(e);
      return false;
    } finally {
      if (alive) state.busy = false;
    }
  }
  async function submit(confirmed) {
    if (!alive || state.busy || state.corrupt) return false;
    let c;
    let sent = false;
    let previouslyUnknown = !!state.attempt;
    state.busy = true;
    state.error = "";
    state.notice = "";
    try {
      c = scope();
      if (!confirmed) throw Error("请先确认已向顾客退还现金");
      if (c.owner !== true) throw Error("仅店主可登记现金退款");
      if (!state.attempt) {
        const reason = state.reason.trim();
        if (!reason || reason.length > 500)
          throw Error("请填写退款原因，最多500字");
        const amountFen = refundAmount(state.amount, c.order);
        if (beforeNew) { await beforeNew(c); if (!current(c)) return false; }
        const attempt = {
          version: 1,
          userId: identity,
          storeId: c.storeId,
          orderId: c.order?.id,
          key: key(),
          amountFen,
          reason,
          phase: "unknown",
        };
        try {
          save(attempt);
        } catch {
          throw Error("退款进度保存失败，尚未发送退款，请检查存储后重试");
        }
        state.attempt = attempt;
        state.blocked = true;
      }
      const a = copy(state.attempt);
      // Rejected/confirmed attempts need only a fresh read, never another write.
      if (a.phase !== "unknown") {
        if (await read(c)) {
          if (a.phase === "confirmed") confirmedReceipt();
          else clear();
        }
        return true;
      }
      sent = true;
      const response = await request(
        `/merchant/orders/${encodeURIComponent(a.orderId)}/cash-refunds`,
        {
          method: "POST",
          headers: { "Idempotency-Key": a.key },
          data: {
            storeId: a.storeId,
            amountFen: a.amountFen,
            reason: a.reason,
          },
        },
      );
      if (!current(c)) return false;
      if (
        response?.id !== a.orderId ||
        response.storeId !== a.storeId ||
        !response.cashReceipt ||
        !Array.isArray(response.cashRefunds)
      )
        throw Error("退款响应不完整");
      state.attempt.phase = "confirmed";
      save(state.attempt);
      if (!(await read(c))) return false;
      confirmedReceipt();
      return true;
    } catch (e) {
      if (c && !current(c)) return false;
      state.error = explain(e);
      if (sent && !previouslyUnknown && e.status === 409 && e.code === 'SHIFT_REQUIRED') {
        // This first transaction definitively did not commit. Preserve the form,
        // and permit navigation to open a shift even while order GET is offline.
        try { state.attempt.phase = 'rejected'; save(state.attempt); clear(); }
        catch (clearError) { state.error += `；${explain(clearError)}`; }
      } else if (
        sent &&
        !previouslyUnknown &&
        [400, 409, 401, 403, 404].includes(e.status)
      ) {
        state.attempt.phase = "rejected";
        try {
          save(state.attempt);
          if (await read(c)) clear();
        } catch (readError) {
          state.error += `；${explain(readError)}，请重新读取订单后再编辑`;
        }
      } else if (state.attempt?.phase === "confirmed")
        state.error += "；登记已确认，请重新读取退款凭证";
      else if (sent || state.attempt)
        state.error += "；结果尚未确认，请保留原退款并恢复核对";
      return false;
    } finally {
      if (alive) state.busy = false;
    }
  }
  return {
    load,
    submit,
    async checkNew() {
      if (!alive || state.busy || state.blocked || state.corrupt) return false;
      let c; state.busy = true; state.error = '';
      try {
        c = scope();
        if (c.owner !== true) throw Error('仅店主可登记现金退款');
        if (beforeNew) await beforeNew(c);
        return current(c);
      } catch(e) { if (!c || current(c)) state.error = explain(e); return false; }
      finally { if (alive && (!c || current(c))) state.busy = false; }
    },
    dispose() {
      alive = false;
    },
  };
}
