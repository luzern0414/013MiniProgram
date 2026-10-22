import test from "node:test";
import assert from "node:assert/strict";
import { useCustomer } from "../../../apps/customer-mini/src/customer.js";
import { useMerchant } from "../../../apps/merchant-mini/src/merchant.js";

function runtime(modes = ["PICKUP"]) {
  const data = new Map(),
    listeners = new Map();
  let account = "owner",
    failSecondStore = false,
    quoteRequest;
  const store = (id) => ({
    id,
    name: `test-${id}`,
    serviceModes: modes,
    isOpen: true,
  });
  globalThis.uni = {
    getStorageInfoSync: () => ({ keys: [...data.keys()] }),
    getStorageSync: (k) => data.get(k),
    setStorageSync: (k, v) => data.set(k, v),
    removeStorageSync: (k) => data.delete(k),
    $on: (name, fn) => listeners.set(name, fn),
    $emit: (name) => listeners.get(name)?.(),
    request(options) {
      const path = new URL(options.url).pathname.replace("/api/v1", "");
      const success = (value) =>
        queueMicrotask(() =>
          options.success({
            statusCode: 200,
            data: { data: value, requestId: "test" },
          }),
        );
      if (path === "/public-config")
        return success({
          environment: "development",
          brandName: "test",
          home: {},
          theme: { primaryColor: "#35664a" },
        });
      if (path === "/stores") return success([store("a"), store("b")]);
      if (path === "/auth/dev-login") {
        account = options.data.account;
        return success({
          token: "test",
          user: {
            id: account,
            name: account,
            role: account === "owner" ? "OWNER" : "CLERK",
            storeIds: [account === "owner" ? "a" : "b"],
          },
        });
      }
      if (path === "/merchant/overview") return success({ orderCount: 0 });
      if (path === "/orders") return success({ items: [], page: 1, total: 0 });
      if (path === "/quotes") {
        quoteRequest = options;
        return;
      }
      if (path === "/merchant/products") {
        if (
          failSecondStore &&
          new URL(options.url).searchParams.get("storeId") === "b"
        )
          return queueMicrotask(() =>
            options.fail({ errMsg: "request:fail network" }),
          );
        return success({
          categories: [],
          products: [
            {
              id:
                account === "owner" ? "private-product-a" : "private-product-b",
            },
          ],
        });
      }
      if (path.endsWith("/catalog"))
        return success({
          categories: [],
          products: [
            {
              id: "p",
              name: "测试餐品",
              isAvailable: true,
              skus: [
                { id: "sku", name: "标准份", available: 10, priceFen: 100 },
              ],
              modifiers: [],
            },
          ],
        });
      if (path.endsWith("/tables")) return success([]);
      throw new Error(`Unexpected request ${path}`);
    },
  };
  return {
    failSecondStore: () => {
      failSecondStore = true;
    },
    resolveQuote: () =>
      quoteRequest.success({
        statusCode: 200,
        data: {
          data: { id: "quote-for-one", totalFen: 100 },
          requestId: "test",
        },
      }),
  };
}
test("customer logout and expired session discard the private detail, quote and open sheet", async () => {
  runtime();
  const customer = useCustomer();
  customer.user.value = { id: "customer-a" };
  customer.order.value = { id: "private-a" };
  customer.quote.value = { id: "quote-a" };
  customer.sheet.value = "cart";
  await customer.logout();
  assert.equal(customer.order.value, null);
  assert.equal(customer.quote.value, null);
  assert.equal(customer.sheet.value, "");
  customer.user.value = { id: "customer-b" };
  customer.order.value = { id: "private-b" };
  customer.quote.value = { id: "quote-b" };
  customer.sheet.value = "cart";
  uni.$emit("session-expired");
  assert.equal(customer.order.value, null);
  assert.equal(customer.quote.value, null);
  assert.equal(customer.sheet.value, "");
});
test("merchant switching identity cannot display prior authorized-store data when the next load fails", async () => {
  const environment = runtime(),
    merchant = useMerchant();
  await merchant.init();
  await merchant.login("owner");
  assert.equal(merchant.catalog.value.products[0].id, "private-product-a");
  merchant.order.value = { id: "private-order-a" };
  merchant.logout();
  assert.equal(merchant.catalog.value.products.length, 0);
  assert.equal(merchant.order.value, null);
  environment.failSecondStore();
  await merchant.login("clerk-b");
  assert.equal(merchant.storeId.value, "b");
  assert.equal(merchant.catalog.value.products.length, 0);
  assert.equal(merchant.overview.value, null);
});
test("a quote response cannot replace cart changes made while its request was pending", async () => {
  const environment = runtime();
  uni.setStorageSync("cart:v1:a:PICKUP", [
    { skuId: "sku", quantity: 1, modifierIds: [], unitPriceFen: 100 },
  ]);
  const customer = useCustomer();
  await customer.init();
  customer.user.value = { id: "customer-a" };
  const request = customer.getQuote();
  customer.change(customer.lines.value[0], 1);
  environment.resolveQuote();
  await request;
  assert.equal(customer.lines.value[0].quantity, 2);
  assert.equal(customer.quote.value, null);
  assert.match(customer.error.value, /重新确认/);
});
test("initial store selection uses a service mode supported by that store", async () => {
  runtime(["DINE_IN"]);
  const customer = useCustomer();
  await customer.init();
  assert.equal(customer.mode.value, "DINE_IN");
});
