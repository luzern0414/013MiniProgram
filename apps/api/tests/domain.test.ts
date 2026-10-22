import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPositiveQuantity, money, canTransition, assertStoreAccess, assertEnvironment, availability, maskPhone } from '../src/common/domain.ts';

test('rejects zero, fractional, negative and oversized quantities', () => {
  for (const q of [0, -1, 1.5, 100, NaN]) assert.throws(() => assertPositiveQuantity(q));
  assert.equal(assertPositiveQuantity(2), 2);
});
test('money is nonnegative safe integer fen and rejects coercion', () => {
  for (const amount of [-1, 1.1, '100', Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => money(amount));
  assert.equal(money(100), 100);
});
test('completed orders cannot accept or restart, delivery requires dispatch', () => {
  assert.equal(canTransition('COMPLETED', 'ACCEPT', 'PICKUP'), false);
  assert.equal(canTransition('READY', 'COMPLETE', 'DELIVERY'), false);
  assert.equal(canTransition('READY', 'DISPATCH', 'DELIVERY'), true);
  assert.equal(canTransition('AWAITING_ACCEPTANCE', 'ACCEPT', 'PICKUP'), true);
  assert.equal(canTransition('PENDING_PAYMENT', 'ACCEPT', 'PICKUP'), false);
});
test('owner still requires store membership; customers cannot use employee routes', () => {
  assert.throws(() => assertStoreAccess({ role: 'OWNER', storeIds: ['a'] }, 'b'));
  assert.throws(() => assertStoreAccess({ role: 'CUSTOMER', storeIds: [] }, 'a'));
  assert.doesNotThrow(() => assertStoreAccess({ role: 'CLERK', storeIds: ['a'] }, 'a'));
  assert.throws(() => assertStoreAccess({ role: 'CLERK', storeIds: ['a'] }, 'a', true));
});
test('production rejects developer authentication flag', () => {
  assert.throws(() => assertEnvironment({ NODE_ENV: 'production', DEV_AUTH_ENABLED: 'true' }));
  assert.doesNotThrow(() => assertEnvironment({ NODE_ENV: 'production' }));
});
test('available stock is independent of held reservations and cannot go negative', () => {
  assert.equal(availability(4), 4);
  assert.throws(() => availability(-1));
});
test('prototype action names are never state-machine actions', () => {
  for (const action of ['constructor', 'toString', '__proto__']) assert.equal(canTransition('PREPARING', action, 'PICKUP'), false);
});
test('state-machine actions require an exact scalar string', () => {
  for (const action of [['READY'], {toString: () => 'READY'}, null, 1, true]) {
    assert.equal(canTransition('PREPARING', action as any, 'PICKUP'), false);
  }
});
test('phone masking handles international and malformed input without failing open', () => {
  assert.equal(maskPhone('+8613800000000'), '138****0000');
  assert.equal(maskPhone('+86 138-0000-0000'), '138****0000');
  assert.equal(maskPhone('unexpected-phone-value'), '***');
  assert.equal(maskPhone(null), null);
});
