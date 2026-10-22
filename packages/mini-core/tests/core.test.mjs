import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/index.mjs";
const storage = () => {
  const data = new Map();
  return {
    get: (k) => data.get(k),
    set: (k, v) => data.set(k, v),
    remove: (k) => data.delete(k),
  };
};
test("cart persists separately for each store and service mode", () => {
  assert.equal(typeof core.createCart, "function");
  const store = storage(),
    cart = core.createCart(store);
  cart.add("a", "PICKUP", {
    skuId: "s",
    quantity: 1,
    modifierIds: [],
    name: "午餐",
  });
  cart.add("b", "PICKUP", {
    skuId: "s",
    quantity: 2,
    modifierIds: [],
    name: "午餐",
  });
  cart.add("a", "DINE_IN", {
    skuId: "s",
    quantity: 3,
    modifierIds: [],
    name: "午餐",
  });
  assert.equal(core.createCart(store).get("a", "PICKUP")[0].quantity, 1);
  assert.equal(cart.get("b", "PICKUP")[0].quantity, 2);
  assert.equal(cart.get("a", "DINE_IN")[0].quantity, 3);
});
test("modifier fingerprint sorts and deduplicates options but separates combinations", () => {
  assert.equal(typeof core.createCart, "function");
  const cart = core.createCart(storage());
  cart.add("a", "PICKUP", {
    skuId: "s",
    quantity: 1,
    modifierIds: ["b", "a", "b"],
  });
  cart.add("a", "PICKUP", { skuId: "s", quantity: 2, modifierIds: ["a", "b"] });
  cart.add("a", "PICKUP", { skuId: "s", quantity: 1, modifierIds: ["a"] });
  assert.equal(cart.get("a", "PICKUP").length, 2);
  assert.equal(cart.get("a", "PICKUP")[0].quantity, 3);
  assert.throws(() =>
    cart.add("a", "PICKUP", {
      skuId: "s",
      quantity: 99,
      modifierIds: ["a", "b"],
    }),
  );
});
test("uncertain order submission reuses persisted quote and idempotency key after restart", () => {
  assert.equal(typeof core.createPendingOrder, "function");
  const storageAdapter = storage();
  const first = core
    .createPendingOrder(storageAdapter)
    .begin("customer-a", "quote-a");
  assert.deepEqual(
    core.createPendingOrder(storageAdapter).begin("customer-a", "quote-b"),
    first,
  );
  assert.notEqual(
    core.createPendingOrder(storageAdapter).begin("customer-b", "quote-b").key,
    first.key,
  );
  core.createPendingOrder(storageAdapter).clear("customer-a");
  assert.equal(
    core.createPendingOrder(storageAdapter).begin("customer-a", "quote-c")
      .quoteId,
    "quote-c",
  );
});
test("transport attaches auth/request id, clears expired session, keeps API requestId", async () => {
  assert.equal(typeof core.createTransport, "function");
  let cleared = false,
    options;
  const api = core.createTransport({
    baseUrl: "http://api",
    token: () => "token",
    onUnauthorized: () => {
      cleared = true;
    },
    request: async (o) => {
      options = o;
      return {
        statusCode: 401,
        data: {
          error: { code: "UNAUTHENTICATED", message: "请登录" },
          requestId: "server-id",
        },
      };
    },
  });
  await assert.rejects(
    () => api("/me"),
    (e) => e.code === "UNAUTHENTICATED" && e.requestId === "server-id",
  );
  assert.equal(options.header.Authorization, "Bearer token");
  assert.ok(options.header["X-Request-Id"]);
  assert.ok(cleared);
});
test("transport distinguishes timeout and network failures without retrying writes", async () => {
  assert.equal(typeof core.createTransport, "function");
  let calls = 0;
  const api = core.createTransport({
    baseUrl: "http://api",
    request: async () => {
      calls++;
      throw { errMsg: "request:fail timeout" };
    },
  });
  await assert.rejects(
    () => api("/orders", { method: "POST" }),
    (e) => e.code === "TIMEOUT",
  );
  assert.equal(calls, 1);
  const offline = core.createTransport({
    baseUrl: "http://api",
    request: async () => {
      throw new Error("offline");
    },
  });
  await assert.rejects(
    () => offline("/stores"),
    (e) => e.code === "NETWORK_ERROR",
  );
});
test("cash recovery freezes the original order, store and tendered amount across refresh", () => {
  assert.equal(typeof core.createCashAttempt, "function");
  const adapter = storage();
  const first = core
    .createCashAttempt(adapter)
    .begin("u", { orderId: "o", storeId: "a", tenderedFen: 10000 });
  const recovered = core
    .createCashAttempt(adapter)
    .begin("u", { orderId: "other", storeId: "b", tenderedFen: 20000 });
  assert.deepEqual(recovered, first);
  assert.equal(recovered.tenderedFen, 10000);
  assert.ok(recovered.key);
  core.createCashAttempt(adapter).clear("u");
  assert.equal(core.createCashAttempt(adapter).get("u"), undefined);
});
test("transport keeps the status of an uncertain server-side write failure", async () => {
  const api = core.createTransport({
    baseUrl: "http://api",
    request: async () => ({
      statusCode: 503,
      data: {
        error: { code: "TEMPORARY_FAILURE", message: "稍后重试" },
        requestId: "r",
      },
    }),
  });
  await assert.rejects(
    () => api("/orders", { method: "POST" }),
    (e) => e.status === 503,
  );
});
