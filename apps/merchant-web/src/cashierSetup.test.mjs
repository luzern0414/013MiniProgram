import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createRenderer, createSSRApp, ssrContextKey } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createRecovery } from './recovery.mjs';

// Load the actual SFC and run its setup/lifecycle with only its template suppressed.
// Vite stays in middleware mode; no listener or existing development service is used.
let server, Cashier;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  Cashier = (await server.ssrLoadModule('/src/Cashier.vue')).default;
});
after(async () => { await server?.close(); });

const renderer = createRenderer({
  createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null,
});
const remote = { id: 'draft-a', name: '原挂单', state: 'DRAFT', storeId: 's1', revision: 1 };
const boundQuote = { id: 'quote-a', totalFen: 1000, cashierDraft: { id: remote.id, revision: 1 } };

const store = { id: 's1', serviceModes: ['PICKUP', 'DINE_IN'], isOpen: true };
const activeShift = {id:'sh1',storeId:'s1',state:'OPEN',revision:0,openingFen:0,openedBy:{id:'u1',name:'店主'},openedAt:'2026-10-21T00:00:00Z',closedBy:null,closedAt:null,summary:{paymentCount:0,refundCount:0,paidFen:0,refundFen:0,netFen:0,expectedFen:0,countedFen:null,differenceFen:null,reason:null}};
function mountCashier(t, restored, { absent = false, respond, pendingShift } = {}) {
  const values = new Map(), calls = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  if (!absent) createRecovery(storage, 'u1', 's1').save(restored);
  if (pendingShift) storage.setItem('cash-shift:v1:u1', JSON.stringify(pendingShift));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push([url, options]);
    // Isolated transport only: never reach the live API.
    if (respond) {
      const data = await respond(url, options);
      if (data !== undefined) return { ok: true, json: async () => ({ data }) };
    }
    return { ok: true, json: async () => ({ data: url.includes('/cash-shifts/current') ? {shift:activeShift} : url.endsWith('/catalog') ? { products: [] } : [] }) };
  });
  const descriptors = new Map();
  for (const [key, value] of Object.entries({ sessionStorage: storage, window: { addEventListener() {}, removeEventListener() {} } })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    descriptors.set(key, descriptor);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const app = renderer.createApp({ ...Cashier, render: () => null }, { store, userId: 'u1' });
  app.provide(ssrContextKey, { modules: new Set() });
  t.after(async () => {
    if (app._instance) app.unmount();
    await new Promise(resolve => setImmediate(resolve));
    for (const [key, descriptor] of descriptors) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
    if (!respond) assert.ok(calls.every(([, options]) => options.method === 'GET'));
  });
  const instance = app.mount({});
  assert.ok(calls.every(([, options]) => options.method === 'GET'));
  return instance.$.setupState;
}

// Render the actual SFC template with its live setup state. Setup has already run
// in the lifecycle harness above; rendering must not create another controller.
const renderCashier = state => renderToString(createSSRApp({ ...Cashier, setup: () => state }, { store, userId: 'u1' }));
const settle = () => new Promise(resolve => setImmediate(resolve));

test('first definitive missing shift preserves original cash order/tender and permits owner navigation', async t => {
  const original={id:'o-shift',storeId:'s1',totalFen:1000,status:'PENDING_PAYMENT',paymentStatus:'UNPAID'};
  const state=mountCashier(t,{order:original,tendered:'20.00',submittedFen:2000,orderKey:'original-key',uncertain:false},{respond:async(url,options)=>{
    if(url.includes('/cash-shifts/current'))return {shift:activeShift};
    if(url.endsWith('/cash-payment'))return {error:'placeholder'};
    if(url.endsWith('/orders/o-shift'))return original;
  }});
  await settle();
  // The actual transport raises a definitive API refusal on the first payment.
  const fetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,options)=>url.endsWith('/cash-payment') ? {ok:false,status:409,json:async()=>({error:{code:'SHIFT_REQUIRED'},requestId:'shift-r'})} : fetch(url,options));
  state.checkout();await settle();await settle();
  assert.equal(state.uncertain,false);assert.equal(state.order.id,original.id);assert.equal(state.tendered,'20.00');assert.equal(state.submittedFen,2000);
  assert.equal(state.mutation.error.code,'SHIFT_REQUIRED');
});
test('prior unknown cash missing-shift replay plus unpaid GET cannot erase financial lock',async t=>{
  const original={id:'o-unknown',storeId:'s1',totalFen:1000,status:'PENDING_PAYMENT',paymentStatus:'UNPAID'};
  const state=mountCashier(t,{order:original,tendered:'20.00',submittedFen:2000,orderKey:'original-key',uncertain:true},{respond:async(url)=>url.endsWith('/orders/o-unknown')?original:undefined});
  await settle();assert.equal(state.uncertain,true,'unpaid GET is not a receipt fact');
  const fetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,options)=>url.endsWith('/cash-payment') ? {ok:false,status:409,json:async()=>({error:{code:'SHIFT_REQUIRED'},requestId:'shift-r'})} : fetch(url,options));
  state.checkout();await settle();await settle();assert.equal(state.uncertain,true);assert.equal(state.submittedFen,2000);assert.equal(state.orderKey,'original-key');
});

test('recovering original order creation with a pending shift never starts a new cash payment',async t=>{
  const calls=[],original={id:'original-created',storeId:'s1',totalFen:1000,status:'PENDING_PAYMENT',paymentStatus:'UNPAID'};
  const state=mountCashier(t,{quote:{id:'original-quote',totalFen:1000},tendered:'20.00',submittedFen:2000,orderKey:'original-create-key',uncertain:true},{pendingShift:{version:1,userId:'u1',storeId:'s1',kind:'open',key:'original-shift-key',data:{storeId:'s1',openingFen:0}},respond:(url,options)=>{calls.push([url,options]);if(url.endsWith('/orders'))return original;}});
  await settle();assert.equal(calls.filter(c=>c[1].method==='POST').length,0);state.checkout();await settle();await settle();
  const posts=calls.filter(c=>c[1].method==='POST');assert.equal(posts.length,1);assert.ok(posts[0][0].endsWith('/orders'));assert.equal(posts[0][1].headers['Idempotency-Key'],'original-create-key');assert.equal(state.order.id,original.id);assert.equal(state.uncertain,false);assert.equal(state.tendered,'20.00');assert.equal(state.mutation.error.code,'SHIFT_RECOVERY');
});

const oldCart = [{ skuId: 'sku-a', quantity: 1, modifierIds: ['m1'], attributeOptionIds: ['a1'], productName: '本地旧商品', skuName: '本地旧规格', modifierNames: ['本地旧加料'], attributes: [{ groupName: '本地旧口味', options: [{ name: '本地旧属性' }] }], unitPriceFen: 3080, available: 10 }];
const selection = { mode: 'PICKUP', note: '本地旧备注', lines: [{ skuId: 'sku-a', quantity: 1, modifierIds: ['m1'], attributeOptionIds: ['a1'] }] };
const draft = { ...remote, orderId: null, selection, display: { lines: [] }, createdAt: '2026-10-21T12:00:00Z', updatedAt: '2026-10-21T12:00:00Z' };
const actualOrder = { id: 'order-real', number: 'R20261021', storeId: 's1', mode: 'DINE_IN', tableName: '01桌', note: '真实订单备注', totalFen: 6160, status: 'UNPAID', paymentStatus: 'UNPAID', cashReceipt: null, lines: [{ skuId: 'sku-a', productName: '下单时商品', skuName: '下单时规格', quantity: 2, lineTotalFen: 6160, modifiers: [{ id: 'm1', name: '下单时加料', priceFen: 80 }], attributes: [{ groupId: 'g1', groupName: '下单时口味', options: [{ id: 'a1', name: '下单时属性' }] }] }] };
const oldQuote = { id: 'quote-old', totalFen: 3080, subtotalFen: 3080, expiresAt: '2099-01-01T00:00:00Z', cashierDraft: { id: draft.id, revision: 1 } };
const oldCheckout = { draftRemote: draft, cart: oldCart, mode: 'PICKUP', note: selection.note, quote: oldQuote, tendered: '30.80', orderKey: 'original-convert-key', uncertain: true };
const converted = { ...draft, state: 'CONVERTED', orderId: actualOrder.id, revision: 2 };

async function assertOrderDisplay(state) {
  const html = await renderCashier(state);
  assert.match(html, /订单明细/);
  assert.match(html, /2 件/);
  for (const text of ['下单时商品', '下单时规格', '下单时加料', '下单时口味', '下单时属性', '堂食', '01桌', '真实订单备注', '¥61.60']) assert.ok(html.includes(text), text);
  for (const text of ['本地旧商品', '本地旧规格', '本地旧加料', '本地旧属性', '本地旧备注', '¥30.80', '原桌台已失效', '请刷新菜单后核对搭配', '商品或规格已失效', 'aria-label="增加数量"', 'aria-label="减少数量"', '重新选择搭配']) assert.ok(!html.includes(text), text);
  assert.deepEqual(state.cart.map(({ key, ...line }) => line), oldCart, 'keep original local bag as recovery evidence');
  return html;
}

test('actual cashier template renders the editable bag before an order exists', async t => {
  const state = mountCashier(t, { ...oldCheckout, draftRemote: undefined });
  const html = await renderCashier(state);
  assert.match(html, /本地旧商品/);
  assert.match(html, /1 件/);
  assert.match(html, /¥30.80/);
});

async function takePriceDraft(t, { invalid = 'disabled', mixed = false, priceFen = 3000 } = {}) {
  const original = { skuId: 'sku-original', quantity: 2, modifierIds: [], attributeOptionIds: ['taste-original'] };
  const products = [{
    id: 'product-original', name: '当前菜单商品', isAvailable: true,
    skus: [{ id: original.skuId, name: '当前规格', priceFen, available: 10 }],
    attributeGroups: [{ id: 'taste', name: '辣度', minSelections: 1, maxSelections: 1,
      options: invalid === 'missing' ? [] : [{ id: 'taste-original', name: '少辣', enabled: !invalid }] }],
  }];
  const lines = [original];
  const display = [{ skuId: original.skuId, productName: '原挂单商品', skuName: '原挂单规格', modifierNames: [], attributeNames: ['少辣'] }];
  if (mixed) {
    products.push({ id: 'product-valid', name: '有效商品', isAvailable: true, skus: [{ id: 'sku-valid', name: '标准份', priceFen: 1200, available: 10 }] });
    lines.push({ skuId: 'sku-valid', quantity: 2, modifierIds: [], attributeOptionIds: [] });
    display.push({ skuId: 'sku-valid', productName: '有效商品', skuName: '标准份', modifierNames: [], attributeNames: [] });
  }
  const remoteDraft = { ...draft, selection: { mode: 'PICKUP', note: '', lines }, display: { lines: display } };
  const state = mountCashier(t, { draftRemote: remoteDraft }, { respond: async (url, options) => {
    assert.equal(options.method, 'GET', 'price presentation fixtures must never write');
    if (url.endsWith('/catalog')) return { products };
    if (url.includes('/cashier-drafts/draft-a?')) return remoteDraft;
  } });
  await settle();
  state.takeDraft();
  await settle();
  return { state, original, products };
}

for (const invalid of ['disabled', 'missing']) for (const mixed of [false, true]) {
  test(`actual cashier marks ${invalid} draft prices unresolved${mixed ? ' with another valid line' : ''}`, async t => {
    const { state, original } = await takePriceDraft(t, { invalid, mixed });
    const html = await renderCashier(state);
    const bag = html.match(/<div class="cart-lines">[\s\S]*?(?=<label)/)?.[0];
    assert.ok(bag);
    for (const text of ['原挂单商品', '原挂单规格', '少辣', '所选口味已失效，请重新选择']) assert.ok(bag.includes(text), text);
    assert.deepEqual(state.cart[0].attributeOptionIds, original.attributeOptionIds);
    assert.equal(state.cart[0].skuId, original.skuId);
    assert.equal(state.cart[0].quantity, 2);
    assert.equal(state.cart[0].unitPriceFen, 0, 'retain the internal unresolved fallback');
    assert.ok(state.invalidCart);
    assert.match(html, /<button[^>]*disabled[^>]*>保存并核价<\/button>/);
    assert.match(html, /<div class="payment-total"><span>商品合计（预估）<\/span><strong>待重新核价<\/strong>/);
    assert.match(bag, /<strong>待重新核价<\/strong>/);
    assert.ok(!bag.includes('¥0.00'), 'the unresolved line must not look free');
    if (mixed) assert.match(bag, /¥24\.00/);
  });
}

test('actual cashier keeps an unresolved hydrated price pending after menu availability returns', async t => {
  const { state, products } = await takePriceDraft(t);
  products[0].attributeGroups[0].options[0].enabled = true;
  state.refreshMenu();
  await settle();
  assert.equal(state.invalidCart, false, 'the refreshed menu accepts the original selection');
  assert.ok(state.cart[0].issue, 'the bag has not been hydrated or reselected again');
  assert.equal(state.cart[0].unitPriceFen, 0);
  const html = await renderCashier(state);
  assert.match(html, /<div class="cart-lines">[\s\S]*?<strong>待重新核价<\/strong>/);
  assert.match(html, /<div class="payment-total"><span>商品合计（预估）<\/span><strong>待重新核价<\/strong>/);
  state.takeDraft();
  await settle();
  const refreshed = await renderCashier(state);
  assert.equal(state.cart[0].issue, '');
  assert.match(refreshed, /<div class="payment-total"><span>商品合计（预估）<\/span><strong>¥60\.00<\/strong>/);
  assert.ok(!refreshed.includes('待重新核价'));
});

test('actual cashier keeps a valid zero-price draft line and estimate visible', async t => {
  const { state } = await takePriceDraft(t, { invalid: false, priceFen: 0 });
  const html = await renderCashier(state);
  assert.equal(state.invalidCart, false);
  assert.match(html, /<div class="cart-lines">[\s\S]*?<strong>¥0\.00<\/strong>/);
  assert.match(html, /<div class="payment-total"><span>商品合计（预估）<\/span><strong>¥0\.00<\/strong>/);
  assert.ok(!html.includes('待重新核价'));
});

for (const totalFen of [0, 4321]) test(`actual cashier keeps server quote total ${totalFen} despite an invalid local line`, async t => {
  const { state } = await takePriceDraft(t);
  state.quote = { ...oldQuote, totalFen, subtotalFen: totalFen };
  const html = await renderCashier(state);
  const amount = totalFen === 0 ? '¥0.00' : '¥43.21';
  assert.ok(state.invalidCart);
  assert.ok(html.includes(`<div class="payment-total"><span>应收金额</span><strong>${amount}</strong>`));
  assert.ok(html.includes(`<span>商品金额</span><span>${amount}</span>`));
});

test('actual cashier recovers real order snapshots and clears the previous NETWORK only after binding', async t => {
  const calls = [];
  let resolveOrder;
  const orderRead = new Promise(resolve => { resolveOrder = resolve; });
  const state = mountCashier(t, oldCheckout, { respond: async (url, options) => {
    calls.push([url, options]);
    if (url.endsWith('/orders')) throw new Error('lost create response');
    if (url.includes('/cashier-drafts/draft-a?')) return converted;
    if (url.endsWith('/orders/order-real')) return orderRead;
  } });
  state.syncDraft();
  state.checkout();
  await settle();
  assert.equal(state.mutation.error.code, 'NETWORK');
  assert.equal(state.drafts.pending.kind, 'convert');
  assert.equal(state.submittedFen, 3080);
  const recovery = state.recoverDraft();
  await settle();
  assert.equal(state.order, undefined);
  assert.equal(state.mutation.error.code, 'NETWORK');
  assert.equal(state.submittedFen, 3080);
  resolveOrder(actualOrder);
  await recovery;
  assert.equal(state.mutation.error, undefined);
  assert.deepEqual(state.order, actualOrder);
  assert.equal(state.submittedFen, undefined);
  assert.equal(state.quote, undefined);
  assert.equal(state.tendered, '61.60');
  assert.equal(state.orderKey, 'original-convert-key');
  assert.equal(state.drafts.pending, null);
  const html = await assertOrderDisplay(state);
  const tenderInput = html.match(/<input\b[^>]*type="number"[^>]*>/)?.[0];
  assert.ok(tenderInput?.includes('value="61.60"'));
  assert.ok(!tenderInput.includes('disabled'));
  assert.equal(calls.filter(([, o]) => o.method !== 'GET').length, 1);
  assert.ok(!calls.some(([url]) => url.includes('cash-payment')));
});

for (const outcome of ['offline', 'still-draft']) test(`actual cashier keeps error and locks when recovery is ${outcome}`, async t => {
  const calls = [];
  const state = mountCashier(t, oldCheckout, { respond: async (url, options) => {
    calls.push([url, options]);
    if (url.endsWith('/orders') || url.endsWith('/orders/order-real')) throw new Error('offline');
    if (url.includes('/cashier-drafts/draft-a?')) return outcome === 'still-draft' ? draft : converted;
  } });
  state.syncDraft();
  state.checkout();
  await settle();
  const originalError = state.mutation.error;
  await state.recoverDraft();
  assert.equal(state.mutation.error, originalError);
  assert.equal(state.mutation.error.code, 'NETWORK');
  assert.equal(state.order, undefined);
  assert.equal(state.submittedFen, 3080);
  assert.equal(state.orderKey, 'original-convert-key');
  assert.equal(state.drafts.pending.kind, 'convert');
  assert.equal(state.drafts.blocked, true);
  assert.equal(state.uncertain, true);
  assert.ok(!calls.some(([url]) => url.includes('cash-payment')));
});

test('actual cashier refresh renders real order facts and preserves unknown cash amount and key', async t => {
  const calls = [];
  const state = mountCashier(t, { ...oldCheckout, order: actualOrder, submittedFen: 7000, tendered: '70.00' }, { respond: async (url, options) => {
    calls.push([url, options]);
    if (url.endsWith('/orders/order-real')) return actualOrder;
  } });
  await settle();
  const html = await assertOrderDisplay(state);
  const tenderInput = html.match(/<input\b[^>]*type="number"[^>]*>/)?.[0];
  assert.ok(tenderInput?.includes('value="70.00"'));
  assert.ok(tenderInput.includes('disabled'));
  state.drafts.remote = converted;
  state.drafts.order = actualOrder;
  await state.recoverDraft();
  assert.equal(state.submittedFen, 7000);
  assert.equal(state.tendered, '70.00');
  assert.equal(state.orderKey, 'original-convert-key');
  assert.deepEqual(state.quote, oldQuote);
  assert.ok(calls.every(([, options]) => options.method === 'GET'));
});

for (const [name, value, options] of [
  ['absent checkout', undefined, { absent: true }],
  ['null checkout', null],
  ['undefined checkout', undefined],
]) test(`actual cashier setup opens an empty bag for ${name}`, t => {
  const state = mountCashier(t, value, options);
  assert.deepEqual(state.cart, []);
  assert.equal(state.drafts.remote, null);
  assert.equal(state.drafts.quote, null);
  assert.equal(state.quote, undefined);
  assert.equal(state.locked, false);
});

for (const [name, restored] of [
  ['missing remote and quote', {}],
  ['bound quote without remote', { quote: boundQuote }],
  ['remote without quote', { draftRemote: remote }],
  ['ordinary quote without draft binding', { quote: { id: 'ordinary-quote' } }],
  ['different draft binding', { draftRemote: remote, quote: { ...boundQuote, cashierDraft: { id: 'draft-b', revision: 1 } } }],
]) test(`actual cashier setup does not borrow a draft quote for ${name}`, t => {
  const state = mountCashier(t, restored);
  assert.equal(state.drafts.quote, null);
});

test('actual cashier setup restores a quote only for the same bound draft', t => {
  const state = mountCashier(t, { draftRemote: remote, draftName: '未保存名称', quote: boundQuote });
  assert.deepEqual(state.drafts.remote, remote);
  assert.equal(state.drafts.edit.name, '未保存名称');
  assert.deepEqual(state.drafts.quote, boundQuote);
});

test('actual cashier setup preserves legacy unknown cash amount, key and order', t => {
  const order = { id: 'order-a', storeId: 's1', totalFen: 1000 };
  const quote = { id: 'legacy-quote', totalFen: 1000 };
  const state = mountCashier(t, { order, quote, submittedFen: 5000, tendered: '50.00', orderKey: 'original-key', uncertain: true });
  assert.deepEqual(state.order, order);
  assert.deepEqual(state.quote, quote);
  assert.equal(state.submittedFen, 5000);
  assert.equal(state.tendered, '50.00');
  assert.equal(state.orderKey, 'original-key');
  assert.equal(state.uncertain, true);
  assert.equal(state.drafts.quote, null);
  assert.equal(state.locked, true);
});
