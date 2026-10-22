import test from "node:test";
import assert from "node:assert/strict";
const mod = await import("../src/catalog-settings.mjs").catch(() => ({}));
const settings = () => ({
  canManageBrand: true,
  categories: [
    {
      id: "c",
      name: "茶",
      enabled: true,
      sort: 0,
      revision: 2,
      visibleStoreIds: null,
    },
  ],
  units: [{ id: "u", name: "杯", enabled: true, revision: 1 }],
  stores: [{ id: "s", name: "门店" }],
});
test("setting payload validates revision, sort and explicit hidden visibility", () => {
  assert.equal(typeof mod.catalogPayload, "function");
  assert.deepEqual(
    mod.catalogPayload(
      "s",
      "categories",
      { revision: 2 },
      {
        name: " 茶 ",
        sort: "0",
        enabled: false,
        allStores: false,
        visibleStoreIds: [],
      },
    ),
    {
      storeId: "s",
      expectedRevision: 2,
      name: "茶",
      sort: 0,
      enabled: false,
      visibleStoreIds: [],
    },
  );
  assert.throws(
    () =>
      mod.catalogPayload(
        "s",
        "categories",
        { revision: 2 },
        { name: "茶", sort: "1.2", allStores: true },
      ),
    /排序/,
  );
});
test("revision conflicts lock writes until successful reload, reference failure keeps draft", async () => {
  assert.equal(typeof mod.createCatalogController, "function");
  const state = {},
    data = settings();
  let code = "STATE_CONFLICT",
    writes = 0;
  const ctl = mod.createCatalogController({
    state,
    storeId: () => "s",
    request: async (path, opts) => {
      if (!opts) return data;
      writes++;
      throw { code };
    },
  });
  await ctl.load();
  ctl.open("categories", data.categories[0]);
  state.form.name = "新茶";
  await ctl.save();
  await ctl.save();
  assert.equal(writes, 1);
  assert.equal(state.blocked, true);
  assert.equal(state.form.name, "新茶");
  await ctl.reloadEditor();
  assert.equal(state.blocked, false);
  assert.equal(state.form.name, "茶");
  code = "REFERENCE_CONFLICT";
  await ctl.save(true);
  assert.equal(state.form.name, "茶");
  assert.match(state.error, /引用/);
  assert.equal(state.mode, "edit");
});
test("unknown write result locks resubmission and read-only settings reject writes", async () => {
  const state = {},
    data = settings();
  let writes = 0;
  const ctl = mod.createCatalogController({
    state,
    storeId: () => "s",
    request: async (p, o) => {
      if (!o) return data;
      writes++;
      throw { code: "TIMEOUT" };
    },
  });
  await ctl.load();
  ctl.open("units");
  state.form.name = "份";
  await ctl.save();
  await ctl.save();
  assert.equal(writes, 1);
  assert.match(state.error, /核对/);
  data.canManageBrand = false;
  await ctl.reloadEditor();
  ctl.open("units");
  await ctl.save();
  assert.equal(writes, 1);
});
test("late loads cannot populate a new store scope", async () => {
  let scope = "s",
    resolve;
  const state = {};
  const ctl = mod.createCatalogController({
    state,
    storeId: () => scope,
    request: () => new Promise((r) => (resolve = r)),
  });
  const loading = ctl.load();
  scope = "other";
  resolve(settings());
  await loading;
  assert.equal(state.settings, null);
});
test("product keeps disabled original category and unit, changes only to current valid selections", () => {
  assert.equal(typeof mod.productPayload, "function");
  const data = settings(),
    target = { id: "p", categoryId: "old", unitId: "old-u", unit: "份" };
  const form = {
    name: " 茶 ",
    description: "",
    imageUrl: "",
    categoryId: "old",
    unitId: "old-u",
    isAvailable: true,
  };
  const payload = mod.productPayload("s", target, form, data);
  assert.equal(Object.hasOwn(payload, "unitId"), false);
  assert.equal(Object.hasOwn(payload, "unit"), false);
  assert.equal(Object.hasOwn(payload, "categoryId"), false);
  assert.equal(Object.hasOwn(payload, "skus"), false);
  assert.throws(
    () => mod.productPayload("s", target, { ...form, unitId: "missing" }, data),
    /单位/,
  );
  assert.throws(
    () =>
      mod.productPayload("s", target, { ...form, categoryId: "missing" }, data),
    /分类/,
  );
  assert.equal(
    mod.productPayload(
      "s",
      target,
      { ...form, categoryId: "c", unitId: "u" },
      data,
    ).unitId,
    "u",
  );
  data.categories[0].visibleStoreIds = [];
  assert.throws(
    () => mod.productPayload("s", target, { ...form, categoryId: "c" }, data),
    /分类/,
  );
});
test("product create validates real selections, money, SKU count and stock", () => {
  const form = {
    name: "茶",
    description: "",
    categoryId: "c",
    unitId: "u",
    skus: [{ name: "标准", price: "2.30", stock: "5" }],
  };
  const payload = mod.productPayload("s", null, form, settings());
  assert.deepEqual(payload.skus, [{ name: "标准", priceFen: 230, stock: 5 }]);
  for (const change of [{ price: "1.234" }, { stock: "-1" }, { name: "" }])
    assert.throws(() =>
      mod.productPayload(
        "s",
        null,
        { ...form, skus: [{ ...form.skus[0], ...change }] },
        settings(),
      ),
    );
  assert.throws(
    () => mod.productPayload("s", null, { ...form, skus: [] }, settings()),
    /规格/,
  );
});
test("product editor rechecks settings before submitting and blocks after uncertain write", async () => {
  assert.equal(typeof mod.createProductController, "function");
  const state = {},
    data = settings();
  let writes = 0;
  let failLoad = false;
  const ctl = mod.createProductController({
    state,
    storeId: () => "s",
    request: async (p, o) => {
      if (!o) {
        if (failLoad) throw { code: "NETWORK_ERROR" };
        return data;
      }
      writes++;
      throw { code: "TIMEOUT" };
    },
  });
  await ctl.open();
  Object.assign(state.form, {
    name: "茶",
    categoryId: "c",
    unitId: "u",
    skus: [{ name: "标准", price: "1", stock: "1" }],
  });
  failLoad = true;
  await ctl.save();
  assert.equal(writes, 0);
  failLoad = false;
  await ctl.save();
  await ctl.save();
  assert.equal(writes, 1);
  assert.equal(state.blocked, true);
});
test("lost product update response reloads actual product before unlocking editor", async () => {
  const state = {},
    original = { id: "p", name: "旧名", unitId: "u", categoryId: "c" },
    actual = { ...original, name: "已成功保存" };
  let listReads = 0;
  const ctl = mod.createProductController({
    state,
    storeId: () => "s",
    request: async (path, opts) => {
      if (opts) throw { code: "INTERNAL_ERROR" };
      if (path.startsWith("/merchant/products?")) {
        listReads++;
        return { products: [actual] };
      }
      return settings();
    },
  });
  await ctl.open(original);
  await ctl.save();
  assert.equal(state.blocked, true);
  await ctl.reload();
  assert.equal(listReads, 1);
  assert.equal(state.form.name, "已成功保存");
  assert.equal(state.blocked, false);
});
test("uncertain creation must read product list before closing for verification, failed recovery stays locked", async () => {
  const state = {};
  let fail = true,
    writes = 0,
    reads = 0,
    saved = 0;
  const ctl = mod.createProductController({
    state,
    storeId: () => "s",
    onSaved: () => saved++,
    request: async (path, opts) => {
      if (opts) {
        writes++;
        throw { code: "TIMEOUT" };
      }
      if (path.startsWith("/merchant/products?")) {
        reads++;
        if (fail) throw { code: "NETWORK_ERROR" };
        return { products: [] };
      }
      return settings();
    },
  });
  await ctl.open();
  Object.assign(state.form, {
    name: "茶",
    categoryId: "c",
    unitId: "u",
    skus: [{ name: "标准", price: "1", stock: "0" }],
  });
  await ctl.save();
  await ctl.reload();
  await ctl.save();
  assert.equal(writes, 1);
  assert.equal(state.blocked, true);
  assert.equal(saved, 0);
  fail = false;
  await ctl.reload();
  assert.equal(reads, 2);
  assert.equal(state.mode, "");
  assert.equal(saved, 1);
  await ctl.save();
  assert.equal(writes, 1);
});
test("uncertain category creation returns to freshly loaded list rather than reopening create", async () => {
  const state = {};
  const ctl = mod.createCatalogController({
    state,
    storeId: () => "s",
    request: async (p, o) => {
      if (o) throw { code: "TIMEOUT" };
      return settings();
    },
  });
  await ctl.load();
  ctl.open("categories");
  state.form.name = "茶";
  await ctl.save();
  await ctl.reloadEditor();
  assert.equal(state.mode, "");
  assert.match(state.notice, /核对/);
});
test("a product selection disabled after opening is rejected using freshly fetched settings", async () => {
  const state = {};
  let latest = settings(),
    writes = 0,
    reads = 0;
  const ctl = mod.createProductController({
    state,
    storeId: () => "s",
    request: async (path, o) => {
      if (o) {
        writes++;
        return {};
      }
      reads++;
      return latest;
    },
  });
  await ctl.open();
  Object.assign(state.form, {
    name: "茶",
    categoryId: "c",
    unitId: "u",
    skus: [{ name: "标准", price: "1", stock: "0" }],
  });
  latest = settings();
  latest.units[0].enabled = false;
  await ctl.save();
  assert.equal(reads, 2);
  assert.equal(writes, 0);
  assert.match(state.error, /有效的售卖单位/);
});
