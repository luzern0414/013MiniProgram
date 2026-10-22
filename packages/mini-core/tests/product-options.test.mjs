import test from "node:test";
import assert from "node:assert/strict";
const mod = await import("../src/product-options.mjs").catch(() => ({}));
const controllers = await import("../src/options-editor.mjs").catch(() => ({}));
const source = () => ({
  productId: "p",
  configurationRevision: 2,
  specGroups: [
    {
      id: "g",
      name: "杯型",
      sort: 0,
      enabled: true,
      values: [{ id: "v", name: "大杯", sort: 0, enabled: true }],
    },
  ],
  skus: [
    {
      id: "s",
      name: "大杯",
      enabled: true,
      priceFen: 1200,
      available: 7,
      reserved: 2,
      selections: [{ groupRef: "g", valueRef: "v" }],
    },
  ],
  attributeGroups: [
    {
      id: "a",
      name: "温度",
      sort: 0,
      enabled: true,
      minSelections: 1,
      maxSelections: 1,
      options: [{ id: "o", name: "热", sort: 0, enabled: true }],
    },
  ],
  modifiers: [
    {
      id: "m",
      name: "奶盖",
      enabled: true,
      priceFen: 200,
      available: 3,
      reserved: 1,
    },
  ],
});
test("new dimension references resolve within full tree; existing inventory never leaks into PUT", () => {
  assert.equal(typeof mod.optionsPayload, "function");
  const d = mod.optionsDraft(source());
  const g = mod.newOptionsGroup("spec", 1);
  g.name = "甜度";
  g.values[0].name = "少糖";
  d.specGroups.push(g);
  d.skus[0].selections.push({
    groupRef: g.clientKey,
    valueRef: g.values[0].clientKey,
  });
  d.skus[0].initialStock = "99";
  const data = mod.optionsPayload("store", d);
  assert.equal(data.expectedRevision, 2);
  assert.equal(data.skus[0].id, "s");
  assert.equal(data.specGroups[0].values[0].id, "v");
  assert.deepEqual(data.skus[0].selections[1], {
    groupRef: g.clientKey,
    valueRef: g.values[0].clientKey,
  });
  for (const key of ["available", "reserved", "stock", "initialStock", "price"])
    assert.equal(key in data.skus[0], false);
  assert.equal("available" in data.modifiers[0], false);
  d.modifiers.push({
    name: "珍珠",
    enabled: true,
    price: "1.25",
    initialStock: "9",
  });
  assert.equal(mod.optionsPayload("store", d).modifiers[1].initialStock, 9);
});
test("missing dimensions, duplicate combinations, disabled values and dimension merging are rejected", () => {
  assert.equal(typeof mod.optionsDraft, "function");
  const d = mod.optionsDraft(source());
  d.skus[0].selections = [];
  assert.throws(() => mod.optionsPayload("store", d), /杯型/);
  d.skus[0].selections = [{ groupRef: "g", valueRef: "v" }];
  d.skus.push({ ...d.skus[0], id: undefined });
  assert.throws(() => mod.optionsPayload("store", d), /重复/);
  d.skus[1].enabled = false;
  assert.doesNotThrow(() => mod.optionsPayload("store", d));
  d.specGroups[0].values[0].enabled = false;
  assert.throws(() => mod.optionsPayload("store", d), /停用/);
  const merged = mod.optionsDraft(source());
  merged.specGroups[0].enabled = false;
  merged.skus.push({ ...merged.skus[0], id: undefined });
  assert.throws(() => mod.optionsPayload("store", merged), /重复/);
});
test("combination preview is bounded and adding requires explicit user selection", () => {
  assert.equal(typeof mod.previewCombinations, "function");
  const d = mod.optionsDraft(source());
  d.specGroups[0].values.push({
    clientKey: "new",
    name: "小杯",
    enabled: true,
    sort: 1,
  });
  const preview = mod.previewCombinations(d);
  assert.equal(preview.total, 2);
  assert.equal(preview.items.length, 1);
  assert.equal(d.skus.length, 1);
  assert.equal(preview.items[0].name, "小杯");
  const huge = mod.optionsDraft(source());
  huge.specGroups = Array.from({ length: 3 }, (_, i) => ({
    clientKey: `g${i}`,
    name: `g${i}`,
    enabled: true,
    values: Array.from({ length: 20 }, (_, j) => ({
      clientKey: `v${i}_${j}`,
      name: `v${j}`,
      enabled: true,
    })),
  }));
  assert.equal(mod.previewCombinations(huge).total, 8000);
  assert.ok(mod.previewCombinations(huge).items.length <= 20);
});
test("attribute bounds, names, money and legacy caps show actionable errors", () => {
  assert.equal(typeof mod.optionsDraft, "function");
  const d = mod.optionsDraft(source());
  d.attributeGroups[0].minSelections = "2";
  assert.throws(() => mod.optionsPayload("store", d), /最少|最多/);
  d.attributeGroups[0].minSelections = "1";
  d.attributeGroups[0].options[0].enabled = false;
  assert.throws(() => mod.optionsPayload("store", d), /选项/);
  d.attributeGroups[0].options[0].enabled = true;
  d.modifiers[0].price = "1.234";
  assert.throws(() => mod.optionsPayload("store", d), /价格/);
  d.modifiers[0].price = "2";
  d.specGroups[0].name = " ";
  assert.throws(() => mod.optionsPayload("store", d), /名称/);
  d.specGroups[0].name = "杯型";
  d.modifiers = Array.from({ length: 21 }, () => ({ ...d.modifiers[0] }));
  assert.throws(() => mod.optionsPayload("store", d), /20|超出/);
});
for (const code of [
  "STATE_CONFLICT",
  "TIMEOUT",
  "NETWORK",
  "INVALID_RESPONSE",
  "INTERNAL_ERROR",
])
  test(`${code} locks repeat writes and retains draft until a successful real GET`, async () => {
    assert.equal(typeof controllers.createOptionsController, "function");
    const state = {};
    let writes = 0,
      failRead = false,
      reads = 0;
    const ctl = controllers.createOptionsController({
      state,
      storeId: () => "store",
      productId: () => "p",
      request: async (p, o) => {
        if (o) {
          writes++;
          throw { code, requestId: "r1" };
        }
        reads++;
        if (failRead) throw { code: "NETWORK" };
        return source();
      },
    });
    await ctl.load();
    state.draft.modifiers[0].name = "新奶盖";
    await ctl.save();
    await ctl.save();
    assert.equal(writes, 1);
    assert.equal(state.blocked, true);
    assert.equal(state.draft.modifiers[0].name, "新奶盖");
    assert.match(state.error, /r1/);
    failRead = true;
    await ctl.load();
    assert.equal(state.blocked, true);
    assert.equal(state.draft.modifiers[0].name, "新奶盖");
    failRead = false;
    await ctl.load();
    assert.equal(reads, 3);
    assert.equal(state.blocked, false);
    assert.equal(state.draft.modifiers[0].name, "奶盖");
    assert.equal(state.previousDraft.modifiers[0].name, "新奶盖");
  });
test("successful write waits for GET and catalog refresh before unlocking; duplicate click cannot write twice", async () => {
  assert.equal(typeof controllers.createOptionsController, "function");
  const state = {};
  let finish,
    writes = 0,
    read = 0,
    refreshed = false;
  const ctl = controllers.createOptionsController({
    state,
    storeId: () => "store",
    productId: () => "p",
    onChanged: () =>
      new Promise(
        (r) =>
          (finish = () => {
            refreshed = true;
            r();
          }),
      ),
    request: async (p, o) => {
      if (o) {
        writes++;
        return source();
      }
      read++;
      return source();
    },
  });
  await ctl.load();
  const saving = ctl.save();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(state.busy, true);
  assert.equal(read, 2);
  await ctl.save();
  assert.equal(writes, 1);
  finish();
  await saving;
  assert.equal(refreshed, true);
  assert.equal(state.busy, false);
  assert.match(state.notice, /已保存/);
});
test("modifier inventory uses available CAS and blocks after conflict without dropping input", async () => {
  assert.equal(typeof controllers.createOptionsController, "function");
  const state = {};
  let sent;
  const ctl = controllers.createOptionsController({
    state,
    storeId: () => "store",
    productId: () => "p",
    request: async (p, o) => {
      if (!o) return source();
      sent = { p, ...o };
      throw { code: "STATE_CONFLICT" };
    },
  });
  await ctl.load();
  state.inventory.m = "9";
  await ctl.saveInventory("m");
  assert.equal(sent.p, "/merchant/modifiers/m/inventory");
  assert.deepEqual(sent.data, {
    storeId: "store",
    expectedAvailable: 3,
    available: 9,
  });
  assert.equal(state.inventory.m, "9");
  assert.equal(state.blocked, true);
});
test("owner restriction and scope changes ignore late replies", async () => {
  assert.equal(typeof controllers.createOptionsController, "function");
  const state = {};
  let scope = "store",
    resolve,
    reads = 0,
    writes = 0;
  const ctl = controllers.createOptionsController({
    state,
    canEdit: () => false,
    storeId: () => scope,
    productId: () => "p",
    request: async (p, o) => {
      if (o) writes++;
      else reads++;
      return new Promise((r) => (resolve = r));
    },
  });
  const loading = ctl.load();
  scope = "next";
  resolve(source());
  await loading;
  assert.equal(state.draft, null);
  assert.equal(reads, 1);
  await ctl.save();
  assert.equal(writes, 0);
});
test("disposal ignores a confirmed in-flight reload response without refreshing the catalog", async () => {
  const state = {};
  let reads = 0,
    refreshes = 0,
    resolvePending;
  const ctl = controllers.createOptionsController({
    state,
    storeId: () => "store",
    productId: () => "p",
    onChanged: async () => {
      refreshes++;
    },
    request: async () => {
      reads++;
      if (reads === 1) return source();
      return new Promise((resolve) => {
        resolvePending = resolve;
      });
    },
  });
  await ctl.load();
  const originalDraft = structuredClone(state.draft);
  const pending = ctl.load();
  assert.equal(reads, 2, "reload request must be in flight before disposal");
  assert.equal(typeof resolvePending, "function");
  ctl.dispose();
  const latest = source();
  latest.configurationRevision = 3;
  latest.modifiers[0].name = "卸载后晚到的改名";
  resolvePending(latest);
  await pending;
  assert.deepEqual(state.draft, originalDraft);
  assert.equal(state.previousDraft, null);
  assert.equal(refreshes, 0);
});
test("removing an unsaved dimension clears its draft selections and never removes established identities", () => {
  assert.equal(typeof mod.removeNewOptionsGroup, "function");
  const d = mod.optionsDraft(source()),
    g = mod.newOptionsGroup("spec");
  d.specGroups.push(g);
  d.skus[0].selections.push({
    groupRef: g.clientKey,
    valueRef: g.values[0].clientKey,
  });
  mod.removeNewOptionsGroup(d, "spec", 0);
  assert.equal(d.specGroups[0].id, "g");
  mod.removeNewOptionsGroup(d, "spec", 1);
  assert.equal(d.specGroups.length, 1);
  assert.equal(d.skus[0].selections.length, 1);
});
test("inventory saves preserve unsaved configuration edits and refresh catalog", async () => {
  const state = {};
  let refresh = 0;
  const ctl = controllers.createOptionsController({
    state,
    storeId: () => "store",
    productId: () => "p",
    onChanged: async () => {
      refresh++;
    },
    request: async (p, o) =>
      o ? { id: "m", available: 9, reserved: 2 } : source(),
  });
  await ctl.load();
  state.draft.modifiers[0].name = "改名待保存";
  state.inventory.m = "9";
  await ctl.saveInventory("m");
  assert.equal(state.draft.modifiers[0].name, "改名待保存");
  assert.equal(state.draft.modifiers[0].available, 9);
  assert.equal(refresh, 1);
});
test("failed confirmation GET keeps draft locked after a successful PUT", async () => {
  const state = {};
  let reads = 0,
    writes = 0;
  const ctl = controllers.createOptionsController({
    state,
    storeId: () => "store",
    productId: () => "p",
    request: async (p, o) => {
      if (o) {
        writes++;
        return source();
      }
      if (++reads > 1) throw { code: "NETWORK" };
      return source();
    },
  });
  await ctl.load();
  state.draft.modifiers[0].name = "未核对改名";
  await ctl.save();
  await ctl.save();
  assert.equal(writes, 1);
  assert.equal(state.blocked, true);
  assert.equal(state.notice, "");
  assert.equal(state.draft.modifiers[0].name, "未核对改名");
});
test("failed list refresh never reports success or releases unknown result lock", async () => {
  const state = {};
  const ctl = controllers.createOptionsController({
    state,
    storeId: () => "store",
    productId: () => "p",
    onChanged: async () => {
      throw { code: "NETWORK" };
    },
    request: async () => source(),
  });
  await ctl.load();
  await ctl.save();
  assert.equal(state.notice, "");
  assert.equal(state.blocked, true);
});
test("inventory conflict recovery preserves the attempted quantity for comparison", async () => {
  const state = {};
  const ctl = controllers.createOptionsController({
    state,
    storeId: () => "store",
    productId: () => "p",
    request: async (p, o) => {
      if (o) throw { code: "STATE_CONFLICT" };
      return source();
    },
  });
  await ctl.load();
  state.inventory.m = "9";
  await ctl.saveInventory("m");
  await ctl.load();
  assert.equal(state.previousInventory.m, "9");
  assert.equal(state.inventory.m, "3");
});
test("recovery also awaits the real product list refresh before unlocking", async () => {
  const state = {};
  let failList = true;
  const ctl = controllers.createOptionsController({
    state,
    storeId: () => "store",
    productId: () => "p",
    onChanged: async () => {
      if (failList) throw { code: "NETWORK" };
    },
    request: async (p, o) => {
      if (o) throw { code: "TIMEOUT" };
      return source();
    },
  });
  await ctl.load();
  await ctl.save();
  await ctl.load();
  assert.equal(state.blocked, true);
  failList = false;
  await ctl.load();
  assert.equal(state.blocked, false);
});
