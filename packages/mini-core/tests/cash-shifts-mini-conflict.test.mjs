import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftStorageKey } from '../src/cash-shifts.mjs';
import { login } from './cash-shifts-mini-fixture.mjs';

const cashKey = 'cash-attempt:v1:owner';
const cashPending = { orderId: 'o1', storeId: 'a', tenderedFen: 200, key: 'original-cash-conflict' };
const shiftPending = { version: 1, userId: 'owner', storeId: 'b', kind: 'open', key: 'original-shift', data: { storeId: 'b', openingFen: 100 } };
const refundPending = { version: 1, userId: 'owner', storeId: 'a', orderId: 'refund-original', key: 'original-refund', amountFen: 50, reason: '原原因', phase: 'unknown' };
const receipt = { amountFen: 100, tenderedFen: 200, changeFen: 100, shiftId: 'shift-a' };
const copy = value => JSON.parse(JSON.stringify(value));

async function conflict() {
  let finish, started;
  const reading = new Promise(resolve => { started = resolve; });
  const r = await login({ cashPending, shiftPending, refundPending,
    request: ({ path, ok, bad }) => {
      if (path.endsWith('/cash-payment')) { bad(409, 'STATE_CONFLICT'); return true; }
      if (path === '/orders/o1') { finish = ok; started(); return true; }
    } });
  r.m.order.value = { ...r.order, number: '核对前原订单' };
  r.m.sheet.value = 'cash';
  const recovery = r.m.cash(true);
  await reading;
  assert.deepEqual(r.values.get(cashKey), cashPending);
  assert.deepEqual(r.values.get(shiftStorageKey('owner')), shiftPending);
  return { ...r, recovery, finish };
}
function assertRecords(r, cashRetained = true) {
  assert.deepEqual(r.values.get(cashKey), cashRetained ? cashPending : undefined);
  assert.deepEqual(r.values.get(shiftStorageKey('owner')), shiftPending);
  assert.deepEqual(r.values.get('cash-refund:v1:owner'), refundPending);
  const writes = r.calls.filter(c => c.method === 'POST' && c.path.endsWith('/cash-payment'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].headers['Idempotency-Key'], cashPending.key);
  assert.deepEqual(writes[0].data, { tenderedFen: cashPending.tenderedFen });
  assert.equal(r.calls.some(c => c.path.includes('/cash-shifts/current')), false);
}
function view(m) { return { order: copy(m.order.value), sheet: m.sheet.value, tab: m.tab.value, notice: m.notice.value }; }

for (const scope of ['session-expired', 'store-changed', 'identity-changed', 'same-user-new-session']) {
  test(`STATE_CONFLICT late GET after ${scope} preserves original records and current view`, async () => {
    const r = await conflict(), { m } = r;
    if (scope === 'session-expired') uni.$emit('session-expired');
    if (scope === 'store-changed') m.storeId.value = 'b';
    if (scope === 'identity-changed') m.user.value = { ...m.user.value, id: 'other-owner' };
    if (scope === 'same-user-new-session') m.user.value = { ...m.user.value };
    const before = view(m);
    r.finish({ ...r.order, paymentStatus: 'PAID', cashReceipt: receipt });
    await r.recovery;
    assert.deepEqual(view(m), before, 'late result must not publish an order, route, sheet or success');
    assertRecords(r);
    if (scope === 'session-expired') {
      assert.equal(m.user.value, null); assert.equal(m.pendingCash.value, null);
      await m.login('owner');
      assert.deepEqual(copy(m.pendingCash.value), cashPending);
      assert.equal(m.shiftBusy.value, true); assert.equal(m.refundBusy.value, true);
    } else assert.deepEqual(copy(m.pendingCash.value), cashPending);
  });
}

for (const [name, fact] of [
  ['wrong order id', { id: 'other-order', storeId: 'a', status: 'COMPLETED', paymentStatus: 'PAID', cashReceipt: receipt }],
  ['wrong store', { id: 'o1', storeId: 'b', status: 'COMPLETED', paymentStatus: 'PAID', cashReceipt: receipt }],
  ['missing id', { storeId: 'a', status: 'CANCELLED', paymentStatus: 'UNPAID' }],
  ['missing store', { id: 'o1', status: 'CANCELLED', paymentStatus: 'UNPAID' }],
  ['missing status', { id: 'o1', storeId: 'a', paymentStatus: 'UNPAID' }],
  ['missing payment status', { id: 'o1', storeId: 'a', status: 'PENDING_PAYMENT' }],
  ['unknown status', { id: 'o1', storeId: 'a', status: 'UNKNOWN', paymentStatus: 'UNPAID', cashReceipt: null }],
  ['unknown payment status', { id: 'o1', storeId: 'a', status: 'PENDING_PAYMENT', paymentStatus: 'UNKNOWN', cashReceipt: null }],
  ['missing receipt field', { id: 'o1', storeId: 'a', status: 'CANCELLED', paymentStatus: 'CLOSED' }],
  ['incomplete receipt', { id: 'o1', storeId: 'a', status: 'AWAITING_ACCEPTANCE', paymentStatus: 'PAID', cashReceipt: {} }],
  ['null order', null],
]) test(`STATE_CONFLICT ${name} cannot publish facts or clear original cash`, async () => {
  const r = await conflict(), before = view(r.m);
  r.finish(fact); await r.recovery;
  assert.deepEqual(view(r.m), before);
  assert.deepEqual(copy(r.m.pendingCash.value), cashPending);
  assert.match(r.m.error.value, /订单读取不完整/);
  assertRecords(r);
  assert.equal(r.m.shiftBusy.value, true); assert.equal(r.m.refundBusy.value, true);
});

for (const resolved of ['receipt', 'closed']) test(`STATE_CONFLICT same-scope original ${resolved} resolves only original cash lock`, async () => {
  const r = await conflict();
  const actual = { ...r.order, ...(resolved === 'receipt' ? { status: 'AWAITING_ACCEPTANCE', paymentStatus: 'PAID', cashReceipt: receipt } : { status: 'CANCELLED' }) };
  r.finish(actual); await r.recovery;
  assert.equal(r.m.pendingCash.value, null); assert.deepEqual(copy(r.m.order.value), actual);
  assert.equal(r.m.sheet.value, ''); assert.equal(r.m.tab.value, 'orders');
  assertRecords(r, false);
  assert.equal(r.m.shiftBusy.value, true); assert.equal(r.m.refundBusy.value, true);
  r.m.navigate('products'); await r.m.selectStore('b'); await r.m.logout();
  assert.equal(r.m.storeId.value, 'a'); assert.equal(r.m.tab.value, 'orders'); assert.equal(r.m.user.value.id, 'owner');
  if (resolved === 'receipt') assert.match(r.m.notice.value, /原收款已确认/);
  else assert.match(r.m.error.value, /订单已关闭或状态已更新/);
});
