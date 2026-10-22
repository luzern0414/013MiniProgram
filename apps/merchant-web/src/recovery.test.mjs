import test from "node:test";
import assert from "node:assert/strict";
import {
  createRecovery,
  submittedCash,
  confirmedCash,
  closeCashDialog,
} from "./recovery.mjs";
import * as recovery from "./recovery.mjs";
import { selectionKey } from "../../../packages/mini-core/src/product-selection.mjs";

test("legacy cashier cart normalizes attribute identity while preserving unknown creation and tender", () => {
  assert.equal(typeof recovery.restoreSelectionCart, "function");
  const session = storage();
  const oldLine = {
    key: "sku:m",
    skuId: "sku",
    modifierIds: ["m"],
    quantity: 2,
    skuName: "历史规格 · 加料",
  };
  createRecovery(session, "u", "s").save({
    cart: [oldLine],
    quote: { id: "q" },
    orderKey: "original",
    submittedFen: 5000,
    uncertain: true,
  });
  const saved = createRecovery(session, "u", "s").read();
  const lines = recovery.restoreSelectionCart(saved.cart);
  assert.deepEqual(lines[0].attributeOptionIds, []);
  assert.equal(
    lines[0].key,
    selectionKey({ skuId: "sku", modifierIds: ["m"], attributeOptionIds: [] }),
  );
  assert.equal(lines[0].quantity, 2);
  assert.equal(lines[0].skuName, oldLine.skuName);
  assert.equal(saved.orderKey, "original");
  assert.equal(saved.quote.id, "q");
  assert.equal(saved.submittedFen, 5000);
  assert.equal(saved.uncertain, true);
  assert.equal(saved.cart[0].key, "sku:m");
});

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
test("refresh restores original quote, key, order, uncertainty and submitted cash scoped to employee and store", () => {
  const session = storage();
  const state = {
    quote: { id: "q1" },
    orderKey: "original-key",
    order: { id: "o1" },
    uncertain: true,
    submittedFen: 5000,
    cart: [{ skuId: "s1", quantity: 1 }],
  };
  createRecovery(session, "u1", "store-a").save(state);
  assert.deepEqual(createRecovery(session, "u1", "store-a").read(), state);
  assert.equal(createRecovery(session, "u2", "store-a").read(), null);
  assert.equal(createRecovery(session, "u1", "store-b").read(), null);
});
test("first tender stays frozen on retry and confirmed receipt comes from server", () => {
  assert.equal(submittedCash(undefined, "50.00", 3080), 5000);
  assert.equal(submittedCash(5000, "99.00", 3080), 5000);
  assert.deepEqual(
    confirmedCash({
      cashReceipt: { amountFen: 3080, tenderedFen: 4000, changeFen: 920 },
    }),
    { amountFen: 3080, tenderedFen: 4000, changeFen: 920 },
  );
  assert.throws(() => confirmedCash({ totalFen: 3080 }), /收款凭证/);
});
test("completed payment clears dialog selection rather than opening an empty detail", () => {
  assert.deepEqual(closeCashDialog(), { selected: undefined, cash: false });
});
test("recoverable order survives clearing another employee or store checkout", () => {
  const session = storage();
  createRecovery(session, "u1", "a").save({ orderKey: "k", uncertain: true });
  createRecovery(session, "u1", "b").save({ orderKey: "b", uncertain: false });
  createRecovery(session, "u1", "b").clear();
  assert.equal(createRecovery(session, "u1", "a").read()?.orderKey, "k");
});
