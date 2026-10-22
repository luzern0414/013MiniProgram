import test from 'node:test';
import assert from 'node:assert/strict';
import * as mobile from '../../../apps/merchant-mini/src/cashier.js';
import { createDraftController, draftSelection, draftStorageKey, readDraftAttempt } from '../src/cashier-drafts.mjs';
import { useMerchant } from '../../../apps/merchant-mini/src/merchant.js';

const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const selection = () => ({ mode: 'DINE_IN', tableCode: 'T01', note: '少盐', lines: [{ skuId: 'small', quantity: 1, modifierIds: ['egg'], attributeOptionIds: ['mild'] }] });
const draft = (extra = {}) => ({ id: 'd1', storeId: 's1', name: '张女士', revision: 1, state: 'DRAFT', selection: selection(), display: { lines: [{ skuId: 'small', productName: '面', skuName: '小份', modifierNames: ['蛋'], attributeNames: ['微辣'] }] }, orderId: null, createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T01:00:00Z', ...extra });
const menu = () => ({ categories: [], products: [{ id: 'p1', name: '面', isAvailable: true, skus: [{ id: 'small', name: '小份', priceFen: 1000, available: 120 }], modifiers: [{ id: 'egg', name: '蛋', priceFen: 200, available: 120 }], attributeGroups: [{ id: 'taste', name: '口味', minSelections: 1, maxSelections: 1, options: [{ id: 'mild', name: '微辣' }] }] }] });
const offline = () => Object.assign(Error('离线'), { code: 'NETWORK', requestId: 'request-original' });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { resolve, promise }; };
function uniMemory() {
  const values = new Map();
  return { values, getStorageInfoSync: () => ({ keys: [...values.keys()] }), getStorageSync: key => values.has(key) ? copy(values.get(key)) : '', setStorageSync: (key, value) => values.set(key, copy(value)), removeStorageSync: key => values.delete(key) };
}
function setup(overrides = {}) {
  assert.equal(typeof mobile.createMiniCashier, 'function', 'mobile adapter must use shared draft controller');
  const uni = overrides.uni || uniMemory(), calls = [], state = {};
  let current = draft();
  const request = overrides.request || (async (path, options) => {
    calls.push([path, copy(options)]);
    if (path.includes('/catalog')) return menu();
    if (path.includes('/tables')) return [{ code: 'T01', name: '01桌' }];
    if (path.includes('/pickup-slots')) return [];
    if (path.includes('/quote')) return { id: 'q1', totalFen: 1200, cashierDraft: { id: 'd1', revision: current.revision } };
    if (path === '/orders') { current = draft({ state: 'CONVERTED', orderId: 'order-real' }); return { id: 'order-real', storeId: 's1' }; }
    if (path === '/orders/order-real') return { id: 'order-real', storeId: 's1', totalFen: 1500, status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' };
    if (options) { current = draft({ name: options.data.name || current.name, selection: options.data.selection || current.selection, revision: current.revision + 1 }); return current; }
    if (path.includes('?storeId=') && !path.includes('state=')) return copy(current);
    return { items: [current], page: 1, pageSize: 20, total: 1 };
  });
  const cashier = mobile.createMiniCashier({ state, request, storage: mobile.uniDraftStorage(uni), userId: overrides.userId || (() => 'u1'), storeId: overrides.storeId || (() => 's1'), locked: overrides.locked || (() => false), onOrder: overrides.onOrder || (() => {}) });
  return { cashier, state, uni, calls, setRemote: value => { current = value; } };
}
test('uni storage distinguishes absent keys from empty/null corruption and fails closed without key enumeration', () => {
  assert.equal(typeof mobile.uniDraftStorage, 'function', 'uni storage adapter is available');
  const uni = uniMemory(), storage = mobile.uniDraftStorage(uni), key = draftStorageKey('u1');
  assert.equal(readDraftAttempt(storage, 'u1').error, null);
  for (const value of ['', null]) { uni.values.set(key, value); assert.equal(readDraftAttempt(storage, 'u1').error.code, 'DRAFT_STORAGE'); }
  assert.equal(readDraftAttempt(mobile.uniDraftStorage({ getStorageSync: () => '' }), 'u1').error.code, 'DRAFT_STORAGE');
});
test('mobile cross-device take preserves SKU, attributes, modifiers, table, note; edit CAS then quote uses new revision', async () => {
  const { cashier, state, calls } = setup(); await cashier.loadMenu();
  assert.equal(await cashier.take('d1'), true);
  assert.deepEqual(state.drafts.edit.selection, selection());
  assert.deepEqual(state.cart[0].modifierIds, ['egg']); assert.deepEqual(state.cart[0].attributeOptionIds, ['mild']);
  assert.equal(state.tableCode, 'T01'); assert.equal(state.note, '少盐');
  cashier.editField('note', '手机修改');
  assert.equal(await cashier.quote(), true);
  const update = calls.find(c => c[1]?.method === 'PUT');
  assert.equal(update[1].data.expectedRevision, 1); assert.equal(update[1].data.selection.note, '手机修改');
  assert.equal(calls.find(c => c[0].endsWith('/quote'))[1].data.expectedRevision, 2);
});
test('CAS conflict preserves mobile input and exposes remote revision without silent overwrite', async () => {
  const { cashier, state, setRemote } = setup(); await cashier.loadMenu(); await cashier.take('d1');
  cashier.editField('note', '我的修改');
  // A second device changes the server; this isolated request fixture enforces CAS.
  const remote = draft({ revision: 9 });
  const r = setup({ request: async (path, options) => { if (options) throw Object.assign(Error('版本已变'), { code: 'DRAFT_CHANGED', status: 409 }); return remote; } });
  r.state.drafts.remote = draft(); r.state.cart = state.cart; r.state.name = '张女士'; r.state.mode = 'DINE_IN'; r.state.tableCode = 'T01'; r.state.note = '我的修改';
  assert.equal(await r.cashier.save(), false);
  assert.equal(r.state.note, '我的修改'); assert.equal(r.state.drafts.remote.revision, 9); assert.equal(r.state.drafts.review, true);
});
test('nonempty bag replacement requires an explicit decision; slow read cannot publish after cancellation', async () => {
  const { cashier, state } = setup(); await cashier.loadMenu(); await cashier.take('d1');
  const selected = copy(state.cart); assert.equal(await cashier.take('other'), false); assert.deepEqual(state.cart, selected);
  const gate = deferred(); const r = setup({ request: () => gate.promise });
  const taking = r.cashier.take('d1'); assert.equal(r.cashier.navigationLocked(), true);
  r.cashier.cancelTake(); gate.resolve(draft()); assert.equal(await taking, false);
  assert.equal(r.state.drafts.remote, null); assert.deepEqual(r.state.cart, []); assert.equal(r.state.drafts.quote, null);
});
test('unknown conversion persists original quote/key, reload discovers it and only explicit replay creates; never cashes', async () => {
  const r = setup(); await r.cashier.loadMenu(); await r.cashier.take('d1'); await r.cashier.quote();
  const writes = [], originalRequest = async (path, options) => { writes.push([path, copy(options)]); throw offline(); };
  const unknown = setup({ uni: r.uni, request: originalRequest });
  Object.assign(unknown.state.drafts, { remote: draft(), edit: { name: '张女士', selection: selection() }, quote: r.state.drafts.quote });
  Object.assign(unknown.state, { cart: r.state.cart, name: '张女士', mode: 'DINE_IN', tableCode: 'T01', note: '少盐' });
  await unknown.cashier.convert(); const first = copy(writes[0]);
  assert.equal(unknown.cashier.navigationLocked(), true); assert.equal(unknown.state.drafts.pending.quoteId, 'q1');
  const restored = setup({ uni: r.uni });
  assert.equal(restored.cashier.navigationLocked(), true); assert.equal(restored.cashier.pendingStore(), 's1');
  await restored.cashier.recover(); assert.equal(restored.state.drafts.blocked, true);
  await restored.cashier.recover('replay');
  assert.deepEqual(restored.calls.find(c => c[0] === '/orders'), first);
  assert.equal(restored.state.drafts.order.totalFen, 1500); assert.equal(restored.state.drafts.order.paymentStatus, 'UNPAID');
  assert.equal(restored.calls.some(c => c[0].includes('cash-payment')), false);
});
test('storage write/readback and clear failure keep operation safe, recoverable and discoverable', async () => {
  const uni = uniMemory(); uni.setStorageSync = () => {};
  const r = setup({ uni }); Object.assign(r.state, { cart: [selection().lines[0]], name: '新单' });
  assert.equal(await r.cashier.save(), false); assert.equal(r.calls.length, 0); assert.equal(r.state.drafts.error.code, 'DRAFT_STORAGE');
  const normal = setup(); await normal.cashier.loadMenu(); await normal.cashier.take('d1'); normal.uni.removeStorageSync = () => {};
  assert.equal(await normal.cashier.save(), false); assert.equal(normal.cashier.navigationLocked(), true);
  assert.ok(normal.uni.values.get(draftStorageKey('u1')));
});
test('take retains unavailable required options and original expired pickup selection with editable IDs', async () => {
  const r = setup(); await r.cashier.loadMenu();
  const unavailable = menu(); unavailable.products[0].attributeGroups[0].options = [];
  r.state.catalog = unavailable;
  r.setRemote(draft({ selection: { ...selection(), mode: 'PICKUP', tableCode: undefined, pickupSlotId: 'expired' } }));
  await r.cashier.take('d1');
  assert.deepEqual(r.state.cart[0].attributeOptionIds, ['mild']); assert.ok(r.cashier.lineIssue(r.state.cart[0]));
  assert.equal(r.state.pickup.slotId, 'expired'); assert.equal(r.state.pickup.needsRefresh, true);
  assert.equal(await r.cashier.quote(), false); assert.equal(r.state.pickup.slotId, 'expired');
});
test('quantity 1 and 99 valid, 100/stock excess and required option missing rejected; wrong table blocks quote', async () => {
  const r = setup(); await r.cashier.loadMenu();
  assert.equal(r.cashier.add({ ...selection().lines[0], quantity: 1 }), true);
  assert.equal(r.cashier.changeQuantity(0, 99), true); assert.equal(r.state.cart[0].quantity, 99);
  assert.equal(r.cashier.changeQuantity(0, 100), false); assert.equal(r.state.cart[0].quantity, 99);
  r.state.catalog.products[0].skus[0].available = 98; assert.equal(r.cashier.changeQuantity(0, 99), false);
  r.state.catalog.products[0].attributeGroups[0].options = []; assert.equal(r.cashier.add(selection().lines[0]), false);
  r.state.name = '桌台校验'; r.state.mode = 'DINE_IN'; r.state.tableCode = 'wrong'; assert.equal(await r.cashier.quote(), false);
});
test('OR locks protect writes, menu edits, navigation and recovery; dispose/account/store switches ignore late responses', async () => {
  let external = true; const r = setup({ locked: () => external });
  assert.equal(r.cashier.navigationLocked(), true); assert.equal(await r.cashier.save(), false); assert.equal(r.cashier.add(selection().lines[0]), false);
  external = false; const gate = deferred(); let uid = 'u1', sid = 's1';
  const old = setup({ request: () => gate.promise, userId: () => uid, storeId: () => sid });
  const taking = old.cashier.take('d1'); uid = 'u2'; sid = 's2'; old.cashier.dispose(); gate.resolve(draft()); await taking;
  assert.equal(old.state.drafts.remote, null); assert.deepEqual(old.state.cart, []);
});
test('converted draft binds authorized real order and original cash entry only runs on explicit view action', async () => {
  let opened = null; const r = setup({ onOrder: value => { opened = value; } });
  r.setRemote(draft({ state: 'CONVERTED', orderId: 'order-real' }));
  await r.cashier.take('d1'); assert.equal(opened, null); assert.equal(r.state.drafts.order.totalFen, 1500);
  assert.equal(r.cashier.showOrder(), true); assert.equal(opened.id, 'order-real'); assert.equal(opened.paymentStatus, 'UNPAID');
  assert.equal(await r.cashier.save(), false);
});

function merchantRuntime(uni = uniMemory()) {
  const calls = [], listeners = new Map();
  const user = { id: 'u1', role: 'CLERK', storeIds: ['s1', 's2'] };
  Object.assign(uni, {
    $on: (name, fn) => listeners.set(name, fn), $emit: name => listeners.get(name)?.(),
    request(options) {
      const path = new URL(options.url).pathname.replace('/api/v1', ''); calls.push(path);
      const success = data => queueMicrotask(() => options.success({ statusCode: 200, data: { data } }));
      if (path === '/public-config') return success({ environment: 'development' });
      if (path === '/stores') return success([{ id: 's1' }, { id: 's2' }]);
      if (path === '/auth/dev-login') return success({ token: 'session', user });
      if (path === '/me') return success(user);
      if (path === '/merchant/overview') return success({});
      if (path === '/merchant/products') return success(menu());
      if (path === '/orders') return success({ items: [], total: 0 });
      if (path === '/auth/logout') return success({});
      if (path === '/merchant/cashier-drafts/d1') return success(draft());
      if (path.endsWith('/catalog')) return success(menu());
      if (path.endsWith('/tables')) return success([{ code: 'T01' }]);
      throw Error(path);
    },
  });
  globalThis.uni = uni;
  return { uni, calls };
}
test('merchant login finds identity-wide draft at original store and locks logout, store/tab changes and original order writes', async () => {
  const uni = uniMemory();
  const pending = setup({ uni, request: async () => { throw offline(); } });
  Object.assign(pending.state, { name: '待恢复', cart: [selection().lines[0]] }); await pending.cashier.save();
  uni.values.set('merchant:store', 's2');
  const r = merchantRuntime(uni), merchant = useMerchant(); await merchant.init(); await merchant.login('clerk');
  assert.equal(merchant.storeId.value, 's1'); assert.equal(merchant.tab.value, 'cashier');
  assert.equal(merchant.cashierBusy.value, true);
  await merchant.selectStore('s2'); merchant.navigate('orders'); await merchant.logout();
  merchant.openCash({ id: 'unrelated' }); await merchant.transition({ id: 'unrelated' }, 'ACCEPT', '接单');
  assert.equal(merchant.storeId.value, 's1'); assert.equal(merchant.tab.value, 'cashier'); assert.equal(merchant.cashOrder.value, null); assert.ok(merchant.user.value);
  assert.equal(r.calls.includes('/auth/logout'), false); assert.ok(uni.values.get(draftStorageKey('u1')));
});
test('merchant cash/refund/auxiliary busy use OR with draft locks; unknown cash never loses frozen original key or amount', async () => {
  const r = merchantRuntime(), merchant = useMerchant(); await merchant.init(); await merchant.login('clerk');
  assert.ok(merchant.cashier?.value, 'merchant owns mobile cashier adapter');
  const c = merchant.cashier.value;
  merchant.auxiliaryBusy.value = true;
  assert.equal(await c.save(), false); merchant.navigate('cashier'); assert.equal(merchant.tab.value, 'overview');
  merchant.auxiliaryBusy.value = false; merchant.refund.blocked = true;
  assert.equal(c.editingLocked(), true); merchant.refund.blocked = false;
  merchant.pendingCash.value = { key: 'old-key', tenderedFen: 9999, storeId: 's1', orderId: 'old-order' };
  assert.equal(c.editingLocked(), true); assert.equal(c.newBag(), false);
  assert.equal(await c.take('d1'), false); assert.equal(merchant.pendingCash.value.key, 'old-key'); assert.equal(merchant.pendingCash.value.tenderedFen, 9999);
});
test('merchant disposal on session expiry cannot expose late draft in a newly logged-in scope', async () => {
  const r = merchantRuntime(), merchant = useMerchant(); await merchant.init(); await merchant.login('clerk');
  assert.ok(merchant.cashier?.value, 'merchant owns mobile cashier adapter');
  const old = merchant.cashier.value;
  uni.$emit('session-expired');
  assert.equal(merchant.cashier.value, null); assert.equal(old.navigationLocked(), true);
  await merchant.login('clerk'); assert.notEqual(merchant.cashier.value, old);
  assert.equal(old.showOrder(), false); assert.equal(merchant.order.value, null);
});
test('formal order cannot be replaced through adapter take without starting an explicit next bag', async () => {
  const r = setup(); r.setRemote(draft({ state: 'CONVERTED', orderId: 'order-real' })); await r.cashier.take('d1');
  const before = r.calls.length;
  assert.equal(await r.cashier.take('another', { replace: true }), false);
  assert.equal(r.calls.length, before); assert.equal(r.state.drafts.order.id, 'order-real');
});
test('merchant independent cashier starts with a service mode actually supported by its store', async () => {
  const r = merchantRuntime();
  const original = r.uni.request;
  r.uni.request = options => {
    if (new URL(options.url).pathname.endsWith('/stores')) return queueMicrotask(() => options.success({ statusCode: 200, data: { data: [{ id: 's1', serviceModes: ['DINE_IN'] }] } }));
    original(options);
  };
  const m = useMerchant(); await m.init(); await m.login('clerk');
  assert.equal(m.cashier.value.state.mode, 'DINE_IN');
});
test('unknown update and cancel survive uni reload and require explicit keep/reload after successful GET', async () => {
  for (const operation of ['save', 'cancel']) {
    const r = setup({ request: async () => { throw offline(); } });
    Object.assign(r.state.drafts, { remote: draft() }); Object.assign(r.state, { cart: [selection().lines[0]], name: '本地名称', note: '本地备注' });
    await r.cashier[operation](); assert.equal(r.state.drafts.blocked, true);
    const restored = setup({ uni: r.uni });
    await restored.cashier.recover(); assert.equal(restored.state.drafts.blocked, true); assert.equal(restored.state.name, '本地名称');
    await restored.cashier.recover('reload'); assert.equal(restored.state.drafts.blocked, false); assert.equal(restored.state.name, '张女士'); assert.equal(restored.state.note, '少盐');
    assert.equal(restored.calls.some(c => c[1]), false);
  }
});
for (const hasMenu of [true, false]) {
  test(`restored create refreshes bag names from ${hasMenu ? 'loaded menu' : 'replay display'} without changing the original request`, async () => {
    const writes = [], local = { ...selection(), mode: 'PICKUP', tableCode: undefined, pickupSlotId: 'original-slot', note: '原备注' };
    const original = setup({ request: async (path, options) => { writes.push([path, copy(options)]); throw offline(); } });
    Object.assign(original.state, { name: ' 原挂单名 ', mode: local.mode, note: local.note, cart: copy(local.lines) });
    original.state.pickup.slotId = local.pickupSlotId;
    assert.equal(await original.cashier.save(), false);
    const pending = copy(original.state.drafts.pending), calls = [];
    const restored = setup({ uni: original.uni, request: async (path, options) => {
      calls.push([path, copy(options)]);
      if (path.endsWith('/catalog')) return hasMenu ? menu() : { categories: [], products: [] };
      if (path.endsWith('/tables')) return [];
      return draft({ name: '远端另一名称', selection: { ...selection(), note: '远端备注', lines: [{ ...selection().lines[0], quantity: 9 }] } });
    } });
    const input = () => ({ name: restored.state.name, selection: draftSelection(restored.state.cart, { mode: restored.state.mode, tableCode: restored.state.tableCode, pickupSlotId: restored.state.pickup.slotId, note: restored.state.note }) });
    assert.equal(restored.state.cart[0].productName, '原商品');
    assert.equal(await restored.cashier.loadMenu(), true);
    assert.deepEqual(input(), pending.edit); assert.deepEqual(restored.state.drafts.edit, pending.edit);
    assert.deepEqual(restored.state.drafts.pending, pending); assert.deepEqual(restored.uni.values.get(draftStorageKey('u1')), pending);
    assert.equal(restored.cashier.navigationLocked(), true); assert.equal(calls.some(c => c[1]), false);
    if (hasMenu) {
      assert.equal(restored.state.cart[0].productName, '面'); assert.equal(restored.state.cart[0].skuName, '小份');
      assert.deepEqual(restored.state.cart[0].modifierNames, ['蛋']);
      assert.equal(restored.state.cart[0].attributes[0].options[0].name, '微辣');
    }
    assert.equal(await restored.cashier.recover('replay'), true);
    const line = restored.state.cart[0];
    assert.equal(line.productName, '面'); assert.equal(line.skuName, '小份'); assert.deepEqual(line.modifierNames, ['蛋']);
    assert.equal(line.attributes?.[0].options[0].name || line.display.attributeNames[0], '微辣');
    assert.deepEqual(input(), pending.edit); assert.deepEqual(restored.state.drafts.edit, pending.edit);
    assert.equal(restored.state.pickup.needsRefresh, true); assert.equal(restored.state.pickup.selected, null);
    assert.deepEqual(calls.filter(c => c[1]), writes); assert.equal(calls.length, 4);
    assert.equal(restored.state.drafts.blocked, false); assert.equal(restored.state.drafts.order, null);
    if (!hasMenu) { assert.ok(restored.cashier.lineIssue(line)); assert.equal(await restored.cashier.quote(), false); assert.equal(calls.length, 4); }
  });
}
test('restored update read matches display by selection while retaining local input and unknown lock', async () => {
  const local = selection(); local.lines.push({ skuId: 'removed', quantity: 3, modifierIds: ['old-extra'], attributeOptionIds: ['old-taste'] });
  const original = setup({ request: async () => { throw offline(); } });
  original.state.drafts.remote = draft();
  Object.assign(original.state, { name: '原本地名称', mode: 'DINE_IN', tableCode: 'T-local', note: '原本地备注', cart: copy(local.lines) });
  await original.cashier.save(); const pending = copy(original.state.drafts.pending), calls = [];
  const remote = draft({ name: '远端修改', selection: { ...selection(), lines: [local.lines[1], { ...local.lines[0], modifierIds: [], attributeOptionIds: [] }] }, display: { lines: [
    { skuId: 'removed', productName: '已下架原菜', skuName: '原规格名', modifierNames: ['原加料名'], attributeNames: ['原口味名'] },
    { skuId: 'small', productName: '另一搭配', skuName: '另一规格', modifierNames: [], attributeNames: [] },
  ] } });
  const restored = setup({ uni: original.uni, request: async (path, options) => { calls.push([path, copy(options)]); return copy(remote); } });
  assert.equal(await restored.cashier.recover('read'), true);
  assert.equal(restored.state.cart[0].productName, '原商品', 'different options cannot supply this local line display');
  assert.equal(restored.state.cart[1].productName, '已下架原菜'); assert.equal(restored.state.cart[1].skuName, '原规格名');
  assert.deepEqual(restored.state.cart[1].modifierNames, ['原加料名']); assert.deepEqual(restored.state.cart[1].display.attributeNames, ['原口味名']);
  assert.equal(restored.state.name, pending.edit.name); assert.equal(restored.state.mode, pending.edit.selection.mode);
  assert.equal(restored.state.tableCode, pending.edit.selection.tableCode); assert.equal(restored.state.note, pending.edit.selection.note);
  assert.deepEqual(restored.state.cart.map(({ skuId, quantity, modifierIds, attributeOptionIds }) => ({ skuId, quantity, modifierIds, attributeOptionIds })), pending.edit.selection.lines);
  assert.deepEqual(restored.state.drafts.edit, pending.edit); assert.deepEqual(restored.state.drafts.pending, pending);
  assert.equal(restored.state.drafts.blocked, true); assert.equal(restored.cashier.editingLocked(), true);
  assert.ok(restored.cashier.lineIssue(restored.state.cart[1])); assert.equal(await restored.cashier.save(), false);
  assert.equal(calls.length, 1); assert.equal(calls[0][1], undefined);
});
test('menu display refresh retains restored known names through empty and invalid menus without changing pending input', async () => {
  const original = setup({ request: async () => { throw offline(); } });
  Object.assign(original.state, { name: '原本地名称', mode: 'DINE_IN', tableCode: 'T-local', note: '原本地备注', cart: copy(selection().lines) });
  assert.equal(await original.cashier.save(), false);
  const pending = copy(original.state.drafts.pending), calls = [];
  let catalog = menu();
  const restored = setup({ uni: original.uni, request: async (path, options) => {
    calls.push([path, copy(options)]);
    if (path.endsWith('/catalog')) return copy(catalog);
    if (path.endsWith('/tables')) return [];
    throw Error(`Unexpected isolated request: ${path}`);
  } });
  assert.equal(restored.state.cart[0].productName, '原商品');
  assert.equal(await restored.cashier.loadMenu(), true);
  const known = copy(restored.state.cart[0]);
  assert.equal(known.productName, '面'); assert.equal(known.skuName, '小份');
  const invalid = menu(); invalid.products[0].attributeGroups[0].options = [];
  for (const nextCatalog of [{ categories: [], products: [] }, invalid]) {
    catalog = nextCatalog;
    assert.equal(await restored.cashier.loadMenu(), true);
    const line = restored.state.cart[0];
    assert.equal(line.productName, '面'); assert.equal(line.skuName, '小份');
    assert.deepEqual(line.modifierNames, ['蛋']); assert.deepEqual(line.attributes, known.attributes);
    assert.equal(line.unitPriceFen, known.unitPriceFen); assert.equal(line.configurationRevision, known.configurationRevision);
    assert.deepEqual(draftSelection(restored.state.cart, restored.state), pending.edit.selection);
    assert.equal(restored.state.name, pending.edit.name);
    assert.deepEqual(restored.state.drafts.edit, pending.edit); assert.deepEqual(restored.state.drafts.pending, pending);
    assert.deepEqual(restored.uni.values.get(draftStorageKey('u1')), pending);
    assert.equal(restored.cashier.editingLocked(), true); assert.ok(restored.cashier.lineIssue(line));
    assert.equal(await restored.cashier.quote(), false);
  }
  assert.equal(calls.length, 6); assert.equal(calls.some(([, options]) => options), false);
  const r = setup(); await r.cashier.loadMenu(); await r.cashier.take('d1');
  const priced = copy(r.state.cart[0]); r.state.cart[0].configurationRevision = -1;
  assert.equal(await r.cashier.loadMenu(), true);
  assert.equal(r.state.cart[0].configurationRevision, -1); assert.equal(r.state.cart[0].unitPriceFen, priced.unitPriceFen);
  assert.match(r.cashier.lineIssue(r.state.cart[0]), /已调整/);
});
test('expired conversion quote preserves input, clears rejected quote and forces explicit requote', async () => {
  const r = setup({ request: async (path, options) => { if (options) throw Object.assign(Error('金额已过期'), { code: 'QUOTE_EXPIRED', status: 409 }); return draft(); } });
  Object.assign(r.state.drafts, { remote: draft(), edit: { name: '张女士', selection: selection() }, quote: { id: 'old-q', totalFen: 1200, cashierDraft: { id: 'd1', revision: 1 } } });
  Object.assign(r.state, { cart: [selection().lines[0]], name: '张女士', note: '未丢失' });
  assert.equal(await r.cashier.convert(), false); assert.equal(r.state.drafts.quote, null); assert.equal(r.state.drafts.blocked, false); assert.equal(r.state.note, '未丢失'); assert.equal(r.state.drafts.error.code, 'QUOTE_EXPIRED');
  assert.equal(await r.cashier.convert(), false); assert.equal(r.state.drafts.order, null);
});
test('explicit reload fetches current server revision before replacing conflict input; cancellation removes old quote', async () => {
  const r = setup(); await r.cashier.loadMenu(); await r.cashier.take('d1');
  r.cashier.editField('note', '当前输入'); r.setRemote(draft({ revision: 5, selection: { ...selection(), note: '远端最新' } }));
  assert.equal(await r.cashier.reloadRemote(), true); assert.equal(r.state.note, '远端最新'); assert.equal(r.state.drafts.remote.revision, 5);
  await r.cashier.quote(); assert.ok(r.state.drafts.quote);
  await r.cashier.cancel(); assert.equal(r.state.drafts.quote, null);
});
test('mobile edit advances shared server version so an already-open Web controller receives 409 and retains its own input', async () => {
  let server = draft();
  const request = async (path, options) => {
    if (options) {
      if (options.data.expectedRevision !== server.revision) throw Object.assign(Error('其他设备已修改'), { code: 'DRAFT_CHANGED', status: 409 });
      server = draft({ revision: server.revision + 1, name: options.data.name, selection: options.data.selection });
    }
    return copy(server);
  };
  const mobileSide = setup({ request }); await mobileSide.cashier.take('d1');
  const state = {}, values = new Map();
  const web = createDraftController({ state, request, userId: 'web-employee', storeId: 's1', storage: { get: k => values.get(k), set: (k,v) => values.set(k,copy(v)), remove: k => values.delete(k) } });
  await web.get('d1'); state.edit.selection.note = '电脑未保存的修改';
  mobileSide.cashier.editField('note', '手机修改'); await mobileSide.cashier.save();
  assert.equal(server.revision, 2); assert.equal(server.selection.note, '手机修改');
  assert.equal(await web.update(), false); assert.equal(state.error.status, 409); assert.equal(state.error.code, 'DRAFT_CHANGED');
  assert.equal(state.edit.selection.note, '电脑未保存的修改'); assert.equal(state.remote.revision, 2);
});
test('store-load failure leaves the new cashier scope available without reviving the previous store bag', async () => {
  const r = merchantRuntime(), m = useMerchant(); await m.init(); await m.login('clerk');
  const old = m.cashier.value;
  const request = r.uni.request;
  r.uni.request = options => {
    const url = new URL(options.url);
    if (url.pathname.endsWith('/merchant/products') && url.searchParams.get('storeId') === 's2') return queueMicrotask(() => options.fail({ errMsg: 'offline' }));
    request(options);
  };
  await m.selectStore('s2'); assert.equal(m.storeId.value, 's2');
  assert.ok(m.cashier.value, 'cashier entry remains available for current-store read retry');
  assert.notEqual(m.cashier.value, old); assert.deepEqual(m.cashier.value.state.cart, []); assert.equal(old.navigationLocked(), true);
});
test('existing unknown cash rejection preserves original key/amount across same-identity reload, then explicitly recovers exact request', async () => {
  for (const [code,status] of [['FORBIDDEN',403], ['NOT_FOUND',404], ['VALIDATION_ERROR',400], ['UNAUTHENTICATED',401], ['NETWORK_ERROR',0]]) {
    const r = merchantRuntime(), original = { orderId: 'original-cash', storeId: 's1', key: 'frozen-original-key', tenderedFen: 9900 };
    r.uni.values.set('cash-attempt:v1:u1', copy(original));
    const request = r.uni.request, writes = []; let accepted = false;
    r.uni.request = options => {
      if (!new URL(options.url).pathname.endsWith('/cash-payment')) return request(options);
      writes.push({ data: copy(options.data), key: options.header['Idempotency-Key'] });
      if (accepted) return queueMicrotask(() => options.success({ statusCode: 200, data: { data: { id: original.orderId, storeId: 's1', status: 'AWAITING_ACCEPTANCE', paymentStatus: 'PAID', cashReceipt: { amountFen: 9000, tenderedFen: 9900, changeFen: 900 } } } }));
      if (!status) return queueMicrotask(() => options.fail({ errMsg: 'network' }));
      queueMicrotask(() => options.success({ statusCode: status, data: { error: { code, message: '原收款暂不能确认' }, requestId: 'cash-rejected' } }));
    };
    const m = useMerchant(); await m.init(); await m.login('clerk'); await m.cash(true);
    assert.deepEqual(r.uni.values.get('cash-attempt:v1:u1'), original, `${code}: original attempt must survive refusal`);
    if (m.user.value) { assert.deepEqual(copy(m.pendingCash.value), original); assert.equal(m.cashier.value.editingLocked(), true); }
    const reload = useMerchant(); await reload.init(); if (!reload.user.value) await reload.login('clerk');
    assert.deepEqual(copy(reload.pendingCash.value), original); assert.equal(reload.cashier.value.editingLocked(), true);
    accepted = true; await reload.cash(true);
    assert.deepEqual(writes, [{ data: { tenderedFen: 9900 }, key: 'frozen-original-key' }, { data: { tenderedFen: 9900 }, key: 'frozen-original-key' }]);
    assert.equal(reload.pendingCash.value, null); assert.equal(r.uni.values.has('cash-attempt:v1:u1'), false); assert.equal(reload.order.value.id, original.orderId);
  }
});
test('failed GET after unknown cash state conflict preserves old attempt through reload', async () => {
  const r = merchantRuntime(), original = { orderId: 'original-cash', storeId: 's1', key: 'old-key', tenderedFen: 8888 };
  r.uni.values.set('cash-attempt:v1:u1', copy(original)); const request = r.uni.request;
  r.uni.request = options => {
    const path = new URL(options.url).pathname;
    if (path.endsWith('/cash-payment')) return queueMicrotask(() => options.success({ statusCode: 409, data: { error: { code: 'STATE_CONFLICT', message: '状态变化' } } }));
    if (path.endsWith('/orders/original-cash')) return queueMicrotask(() => options.fail({ errMsg: 'offline' }));
    request(options);
  };
  const m = useMerchant(); await m.init(); await m.login('clerk'); await m.cash(true);
  assert.deepEqual(r.uni.values.get('cash-attempt:v1:u1'), original);
  const reload = useMerchant(); await reload.init(); assert.deepEqual(copy(reload.pendingCash.value), original); assert.equal(reload.cashier.value.editingLocked(), true);
});
