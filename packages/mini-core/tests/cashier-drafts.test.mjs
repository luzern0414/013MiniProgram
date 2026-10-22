import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.mjs';

const original = { skuId: 'sku-a', quantity: 2, modifierIds: ['egg'], attributeOptionIds: ['hot'] };
const selection = () => ({ mode: 'PICKUP', pickupSlotId: 'slot-a', note: '少盐', lines: [structuredClone(original)] });
const draft = (overrides = {}) => ({ id: 'd1', storeId: 's1', name: '小张', revision: 1, state: 'DRAFT', selection: selection(), display: { lines: [{ skuId: 'sku-a', productName: '面', skuName: '大碗', modifierNames: ['蛋'], attributeNames: ['热'] }] }, orderId: null, createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T01:00:00Z', ...overrides });
const catalog = () => ({ products: [{ id: 'p1', name: '面', isAvailable: true, skus: [{ id: 'sku-a', name: '大碗', priceFen: 1000, available: 30 }], modifiers: [{ id: 'egg', name: '蛋', priceFen: 200, available: 30 }], attributeGroups: [{ id: 'temp', name: '温度', minSelections: 1, maxSelections: 1, options: [{ id: 'hot', name: '热' }] }] }] });
const memory = () => { const values = new Map(); return { values, get: k => values.get(k), set: (k, v) => values.set(k, structuredClone(v)), remove: k => values.delete(k) }; };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const network = () => Object.assign(Error('离线'), { code: 'NETWORK', requestId: 'req-1' });
function setup(request, options = {}) {
  assert.equal(typeof core.createDraftController, 'function', 'shared draft controller is exported');
  const state = {}, storage = options.storage || memory();
  const ctl = core.createDraftController({ state, storage, request, userId: options.userId || 'u1', storeId: options.storeId || 's1' });
  state.edit = { name: '当前未覆盖草稿名', selection: selection() };
  return { state, storage, ctl };
}

test('hydration preserves all original IDs and server display when a required option disappears', () => {
  assert.equal(typeof core.hydrateDraft, 'function');
  const menu = catalog(); menu.products[0].attributeGroups[0].options = [];
  const value = core.hydrateDraft(draft(), menu);
  assert.deepEqual(value.cart[0].attributeOptionIds, ['hot']);
  assert.deepEqual(value.cart[0].modifierIds, ['egg']);
  assert.equal(value.cart[0].quantity, 2);
  assert.ok(value.cart[0].issue);
  assert.deepEqual(value.cart[0].display, draft().display.lines[0]);
  assert.equal(value.pickupSlotId, 'slot-a');
});
test('draftSelection sends only original selections and retains service context', () => {
  assert.equal(typeof core.draftSelection, 'function');
  assert.deepEqual(core.draftSelection([{ ...original, unitPriceFen: 999 }], { mode: 'DINE_IN', tableCode: 'T1', note: '备注', pickupSlotId: 'ignore' }), { mode: 'DINE_IN', tableCode: 'T1', note: '备注', lines: [original] });
});
test('successful create persists original request before send and GET verifies version and time', async () => {
  const storage = memory(), calls = [];
  const { ctl, state } = setup(async (path, o) => { calls.push([path, o]); if (o) { assert.equal(storage.get(core.draftStorageKey('u1')).method, 'POST'); return draft(); } return draft(); }, { storage });
  assert.equal(await ctl.create(), true);
  assert.equal(calls.length, 2); assert.ok(calls[0][1].headers['Idempotency-Key']);
  assert.equal(state.remote.revision, 1); assert.equal(state.blocked, false);
  assert.equal(storage.get(core.draftStorageKey('u1')), undefined);
});
test('create unknown only explicit replay uses exactly same payload and key, then clears stale NETWORK', async () => {
  const calls = []; let offline = true;
  const { ctl, state } = setup(async (path, o) => { calls.push([path, o]); if (offline) throw network(); return draft(); });
  await ctl.create(); const first = structuredClone(calls[0]);
  assert.equal(state.blocked, true); assert.equal(state.error.requestId, 'req-1');
  offline = false; assert.equal(await ctl.recover('replay'), true);
  assert.deepEqual(calls[1], first); assert.equal(state.error, null); assert.equal(state.blocked, false);
});
test('CAS conflict GET keeps current input and exposes current server revision', async () => {
  const { ctl, state } = setup(async (path, o) => { if (o) throw Object.assign(Error('冲突'), { code: 'DRAFT_CHANGED', status: 409 }); return draft({ revision: 2 }); });
  state.remote = draft(); await ctl.update();
  assert.equal(state.error.code, 'DRAFT_CHANGED');
  assert.equal(state.edit.name, '当前未覆盖草稿名');
  assert.equal(state.remote.revision, 2); assert.equal(state.blocked, false); assert.equal(state.review, true);
});
test('unknown update recovery reads only, retains input until explicit keep/reload decision', async () => {
  const calls = []; let offline = true;
  const { ctl, state } = setup(async (path, o) => { calls.push([path, o]); if (offline) throw network(); return draft({ revision: 2 }); });
  state.remote = draft(); await ctl.update(); offline = false; await ctl.recover();
  assert.equal(calls.filter(c => c[1]).length, 1); assert.equal(state.blocked, true);
  assert.equal(state.edit.name, '当前未覆盖草稿名');
  await ctl.recover('keep'); assert.equal(state.blocked, false); assert.equal(state.remote.revision, 2);
});
test('storage failure or readback mismatch never sends write', async () => {
  for (const storage of [{ get: () => undefined, set() { throw Error(); }, remove() {} }, { get: () => undefined, set() {}, remove() {} }]) {
    let writes = 0; const { ctl, state } = setup(async () => { writes++; }, { storage });
    await ctl.create(); assert.equal(writes, 0); assert.equal(state.error.code, 'DRAFT_STORAGE');
  }
});
test('empty, corrupt, unsupported and foreign identity records fail closed', () => {
  assert.equal(typeof core.readDraftAttempt, 'function');
  for (const raw of [null, '', '{', { version: 8 }, { version: 1, userId: 'other' }]) {
    const storage = memory(); storage.set(core.draftStorageKey('u1'), raw);
    const result = core.readDraftAttempt(storage, 'u1'); assert.ok(result.error);
    const { state } = setup(async () => {}, { storage }); assert.equal(state.blocked, true); assert.equal(state.corrupt, true);
  }
});
test('identity and original store scope block wrong store replay and discover original store', async () => {
  const storage = memory(); const first = setup(async () => { throw network(); }, { storage }); await first.ctl.create();
  let writes = 0; const other = setup(async () => { writes++; }, { storage, storeId: 's2' });
  assert.equal(other.state.pending.storeId, 's1'); await other.ctl.recover('replay'); assert.equal(writes, 0);
  const account = setup(async () => {}, { storage, userId: 'u2' }); assert.equal(account.state.blocked, false);
});
test('slow create rejects concurrent writes and dispose prevents late state and storage mutation', async () => {
  const wait = deferred(); let count = 0;
  const { ctl, state, storage } = setup(async () => { count++; return wait.promise; });
  const first = ctl.create(); assert.equal(state.busy, true); assert.equal(state.blocked, true);
  await ctl.create(); assert.equal(count, 1);
  const pending = structuredClone(storage.get(core.draftStorageKey('u1'))); ctl.dispose(); wait.resolve(draft()); await first;
  assert.equal(state.remote, null); assert.deepEqual(storage.get(core.draftStorageKey('u1')), pending);
});
test('context changes ignore late GET and response from a previously selected draft', async () => {
  const wait = deferred(); let storeId = 's1';
  const { ctl, state } = setup(async () => wait.promise, { storeId: () => storeId });
  const load = ctl.get('d1'); storeId = 's2'; wait.resolve(draft()); await load; assert.equal(state.remote, null);
});

test('cancelled selection GET never publishes remote, edit, quote or converted order', async () => {
  const wait = deferred(); let accepted = true;
  const { ctl, state } = setup(async () => wait.promise);
  state.remote = draft(); state.quote = { id: 'old-quote' };
  const before = structuredClone({ remote: state.remote, edit: state.edit, quote: state.quote, order: state.order });
  const loading = ctl.get('d2', { accept: () => accepted }); accepted = false;
  wait.resolve(draft({ id: 'd2' }));
  assert.equal(await loading, false);
  assert.deepEqual({ remote: state.remote, edit: state.edit, quote: state.quote, order: state.order }, before);
  assert.equal(state.busy, false);
});
test('GET failure or 401/403 after unknown write keeps durable recovery lock', async () => {
  for (const status of [401, 403, 500]) {
    const { ctl, state } = setup(async () => { throw Object.assign(network(), { status }); });
    state.remote = draft(); await ctl.update(); await ctl.recover(); assert.equal(state.blocked, true); assert.ok(state.pending);
  }
});
test('quote with local edits saves CAS before quoting latest revision', async () => {
  const calls = []; const { ctl, state } = setup(async (path, o) => { calls.push([path, o]); if (path.endsWith('/quote')) return { id: 'q1', cashierDraft: { id: 'd1', revision: 2 } }; return draft({ revision: 2, name: '当前未覆盖草稿名' }); });
  state.remote = draft(); assert.equal(await ctl.quote(), true);
  assert.equal(calls[0][1].method, 'PUT'); assert.ok(calls.at(-1)[0].endsWith('/quote'));
  assert.equal(calls.at(-1)[1].data.expectedRevision, 2);
});
test('unknown conversion retains original quoteId/key and only reconciles real draft and order', async () => {
  const calls = []; let unknown = true;
  const { ctl, state } = setup(async (path, o) => { calls.push([path, o]); if (o) throw network(); if (unknown) return draft(); if (path.startsWith('/orders/')) return { id: 'o1', storeId: 's1', paymentStatus: 'UNPAID' }; return draft({ state: 'CONVERTED', orderId: 'o1' }); });
  state.remote = draft(); state.quote = { id: 'original-quote', cashierDraft: { id: 'd1', revision: 1 } };
  await ctl.convert({ quoteId: 'original-quote', orderKey: 'original-order-key' });
  assert.equal(state.pending.quoteId, 'original-quote'); assert.equal(state.pending.key, 'original-order-key');
  await ctl.recover(); assert.equal(state.blocked, true);
  unknown = false; await ctl.recover(); assert.equal(state.order.id, 'o1'); assert.equal(state.blocked, false);
  assert.equal(calls.filter(c => c[1]).length, 1); assert.ok(!calls.some(c => c[0].includes('cash-payment')));
});
test('converted draft cannot be updated or cancelled or converted again', async () => {
  let writes = 0; const { ctl, state } = setup(async () => { writes++; }); state.remote = draft({ state: 'CONVERTED', orderId: 'o1' });
  await ctl.update(); await ctl.cancel(); await ctl.convert({ quoteId: 'q', orderKey: 'k' }); assert.equal(writes, 0);
});
test('list load uses server pagination and clears old errors on success', async () => {
  let url; const { ctl, state } = setup(async path => { url = path; return { items: [draft()], total: 71, page: 2, pageSize: 20 }; });
  state.error = network(); await ctl.load({ page: 2, state: 'CONVERTED' });
  assert.match(url, /page=2/); assert.match(url, /state=CONVERTED/); assert.equal(state.total, 71); assert.equal(state.error, null);
});
test('save then quote refuses a remotely changed selection rather than hiding unsaved input', async () => {
  let quotes = 0;
  const { ctl, state } = setup(async (path, o) => {
    if (path.endsWith('/quote')) { quotes++; return { id: 'q1', cashierDraft: { id: 'd1', revision: 3 } }; }
    return o ? draft({ revision: 2, name: '当前未覆盖草稿名' }) : draft({ revision: 3, name: '另一位修改' });
  });
  state.remote = draft(); assert.equal(await ctl.quote(), false); assert.equal(quotes, 0);
  assert.equal(state.edit.name, '当前未覆盖草稿名'); assert.equal(state.error.code, 'DRAFT_CHANGED');
});
test('a previously selected draft cannot receive late write results after selection context changes', async () => {
  const wait = deferred(); const { ctl, state } = setup(async () => wait.promise);
  state.remote = draft(); const work = ctl.update(); state.remote = draft({ id: 'd2' });
  wait.resolve(draft({ revision: 2 })); await work; assert.equal(state.remote.id, 'd2'); assert.ok(state.pending);
});
test('switching from one loaded draft to another releases read busy and keeps new context', async () => {
  const { ctl, state } = setup(async () => draft({ id: 'd2' })); state.remote = draft();
  assert.equal(await ctl.get('d2'), true); assert.equal(state.remote.id, 'd2'); assert.equal(state.busy, false);
});
test('quote compares normalized selections independently of JSON database key ordering', async () => {
  let writes = 0; const { ctl, state } = setup(async (path, o) => { writes++; assert.ok(path.endsWith('/quote')); return { id:'q1', cashierDraft:{ id:'d1', revision:1 } }; });
  state.remote = draft();
  state.edit = { name: ' 小张 ', selection: { lines: [{ attributeOptionIds:['hot'], modifierIds:['egg'], quantity:2, skuId:'sku-a' }], note:'少盐', pickupSlotId:'slot-a', mode:'PICKUP' } };
  assert.equal(await ctl.quote(), true); assert.equal(writes, 1);
});
test('recovery rejects injected edit fields rather than replaying extra API data', async () => {
  const storage = memory(); const first = setup(async () => { throw network(); }, { storage }); await first.ctl.create();
  const raw = storage.get(core.draftStorageKey('u1')); raw.edit.priceFen = 1; raw.data.priceFen = 1;
  assert.ok(core.readDraftAttempt(storage, 'u1').error);
});
test('selecting a different draft removes the previous draft order fact', async () => {
  const { ctl, state } = setup(async () => draft({id:'d2'}));
  state.remote = draft({state:'CONVERTED',orderId:'o1'}); state.order = {id:'o1',storeId:'s1'};
  await ctl.get('d2'); assert.equal(state.order, null);
});
test('dirty state recognizes unsaved bag and name changes without treating key order as changes', () => {
  const { ctl, state } = setup(async () => {}); state.remote = draft();
  assert.equal(typeof ctl.isDirty, 'function'); assert.equal(ctl.isDirty(), true);
  state.edit = { name:'小张', selection:selection() }; assert.equal(ctl.isDirty(), false);
  state.edit.selection.note = '未保存'; assert.equal(ctl.isDirty(), true);
});
