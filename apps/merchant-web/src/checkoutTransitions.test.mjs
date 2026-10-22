import test from "node:test";
import assert from "node:assert/strict";
import { transitionCheckout } from "./checkoutTransitions.mjs";

test("explicit creation refusal releases rejected quote and key while unknown result preserves recovery", () => {
  const state = {
    quote: { id: "q" },
    orderKey: "original",
    submittedFen: 5000,
    uncertain: true,
  };
  const refused = transitionCheckout(state, {
    type: "CREATE_REJECTED",
    key: "fresh",
  }).state;
  assert.equal(refused.uncertain, false);
  assert.equal(refused.quote, undefined);
  assert.equal(refused.submittedFen, undefined);
  assert.equal(refused.orderKey, "fresh");
  const unknown = transitionCheckout(state, { type: "RECONCILE_FAILED" }).state;
  assert.equal(unknown.orderKey, "original");
  assert.equal(unknown.quote.id, "q");
  assert.equal(unknown.submittedFen, 5000);
});

test("expired quote releases unsubmitted tender and a revised cart can submit a larger sale", () => {
  let result = transitionCheckout(
    {
      quote: {
        id: "expired",
        totalFen: 3000,
        expiresAt: "2020-01-01T00:00:00Z",
      },
      orderKey: "original",
      submittedFen: undefined,
      uncertain: false,
    },
    { type: "SUBMIT", tendered: "50.00", now: 1000 * 86400 * 20000 },
  );
  assert.equal(result.error, "报价已过期，请重新核对金额。");
  assert.equal(result.state.submittedFen, undefined);
  assert.equal(result.state.quote, undefined);
  result = transitionCheckout(result.state, {
    type: "CART_CHANGED",
    key: "revised",
  });
  result = transitionCheckout(result.state, {
    type: "QUOTE_RECEIVED",
    quote: { id: "q2", totalFen: 6000, expiresAt: "2099-01-01T00:00:00Z" },
  });
  result = transitionCheckout(result.state, {
    type: "SUBMIT",
    tendered: "70.00",
    now: Date.now(),
  });
  assert.equal(result.error, undefined);
  assert.equal(result.state.submittedFen, 7000);
  assert.equal(result.state.orderKey, "revised");
});
test("payment rejection reconciliation releases a closed order for a safe next sale", () => {
  const pending = {
    quote: { id: "q" },
    order: { id: "o", status: "PENDING_PAYMENT", paymentStatus: "UNPAID" },
    submittedFen: 5000,
    uncertain: true,
    orderKey: "original",
  };
  const result = transitionCheckout(pending, {
    type: "RECONCILED",
    order: { id: "o", status: "CANCELLED", paymentStatus: "CLOSED" },
  });
  assert.equal(result.state.terminal, true);
  assert.equal(result.state.uncertain, false);
  assert.equal(result.state.order.id, "o");
  assert.equal(result.state.paid, undefined);
});
test("lost payment result reconciles actual receipt and unresolved queries retain original recovery", () => {
  const pending = {
    order: { id: "o" },
    orderKey: "original",
    submittedFen: 5000,
    uncertain: true,
  };
  let result = transitionCheckout(pending, { type: "RECONCILE_FAILED" });
  assert.equal(result.state.uncertain, true);
  assert.equal(result.state.orderKey, "original");
  assert.equal(result.state.submittedFen, 5000);
  result = transitionCheckout(result.state, {
    type: "RECONCILED",
    order: {
      id: "o",
      status: "AWAITING_ACCEPTANCE",
      paymentStatus: "PAID",
      cashReceipt: { amountFen: 3000, tenderedFen: 4000, changeFen: 1000 },
    },
  });
  assert.equal(result.state.uncertain, false);
  assert.equal(result.state.receipt.tenderedFen, 4000);
  assert.equal(result.state.paid.id, "o");
});
test("uncertain creation retry preserves expired quote and frozen amount", () => {
  const state = {
    quote: { id: "q", totalFen: 3000, expiresAt: "2020-01-01T00:00:00Z" },
    orderKey: "same",
    submittedFen: 5000,
    uncertain: true,
  };
  const result = transitionCheckout(state, {
    type: "SUBMIT",
    tendered: "90.00",
    now: Date.now(),
  });
  assert.equal(result.error, undefined);
  assert.equal(result.state.quote.id, "q");
  assert.equal(result.state.submittedFen, 5000);
  assert.equal(result.state.orderKey, "same");
});

test('reconciled draft binding releases the old quote and tender for explicit cash confirmation', () => {
  const previous = { quote: { id: 'old', totalFen: 1000 }, submittedFen: 1000, orderKey: 'original-key', uncertain: true };
  const order = { id: 'o2', totalFen: 2000, status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' };
  let result = transitionCheckout(previous, { type: 'DRAFT_ORDER_RECONCILED', order });
  assert.equal(result.error, undefined); assert.deepEqual(result.state.order, order);
  assert.equal(result.state.quote, undefined); assert.equal(result.state.submittedFen, undefined);
  assert.equal(result.state.uncertain, false); assert.equal(result.state.orderKey, 'original-key');
  result = transitionCheckout(result.state, { type: 'SUBMIT', tendered: '20.00', now: Date.now() });
  assert.equal(result.error, undefined); assert.equal(result.state.submittedFen, 2000);
});

test('viewing the same bound draft order preserves unknown cash frozen amount and original key', () => {
  const order = { id: 'o1', totalFen: 2000, status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' };
  const previous = { order, quote: { id: 'old', totalFen: 1000 }, submittedFen: 3000, orderKey: 'original-key', uncertain: true };
  let result = transitionCheckout(previous, { type: 'DRAFT_ORDER_RECONCILED', order });
  assert.equal(result.error, undefined); assert.equal(result.state.submittedFen, 3000);
  result = transitionCheckout(result.state, { type: 'SUBMIT', tendered: '90.00', now: Date.now() });
  assert.equal(result.error, undefined); assert.equal(result.state.submittedFen, 3000); assert.equal(result.state.orderKey, 'original-key');
});

test('actual order total governs submission even when an old quote remains in cash recovery', () => {
  const result = transitionCheckout({ order: { id: 'o1', totalFen: 2000 }, quote: { totalFen: 1000 }, submittedFen: 1000, uncertain: true },
    { type: 'SUBMIT', tendered: '20.00', now: Date.now() });
  assert.equal(result.error, '实收现金不能少于应收金额。'); assert.equal(result.state.submittedFen, 1000);
});

test('draft recovery cannot replace another existing financial order', () => {
  const previous = { order: { id: 'cash-order' }, submittedFen: 3000, orderKey: 'cash-key', uncertain: true };
  const result = transitionCheckout(previous, { type: 'DRAFT_ORDER_RECONCILED', order: { id: 'other-order', totalFen: 2000 } });
  assert.ok(result.error); assert.deepEqual(result.state, previous);
});
