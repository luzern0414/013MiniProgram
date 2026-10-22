import { submittedCash, confirmedCash } from "./recovery.mjs";
export const transitionCheckout = (previous, event) => {
  const state = { ...previous };
  if (event.type === "CREATE_REJECTED" && !state.order) {
    state.quote = undefined;
    state.submittedFen = undefined;
    state.uncertain = false;
    state.orderKey = event.key;
  }
  if (event.type === "CART_CHANGED" && !state.order && !state.uncertain) {
    state.quote = undefined;
    state.submittedFen = undefined;
    state.orderKey = event.key;
  }
  if (event.type === "QUOTE_RECEIVED" && !state.order && !state.uncertain) {
    state.quote = event.quote;
    state.submittedFen = undefined;
  }
  if (event.type === "SUBMIT") {
    if (
      !state.order &&
      !state.uncertain &&
      (!state.quote || Date.parse(state.quote.expiresAt) <= event.now)
    )
      return {
        state: { ...state, quote: undefined, submittedFen: undefined },
        error: "报价已过期，请重新核对金额。",
      };
    try {
      state.submittedFen = submittedCash(
        state.submittedFen,
        event.tendered,
        state.order?.totalFen ?? state.quote.totalFen,
      );
    } catch (error) {
      return { state, error: error.message };
    }
  }
  if (event.type === "RECONCILE_FAILED") state.uncertain = true;
  if (event.type === 'CASH_SHIFT_REQUIRED_FIRST') state.uncertain = false;
  if (event.type === 'DRAFT_ORDER_RECONCILED') {
    const existing = state.order || state.paid;
    if (existing && existing.id !== event.order.id)
      return { state, error: '请先核对当前订单收款，不能替换为另一笔挂单订单。' };
    // No cash request can have been sent before an order was bound locally.
    // Re-reading an already bound order must keep any unknown cash attempt frozen.
    if (!existing) {
      state.quote = undefined;
      state.submittedFen = undefined;
      state.tendered = (event.order.totalFen / 100).toFixed(2);
    }
  }
  if (event.type === "RECONCILED" || event.type === 'DRAFT_ORDER_RECONCILED') {
    state.order = event.order;
    if (event.order.paymentStatus === "PAID") {
      try {
        state.receipt = confirmedCash(event.order);
        state.paid = event.order;
        state.uncertain = false;
        state.terminal = false;
      } catch (error) {
        return { state: { ...state, uncertain: true }, error: error.message };
      }
    } else if (
      event.order.status === "CANCELLED" ||
      event.order.paymentStatus === "CLOSED"
    ) {
      state.terminal = true;
      state.uncertain = false;
      state.paid = undefined;
      state.receipt = undefined;
    } else {
      state.terminal = false;
      state.uncertain = !!(previous.order && previous.uncertain);
    }
  }
  return { state, error: undefined };
};
