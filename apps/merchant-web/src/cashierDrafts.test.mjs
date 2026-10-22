import test from 'node:test';
import assert from 'node:assert/strict';
import * as bridge from './cashierDrafts.mjs';
import { createDraftController } from '../../../packages/mini-core/src/cashier-drafts.mjs';
import { transitionCheckout } from './checkoutTransitions.mjs';

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const draft = (id, extra = {}) => ({ id, storeId: 's1', name: id, revision: 1, state: 'DRAFT', orderId: null,
  selection: { mode: 'PICKUP', note: '', lines: [{ skuId: 'sku1', quantity: 1, modifierIds: [], attributeOptionIds: [] }] },
  display: { lines: [] }, createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z', ...extra });

test('web adapter preserves original method body and idempotency key', async () => {
  assert.equal(typeof bridge.webDraftRequest, 'function');
  let call; const request = bridge.webDraftRequest(async (...args) => { call = args; return { id: 'd' }; });
  await request('/orders', { method: 'POST', data: { quoteId: 'original' }, headers: { 'Idempotency-Key': 'same-key' } });
  assert.deepEqual(call, ['/orders', { method: 'POST', body: { quoteId: 'original' }, key: 'same-key' }]);
});
test('web session adapter distinguishes absent from damaged empty record', () => {
  assert.equal(typeof bridge.webDraftStorage, 'function');
  const data = new Map(), storage = bridge.webDraftStorage({ getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) });
  assert.equal(storage.get('k'), undefined); data.set('k', ''); assert.equal(storage.get('k'), '');
  storage.set('k', { version: 1 }); assert.deepEqual(JSON.parse(storage.get('k')), { version: 1 });
});
test('nonempty bag requires replacement confirmation and cancel keeps bag untouched', async () => {
  assert.equal(typeof bridge.createDraftTakeover, 'function');
  let loaded = '', applied = 0; const state = {};
  const ctl = bridge.createDraftTakeover({ state, hasCart: () => true, load: async id => { loaded = id; return true; }, apply: () => applied++ });
  await ctl.choose('d1'); assert.equal(loaded, ''); assert.equal(state.candidate, 'd1');
  ctl.cancel(); assert.equal(applied, 0); assert.equal(state.candidate, null);
  await ctl.choose('d2'); await ctl.accept(); assert.equal(loaded, 'd2'); assert.equal(applied, 1);
});
test('all cash, refund, appointment and draft locks combine with OR', () => {
  assert.equal(typeof bridge.cashierLocks, 'function');
  for (let i=0;i<5;i++) { const values = Array(5).fill(false); values[i] = true; assert.equal(bridge.cashierLocks(...values), true); }
  assert.equal(bridge.cashierLocks(false,false), false);
});

test('cancel during accepted load prevents late bag replacement', async () => {
  const wait = deferred(), state = {}; let applied = 0;
  const ctl = bridge.createDraftTakeover({ state, hasCart: () => true, load: () => wait.promise, apply: () => applied++ });
  await ctl.choose('d1'); const taking = ctl.accept(); ctl.cancel(); wait.resolve(true);
  assert.equal(await taking, false); assert.equal(applied, 0); assert.equal(state.candidate, null);
});

test('repeated accept loads once and changing candidate invalidates the original load', async () => {
  const wait = deferred(), state = {}; let calls = 0, applied = 0;
  const ctl = bridge.createDraftTakeover({ state, hasCart: () => true, load: () => { calls++; return wait.promise; }, apply: () => applied++ });
  await ctl.choose('d1'); const first = ctl.accept(), repeated = ctl.accept();
  await ctl.choose('d2'); wait.resolve(true);
  assert.equal(await first, false); assert.equal(await repeated, false);
  assert.equal(calls, 1); assert.equal(applied, 0); assert.equal(state.candidate, 'd2');
  assert.equal(await ctl.accept(), true); assert.equal(applied, 1); assert.equal(calls, 2);
});

for (const converted of [false, true]) test(`cancelled takeover preserves controller selection through late ${converted ? 'order' : 'draft'} GET`, async () => {
  const wait = deferred(), orderWait = deferred(), state = {}, replacement = {};
  const controller = createDraftController({ state, userId: 'u1', storeId: 's1', storage: { get() {}, set() {}, remove() {} },
    request: path => path.startsWith('/orders/') ? orderWait.promise : wait.promise });
  const original = draft('original'); state.remote = original;
  state.edit = { name: 'unsaved', selection: original.selection }; state.quote = { id: 'original-quote' };
  const before = structuredClone({ remote: state.remote, edit: state.edit, quote: state.quote, order: state.order });
  let applied = 0;
  const ctl = bridge.createDraftTakeover({ state: replacement, hasCart: () => true,
    load: (id, accept) => controller.get(id, { accept }), apply: () => applied++ });
  await ctl.choose('d1'); const taking = ctl.accept();
  if (converted) { wait.resolve(draft('d1', { state: 'CONVERTED', orderId: 'o1' })); await Promise.resolve(); await Promise.resolve(); }
  ctl.cancel(); wait.resolve(draft('d1')); orderWait.resolve({ id: 'o1', storeId: 's1' });
  assert.equal(await taking, false); assert.equal(applied, 0); assert.equal(state.busy, false);
  assert.deepEqual({ remote: state.remote, edit: state.edit, quote: state.quote, order: state.order }, before);
});

test('Web draft recovery reconciles the real bound order before releasing tender and sends no cash', async () => {
  assert.equal(typeof bridge.recoverDraftCheckout, 'function');
  const state = {}, values = new Map(), calls = [], wait = deferred(); let converted = false;
  const actualOrder = { id: 'other-clerk-order', storeId: 's1', totalFen: 2000, status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' };
  const controller = createDraftController({ state, userId: 'u1', storeId: 's1',
    storage: { get: k => values.get(k), set: (k,v) => values.set(k, structuredClone(v)), remove: k => values.delete(k) },
    request: async (path, options) => {
      calls.push([path, options]);
      if (options) throw Object.assign(Error('lost conversion'), { code: 'NETWORK' });
      if (path.startsWith('/orders/')) return wait.promise;
      return converted ? draft('d1', { state: 'CONVERTED', orderId: actualOrder.id }) : draft('d1');
    } });
  state.remote = draft('d1'); state.edit = { name: 'd1', selection: state.remote.selection };
  state.quote = { id: 'old-quote', cashierDraft: { id: 'd1', revision: 1 } };
  await controller.convert({ quoteId: 'old-quote', orderKey: 'original-order-key' });
  const original = structuredClone(state.pending);
  let checkout = { quote: { id: 'old-quote', totalFen: 1000 }, submittedFen: 1000, tendered: '10.00', orderKey: 'original-order-key', uncertain: true };
  let events = 0;
  const applyEvent = event => { events++; const result = transitionCheckout(checkout, event); checkout = result.state; return result.error; };
  assert.equal(await bridge.recoverDraftCheckout({ state, controller, applyEvent }), null);
  assert.equal(events, 0); assert.deepEqual(state.pending, original); assert.equal(checkout.submittedFen, 1000);
  converted = true; const recovery = bridge.recoverDraftCheckout({ state, controller, applyEvent });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(checkout.submittedFen, 1000); assert.deepEqual(state.pending, original);
  wait.resolve(actualOrder); assert.deepEqual(await recovery, actualOrder);
  assert.equal(state.pending, null); assert.equal(events, 1);
  assert.equal(checkout.quote, undefined); assert.equal(checkout.submittedFen, undefined);
  assert.equal(checkout.orderKey, 'original-order-key'); assert.equal(checkout.order.id, actualOrder.id);
  const submitted = transitionCheckout(checkout, { type: 'SUBMIT', tendered: '20.00', now: Date.now() });
  assert.equal(submitted.error, undefined); assert.equal(submitted.state.submittedFen, 2000);
  assert.equal(calls.filter(([, options]) => options).length, 1);
  assert.ok(calls.every(([path]) => !path.includes('cash-payment')));
  checkout = { ...submitted.state, submittedFen: 3000, uncertain: true };
  await bridge.recoverDraftCheckout({ state, controller, applyEvent });
  assert.equal(checkout.submittedFen, 3000); assert.equal(checkout.orderKey, 'original-order-key');
});

test('Web recovery refuses stale, unbound or still blocked draft order facts', async () => {
  assert.equal(typeof bridge.recoverDraftCheckout, 'function');
  let events = 0;
  for (const extra of [{ blocked: true }, { busy: true }, { remote: draft('d1') }, { remote: draft('d1', { state: 'CONVERTED', orderId: 'different' }) }, { pending: { kind: 'convert' } }]) {
    const state = { remote: draft('d1', { state: 'CONVERTED', orderId: 'o1' }), order: { id: 'o1', storeId: 's1' }, ...extra };
    assert.equal(await bridge.recoverDraftCheckout({ state, controller: { recover: async () => false }, applyEvent: () => events++ }), null);
  }
  assert.equal(events, 0);
});
