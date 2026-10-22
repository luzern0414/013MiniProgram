import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftStorageKey } from '../src/cash-shifts.mjs';
import { login } from './cash-shifts-mini-fixture.mjs';
const pending = (storeId = 'b') => ({ version: 1, userId: 'owner', storeId, kind: 'open', key: 'original-shift', data: { storeId, openingFen: 100 } });
test('persistent shift is independently discovered before any component mounts and blocks navigation, writes, logout', async () => {
  const r = await login({ shiftPending: pending() }), { m } = r;
  assert.equal(m.shiftBusy?.value, true); assert.equal(m.storeId.value, 'b');
  const before = r.calls.length; m.navigate('products'); await m.selectStore('a'); await m.logout(); m.openCash(r.order); await m.transition(r.order, 'ACCEPT', '接单');
  assert.equal(m.user.value.id, 'owner'); assert.equal(m.storeId.value, 'b'); assert.equal(m.cashOrder.value, null); assert.equal(r.calls.length, before);
  assert.equal(await m.showShifts(), true); assert.equal(m.tab.value, 'shifts');
  await m.shifts.value.recover('replay'); assert.equal(m.shiftBusy.value, false); assert.equal(r.values.has(shiftStorageKey('owner')), false);
  const post = r.calls.find(c => c.path === '/merchant/cash-shifts' && c.method === 'POST');
  assert.equal(post.headers['Idempotency-Key'], 'original-shift'); assert.deepEqual(post.data, { storeId: 'b', openingFen: 100 });
});
for (const value of ['', null, '{bad']) test(`uni existing ${JSON.stringify(value)} is corruption, missing is empty`, async () => {
  const { m } = await login({ shiftPending: value }); assert.equal(m.shiftBusy?.value, true); assert.equal(m.shifts.value.state.corrupt, true);
  m.navigate('orders'); assert.equal(m.tab.value, 'overview'); await m.logout(); assert.ok(m.user.value);
});
test('new cash reads active shift first, preserves order and tendered input if none, and writes nothing', async () => {
  const r = await login({ shift: null }), { m } = r; m.openCash(r.order); m.tendered.value = '2.00'; await m.cash();
  assert.equal(r.calls.filter(c => c.path.includes('cash-payment')).length, 0); assert.ok(r.calls.some(c => c.path.includes('/cash-shifts/current')));
  assert.equal(m.tendered.value, '2.00'); assert.equal(m.cashOrder.value.id, 'o1'); assert.equal(m.pendingCash.value, null); assert.match(m.error.value, /开班/);
});
test('new cash uses server total and current preflight; only tendered is submitted', async () => {
  const r = await login(), { m } = r; m.openCash(r.order); m.tendered.value = '2'; await m.cash();
  const active = r.calls.findIndex(c => c.path.endsWith('/cash-shifts/current')), post = r.calls.findIndex(c => c.path.endsWith('cash-payment'));
  assert.ok(active >= 0 && active < post); assert.deepEqual(r.calls[post].data, { tenderedFen: 200 }); assert.equal(m.pendingCash.value, null);
});
test('original cash recovery precedes shift recovery across stores and resolving one never unlocks the other', async () => {
  const cashPending = { orderId: 'o1', storeId: 'a', tenderedFen: 200, key: 'original-cash' };
  const r = await login({ shiftPending: pending(), cashPending }), { m } = r;
  assert.equal(m.storeId.value, 'a'); assert.equal(await m.showShifts(), false);
  await m.cash(true); assert.equal(m.pendingCash.value, null); assert.equal(m.shiftBusy.value, true); assert.equal(m.tab.value, 'orders');
  assert.equal(r.calls.some(c => c.path.includes('/cash-shifts/current')), false, 'old unknown never uses new-payment preflight');
  const post = r.calls.find(c => c.path.endsWith('cash-payment')); assert.equal(post.headers['Idempotency-Key'], 'original-cash');
  assert.equal(await m.showShifts(), true); assert.equal(m.storeId.value, 'b'); assert.equal(m.tab.value, 'shifts');
  await m.shifts.value.recover('replay'); assert.equal(m.shiftBusy.value, false);
});
test('original unknown SHIFT_REQUIRED reads original receipt and keeps original key if not resolved', async () => {
  const cashPending = { orderId: 'o1', storeId: 'a', tenderedFen: 200, key: 'old-cash' };
  const r = await login({ cashPending, request: ({ path, bad }) => { if (path.endsWith('cash-payment')) { bad(409, 'SHIFT_REQUIRED'); return true; } } });
  await r.m.cash(true); assert.equal(r.m.pendingCash.value.key, 'old-cash'); assert.ok(r.calls.some(c => c.path === '/orders/o1')); assert.equal(r.calls.some(c => c.path.includes('/cash-shifts/current')), false);
});
test('first definitive SHIFT_REQUIRED releases only new cash attempt and retains form', async () => {
  const r = await login({ request: ({ path, bad }) => { if (path.endsWith('cash-payment')) { bad(409, 'SHIFT_REQUIRED'); return true; } } });
  r.m.openCash(r.order); r.m.tendered.value = '2'; await r.m.cash();
  assert.equal(r.m.pendingCash.value, null); assert.equal(r.m.cashOrder.value.id, 'o1'); assert.equal(r.m.tendered.value, '2'); assert.match(r.m.error.value, /开班/);
});
test('new refund checks current before review and before submit; missing shift keeps refund input', async () => {
  const r = await login({ shift: null }); Object.assign(r.order, { cashReceipt: { amountFen: 100 }, paymentStatus: 'PAID' }); r.m.order.value = r.order;
  r.m.refund.amount = '0.50'; r.m.refund.reason = '保留原因';
  assert.equal(await r.m.refundCtl.value.checkNew(), false); assert.equal(await r.m.refundCtl.value.submit(true), false);
  assert.equal(r.calls.filter(c => c.path.endsWith('cash-refunds')).length, 0); assert.equal(r.m.refund.amount, '0.50'); assert.equal(r.m.refund.reason, '保留原因'); assert.match(r.m.refund.error, /开班/);
});
test('original refund unknown keeps recovery reachable with shift and cash locks, and no new-shift preflight', async () => {
  const refundPending = { version: 1, userId: 'owner', storeId: 'a', orderId: 'o1', key: 'old-refund', amountFen: 50, reason: '原原因', phase: 'unknown' };
  const r = await login({ shiftPending: pending(), refundPending }); Object.assign(r.order, { cashReceipt: { amountFen: 100 }, cashRefunds: [], paymentStatus: 'PAID' });
  assert.equal(r.m.tab.value, 'orders'); assert.equal(await r.m.showShifts(), false); await r.m.refundCtl.value.load(); await r.m.refundCtl.value.submit(true);
  assert.equal(r.m.refundBusy.value, false); assert.equal(r.m.shiftBusy.value, true); assert.equal(r.calls.some(c => c.path.includes('/cash-shifts/current')), false);
  assert.equal(await r.m.showShifts(), true); assert.equal(r.m.storeId.value, 'b');
});
test('refresh discovers newly persisted shift and session expiry retains identity record for relogin', async () => {
  const r = await login(); r.values.set(shiftStorageKey('owner'), pending()); await r.m.refresh();
  assert.equal(r.m.shiftBusy?.value, true); await r.m.showShifts(); assert.equal(r.m.storeId.value, 'b');
  uni.$emit('session-expired'); assert.equal(r.m.user.value, null); assert.ok(r.values.has(shiftStorageKey('owner')));
  await r.m.login('owner'); assert.equal(r.m.shiftBusy.value, true); assert.equal(r.m.storeId.value, 'b');
});
test('customer identity gets neither controller nor shift entry', async () => {
  const r = await login({ role: 'CUSTOMER', shiftPending: pending() }); assert.equal(r.m.user.value, null); assert.equal(r.m.shifts?.value, null);
});
test('cash recovery leaves a different-store refund reachable before shift recovery', async () => {
  const refundPending = { version: 1, userId: 'owner', storeId: 'b', orderId: 'o1', key: 'old-refund', amountFen: 50, reason: '原原因', phase: 'unknown' };
  const r = await login({ shiftPending: pending(), cashPending: { orderId: 'o1', storeId: 'a', tenderedFen: 200, key: 'old-cash' }, refundPending });
  await r.m.cash(true); assert.equal(r.m.pendingCash.value, null); assert.equal(r.m.refundBusy.value, true);
  assert.equal(await r.m.returnToRefundStore(), true); assert.equal(r.m.storeId.value, 'b'); assert.equal(r.m.tab.value, 'orders');
  Object.assign(r.order, { storeId: 'b', cashReceipt: { amountFen: 100 }, cashRefunds: [], paymentStatus: 'PAID' });
  await r.m.refundCtl.value.load(); await r.m.refundCtl.value.submit(true); assert.equal(r.m.refundBusy.value, false); assert.equal(r.m.shiftBusy.value, true);
});
test('late cash confirmation after leaving the original sheet cannot submit a new payment', async () => {
  const r = await login(); let modal;
  uni.showModal = options => { modal = options; };
  r.m.openCash(r.order); r.m.tendered.value = '2'; const sending = r.m.cash();
  while (!modal) await Promise.resolve();
  r.m.navigate('overview'); modal.success({ confirm: true }); await sending;
  assert.equal(r.calls.some(c => c.path.endsWith('cash-payment')), false); assert.equal(r.m.pendingCash.value, null);
});
test('explicit return from shifts reads original cash order and restores tender without automatically charging', async () => {
  const r = await login({ shift: null }); r.m.openCash(r.order); r.m.tendered.value = '2.00'; await r.m.cash();
  assert.equal(await r.m.showShifts(), true); assert.equal(await r.m.resumeCash(), true);
  assert.equal(r.m.sheet.value, 'cash'); assert.equal(r.m.cashOrder.value.id, 'o1'); assert.equal(r.m.tendered.value, '2.00');
  assert.equal(r.calls.filter(c => c.path.endsWith('cash-payment')).length, 0); assert.ok(r.calls.some(c => c.path === '/orders/o1'));
});
test('explicit return from shifts preserves original refund order, amount and reason after reading server order', async () => {
  const r = await login({ shift: null }); Object.assign(r.order, { cashReceipt: { amountFen: 100 }, paymentStatus: 'PAID' }); r.m.order.value = r.order;
  Object.assign(r.m.refund, { expanded: true, amount: '0.50', reason: '原退款原因' }); await r.m.refundCtl.value.checkNew();
  assert.equal(await r.m.showShifts(), true); assert.equal(await r.m.resumeRefund(), true);
  assert.equal(r.m.order.value.id, 'o1'); assert.equal(r.m.refund.amount, '0.50'); assert.equal(r.m.refund.reason, '原退款原因'); assert.equal(r.m.refund.expanded, true);
  assert.equal(r.calls.filter(c => c.path.endsWith('cash-refunds')).length, 0);
});
test('draft return cannot dispose an active shift read or release its navigation lock', async () => {
  let finish;
  const r = await login({ request: ({ path, ok, shift }) => { if (path.endsWith('/cash-shifts/current')) { finish = () => ok({ shift }); return true; } } });
  const controller = r.m.shifts.value, reading = controller.current(); assert.equal(r.m.shiftBusy.value, true);
  await r.m.returnToDraftStore(); assert.equal(r.m.shifts.value, controller); assert.equal(r.m.tab.value, 'overview');
  finish(); await reading; assert.equal(r.m.shiftBusy.value, false);
});
test('late shift-store handoff load cannot select a route after session expiry', async () => {
  let finish, delay = false;
  const r = await login({ shiftPending: pending(), request: ({ path, ok }) => { if (delay && path === '/merchant/overview') { finish = () => ok({}); return true; } } });
  r.m.storeId.value = 'a'; delay = true; const handoff = r.m.showShifts();
  while (!finish) await Promise.resolve(); uni.$emit('session-expired'); finish();
  assert.equal(await handoff, false); assert.equal(r.m.user.value, null); assert.equal(r.m.tab.value, 'overview'); assert.ok(r.values.has(shiftStorageKey('owner')));
});
test('cash recovery at same store cannot strand a different original refund order', async () => {
  const refundPending = { version: 1, userId: 'owner', storeId: 'a', orderId: 'refund-original', key: 'old-refund', amountFen: 50, reason: '原原因', phase: 'unknown' };
  const r = await login({ shiftPending: pending(), cashPending: { orderId: 'o1', storeId: 'a', tenderedFen: 200, key: 'old-cash' }, refundPending,
    request: ({ path, ok }) => { if (path === '/orders/refund-original') { ok({ id: 'refund-original', storeId: 'a', cashReceipt: { amountFen: 100 }, cashRefunds: [], refundedFen: 0 }); return true; } } });
  await r.m.cash(true); assert.equal(r.m.order.value.id, 'o1'); assert.equal(await r.m.refundCtl.value.load(), true);
  assert.equal(r.m.order.value.id, 'refund-original'); assert.equal(r.m.refund.attempt.key, 'old-refund'); assert.equal(r.m.shiftBusy.value, true);
});
