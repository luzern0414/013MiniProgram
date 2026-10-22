import { draftLocked } from '../../../packages/mini-core/src/cashier-drafts.mjs';
export const cashierLocks = draftLocked;
export const webDraftRequest = api => (path, options) => api(path, options ? {
  method: options.method, body: options.data, key: options.headers?.['Idempotency-Key'],
} : undefined);
export const webDraftStorage = storage => ({
  get: key => storage.getItem(key) ?? undefined,
  set: (key, value) => storage.setItem(key, JSON.stringify(value)),
  remove: key => storage.removeItem(key),
});
export async function recoverDraftCheckout({ state, controller, applyEvent }) {
  if (state.busy) return null;
  if (state.pending && !await controller.recover()) return null;
  const order = state.order;
  if (state.busy || state.blocked || state.pending || !order || state.remote?.state !== 'CONVERTED' ||
    state.remote.orderId !== order.id || state.remote.storeId !== order.storeId) return null;
  const error = applyEvent({ type: 'DRAFT_ORDER_RECONCILED', order });
  if (error) throw new Error(error);
  return order;
}
export function createDraftTakeover({ state, hasCart, load, apply }) {
  state.candidate = null;
  let generation = 0, loading = false;
  async function take(id, version) {
    if (loading) return false;
    loading = true;
    const accept = () => version === generation;
    try {
      if (!await load(id, accept) || !accept()) return false;
      state.candidate = null; apply(); return true;
    } finally { loading = false; }
  }
  return {
    choose(id) { generation++; if (hasCart()) { state.candidate = id; return Promise.resolve(false); } state.candidate = null; return take(id, generation); },
    accept() { return state.candidate ? take(state.candidate, generation) : Promise.resolve(false); },
    cancel() { generation++; state.candidate = null; },
  };
}
