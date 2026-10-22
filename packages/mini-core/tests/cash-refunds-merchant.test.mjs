import test from "node:test";
import assert from "node:assert/strict";
import { useMerchant } from "../../../apps/merchant-mini/src/merchant.js";
function runtime() {
  const storage = new Map(),
    listeners = new Map(),
    writes = [];
  let result = "offline";
  const order = {
    id: "original",
    number: "ORDER",
    storeId: "b",
    paymentStatus: "PAID",
    status: "COMPLETED",
    cashReceipt: {
      amountFen: 100,
      tenderedFen: 200,
      changeFen: 100,
      refundedFen: 0,
    },
    cashRefunds: [],
    refundedFen: 0,
    netPaidFen: 100,
  };
  const attempt = {
    version: 1,
    userId: "owner",
    storeId: "b",
    orderId: "original",
    key: "original-key",
    amountFen: 1,
    reason: "原原因",
    phase: "unknown",
  };
  storage.set("cash-refund:v1:owner", attempt);
  const user = { id: "owner", role: "OWNER", storeIds: ["a", "b"] };
  globalThis.uni = {
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    getStorageSync: (k) => storage.get(k),
    setStorageSync: (k, v) => storage.set(k, structuredClone(v)),
    removeStorageSync: (k) => storage.delete(k),
    $on: (name, fn) => listeners.set(name, fn),
    $emit: (name) => listeners.get(name)?.(),
    request(options) {
      const path = new URL(options.url).pathname.replace("/api/v1", "");
      const success = (data) =>
        queueMicrotask(() =>
          options.success({ statusCode: 200, data: { data } }),
        );
      if (path === "/public-config")
        return success({ environment: "development" });
      if (path === "/stores") return success([{ id: "a" }, { id: "b" }]);
      if (path === "/auth/dev-login")
        return success({ token: "owner-token", user });
      if (path === "/merchant/overview") return success({});
      if (path === "/merchant/products")
        return success({ categories: [], products: [] });
      if (path === "/orders") return success({ items: [], total: 0 });
      if (path === "/orders/original") return success(order);
      if (path === "/merchant/orders/original/cash-refunds") {
        writes.push(options);
        if (result === "offline")
          return queueMicrotask(() => options.fail({ errMsg: "network" }));
        return success({ ...order, refundedFen: 1 });
      }
      throw Error(path);
    },
  };
  return { storage, writes, order, result: (v) => (result = v) };
}
test("mini startup discovers original-store refund and blocks navigation, logout, collection and other order writes until explicit replay", async () => {
  const r = runtime(),
    m = useMerchant();
  await m.init();
  await m.login("owner");
  assert.equal(m.storeId.value, "b");
  assert.equal(m.tab.value, "orders");
  assert.equal(m.refundBusy.value, true);
  m.navigate("overview");
  await m.selectStore("a");
  await m.logout();
  m.openCash({ id: "new" });
  await m.transition({ id: "new" }, "ACCEPT", "接单");
  assert.equal(m.storeId.value, "b");
  assert.equal(m.tab.value, "orders");
  assert.equal(m.user.value.id, "owner");
  assert.equal(m.cashOrder.value, null);
  assert.equal(r.writes.length, 0);
  await m.refundCtl.value.load();
  assert.equal(m.order.value.id, "original");
  assert.equal(m.refundBusy.value, true);
  await m.refundCtl.value.submit(true);
  assert.equal(m.refundBusy.value, true);
  r.result("success");
  await m.refundCtl.value.submit(true);
  assert.equal(m.refundBusy.value, false);
  assert.equal(r.writes.length, 2);
  for (const write of r.writes) {
    assert.equal(write.header["Idempotency-Key"], "original-key");
    assert.deepEqual(write.data, {
      storeId: "b",
      amountFen: 1,
      reason: "原原因",
    });
  }
  assert.equal(r.storage.has("cash-refund:v1:owner"), false);
  m.navigate("overview");
  assert.equal(m.tab.value, "overview");
});
test("session expiration leaves refund attempt for its original identity and clears visible private state", async () => {
  const r = runtime(),
    m = useMerchant();
  await m.init();
  await m.login("owner");
  await m.refundCtl.value.load();
  uni.$emit("session-expired");
  assert.equal(m.user.value, null);
  assert.equal(m.order.value, null);
  assert.equal(m.refund.attempt, null);
  assert.ok(r.storage.get("cash-refund:v1:owner"));
});
