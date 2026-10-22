import test from "node:test";
import assert from "node:assert/strict";
import { useCustomer } from "../../../apps/customer-mini/src/customer.js";
import { addressStorageKey } from "../src/customer-addresses.mjs";

const address = (overrides = {}) => ({
  id: "address-1",
  name: "林顾客",
  phone: "13800000000",
  region: "上海市浦东新区",
  detail: "梧桐路 88 号",
  point: null,
  isDefault: true,
  revision: 0,
  deletedAt: null,
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
  ...overrides,
});
const attempt = {
  schemaVersion: 1,
  userId: "customer",
  kind: "CREATE",
  addressId: null,
  key: "address-original",
  method: "POST",
  path: "/customer/addresses",
  body: {
    expectedBookRevision: 0,
    name: "待恢复顾客",
    phone: "13800000000",
    region: "上海市浦东新区",
    detail: "待恢复地址",
    point: null,
    isDefault: false,
  },
};
const quoteInput = {
  storeId: "a",
  mode: "PICKUP",
  lines: [
    {
      skuId: "sku",
      quantity: 1,
      modifierIds: [],
      attributeOptionIds: [],
    },
  ],
  note: "",
};
const product = {
  id: "product",
  name: "招牌饭",
  categoryId: "meal",
  description: "现做",
  isAvailable: true,
  skus: [{ id: "sku", name: "一份", priceFen: 1000, available: 10 }],
  modifiers: [],
  attributeGroups: [],
};

function runtime({ addresses = [address()], addressBookRevision = 1 } = {}) {
  const values = new Map();
  const calls = [];
  const listeners = new Map();
  const user = { id: "customer", name: "顾客", role: "CUSTOMER", balanceFen: 0, points: 0 };
  values.set("session:customer", { token: "valid-token" });
  globalThis.uni = {
    getStorageInfoSync: () => ({ keys: [...values.keys()] }),
    getStorageSync: (key) => (values.has(key) ? structuredClone(values.get(key)) : undefined),
    setStorageSync: (key, value) => values.set(key, structuredClone(value)),
    removeStorageSync: (key) => values.delete(key),
    $on: (name, callback) => listeners.set(name, callback),
    $emit: (name) => listeners.get(name)?.(),
    showToast() {},
    showModal: (options) => options.success({ confirm: true }),
    request(options) {
      const url = new URL(options.url);
      const path = url.pathname.replace("/api/v1", "");
      calls.push({
        path,
        method: options.method || "GET",
        data: structuredClone(options.data),
        headers: structuredClone(options.header),
      });
      const ok = (data) => queueMicrotask(() =>
        options.success({ statusCode: 200, data: { data: structuredClone(data), requestId: "fixture-ok" } }),
      );
      if (path === "/public-config")
        return ok({ environment: "development", brandName: "测试" });
      if (path === "/stores")
        return ok([
          { id: "a", name: "同品牌一店", serviceModes: ["DINE_IN", "PICKUP", "DELIVERY"], isOpen: true },
          { id: "b", name: "同品牌二店", serviceModes: ["DINE_IN", "PICKUP", "DELIVERY"], isOpen: true },
        ]);
      if (path === "/me") return ok(user);
      if (/^\/stores\/[ab]\/catalog$/.test(path))
        return ok({ categories: [{ id: "meal", name: "主食" }], products: [product] });
      if (/^\/stores\/[ab]\/tables$/.test(path)) return ok([]);
      if (path === "/orders" && options.method !== "POST") return ok({ items: [], total: 0, page: 1, pageSize: 20 });
      if (path === "/orders" && options.method === "POST")
        return ok({ id: "order", storeId: "a", mode: "PICKUP", lines: [], events: [] });
      if (path === "/quotes") return ok({ id: "quote", totalFen: 1000 });
      if (path === "/auth/dev-login") return ok({ token: "valid-token", user });
      if (path === "/customer/addresses" && (!options.method || options.method === "GET"))
        return ok({ items: structuredClone(addresses), bookRevision: addressBookRevision, limit: 20 });
      if (path === "/customer/addresses" && options.method === "POST")
        return ok({
          operation: { kind: "CREATE", addressId: "address-2", addressRevision: 0, bookRevision: 2, succeededAt: "2026-10-21T00:01:00.000Z" },
          address: address({ id: "address-2", isDefault: false }),
          bookRevision: 2,
          replayed: false,
        });
      throw Error("Unexpected request " + path);
    },
  };
  return { values, calls, listeners, user };
}

test("customer startup discovers address and order recovery independently and address lock prevents store switching", async () => {
  const env = runtime();
  env.values.set("pending-order:v1:customer", { quoteId: "old-quote", key: "old-order" });
  env.values.set(addressStorageKey("customer"), structuredClone(attempt));
  const customer = useCustomer();
  await customer.init();
  assert.equal(customer.pending.value.key, "old-order");
  assert.equal(customer.addresses.value.state.pending.key, "address-original");
  assert.equal(customer.addressLocked.value, true);

  const before = env.calls.length;
  await customer.selectStore("b");
  assert.equal(customer.storeId.value, "a");
  assert.equal(env.calls.length, before);

  assert.equal(await customer.addresses.value.recover("read"), true);
  assert.ok(env.calls.some((call) => call.path === "/customer/addresses"));

  await customer.submit();
  assert.equal(customer.pending.value, null);
  assert.equal(customer.addresses.value.state.pending.key, "address-original");
  await customer.selectStore("b");
  assert.equal(customer.storeId.value, "a");
});

test("same-brand store switching reuses one user address controller without starting another address book", async () => {
  const env = runtime();
  const customer = useCustomer();
  await customer.init();
  const controller = customer.addresses.value;
  await customer.addresses.value.load();
  assert.ok(controller);
  await customer.selectStore("b");
  assert.equal(customer.storeId.value, "b");
  assert.equal(customer.addresses.value, controller);
  assert.equal([...env.values.keys()].filter((key) => key.startsWith("customer-address:v1:")).length, 0);
});

test("session expiry clears mounted PII and edit state while retaining the original identity recovery record", async () => {
  const env = runtime();
  env.values.set(addressStorageKey("customer"), structuredClone(attempt));
  const customer = useCustomer();
  await customer.init();
  await customer.addresses.value.load();
  assert.equal(customer.addressesState.items.length, 1);
  assert.equal(customer.addresses.value.state.pending.key, "address-original");
  uni.$emit("session-expired");
  assert.equal(customer.user.value, null);
  assert.equal(customer.addresses.value, null);
  assert.deepEqual(customer.addressesState.items, []);
  assert.equal(customer.addressesState.form.name, "");
  assert.ok(env.values.has(addressStorageKey("customer")));
  await customer.login();
  assert.equal(customer.addresses.value.state.pending.key, "address-original");
});

test("delivery selection retains address id/revision but refuses a fake quote and never submits legacy address JSON", async () => {
  const env = runtime();
  const customer = useCustomer();
  await customer.init();
  await customer.addresses.value.load();
  assert.equal("address" in customer, false);
  await customer.selectMode("DELIVERY");
  assert.equal(customer.selectDeliveryAddress("address-1"), true);
  assert.equal(customer.selectedAddressId.value, "address-1");
  assert.equal(customer.selectedAddressRevision.value, 0);
  customer.openProduct(product);
  customer.add(product);
  const quoteCalls = env.calls.filter((call) => call.path === "/quotes").length;
  await customer.getQuote();
  assert.equal(env.calls.filter((call) => call.path === "/quotes").length, quoteCalls);
  assert.match(customer.error.value, /配送服务尚未开通/);
  assert.equal(customer.selectedAddressId.value, "address-1");
  assert.equal(customer.quote.value, null);
});
