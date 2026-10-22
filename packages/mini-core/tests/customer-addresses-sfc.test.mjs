import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer as createOfflineServer } from "node:http";
import { readFile } from "node:fs/promises";
import { addressStorageKey } from "../src/customer-addresses.mjs";
import { createMiniCustomerAddresses, uniAddressStorage } from "../../../apps/customer-mini/src/addresses.js";

const require = createRequire(new URL("../../../apps/customer-mini/package.json", import.meta.url));
const { reactive, nextTick, createRenderer } = require("vue");
const { parse, compileScript } = require("vue/compiler-sfc");
const viteEntry = new URL(require("vite/package.json").exports["."].import.default, pathToFileURL(require.resolve("vite/package.json")));
const { createServer } = await import(viteEntry);

const customTags = ["view", "text", "button", "input", "textarea", "label", "picker", "switch", "image", "scroll-view"];
let server, CustomerAddresses, AddressForm, AddressPoint, Index;
const node = (tag, text = "") => ({ tag, tagName: tag.toUpperCase(), text, children: [], props: {}, parent: null, style: {}, querySelector: () => null, addEventListener() {}, getAttribute(name) { return this.props[name]; } });
const renderer = createRenderer({
  createElement: (tag) => node(tag),
  createText: (text) => node("#text", text),
  createComment: (text) => node("#comment", text),
  setText: (nodeValue, text) => { nodeValue.text = text; },
  setElementText: (nodeValue, text) => { nodeValue.text = text; nodeValue.children = []; },
  parentNode: (nodeValue) => nodeValue.parent,
  nextSibling: (nodeValue) => nodeValue.parent?.children[nodeValue.parent.children.indexOf(nodeValue) + 1],
  insert(nodeValue, parent, anchor) { if (nodeValue.parent) nodeValue.parent.children.splice(nodeValue.parent.children.indexOf(nodeValue), 1); const position = parent.children.indexOf(anchor); parent.children.splice(position < 0 ? parent.children.length : position, 0, nodeValue); nodeValue.parent = parent; },
  remove(nodeValue) { nodeValue.parent?.children.splice(nodeValue.parent.children.indexOf(nodeValue), 1); nodeValue.parent = null; },
  patchProp(nodeValue, key, _previous, value) { nodeValue.props[key] = value; },
});
const all = (root) => [root, ...root.children.flatMap(all)];
const text = (root) => root.text + root.children.map(text).join("");
const find = (root, tag, label) => all(root).find((nodeValue) => nodeValue.tag === tag && text(nodeValue).replace(/\s+/g, "").includes(label.replace(/\s+/g, "")));
const findInput = (root, id) => all(root).find((nodeValue) => nodeValue.tag === "input" && nodeValue.props.id === id);
const findTextarea = (root, placeholder) => all(root).find((nodeValue) => nodeValue.tag === "textarea" && nodeValue.props.placeholder === placeholder);
async function settle() { for (let index = 0; index < 10; index++) { await Promise.resolve(); await nextTick(); } }
async function click(root, label) { const button = find(root, "button", label); assert.ok(button, "button " + label); assert.ok(!button.props.disabled, "enabled " + label); await button.props.onClick?.({}); await settle(); }
function mount(component, props = {}) { assert.ok(component, "actual SFC exists"); const root = node("root"), app = renderer.createApp(component, props); app.mount(root); return { root, app }; }
function setInput(root, id, value) { const input = findInput(root, id); assert.ok(input, "input " + id); input.props.onInput?.({ detail: { value } }); }
function setTextarea(root, placeholder, value) { const input = findTextarea(root, placeholder); assert.ok(input, "textarea " + placeholder); input.props.onInput?.({ detail: { value } }); }

before(async () => {
  globalThis.document = { activeElement: null };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  server = await createServer({
    root: fileURLToPath(new URL("../../../apps/customer-mini", import.meta.url)),
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true, watch: null, hmr: { server: createOfflineServer() } },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [{
      name: "actual-customer-address-sfc",
      transform(source, filename) {
        if (!filename.endsWith(".vue")) return;
        if (filename.endsWith("pages/index/index.vue")) {
          source = source.replace(/const\s*\{\s*tab,/, "const customerState = useCustomer();\nconst {\n  tab,");
          source = source.replace("} = useCustomer();", "} = customerState;\nglobalThis.__actualCustomer = customerState;");
        }
        const isCustomElement = (tag) => customTags.includes(tag);
        const { descriptor } = parse(source, { filename, templateParseOptions: { isCustomElement } });
        return compileScript(descriptor, {
          id: filename,
          inlineTemplate: true,
          templateOptions: { compilerOptions: { isCustomElement } },
        }).content;
      },
    }],
  });
  const load = async (path) => {
    try { return (await server.ssrLoadModule(path)).default; } catch (error) { console.error("SFC loader", path, error.message); return null; }
  };
  CustomerAddresses = await load("/src/components/CustomerAddresses.vue");
  AddressForm = await load("/src/components/AddressForm.vue");
  AddressPoint = await load("/src/components/AddressPoint.vue");
  Index = await load("/src/pages/index/index.vue");
});
after(async () => { await server?.close(); });

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
const writeResult = (kind, value, bookRevision, replayed = false) => ({
  operation: {
    kind,
    addressId: value.id,
    addressRevision: value.revision,
    bookRevision,
    succeededAt: "2026-10-21T00:01:00.000Z",
  },
  address: value,
  bookRevision,
  replayed,
});
function installStoredController({ request, items = [address()] } = {}) {
  const values = new Map();
  const calls = [];
  globalThis.uni = {
    getStorageInfoSync: () => ({ keys: [...values.keys()] }),
    getStorageSync: (key) => (values.has(key) ? structuredClone(values.get(key)) : undefined),
    setStorageSync: (key, value) => values.set(key, structuredClone(value)),
    removeStorageSync: (key) => values.delete(key),
    getLocation: (options) => options.fail?.({ errMsg: "auth deny" }),
  };
  const state = reactive({});
  let currentItems = structuredClone(items);
  let bookRevision = currentItems.length ? 1 : 0;
  const controller = createMiniCustomerAddresses({
    state,
    storage: uniAddressStorage(),
    context: () => ({ userId: "customer", identity: "session-generation-1" }),
    key: () => "sfc-address-key",
    request: async (path, options = {}) => {
      calls.push({ path, options: structuredClone(options) });
      if (path === "/customer/addresses" && !options.method)
        return { items: structuredClone(currentItems), bookRevision, limit: 20 };
      if (request) return request({ path, options, calls, setItems(next, revision) { currentItems = next; bookRevision = revision; } });
      throw Error("Unexpected request " + path);
    },
  });
  return { values, calls, state, controller, setItems(next, revision) { currentItems = next; bookRevision = revision; } };
}

test("actual customer address list creates, rereads and confirms deletion without choosing a replacement default", async () => {
  const fixture = installStoredController({
    request: async ({ path, options, setItems }) => {
      if (path === "/customer/addresses" && options.method === "POST") {
        const value = address({ id: "address-2", name: options.data.name, isDefault: options.data.isDefault, revision: 0 });
        const previous = address({ ...fixtureItems[0], isDefault: false, revision: 1 });
        fixtureItems.splice(0, fixtureItems.length, previous);
        setItems([previous, value], 2);
        return writeResult("CREATE", value, 2);
      }
      if (/^\/customer\/addresses\/address-2\/delete$/.test(path)) {
        const deleted = address({ id: "address-2", name: "周顾客", revision: 1, deletedAt: "2026-10-21T00:02:00.000Z", isDefault: false });
        setItems([fixtureItems[0]], 3);
        return writeResult("DELETE", deleted, 3);
      }
      throw Error(path);
    },
  });
  const fixtureItems = [address()];
  fixture.setItems(fixtureItems, 1);
  const mounted = mount(CustomerAddresses, { controller: fixture.controller });
  await settle();
  assert.match(text(mounted.root), /林顾客/);
  assert.match(text(mounted.root), /默认地址/);
  await click(mounted.root, "新增收货地址");
  setInput(mounted.root, "address-name", "周顾客");
  setInput(mounted.root, "address-phone", "13900000000");
  setInput(mounted.root, "address-region", "上海市静安区");
  setTextarea(mounted.root, "街道、门牌号等详细地址", "南京西路 1 号");
  const defaultToggle = find(mounted.root, "button", "设为默认地址");
  assert.ok(defaultToggle);
  await defaultToggle.props.onClick({});
  await click(mounted.root, "保存地址");
  assert.equal(fixture.calls.filter((call) => call.path === "/customer/addresses" && call.options.method === "POST").length, 1);
  assert.equal(fixture.state.items.length, 2);
  assert.match(text(mounted.root), /周顾客/);
  await click(mounted.root, "删除");
  assert.match(text(mounted.root), /确认删除地址/);
  await click(mounted.root, "确认删除");
  assert.equal(fixture.calls.some((call) => call.path === "/customer/addresses/address-2/delete"), true, JSON.stringify(fixture.calls.map((call) => call.path)));
  assert.equal(fixture.state.items.length, 1);
  assert.equal(fixture.state.items[0].id, "address-1");
  assert.equal(fixture.state.items[0].isDefault, false);
  assert.doesNotMatch(text(mounted.root), /周顾客/);
  assert.doesNotMatch(text(mounted.root), /默认地址/);
  mounted.app.unmount();
});

test("actual customer address SFC keeps draft through 409, requires explicit reread and explicit version confirmation", async () => {
  let serverItem = address({ revision: 1, name: "服务器最新地址", detail: "服务器最新门牌" });
  let bookRevision = 2;
  let updateCount = 0;
  const fixture = installStoredController();
  fixture.controller.dispose();
  const state = reactive({});
  const calls = [];
  const controller = createMiniCustomerAddresses({
    state,
    storage: uniAddressStorage(),
    context: () => ({ userId: "customer", identity: "session-generation-1" }),
    key: () => "sfc-conflict-key",
    request: async (path, options = {}) => {
      calls.push({ path, options: structuredClone(options) });
      if (path === "/customer/addresses" && !options.method)
        return { items: [structuredClone(serverItem)], bookRevision, limit: 20 };
      if (path === "/customer/addresses/address-1" && !options.method)
        return { address: structuredClone(serverItem), bookRevision };
      if (path === "/customer/addresses/address-1" && options.method === "PUT") {
        updateCount++;
        if (updateCount === 1)
          throw Object.assign(Error("地址已变化"), { code: "ADDRESS_CHANGED", status: 409, requestId: "sfc-conflict-request" });
        serverItem = address({ ...serverItem, revision: 2, detail: options.data.detail });
        bookRevision = 3;
        return writeResult("UPDATE", { ...serverItem }, 3);
      }
      throw Error(path);
    },
  });
  const mounted = mount(CustomerAddresses, { controller });
  await settle();
  await click(mounted.root, "修改");
  setTextarea(mounted.root, "街道、门牌号等详细地址", "保留中的本地门牌");
  await click(mounted.root, "保存地址");
  assert.equal(controller.state.form.detail, "保留中的本地门牌");
  assert.match(text(mounted.root), /sfc-conflict-request/);
  assert.match(text(mounted.root), /读取最新地址/);
  await click(mounted.root, "读取最新地址");
  assert.match(text(mounted.root), /使用最新版本继续/);
  assert.equal(controller.state.form.detail, "保留中的本地门牌");
  assert.equal(controller.state.form.expectedRevision, 1);
  await click(mounted.root, "使用最新版本继续");
  await click(mounted.root, "保存地址");
  assert.equal(updateCount, 2);
  const updateBodies = calls.filter((call) => call.path === "/customer/addresses/address-1" && call.options.method === "PUT").map((call) => call.options.data);
  assert.equal(updateBodies[1].expectedBookRevision, 2);
  assert.equal(updateBodies[1].expectedRevision, 1);
  mounted.app.unmount();
});

test("actual Index exposes independent order and address recovery entries and opens address review", async () => {
  const values = new Map();
  values.set("session:customer", { token: "token" });
  values.set("pending-order:v1:customer", { quoteId: "old-quote", key: "old-order" });
  values.set(addressStorageKey("customer"), {
    schemaVersion: 1,
    userId: "customer",
    kind: "CREATE",
    addressId: null,
    key: "old-address",
    method: "POST",
    path: "/customer/addresses",
    body: { expectedBookRevision: 0, name: "原顾客", phone: "13800000000", region: "上海市浦东新区", detail: "原地址", point: null, isDefault: false },
  });
  globalThis.uni = {
    getStorageInfoSync: () => ({ keys: [...values.keys()] }),
    getStorageSync: (key) => (values.has(key) ? structuredClone(values.get(key)) : undefined),
    setStorageSync: (key, value) => values.set(key, structuredClone(value)),
    removeStorageSync: (key) => values.delete(key),
    $on() {},
    showToast() {},
    showModal: (options) => options.success({ confirm: true }),
    request(options) {
      const path = new URL(options.url).pathname.replace("/api/v1", "");
      const ok = (data) => queueMicrotask(() => options.success({ statusCode: 200, data: { data: structuredClone(data) } }));
      if (path === "/public-config") return ok({ environment: "development", home: { bannerTitle: "今日菜单", bannerSubtitle: "现做现取" }, theme: {} });
      if (path === "/stores") return ok([{ id: "a", name: "一店", serviceModes: ["PICKUP"], isOpen: true }]);
      if (path === "/me") return ok({ id: "customer", role: "CUSTOMER", name: "顾客" });
      if (path === "/stores/a/catalog") return ok({ categories: [], products: [] });
      if (path === "/stores/a/tables") return ok([]);
      if (path === "/orders") return ok({ items: [], total: 0, page: 1, pageSize: 20 });
      if (path === "/customer/addresses") return ok({ items: [], bookRevision: 0, limit: 20 });
      throw Error(path);
    },
  };
  const mounted = mount(Index);
  await settle();
  assert.match(text(mounted.root), /上次订单结果尚未确认/);
  assert.match(text(mounted.root), /原地址操作待核对/);
  assert.match(text(mounted.root), /恢复上次订单/);
  assert.match(text(mounted.root), /核对收货地址/);
  await click(mounted.root, "核对收货地址");
  assert.match(text(mounted.root), /收货地址/);
  assert.match(text(mounted.root), /原新增地址待核对/);
  mounted.app.unmount();

  values.set(addressStorageKey("customer"), "");
  const corrupt = mount(Index);
  await settle();
  assert.match(text(corrupt.root), /原地址操作待核对/);
  await click(corrupt.root, "核对收货地址");
  assert.match(text(corrupt.root), /本机地址恢复记录需要核对/);
  assert.match(text(corrupt.root), /不会自动删除记录/);
  corrupt.app.unmount();
});

test("actual AddressPoint only updates the form after explicit proposal confirmation and ignores cancelled or late results", async () => {
  const locationCalls = [];
  globalThis.uni = globalThis.uni || {};
  globalThis.uni.getLocation = (options) => locationCalls.push(options);
  const first = mount(AddressPoint, { point: null, region: "上海市浦东新区", detail: "梧桐路" });
  await click(first.root, "获取配送点");
  locationCalls.at(-1).fail({ errMsg: "auth deny" });
  await settle();
  assert.match(text(first.root), /可继续填写文字地址/);
  const emitted = [];
  const second = mount(AddressPoint, {
    point: null,
    region: "上海市浦东新区",
    detail: "梧桐路",
    onChange: (point) => emitted.push(point),
  });
  await click(second.root, "获取配送点");
  locationCalls.at(-1).success({ latitude: 31.2345678, longitude: 121.4567891 });
  await settle();
  assert.equal(emitted.length, 0);
  await click(second.root, "使用此配送点");
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].system, "WGS84");
  assert.equal(emitted[0].source, "DEVICE");
  assert.equal(emitted[0].latitudeE6, 31234568);
  assert.equal(emitted[0].longitudeE6, 121456789);
  assert.equal(new Date(emitted[0].confirmedAt).toISOString(), emitted[0].confirmedAt);

  const stringCoordinates = [];
  const invalid = mount(AddressPoint, {
    point: null,
    region: "上海市",
    detail: "某路",
    onChange: (point) => stringCoordinates.push(point),
  });
  await click(invalid.root, "获取配送点");
  locationCalls.at(-1).success({ latitude: "31", longitude: "121" });
  await settle();
  assert.match(text(invalid.root), /没有取得可用的配送点/);
  assert.equal(stringCoordinates.length, 0);
  assert.equal(find(invalid.root, "button", "使用此配送点"), undefined);
  const cancelled = [];
  const third = mount(AddressPoint, { point: null, region: "上海市", detail: "某路", onChange: (point) => cancelled.push(point) });
  await click(third.root, "获取配送点");
  locationCalls.at(-1).success({ latitude: 31, longitude: 121 });
  await settle();
  await click(third.root, "取消");
  assert.deepEqual(cancelled, []);

  const late = [];
  const fourth = mount(AddressPoint, { point: null, region: "上海市", detail: "某路", onChange: (point) => late.push(point) });
  await click(fourth.root, "获取配送点");
  const lateCall = locationCalls.at(-1);
  fourth.app.unmount();
  lateCall.success({ latitude: 31, longitude: 121 });
  await settle();
  assert.deepEqual(late, []);
  first.app.unmount();
  second.app.unmount();
  third.app.unmount();
  invalid.app.unmount();
});

test("AddressForm preserves a confirmed point for name/phone edits and clears it when region or detail changes", async () => {
  const point = { system: "WGS84", latitudeE6: 31234568, longitudeE6: 121456789, source: "DEVICE", confirmedAt: "2026-10-21T00:00:00.000Z" };
  const form = reactive({
    id: "address-1",
    expectedBookRevision: 1,
    expectedRevision: 0,
    name: "顾客",
    phone: "13800000000",
    region: "上海市",
    detail: "某路",
    point,
    isDefault: false,
    busy: false,
    error: "",
    pointNotice: "",
  });
  const mounted = mount(AddressForm, { form });
  setInput(mounted.root, "address-name", "新顾客");
  assert.deepEqual(form.point, point);
  setInput(mounted.root, "address-phone", "13900000000");
  assert.deepEqual(form.point, point);
  setInput(mounted.root, "address-region", "上海市浦东新区");
  assert.equal(form.point, null);
  assert.match(form.pointNotice, /重新确认/);
  mounted.app.unmount();
});

test("address SFCs keep text at 14px or larger and include 390px and reduced-motion rules", async () => {
  const root = "D:/Codes/013MiniProgram/apps/customer-mini/src/components/";
  const inputs = [{ name: "AccessibleInput.vue", path: "D:/Codes/013MiniProgram/packages/mini-core/src/components/AccessibleInput.vue" }];
  for (const file of ["CustomerAddresses.vue", "AddressForm.vue", "AddressPoint.vue"]) inputs.push({ name: file, path: root + file });
  for (const { name: file, path: filePath } of inputs) {
    const source = await readFile(filePath, "utf8");
    const { descriptor } = parse(source, { filename: file });
    const css = descriptor.styles.map((style) => style.content).join("\n");
    for (const match of css.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g))
      assert.ok(Number(match[1]) >= 14, file + " font-size " + match[1]);
  }
  const customerSource = await readFile(root + "CustomerAddresses.vue", "utf8");
  const customerCss = parse(customerSource, { filename: "CustomerAddresses.vue" }).descriptor.styles.map((style) => style.content).join("\n");
  assert.match(customerCss, /@media\s*\(max-width:\s*390px\)/);
  assert.match(customerCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(customerCss, /min-height:\s*44px/);
  assert.match(customerCss, /padding:\s*20px 24px/);

  const manifest = JSON.parse(await readFile("D:/Codes/013MiniProgram/apps/customer-mini/src/manifest.json", "utf8"));
  assert.equal(manifest["mp-weixin"].appid, "");
  assert.equal(manifest["mp-weixin"].permission["scope.userLocation"].desc.includes("配送点"), true);
  assert.equal(manifest["mp-weixin"].requiredPrivateInfos.includes("getLocation"), true);
});
