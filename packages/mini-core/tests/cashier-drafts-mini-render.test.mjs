import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer as createOfflineServer } from 'node:http';
import { createMiniCashier, uniDraftStorage } from '../../../apps/merchant-mini/src/cashier.js';
import { draftSelection, draftStorageKey } from '../src/cashier-drafts.mjs';

// Compile the actual mini SFCs with the installed merchant Vue 3.4 compiler.
// Only uni primitives are custom elements; child components and their setup run.
// Middleware mode opens no port and never touches the running development app.
const require = createRequire(new URL('../../../apps/merchant-mini/package.json', import.meta.url));
const { parse, compileScript } = require('vue/compiler-sfc');
const { createSSRApp, version } = require('vue');
const { renderToString } = require('vue/server-renderer');
const viteEntry = new URL(require('vite/package.json').exports['.'].import.default, pathToFileURL(require.resolve('vite/package.json')));
const { createServer } = await import(viteEntry);
let server, CashierPanel;
before(async () => {
  assert.equal(version, '3.4.21');
  server = await createServer({
    root: fileURLToPath(new URL('../../../apps/merchant-mini', import.meta.url)),
    configFile: false, appType: 'custom',
    server: { middlewareMode: true, watch: null, hmr: { server: createOfflineServer() } },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [{
      name: 'test-actual-mini-sfc',
      transform(source, filename) {
        if (!filename.endsWith('.vue')) return;
        const isCustomElement = tag => ['view', 'text', 'picker'].includes(tag);
        const { descriptor } = parse(source, { filename, templateParseOptions: { isCustomElement } });
        return compileScript(descriptor, {
          id: filename, inlineTemplate: true,
          templateOptions: { compilerOptions: { isCustomElement } },
        }).content;
      },
    }],
  });
  CashierPanel = (await server.ssrLoadModule('/src/components/CashierPanel.vue')).default;
});
after(async () => { await server?.close(); });

const copy = value => JSON.parse(JSON.stringify(value));
const selection = { mode: 'PICKUP', note: '本地旧备注', lines: [{ skuId: 'small', quantity: 1, modifierIds: ['egg'], attributeOptionIds: ['mild'] }] };
const draft = { id: 'd1', storeId: 's1', name: '原挂单', revision: 1, state: 'DRAFT', selection, display: { lines: [] }, orderId: null, createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T01:00:00Z' };
const oldQuote = { id: 'old-q', totalFen: 1200, cashierDraft: { id: draft.id, revision: 1 } };
const oldCart = [{ ...selection.lines[0], productName: '本地旧商品', skuName: '本地旧规格', modifierNames: ['本地旧加料'], unitPriceFen: 1200 }];
const actualOrder = {
  id: 'real-order', number: 'R20261021', storeId: 's1', mode: 'DINE_IN', tableName: '历史01桌', note: '下单时备注',
  totalFen: 2400, status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID',
  lines: [{ skuId: 'small', productName: '下单时商品', skuName: '下单时规格', quantity: 2, lineTotalFen: 2400,
    modifiers: [{ id: 'egg', name: '下单时加料', priceFen: 200 }],
    attributes: [{ groupId: 'taste', groupName: '下单时口味', options: [{ id: 'mild', name: '下单时属性' }] }] }],
};
const store = { id: 's1', serviceModes: ['DINE_IN', 'PICKUP'] };
const render = (cashier, locked = false) => renderToString(createSSRApp(CashierPanel, { cashier, store, locked }));
function setup({ order = actualOrder } = {}) {
  const state = {}, values = new Map(), calls = [], opened = [];
  let externalLock = false;
  const cashier = createMiniCashier({
    state, userId: () => 'u1', storeId: () => 's1', locked: () => externalLock,
    storage: { get: key => values.get(key), set: (key, value) => values.set(key, copy(value)), remove: key => values.delete(key) },
    onOrder: value => opened.push(value),
    request: async (path, options) => {
      calls.push([path, options]);
      if (options) throw Object.assign(Error('丢失转单回执'), { code: 'NETWORK' });
      if (path.startsWith('/merchant/cashier-drafts/d1?')) return {
        ...copy(draft), revision: 2, state: 'CONVERTED', orderId: order.id,
        selection: { mode: 'DINE_IN', tableCode: 'T01', note: order.note, lines: selection.lines.map(line => ({ ...line, quantity: 2 })) },
      };
      if (path === `/orders/${order.id}`) return copy(order);
      throw Error(`Unexpected isolated request: ${path}`);
    },
  });
  Object.assign(state, { cart: copy(oldCart), name: draft.name, note: selection.note });
  state.catalog.products = [{ id: 'p1', name: '当前菜单商品', isAvailable: true, skus: [{ id: 'small', name: '当前规格', priceFen: 1000, available: 20 }], modifiers: [{ id: 'egg', name: '当前加料', priceFen: 200, available: 20 }], attributeGroups: [{ id: 'taste', name: '口味', minSelections: 1, maxSelections: 1, options: [{ id: 'mild', name: '微辣' }] }] }];
  Object.assign(state.drafts, { remote: copy(draft), edit: { name: draft.name, selection: copy(selection) }, quote: copy(oldQuote) });
  return { state, cashier, calls, opened, lock: value => { externalLock = value; } };
}
function assertOrderSnapshot(html, expected = actualOrder) {
  for (const text of ['订单明细', '2份', '下单时商品', '下单时规格', '下单时加料', '下单时口味', '下单时属性', '下单时备注']) assert.ok(html.includes(text), text);
  const amount = expected.totalFen === 0 ? '¥0.00' : '¥24.00';
  assert.ok(html.includes(`${amount}</text><text>×2</text>`), 'historical per-line total and quantity');
  assert.ok(html.includes(`订单应收</text><text>${amount}</text>`), 'server order total');
  for (const text of ['本地旧商品', '本地旧规格', '本地旧加料', '本地旧备注', '¥12.00', '购物袋', '核价应收', '保存并核价', '生成正式订单', '修改搭配', '增加数量', '减少数量', '挂单名称', '选择商品', '尽快取餐']) assert.ok(!html.includes(text), `must hide ${text}`);
}

test('actual mini panel keeps editable selection and current quote before a formal order exists', async () => {
  const r = setup();
  const html = await render(r.cashier);
  for (const text of ['本地旧商品', '购物袋 · 1份', '核价应收', '¥12.00', '保存并核价', '生成正式订单', '修改搭配']) assert.ok(html.includes(text), text);
  for (const label of ['保存并核价', '生成正式订单', '修改搭配']) assert.ok(!html.match(new RegExp(`<button[^>]*>${label}</button>`))[0].includes('disabled'), label);
  assert.ok(!html.includes('订单明细'));
});

test('actual mini restored bag keeps known names after valid then empty or invalid menus and exact create replay', async () => {
  const values = new Map(), calls = [], writes = [];
  const uni = { getStorageInfoSync: () => ({ keys: [...values.keys()] }), getStorageSync: key => values.get(key), setStorageSync: (key, value) => values.set(key, copy(value)), removeStorageSync: key => values.delete(key) };
  const create = request => {
    const state = {};
    return createMiniCashier({ state, request, storage: uniDraftStorage(uni), userId: () => 'u1', storeId: () => 's1' });
  };
  const original = create(async (path, options) => { writes.push([path, copy(options)]); throw Object.assign(Error('隔离丢回执'), { code: 'NETWORK' }); });
  Object.assign(original.state, { cart: copy(selection.lines), name: '原挂单名', note: selection.note });
  original.state.pickup.slotId = 'original-slot';
  assert.equal(await original.save(), false);
  const pending = copy(original.state.drafts.pending);
  const valid = { categories: [], products: [{ id: 'p1', name: '已知商品', isAvailable: true, skus: [{ id: 'small', name: '已知规格', priceFen: 1000, available: 20 }], modifiers: [{ id: 'egg', name: '已知加料', priceFen: 200, available: 20 }], attributeGroups: [{ id: 'taste', name: '口味', minSelections: 1, maxSelections: 1, options: [{ id: 'mild', name: '已知属性' }] }] }] };
  let catalog = valid;
  const remote = { ...copy(draft), name: '远端名称', selection: { ...copy(selection), note: '远端备注' }, display: { lines: [{ productName: '远端商品', skuName: '远端规格', modifierNames: ['远端加料'], attributeNames: ['远端属性'] }] } };
  const cashier = create(async (path, options) => {
    calls.push([path, options && copy(options)]);
    if (path.endsWith('/catalog')) return copy(catalog);
    if (path.endsWith('/tables')) return [];
    return copy(remote);
  });
  assert.match(await render(cashier), /原商品 · 原规格/);
  assert.equal(await cashier.loadMenu(), true);
  const known = copy(cashier.state.cart[0]);
  const invalid = copy(valid); invalid.products[0].modifiers = [];
  for (const nextCatalog of [{ categories: [], products: [] }, invalid]) {
    catalog = nextCatalog;
    assert.equal(await cashier.loadMenu(), true);
    const html = await render(cashier);
    for (const text of ['已知商品 · 已知规格 ×1', '已知加料', '已知属性', '待重新核价']) assert.ok(html.includes(text), text);
    assert.ok(!html.includes('原商品 · 原规格')); assert.ok(!html.includes('¥0.00'));
    assert.deepEqual(draftSelection(cashier.state.cart, { ...cashier.state, pickupSlotId: cashier.state.pickup.slotId }), pending.edit.selection);
    assert.equal(cashier.state.name, pending.edit.name); assert.deepEqual(cashier.state.drafts.edit, pending.edit);
    assert.deepEqual(cashier.state.drafts.pending, pending); assert.deepEqual(values.get(draftStorageKey('u1')), pending);
    assert.equal(cashier.state.cart[0].unitPriceFen, known.unitPriceFen); assert.equal(cashier.state.cart[0].configurationRevision, known.configurationRevision);
    assert.equal(cashier.state.pickup.needsRefresh, true); assert.equal(cashier.state.pickup.selected, null);
    assert.equal(cashier.editingLocked(), true); assert.equal(await cashier.quote(), false);
  }
  assert.equal(calls.length, 6); assert.equal(calls.some(([, options]) => options), false);
  assert.equal(await cashier.recover('replay'), true);
  const html = await render(cashier);
  for (const text of ['远端商品 · 远端规格 ×1', '远端加料', '待重新核价']) assert.ok(html.includes(text), text);
  assert.deepEqual(calls.filter(([, options]) => options), writes); assert.equal(calls.length, 8);
  assert.deepEqual(cashier.state.drafts.edit, pending.edit); assert.equal(cashier.state.name, pending.edit.name);
  assert.deepEqual(draftSelection(cashier.state.cart, { ...cashier.state, pickupSlotId: cashier.state.pickup.slotId }), pending.edit.selection);
  assert.equal(cashier.state.drafts.pending, null); assert.equal(cashier.state.drafts.blocked, false);
  assert.equal(await cashier.quote(), false); assert.equal(calls.length, 8);
});

test('adapter read recovery renders actual server snapshot and hides old one-item cart and quote', async () => {
  const r = setup();
  assert.equal(await r.cashier.convert(), false);
  assert.equal(r.state.drafts.blocked, true);
  const originalAttempt = copy(r.state.drafts.pending);
  assert.equal(await r.cashier.recover('read'), true);
  assert.equal(r.state.drafts.blocked, false);
  assert.equal(r.state.drafts.pending, null);
  assert.deepEqual(r.state.drafts.order, actualOrder);
  assert.equal(r.state.drafts.remote.selection.lines[0].quantity, 2, 'coworker changed the server draft before conversion');
  assert.deepEqual(r.state.cart, oldCart, 'keep original bag for audit/recovery');
  assert.deepEqual(r.state.drafts.quote, oldQuote, 'presentation must not rewrite shared quote data');
  assert.deepEqual(r.state.drafts.edit.selection, selection);
  const html = await render(r.cashier);
  assertOrderSnapshot(html);
  for (const text of ['堂食', '历史01桌', '待付款', '未付款', '查看订单与收款', '开始下一单']) assert.ok(html.includes(text), text);
  assert.equal(r.calls.filter(([, options]) => options).length, 1);
  assert.deepEqual(r.calls[0][1].data, { quoteId: originalAttempt.quoteId });
  assert.equal(r.calls[0][1].headers['Idempotency-Key'], originalAttempt.key);
  assert.equal(r.opened.length, 0, 'recovery cannot enter or confirm cash');
  assert.equal(r.cashier.showOrder(), true);
  assert.deepEqual(r.opened, [actualOrder]);
  assert.ok(!r.calls.some(([path]) => path.includes('cash-payment')));
});

for (const [status, paymentStatus, label] of [['COMPLETED', 'PAID', '已付款'], ['CANCELLED', 'CLOSED', '已关闭']]) {
  test(`actual mini formal snapshot preserves ${paymentStatus} and zero price with historical pickup context`, async () => {
    const order = { ...copy(actualOrder), mode: 'PICKUP', tableName: null, pickupNumber: 'P008', pickupServiceDate: '2026-10-21', pickupWindow: { startsAt: '2026-10-21T04:00:00Z', endsAt: '2026-10-21T04:30:00Z' }, totalFen: 0, status, paymentStatus };
    order.lines[0].lineTotalFen = 0;
    const r = setup({ order }); r.state.drafts.order = copy(order);
    const html = await render(r.cashier);
    assertOrderSnapshot(html, order);
    for (const text of [label, status === 'COMPLETED' ? '已完成' : '已取消', '到店自取', 'P008', '2026-10-21', '12:00–12:30', '北京时间']) assert.ok(html.includes(text), text);
    assert.ok(!html.includes('历史01桌'));
    assert.ok(!html.includes('待重新核价'));
    assert.ok(!html.includes('¥24.00'));
    assert.deepEqual(r.state.drafts.order, order);
  });
}

test('formal snapshot cannot unlock original cash protection or next-order actions', async () => {
  const r = setup(); r.state.drafts.order = copy(actualOrder); r.lock(true);
  const before = copy(r.state.drafts.order);
  const html = await render(r.cashier, true);
  assertOrderSnapshot(html);
  for (const label of ['查看订单与收款', '开始下一单']) assert.match(html, new RegExp(`<button[^>]*disabled[^>]*>${label}</button>`));
  assert.equal(r.cashier.showOrder(), false);
  assert.equal(r.cashier.newBag(), false);
  assert.equal(await r.cashier.convert(), false);
  assert.equal(await r.cashier.save(), false);
  assert.deepEqual(r.state.drafts.order, before);
  assert.equal(r.opened.length, 0); assert.equal(r.calls.length, 0);
});
