import test from "node:test";
import assert from "node:assert/strict";
import { webRefundStorage } from "./refundRecovery.mjs";
import {
  readRefundAttempt,
  createCashRefund,
  refundLocked,
} from "../../../packages/mini-core/src/cash-refunds.mjs";
import { clearMerchantSession } from "./session.mjs";
import { computed, reactive, watch } from "vue";
const attempt = {
  version: 1,
  userId: "u",
  storeId: "s",
  orderId: "o",
  key: "key",
  reason: "原原因",
  amountFen: 1,
  phase: "unknown",
};
test("Web session adapter recovers same payload, isolates identities, retains attempts across session invalidation and rejects bad JSON", () => {
  const map = new Map(),
    session = {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, v),
      removeItem: (k) => map.delete(k),
    };
  const storage = webRefundStorage(session);
  storage.set("cash-refund:v1:u", attempt);
  assert.deepEqual(readRefundAttempt(storage, "u").attempt, attempt);
  assert.equal(readRefundAttempt(storage, "other").attempt, null);
  clearMerchantSession(session);
  assert.deepEqual(readRefundAttempt(storage, "u").attempt, attempt);
  for (const raw of ["", "{invalid", "null", '{"version":999}']) {
    session.setItem("cash-refund:v1:u", raw);
    assert.match(readRefundAttempt(storage, "u").error, /核对/);
  }
});
test("refund lock remains active while a second operation releases its own busy flag", async () => {
  const map = new Map(),
    storage = {
      get: (k) => map.get(k),
      set: (k, v) => map.set(k, structuredClone(v)),
      remove: (k) => map.delete(k),
    };
  const state = reactive({}),
    pickup = reactive({ busy: true }),
    events = [];
  let resolve;
  const order = {
    id: "o",
    storeId: "s",
    cashReceipt: { amountFen: 100 },
    refundedFen: 0,
    cashRefunds: [],
  };
  const ctl = createCashRefund({
    state,
    storage,
    context: () => ({ owner: true, userId: "u", storeId: "s", order }),
    request: (p, o) =>
      o ? new Promise((r) => (resolve = r)) : Promise.resolve(order),
  });
  const locked = computed(() =>
    refundLocked(pickup.busy, state.busy, state.blocked),
  );
  watch(locked, (value) => events.push(value), {
    flush: "sync",
    immediate: true,
  });
  state.amount = "0.01";
  state.reason = "原原因";
  const pending = ctl.submit(true);
  pickup.busy = false;
  assert.equal(locked.value, true);
  assert.deepEqual(events, [true]);
  resolve(order);
  await pending;
  assert.equal(locked.value, false);
  assert.deepEqual(events, [true, false]);
});
