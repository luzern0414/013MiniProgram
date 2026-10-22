import { useMerchant } from '../../../apps/merchant-mini/src/merchant.js';
import { shiftStorageKey } from '../src/cash-shifts.mjs';

const clone = v => structuredClone(v);
const pending = (storeId = 'b') => ({ version: 1, userId: 'owner', storeId, kind: 'open', key: 'original-shift', data: { storeId, openingFen: 100 } });
export const shiftFact = (storeId = 'a') => ({ id: 'shift-a', storeId, state: 'OPEN', revision: 0, openingFen: 100,
  openedBy: { id: 'owner', name: '店主' }, openedAt: '2026-10-21T00:00:00Z', closedBy: null, closedAt: null,
  summary: { paymentCount: 0, refundCount: 0, paidFen: 0, refundFen: 0, netFen: 0, expectedFen: 100, countedFen: null, differenceFen: null, reason: null } });
export function runtime({ shiftPending, cashPending, refundPending, role = 'OWNER', shift = shiftFact(), request: custom } = {}) {
  const values = new Map(), calls = [], listeners = new Map();
  const user = { id: 'owner', role, name: '店主', storeIds: ['a', 'b'] };
  const order = { id: 'o1', number: 'O1', storeId: 'a', totalFen: 100, status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', cashReceipt: null, cashRefunds: [], refundedFen: 0 };
  if (shiftPending !== undefined) values.set(shiftStorageKey('owner'), clone(shiftPending));
  if (cashPending) values.set('cash-attempt:v1:owner', clone(cashPending));
  if (refundPending) values.set('cash-refund:v1:owner', clone(refundPending));
  globalThis.uni = {
    getStorageInfoSync: () => ({ keys: [...values.keys()] }), getStorageSync: k => values.has(k) ? values.get(k) : '',
    setStorageSync: (k, v) => values.set(k, clone(v)), removeStorageSync: k => values.delete(k),
    $on: (n, fn) => listeners.set(n, fn), $emit: n => listeners.get(n)?.(), showModal: o => o.success({ confirm: true }),
    request(o) {
      const url = new URL(o.url), path = url.pathname.replace('/api/v1', ''); calls.push({ path, query: url.search, method: o.method, data: clone(o.data), headers: clone(o.header) });
      const ok = data => queueMicrotask(() => o.success({ statusCode: 200, data: { data: clone(data) } }));
      const bad = (status, code) => queueMicrotask(() => o.success({ statusCode: status, data: { error: { code, message: code }, requestId: 'isolated-request' } }));
      const override = custom?.({ path, options: o, ok, bad, order, shift }); if (override === true) return;
      if (path === '/public-config') return ok({ environment: 'development' });
      if (path === '/stores') return ok(['a', 'b'].map(id => ({ id, name: id, serviceModes: ['PICKUP'] })));
      if (path === '/auth/dev-login' || path === '/auth/staff-login') return ok({ token: 'isolated', user });
      if (path === '/me') return ok(user);
      if (path === '/merchant/overview') return ok({});
      if (path === '/merchant/products') return ok({ categories: [], products: [] });
      if (/^\/stores\/[ab]\/catalog$/.test(path)) return ok({ categories: [], products: [] });
      if (/^\/stores\/[ab]\/tables$/.test(path)) return ok([]);
      if (path === '/orders') return ok({ items: [], total: 0 });
      if (path === '/orders/o1') return ok(order);
      if (path === '/merchant/cash-shifts/current') return ok({ shift });
      if (path === '/merchant/cash-shifts' && o.method === 'GET') return ok({ items: [], total: 0, page: 1, pageSize: 20 });
      if (path === '/merchant/cash-shifts' || path === '/merchant/cash-shifts/shift-a') return ok(shiftFact('b'));
      if (path === '/merchant/orders/o1/cash-payment') return ok({ ...order, cashReceipt: { amountFen: 100, tenderedFen: 200, changeFen: 100, shiftId: 'shift-a' }, paymentStatus: 'PAID' });
      if (path === '/merchant/orders/o1/cash-refunds') return ok(order);
      if (path === '/auth/logout') return ok({});
      throw Error(`Unexpected isolated request ${path}`);
    },
  };
  return { values, calls, listeners, order, user };
}
export async function login(options) { const r = runtime(options), m = useMerchant(); await m.init(); await m.login('owner'); return { ...r, m }; }
