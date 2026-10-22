import test from "node:test";
import assert from "node:assert/strict";
import { useCustomer } from "../../../apps/customer-mini/src/customer.js";
import { selectionLine } from "../src/index.mjs";
const product = (revision = 1) => ({
  id: "p",
  name: "饭",
  configurationRevision: revision,
  isAvailable: true,
  skus: [{ id: "s", name: "小份", priceFen: 1000, available: 10 }],
  modifiers: [],
  attributeGroups: [
    {
      id: "g",
      name: "辣度",
      minSelections: 1,
      maxSelections: 1,
      options: [
        { id: "a", name: "不辣" },
        { id: "b", name: "微辣" },
      ],
    },
  ],
});
function runtime() {
  const storage = new Map(),
    creates = [],
    quotes = [];
  let slots = [];
  let current = product(),
    refusal = "",
    lost = false,
    catalogFail = false;
  globalThis.uni = {
    getStorageSync: (k) => storage.get(k),
    setStorageSync: (k, v) => storage.set(k, v),
    removeStorageSync: (k) => storage.delete(k),
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    $on() {},
    showToast() {},
    request(options) {
      const path = new URL(options.url).pathname.replace("/api/v1", "");
      const success = (data) =>
        queueMicrotask(() =>
          options.success({ statusCode: 200, data: { data, requestId: "r" } }),
        );
      if (path === "/public-config")
        return success({ environment: "development" });
      if (path === "/stores")
        return success([
          { id: "store", isOpen: true, serviceModes: ["PICKUP"] },
        ]);
      if (path === "/me") return success({ id: "u" });
      if (path.endsWith("/catalog")) {
        if (catalogFail)
          return queueMicrotask(() => options.fail({ errMsg: "offline" }));
        return success({ categories: [], products: [current] });
      }
      if (path.endsWith("/tables")) return success([]);
      if (path.endsWith("/pickup-slots")) return success(slots);
      if (path === "/quotes") {
        quotes.push(options.data);
        return success({ id: `q${quotes.length}`, totalFen: 1000 });
      }
      if (path === "/orders" && options.method === "POST") {
        creates.push(options);
        if (lost)
          return queueMicrotask(() => options.fail({ errMsg: "timeout" }));
        if (refusal)
          return queueMicrotask(() =>
            options.success({
              statusCode: 409,
              data: {
                error: { code: refusal, message: "拒绝" },
                requestId: "server-id",
              },
            }),
          );
        return success({ id: "o", storeId: "store", mode: "PICKUP" });
      }
      if (path === "/orders") return success({ items: [], page: 1, total: 0 });
      throw new Error(path);
    },
  };
  storage.set("session:customer", { token: "test" });
  return {
    storage,
    creates,
    quotes,
    setProduct: (p) => (current = p),
    refuse: (code) => (refusal = code),
    lose: (value) => (lost = value),
    failCatalog: (value) => (catalogFail = value),
    setSlots: (value) => (slots = value),
  };
}
test("customer carries two tastes to quote, marks changed configuration and replaces only explicitly reselected line", async () => {
  const env = runtime(),
    customer = useCustomer();
  await customer.init();
  for (const id of ["a", "b"]) {
    customer.openProduct(product());
    customer.add(
      selectionLine(product(), {
        skuId: "s",
        quantity: 1,
        attributeOptionIds: [id],
      }),
    );
  }
  assert.equal(customer.lines.value.length, 2);
  await customer.getQuote();
  assert.deepEqual(
    env.quotes[0].lines.map((l) => l.attributeOptionIds),
    [["a"], ["b"]],
  );
  env.refuse("PRODUCT_OPTIONS_CHANGED");
  await customer.submit();
  assert.equal(customer.pending.value, null);
  assert.equal(customer.quote.value, null);
  assert.equal(customer.needsMenuRefresh.value, true);
  assert.match(customer.error.value, /刷新菜单.*server-id/);
  await customer.getQuote();
  assert.equal(env.quotes.length, 1);
  env.failCatalog(true);
  await customer.reload();
  assert.equal(customer.needsMenuRefresh.value, true);
  env.failCatalog(false);
  env.setProduct(product(2));
  await customer.reload();
  assert.equal(customer.needsMenuRefresh.value, false);
  assert.equal(customer.invalidCart.value, true);
  const old = customer.lines.value[0];
  customer.reselect(old);
  customer.add(
    selectionLine(product(2), {
      skuId: "s",
      quantity: 1,
      attributeOptionIds: ["a"],
    }),
  );
  assert.equal(customer.lines.value.length, 2);
  assert.equal(
    customer.lineIssue(
      customer.lines.value.find((l) => l.attributeOptionIds[0] === "a"),
    ),
    "",
  );
  assert.match(
    customer.lineIssue(
      customer.lines.value.find((l) => l.attributeOptionIds[0] === "b"),
    ),
    /重新选择/,
  );
});
test("unknown customer creation survives reload and retries exact quote/key while confirmed success clears original bag", async () => {
  const env = runtime(),
    customer = useCustomer();
  await customer.init();
  customer.openProduct(product());
  customer.add(
    selectionLine(product(), {
      skuId: "s",
      quantity: 1,
      attributeOptionIds: ["a"],
    }),
  );
  await customer.getQuote();
  env.lose(true);
  await customer.submit();
  const pending = customer.pending.value;
  assert.ok(pending.key);
  assert.equal(customer.lines.value.length, 1);
  const recovered = useCustomer();
  await recovered.init();
  assert.deepEqual(recovered.pending.value, pending);
  env.lose(false);
  await recovered.submit();
  assert.equal(env.creates.length, 2);
  assert.equal(
    env.creates[1].header["Idempotency-Key"],
    env.creates[0].header["Idempotency-Key"],
  );
  assert.equal(env.creates[1].data.quoteId, env.creates[0].data.quoteId);
  assert.equal(!!recovered.pending.value, false);
  assert.equal(recovered.lines.value.length, 0);
});

const pickupSlot = {
  id: "slot",
  startsAt: "2026-10-21T04:00:00Z",
  endsAt: "2026-10-21T04:30:00Z",
  timezone: "Asia/Shanghai",
  remaining: 1,
};
function addMeal(customer) {
  customer.openProduct(product());
  customer.add(
    selectionLine(product(), {
      skuId: "s",
      quantity: 1,
      attributeOptionIds: ["a"],
    }),
  );
}
test("customer reservation refusal preserves selected window and requires reread without an instant fallback", async () => {
  const env = runtime(),
    customer = useCustomer();
  env.setSlots([pickupSlot]);
  await customer.init();
  await customer.loadPickup("2026-10-21");
  customer.selectPickup(pickupSlot);
  addMeal(customer);
  await customer.getQuote();
  assert.equal(env.quotes[0].pickupSlotId, "slot");
  env.refuse("PICKUP_SLOT_FULL");
  await customer.submit();
  assert.equal(customer.pending.value, null);
  assert.equal(customer.quote.value, null);
  assert.equal(customer.pickup.slotId, "slot");
  assert.equal(customer.pickup.needsRefresh, true);
  assert.match(customer.error.value, /名额.*server-id/);
  env.setSlots([]);
  await customer.loadPickup();
  await customer.getQuote();
  assert.equal(env.quotes.length, 1);
  assert.equal(customer.pickup.slotId, "slot");
  customer.selectPickup(null);
  await customer.getQuote();
  assert.equal(Object.hasOwn(env.quotes[1], "pickupSlotId"), false);
});
test("unknown customer reservation freezes selection and recovers the same request after unavailable slot reread", async () => {
  const env = runtime(),
    customer = useCustomer();
  env.setSlots([pickupSlot]);
  await customer.init();
  await customer.loadPickup("2026-10-21");
  customer.selectPickup(pickupSlot);
  addMeal(customer);
  await customer.getQuote();
  env.lose(true);
  await customer.submit();
  const attempt = customer.pending.value;
  customer.selectPickup(null);
  assert.equal(customer.pickup.slotId, "slot");
  env.setSlots([]);
  const recovered = useCustomer();
  await recovered.init();
  await recovered.loadPickup();
  assert.equal(recovered.pickup.slotId, "slot");
  assert.deepEqual(recovered.pending.value, attempt);
  env.lose(false);
  await recovered.submit();
  assert.equal(env.creates[0].data.quoteId, env.creates[1].data.quoteId);
  assert.equal(
    env.creates[0].header["Idempotency-Key"],
    env.creates[1].header["Idempotency-Key"],
  );
});
