import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/index.mjs";
const selection = await import("../src/product-selection.mjs").catch(
  () => ({}),
);
const product = () => ({
  id: "p",
  name: "茶",
  configurationRevision: 2,
  isAvailable: true,
  specGroups: [
    {
      id: "size",
      name: "杯型",
      enabled: true,
      values: [
        { id: "small", name: "小杯", enabled: true },
        { id: "large", name: "大杯", enabled: true },
      ],
    },
  ],
  skus: [
    {
      id: "s",
      name: "小杯",
      enabled: true,
      available: 5,
      priceFen: 1000,
      selections: [{ groupRef: "size", valueRef: "small" }],
    },
    {
      id: "l",
      name: "大杯",
      enabled: true,
      available: 0,
      priceFen: 1500,
      selections: [{ groupRef: "size", valueRef: "large" }],
    },
  ],
  attributeGroups: [
    {
      id: "taste",
      name: "甜度",
      enabled: true,
      minSelections: 1,
      maxSelections: 1,
      options: [
        { id: "a", name: "无糖", enabled: true },
        { id: "b", name: "少糖", enabled: true },
      ],
    },
  ],
  modifiers: [
    { id: "m", name: "珍珠", enabled: true, available: 2, priceFen: 200 },
  ],
});
test("attribute toggle allows deselect, enforces max and disabled choices; definite refusals exclude ambiguity", () => {
  assert.equal(typeof selection.toggleAttribute, "function");
  const g = product().attributeGroups[0];
  assert.deepEqual(selection.toggleAttribute(g, [], "a"), ["a"]);
  assert.deepEqual(selection.toggleAttribute(g, ["a"], "a"), []);
  assert.throws(() => selection.toggleAttribute(g, ["a"], "b"), /最多/);
  assert.equal(
    selection.isDefinitiveOrderRejection({ code: "PRODUCT_OPTIONS_CHANGED" }),
    true,
  );
  for (const code of [
    "NETWORK",
    "NETWORK_ERROR",
    "TIMEOUT",
    "UNKNOWN",
    "STATE_CONFLICT",
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "NOT_FOUND",
  ])
    assert.equal(selection.isDefinitiveOrderRejection({ code }), false);
});
test("same SKU with different attributes stays separate; attribute identity sorts and deduplicates", () => {
  const data = new Map();
  const cart = core.createCart({
    get: (k) => data.get(k),
    set: (k, v) => data.set(k, v),
    remove: (k) => data.delete(k),
  });
  cart.add("store", "PICKUP", {
    skuId: "s",
    quantity: 1,
    attributeOptionIds: ["a"],
  });
  cart.add("store", "PICKUP", {
    skuId: "s",
    quantity: 1,
    attributeOptionIds: ["b"],
  });
  assert.equal(cart.get("store", "PICKUP").length, 2);
  assert.equal(
    core.fingerprint({ skuId: "s", attributeOptionIds: ["b", "a", "a"] }),
    core.fingerprint({ skuId: "s", attributeOptionIds: ["a", "b"] }),
  );
});
test("old stored cart migrates missing attributes without clearing lines or pending work", () => {
  const cart = core.createCart({
    get: () => [{ skuId: "s", quantity: 2, modifierIds: ["m"] }],
  });
  assert.deepEqual(cart.get("store", "PICKUP")[0].attributeOptionIds, []);
});
test("required min/max attributes reject missing, excess, foreign and disabled options", () => {
  assert.equal(typeof selection.selectionLine, "function");
  const p = product(),
    state = {
      skuId: "s",
      quantity: 1,
      modifierIds: [],
      attributeOptionIds: [],
    };
  assert.throws(() => selection.selectionLine(p, state), /甜度.*至少/);
  assert.throws(
    () =>
      selection.selectionLine(p, { ...state, attributeOptionIds: ["a", "b"] }),
    /甜度.*最多/,
  );
  assert.throws(
    () =>
      selection.selectionLine(p, { ...state, attributeOptionIds: ["foreign"] }),
    /口味.*失效/,
  );
  p.attributeGroups[0].options[0].enabled = false;
  assert.throws(
    () => selection.selectionLine(p, { ...state, attributeOptionIds: ["a"] }),
    /口味.*失效/,
  );
});
test("dimensions resolve real SKU and sold-out/disabled SKU and modifiers cannot be added", () => {
  assert.equal(typeof selection.resolveSelectionSku, "function");
  const p = product();
  assert.equal(selection.resolveSelectionSku(p, { size: "small" }).id, "s");
  assert.equal(
    selection.resolveSelectionSku(p, { size: "missing" }),
    undefined,
  );
  const state = {
    skuId: "l",
    quantity: 1,
    modifierIds: [],
    attributeOptionIds: ["a"],
  };
  assert.throws(() => selection.selectionLine(p, state), /库存|售罄/);
  p.skus[0].enabled = false;
  assert.throws(
    () => selection.selectionLine(p, { ...state, skuId: "s" }),
    /规格.*失效/,
  );
  p.skus[0].enabled = true;
  p.modifiers[0].enabled = false;
  assert.throws(
    () =>
      selection.selectionLine(p, { ...state, skuId: "s", modifierIds: ["m"] }),
    /加料.*失效/,
  );
});
test("selected line retains human names, attributes and integer estimate; old revision compatibility", () => {
  assert.equal(typeof selection.selectionLine, "function");
  const p = product(),
    line = selection.selectionLine(p, {
      skuId: "s",
      quantity: 2,
      modifierIds: ["m"],
      attributeOptionIds: ["a"],
    });
  assert.equal(line.unitPriceFen, 1200);
  assert.equal(line.configurationRevision, 2);
  assert.deepEqual(line.attributes, [
    {
      groupId: "taste",
      groupName: "甜度",
      options: [{ id: "a", name: "无糖" }],
    },
  ]);
  assert.equal(selection.cartSelectionIssue(line, [p]), "");
  p.configurationRevision = 3;
  assert.match(selection.cartSelectionIssue(line, [p]), /重新选择/);
  delete line.configurationRevision;
  assert.equal(selection.cartSelectionIssue(line, [p]), "");
  p.attributeGroups[0].options[0].enabled = false;
  assert.match(selection.cartSelectionIssue(line, [p]), /口味.*失效/);
});
test("cart replacement is atomic, removes only edited taste and preserves other selections", () => {
  const data = new Map();
  const cart = core.createCart({
    get: (k) => data.get(k),
    set: (k, v) => data.set(k, v),
  });
  const a = { skuId: "s", quantity: 1, attributeOptionIds: ["a"] },
    b = { ...a, attributeOptionIds: ["b"] };
  cart.add("store", "PICKUP", a);
  cart.add("store", "PICKUP", b);
  assert.throws(() =>
    cart.add("store", "PICKUP", { ...a, quantity: 100 }, core.fingerprint(a)),
  );
  assert.equal(cart.get("store", "PICKUP").length, 2);
  cart.add("store", "PICKUP", { ...b, quantity: 2 }, core.fingerprint(a));
  assert.equal(cart.get("store", "PICKUP").length, 1);
  assert.equal(cart.get("store", "PICKUP")[0].quantity, 3);
});
test("cart merging respects current stock and refreshes selected names after explicit reselection", () => {
  const data = new Map();
  const cart = core.createCart({
    get: (k) => data.get(k),
    set: (k, v) => data.set(k, v),
  });
  cart.add("store", "PICKUP", {
    skuId: "s",
    quantity: 2,
    available: 3,
    name: "旧名称",
  });
  assert.throws(
    () =>
      cart.add("store", "PICKUP", {
        skuId: "s",
        quantity: 2,
        available: 3,
        name: "新名称",
      }),
    /库存/,
  );
  assert.equal(cart.get("store", "PICKUP")[0].quantity, 2);
  cart.add("store", "PICKUP", {
    skuId: "s",
    quantity: 1,
    available: 3,
    name: "新名称",
  });
  assert.equal(cart.get("store", "PICKUP")[0].name, "新名称");
  assert.equal(
    core.attributeSummary({ skuName: "历史规格", modifiers: [] }),
    "",
  );
  assert.match(
    core.errorText({ code: "PRODUCT_OPTIONS_CHANGED", requestId: "trace-1" }),
    /刷新菜单.*trace-1/,
  );
});

test("historical backend snapshots omit empty optional groups from summary without mutating snapshots", () => {
  const line = {
    attributes: [
      {
        groupId: "required",
        groupName: "辣度",
        options: [{ id: "mild", name: "不辣" }],
      },
      { groupId: "optional", groupName: "用餐习惯", options: [] },
    ],
  };
  const original = structuredClone(line);
  assert.equal(core.attributeSummary(line), "辣度：不辣");
  assert.deepEqual(line, original);
  assert.equal(core.attributeSummary({ attributes: [line.attributes[1]] }), "");
});
