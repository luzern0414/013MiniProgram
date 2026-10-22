import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer as createOfflineServer } from 'node:http';
import { login, shiftFact } from './cash-shifts-mini-fixture.mjs';
import { createMiniCashShifts, uniShiftStorage } from '../../../apps/merchant-mini/src/cash-shifts.js';
import { shiftStorageKey } from '../src/cash-shifts.mjs';

const require = createRequire(new URL('../../../apps/merchant-mini/package.json', import.meta.url));
const { parse, compileScript } = require('vue/compiler-sfc');
const { createRenderer, reactive, nextTick } = require('vue');
const viteEntry = new URL(require('vite/package.json').exports['.'].import.default, pathToFileURL(require.resolve('vite/package.json')));
const { createServer } = await import(viteEntry);
let server, CashShifts, Index, CashRefund, CashReceipt;
const node = (tag, text = '') => ({ tag, tagName: tag.toUpperCase(), text, children: [], props: {}, parent: null, style: {}, querySelector: () => null, addEventListener() {}, getAttribute(name) { return this.props[name]; } });
const renderer = createRenderer({
  createElement: tag => node(tag), createText: text => node('#text', text), createComment: text => node('#comment', text),
  setText: (n, text) => { n.text = text; }, setElementText: (n, text) => { n.text = text; n.children = []; },
  parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1],
  insert(n, parent, anchor) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); const pos = parent.children.indexOf(anchor); parent.children.splice(pos < 0 ? parent.children.length : pos, 0, n); n.parent = parent; },
  remove(n) { n.parent?.children.splice(n.parent.children.indexOf(n), 1); n.parent = null; },
  patchProp: (n, k, _p, v) => { n.props[k] = v; },
});
const all = root => [root, ...root.children.flatMap(all)];
const text = root => root.text + root.children.map(text).join('');
const find = (root, tag, label) => all(root).find(n => n.tag === tag && text(n).trim() === label);
async function click(root, label) { const b = find(root, 'button', label); assert.ok(b, `button ${label}`); assert.ok(!b.props.disabled, `enabled ${label}`); await b.props.onClick?.({}); await settle(); }
async function settle() { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick(); } }
function mount(component, props) { const root = node('root'), app = renderer.createApp(component, props); app.mount(root); return { root, app }; }
before(async () => {
  globalThis.document = { activeElement: null };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  server = await createServer({ root: fileURLToPath(new URL('../../../apps/merchant-mini', import.meta.url)), configFile: false, appType: 'custom', server: { middlewareMode: true, watch: null, hmr: { server: createOfflineServer() } }, optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [{ name: 'actual-mini-sfc', transform(source, filename) {
      if (!filename.endsWith('.vue')) return;
      source = source.replace('import { onBackPress } from "@dcloudio/uni-app";', 'const onBackPress = fn => globalThis.__miniBackPress = fn;')
        .replace('import { useMerchant } from "../../merchant.js";', 'const useMerchant = () => globalThis.__actualMerchant;');
      const isCustomElement = tag => ['view', 'text', 'picker', 'checkbox'].includes(tag);
      const { descriptor } = parse(source, { filename, templateParseOptions: { isCustomElement } });
      return compileScript(descriptor, { id: filename, inlineTemplate: true, templateOptions: { compilerOptions: { isCustomElement } } }).content;
    } }] });
  // Missing implementation must produce an assertion failure, not a loader error.
  try { CashShifts = (await server.ssrLoadModule('/src/components/CashShifts.vue')).default; } catch { CashShifts = null; }
  Index = (await server.ssrLoadModule('/src/pages/index/index.vue')).default;
  CashRefund = (await server.ssrLoadModule('/src/components/CashRefund.vue')).default;
  CashReceipt = (await server.ssrLoadModule('/src/components/CashReceipt.vue')).default;
});
after(async () => { await server?.close(); delete globalThis.__actualMerchant; delete globalThis.__miniBackPress; });

function panel({ fact = shiftFact(), request, owner = true, storage = uniShiftStorage(), locked = () => false } = {}) {
  assert.ok(CashShifts, 'actual merchant Mini CashShifts.vue exists');
  const state = reactive({}), calls = [];
  const shifts = createMiniCashShifts({ state, storage, context: () => ({ userId: 'owner', storeId: 'a', owner }), locked,
    key: () => 'sfc-original-key', request: async (p, o) => { calls.push([p, o && structuredClone(o)]); if (request) return request(p, o); return p.includes('/current?') ? { shift: fact } : p.includes('state=') ? { items: [], total: 0, page: 1, pageSize: 20 } : fact; } });
  const mounted = mount(CashShifts, { shifts, owner, locked: locked() }); return { ...mounted, shifts, state, calls };
}
test('actual shift SFC reads current/history, previews zero difference and requires a separate explicit close', async () => {
  await login(); const closed = { ...shiftFact(), state: 'CLOSED', closedBy: { id: 'owner', name: '店主' }, closedAt: '2026-10-21T01:00:00Z', summary: { ...shiftFact().summary, countedFen: 100, differenceFen: 0, reason: null } };
  const r = panel({ request: async (p, o) => p.includes('/current?') ? { shift: shiftFact() } : p.includes('state=') ? { items: [closed], total: 1, page: 1, pageSize: 20 } : closed }); await settle();
  assert.match(text(r.root), /应有现金¥1.00/); assert.ok(r.calls.some(([p]) => p.includes('state=ALL')));
  r.state.counted = '1'; await nextTick(); await click(r.root, '核对关班'); assert.equal(r.calls.some(([, o]) => o), false);
  assert.ok(find(r.root, 'button', '明确关闭班次').props.disabled); await click(r.root, '确认：已清点现金并核对差额'); await click(r.root, '明确关闭班次');
  assert.equal(r.calls.filter(([, o]) => o).length, 1); assert.deepEqual(r.calls.find(([, o]) => o)[1].data, { storeId: 'a', expectedRevision: 0, countedFen: 100, reason: '' });
  assert.match(text(r.root), /已关班快照/); r.app.unmount();
});
test('actual shift SFC handles negative expected, reason validation, close conflict and preserved input', async () => {
  await login(); const fact = shiftFact(); Object.assign(fact.summary, { refundCount: 1, refundFen: 200, netFen: -200, expectedFen: -100 });
  const r = panel({ fact, request: async (p, o) => { if (o) throw Object.assign(Error('班次已变化'), { code: 'SHIFT_CHANGED', status: 409, requestId: 'close-conflict' }); return p.includes('/current?') ? { shift: fact } : p.includes('state=') ? { items: [], total: 0, page: 1, pageSize: 20 } : { ...fact, revision: 4 }; } }); await settle();
  r.state.counted = '0'; await nextTick(); await click(r.root, '核对关班'); assert.match(text(r.root), /差额原因/); assert.equal(find(r.root, 'button', '明确关闭班次'), undefined);
  r.state.reason = '跨班退款'; await nextTick(); await click(r.root, '核对关班'); await click(r.root, '确认：已清点现金并核对差额'); await click(r.root, '明确关闭班次');
  assert.equal(r.state.counted, '0'); assert.equal(r.state.reason, '跨班退款'); assert.equal(r.state.current.revision, 4); assert.equal(r.state.blocked, false); assert.match(text(r.root), /班次已变化/); assert.match(text(r.root), /close-conflict/); r.app.unmount();
});
test('actual shift SFC staff can read frozen history but cannot open or close', async () => {
  await login(); const r = panel({ owner: false, fact: null }); await settle(); assert.match(text(r.root), /店员可查看/); assert.equal(find(r.root, 'button', '确认开班'), undefined); assert.equal(find(r.root, 'button', '核对关班'), undefined); r.app.unmount();
});
test('actual Index with real useMerchant keeps OR navigation, H5 unload/back and financial recovery order without a route hint', async () => {
  const pending = { version: 1, userId: 'owner', storeId: 'b', kind: 'open', key: 'original-shift', data: { storeId: 'b', openingFen: 100 } };
  const r = await login({ shiftPending: pending, cashPending: { orderId: 'o1', storeId: 'a', tenderedFen: 200, key: 'old-cash' } });
  // Preserve a realistic logged-in session for Index's mounted init().
  const handlers = new Map(); globalThis.window = { addEventListener: (n, fn) => handlers.set(n, fn), removeEventListener: n => handlers.delete(n) };
  globalThis.__actualMerchant = r.m; const mounted = mount(Index); await settle();
  assert.match(text(mounted.root), /原交班操作待核对/); assert.ok(find(mounted.root, 'button', '进入现金交班').props.disabled); assert.equal(globalThis.__miniBackPress(), true);
  assert.ok(!text(all(mounted.root).find(n => n.props.class === 'top')).includes('原交班操作待核对'), 'recovery belongs in the body, outside the narrow store header');
  let prevented = false; handlers.get('beforeunload')({ preventDefault: () => { prevented = true; } }); assert.equal(prevented, true);
  await click(mounted.root, '恢复现金收款'); assert.equal(r.m.pendingCash.value, null); assert.equal(r.m.shiftBusy.value, true); assert.equal(globalThis.__miniBackPress(), true);
  await click(mounted.root, '进入现金交班'); await settle(); assert.equal(r.m.tab.value, 'shifts'); assert.equal(r.m.storeId.value, 'b');
  await click(mounted.root, '恢复原开班'); assert.equal(r.m.shiftBusy.value, false); assert.equal(r.values.has(shiftStorageKey('owner')), false); assert.equal(globalThis.__miniBackPress(), false);
  r.m.auxiliaryBusy.value = true; assert.equal(globalThis.__miniBackPress(), true); r.m.auxiliaryBusy.value = false;
  mounted.app.unmount(); assert.equal(handlers.size, 0);
});
test('actual Index original cash recovery stays reachable beside unknown draft and shift; live draft activity disables it', async () => {
  const shiftPending = { version: 1, userId: 'owner', storeId: 'b', kind: 'open', key: 'original-shift', data: { storeId: 'b', openingFen: 100 } };
  const edit = { name: '原挂单', selection: { mode: 'PICKUP', note: '原备注', lines: [{ skuId: 'sku', quantity: 1, modifierIds: [], attributeOptionIds: [] }] } };
  const r = await login({ shiftPending, cashPending: { orderId: 'o1', storeId: 'a', tenderedFen: 200, key: 'old-cash' }, request: ({ path, ok, order }) => {
    if (path === '/merchant/cashier-drafts/d1') { ok({ ...edit, id: 'd1', storeId: 'a', revision: 2, state: 'CONVERTED', orderId: 'o1', display: { lines: [] }, createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T01:00:00Z' }); return true; }
    if (path === '/orders/o1') { ok({ ...order, lines: [] }); return true; }
  } });
  r.values.set('cashier-draft:v1:owner', { version: 1, userId: 'owner', storeId: 'a', kind: 'convert', key: 'old-convert', draftId: 'd1', expectedRevision: 1, quoteId: 'old-quote', edit, path: '/orders', method: 'POST', data: { quoteId: 'old-quote' } });
  await r.m.init(); globalThis.__actualMerchant = r.m;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const mounted = mount(Index); await settle();
  assert.ok(!find(mounted.root, 'button', '恢复现金收款').props.disabled);
  r.m.cashier.value.state.drafts.busy = true; await nextTick(); assert.ok(find(mounted.root, 'button', '恢复现金收款').props.disabled);
  r.m.cashier.value.state.drafts.busy = false; await nextTick(); await click(mounted.root, '恢复现金收款');
  assert.equal(r.m.pendingCash.value, null); assert.equal(r.m.cashierBusy.value, true); assert.equal(r.m.shiftBusy.value, true);
  assert.equal(await r.m.showShifts(), false); assert.equal(await r.m.shifts.value.recover('replay'), false);
  await click(mounted.root, '返回原门店核对挂单');
  assert.equal(r.m.tab.value, 'cashier'); assert.ok(!find(mounted.root, 'button', '读取原操作结果').props.disabled);
  assert.ok(!find(mounted.root, 'button', '恢复原下单').props.disabled);
  await click(mounted.root, '读取原操作结果'); assert.equal(r.m.cashier.value.state.drafts.order.id, 'o1'); assert.equal(r.m.cashierBusy.value, false); assert.equal(r.m.shiftBusy.value, true);
  assert.equal(r.calls.filter(c => c.path.endsWith('cash-payment')).length, 1, 'restored formal order never starts a new cash write');
  await click(mounted.root, '进入现金交班'); assert.equal(r.m.tab.value, 'shifts');
  mounted.app.unmount();
});
test('actual refund SFC review reads active shift before confirmation and preserves entered amounts when missing', async () => {
  const r = await login({ shift: null }); Object.assign(r.order, { cashReceipt: { amountFen: 100 }, cashRefunds: [], paymentStatus: 'PAID' }); r.m.order.value = r.order;
  const mounted = mount(CashRefund, { order: r.order, state: r.m.refund, controller: r.m.refundCtl.value, owner: true });
  await click(mounted.root, '登记现金退款'); r.m.refund.amount = '0.50'; r.m.refund.reason = '退款保留'; await nextTick(); await click(mounted.root, '核对退款');
  assert.equal(r.m.refund.review, false); assert.equal(r.m.refund.amount, '0.50'); assert.match(r.m.refund.error, /开班/); assert.equal(r.calls.some(c => c.path.endsWith('cash-refunds')), false); mounted.app.unmount();
});
test('actual cash receipt displays nullable historical attribution and real refund relation without inferring dates', async () => {
  const order = { cashReceipt: { amountFen: 100, tenderedFen: 200, changeFen: 100, shiftId: null }, cashRefunds: [{ id: 'r', amountFen: 10, reason: '退款', createdAt: '2026-10-21T01:00:00Z', shiftId: 'actual-refund-shift' }] };
  const r = mount(CashReceipt, { order }); assert.match(text(r.root), /历史未归班/); assert.match(text(r.root), /退款班次：actual-refund-shift/); r.app.unmount();
});
for (const kind of ['cash', 'refund']) test(`actual Index shift return button restores original ${kind} input without financial writes`, async () => {
  const r = await login({ shift: null }); globalThis.__actualMerchant = r.m;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const mounted = mount(Index); await settle();
  if (kind === 'cash') { r.m.openCash(r.order); r.m.tendered.value = '2.00'; }
  else { Object.assign(r.order, { cashReceipt: { amountFen: 100, tenderedFen: 200, changeFen: 100, shiftId: null }, paymentStatus: 'PAID' }); r.m.order.value = r.order; r.m.tab.value = 'orders'; Object.assign(r.m.refund, { amount: '0.50', reason: '原退款原因', expanded: true }); }
  await nextTick(); await click(mounted.root, '现金交班');
  assert.equal(r.m.tab.value, 'shifts'); assert.match(text(mounted.root), /当前没有活动现金班次/);
  await click(mounted.root, kind === 'cash' ? '返回原收款' : '返回原退款');
  assert.equal(r.m.tab.value, 'orders'); assert.equal(r.m.order.value.id, 'o1');
  if (kind === 'cash') { assert.equal(r.m.sheet.value, 'cash'); assert.equal(r.m.tendered.value, '2.00'); assert.match(text(mounted.root), /实际收到现金/); }
  else { assert.equal(r.m.refund.amount, '0.50'); assert.equal(r.m.refund.reason, '原退款原因'); assert.match(text(mounted.root), /核对退款/); }
  assert.equal(r.calls.some(c => c.path.endsWith('cash-payment') || c.path.endsWith('cash-refunds')), false);
  mounted.app.unmount();
});
test('actual shift recovery displays frozen original amount and failed GET cannot unlock or send a new attempt', async () => {
  const r = await login(); r.values.set(shiftStorageKey('owner'), { version: 1, userId: 'owner', storeId: 'a', kind: 'open', key: 'unknown-open', data: { storeId: 'a', openingFen: 123 } });
  const p = panel({ request: async () => { throw Object.assign(Error('读取失败'), { code: 'FORBIDDEN', status: 403, requestId: 'read-original' }); } });
  assert.match(text(p.root), /原期初现金 ¥1.23/); await click(p.root, '读取最新班次');
  assert.equal(p.state.blocked, true); assert.equal(p.state.pending.key, 'unknown-open'); assert.match(text(p.root), /read-original/); assert.equal(p.calls.some(([, o]) => o), false);
  p.app.unmount();
});
for (const mode of ['set throws', 'silent set', 'readback throws', 'remove readback']) test(`actual uni shift adapter ${mode} fails closed`, async () => {
  const r = await login(), state = reactive({}), storage = uniShiftStorage(), calls = [];
  if (mode === 'set throws') uni.setStorageSync = () => { throw Error('quota'); };
  if (mode === 'silent set') uni.setStorageSync = () => {};
  if (mode === 'readback throws') { const get = uni.getStorageSync; uni.getStorageSync = k => { if (r.values.has(k)) throw Error('read'); return get(k); }; }
  if (mode === 'remove readback') uni.removeStorageSync = () => {};
  const adapter = createMiniCashShifts({ state, storage, context: () => ({ userId: 'owner', storeId: 'a', owner: true }), request: async (p, o) => { calls.push([p, o]); return shiftFact(); } });
  state.opening = '1'; assert.equal(await adapter.open(), false);
  assert.equal(calls.filter(([, o]) => o).length, mode === 'remove readback' ? 1 : 0);
  if (mode === 'remove readback') { assert.equal(state.blocked, true); assert.ok(state.pending); }
  assert.match(state.error.message, mode === 'remove readback' ? /清理/ : /保存/); adapter.dispose();
});
for (const change of ['store', 'identity', 'dispose']) test(`actual uni adapter ignores late ${change} result and preserves original stored operation`, async () => {
  const r = await login(), state = reactive({}); let resolve;
  const context = { userId: 'owner', storeId: 'a', owner: true };
  const adapter = createMiniCashShifts({ state, storage: uniShiftStorage(), context: () => context, request: () => new Promise(done => { resolve = done; }) });
  state.opening = '1'; const sending = adapter.open();
  if (change === 'store') context.storeId = 'b'; if (change === 'identity') context.userId = 'another'; if (change === 'dispose') adapter.dispose();
  resolve(shiftFact()); assert.equal(await sending, false); assert.equal(state.current, null); assert.ok(r.values.has(shiftStorageKey('owner'))); adapter.dispose();
});
