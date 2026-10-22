import test from 'node:test';
import assert from 'node:assert/strict';

if (process.env.NODE_ENV !== 'test' || !process.env.API_TEST_URL) {
  throw new Error('Run pnpm test:integration to use a disposable test schema.');
}
const base = process.env.API_TEST_URL;
const runId = Date.now().toString(36);
const sessions = {};
let storeA;
let storeB;
let category;
let customer;
let owner;
let clerkA;
let productIndex = 0;
let paidOrder;

async function request(path, { method = 'GET', body, token, key } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  return { status: response.status, data: result.data, error: result.error, requestId: result.requestId };
}
async function ok(path, options) {
  const result = await request(path, options);
  assert.ok(result.status < 400, JSON.stringify({ path, ...result }));
  assert.ok(result.requestId, 'requestId must be present');
  return result.data;
}
async function product(stock = 30, priceFen = 1700) {
  const created = await ok('/merchant/products', { method: 'POST', token: owner, body: { storeId: storeA.id, categoryId: category.id, name: '验收菜品-' + runId + '-' + (++productIndex), description: '隔离测试数据', unit: '份', skus: [{ name: '标准份', priceFen, stock }] } });
  // Read after write ensures this assertion uses persisted state.
  const catalog = await ok('/stores/' + storeA.id + '/catalog');
  const item = catalog.products.find(p => p.id === created.id || p.name === created.name);
  assert.ok(item, 'new product must be persisted and visible');
  return item;
}
async function quote(item, quantity = 1) {
  return ok('/quotes', { method: 'POST', token: customer, body: { storeId: storeA.id, mode: 'PICKUP', lines: [{ skuId: item.skus[0].id, quantity, modifierIds: [] }] } });
}
async function order(q, key) {
  return ok('/orders', { method: 'POST', token: customer, key, body: { quoteId: q.id } });
}

test('R1 real API/database acceptance', async t => {
  await t.test('health actually checks database; identities and stores are persisted', async () => {
    const health = await ok('/health');
    assert.equal(health.database, 'connected');
    const publicConfig = await ok('/public-config');
    assert.equal(publicConfig.brandId, 'experience-brand', 'staff sign-in needs the actual configured public brand');
    const preflight = await fetch(base + '/public-config', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5174', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-request-id' } });
    assert.match(preflight.headers.get('access-control-allow-headers') || '', /x-request-id/i, 'mini H5 transport request ID header must pass CORS');
    for (const account of ['customer', 'owner', 'clerk-a', 'clerk-b']) {
      sessions[account] = await ok('/auth/dev-login', { method: 'POST', body: { account } });
      assert.ok(sessions[account].token);
      assert.equal(sessions[account].environment, 'development');
    }
    customer = sessions.customer.token;
    owner = sessions.owner.token;
    clerkA = sessions['clerk-a'].token;
    const stores = await ok('/stores');
    assert.ok(stores.length >= 2);
    storeA = stores.find(s => sessions['clerk-a'].user.storeIds.includes(s.id));
    storeB = stores.find(s => sessions['clerk-b'].user.storeIds.includes(s.id));
    assert.ok(storeA && storeB && storeA.id !== storeB.id);
    category = (await ok('/stores/' + storeA.id + '/catalog')).categories[0];
    assert.ok(category);
  });

  await t.test('anonymous and cross-store access are rejected by API', async () => {
    assert.equal((await request('/merchant/overview?storeId=' + storeA.id)).status, 401);
    assert.equal((await request('/merchant/overview?storeId=' + storeB.id, { token: clerkA })).status, 403);
    assert.equal((await request('/merchant/products', { method: 'POST', token: clerkA, body: { storeId: storeA.id, name: '禁止创建' } })).status, 403);
    const spoof = await request('/auth/dev-login', { method: 'POST', body: { account: 'arbitrary', role: 'OWNER' } });
    assert.ok(spoof.status >= 400, 'arbitrary dev identity must not be accepted');
  });

  await t.test('invalid quantities and unsupported coupons are not silently accepted', async () => {
    const item = await product();
    for (const quantity of [0, -1, 1.5, 100]) {
      const response = await request('/quotes', { method: 'POST', token: customer, body: { storeId: storeA.id, mode: 'PICKUP', lines: [{ skuId: item.skus[0].id, quantity, modifierIds: [] }] } });
      assert.ok(response.status >= 400 && response.status < 500, 'invalid quantity must be business validation');
    }
    const coupon = await request('/quotes', { method: 'POST', token: customer, body: { storeId: storeA.id, mode: 'PICKUP', couponId: 'nonexistent', lines: [{ skuId: item.skus[0].id, quantity: 1, modifierIds: [] }] } });
    assert.ok(coupon.status >= 400 && coupon.status < 500);
  });

  await t.test('duplicate order submission creates one persisted order; changed payload conflicts', async () => {
    const item = await product();
    const q = await quote(item, 2);
    assert.equal(q.totalFen, 3400);
    const key = 'acceptance-' + runId + '-idem';
    const first = await order(q, key);
    const second = await order(q, key);
    assert.equal(first.id, second.id);
    const changed = await quote(item);
    assert.equal((await request('/orders', { method: 'POST', token: customer, key, body: { quoteId: changed.id } })).status, 409);
    const persisted = await ok('/orders/' + first.id, { token: customer });
    assert.equal(persisted.totalFen, 3400);
    assert.equal(persisted.lines[0].quantity, 2);
    paidOrder = persisted;
  });

  await t.test('price editing cannot silently reuse old quote or change existing snapshots', async () => {
    const item = await product();
    const oldQuote = await quote(item);
    const submitted = await order(oldQuote, 'acceptance-' + runId + '-snapshot');
    await ok('/merchant/skus/' + item.skus[0].id, { method: 'PATCH', token: owner, body: { storeId: storeA.id, priceFen: 2100 } });
    const after = await ok('/orders/' + submitted.id, { token: customer });
    assert.equal(after.totalFen, 1700);
    assert.equal(after.lines[0].unitPriceFen, 1700);
    const stale = await request('/orders', { method: 'POST', token: customer, key: 'acceptance-' + runId + '-stale', body: { quoteId: oldQuote.id } });
    assert.ok(stale.status >= 400 && stale.status < 500, 'stale price must be refused for a new order');
  });

  await t.test('stock one concurrent twenty submissions reserve at most one; cancel restores once', async () => {
    const item = await product(1);
    const quotes = await Promise.all(Array.from({ length: 20 }, () => quote(item)));
    const results = await Promise.all(quotes.map((q, index) => request('/orders', { method: 'POST', token: customer, key: 'acceptance-' + runId + '-race-' + index, body: { quoteId: q.id } })));
    const successes = results.filter(r => r.status < 400);
    assert.equal(successes.length, 1, JSON.stringify(results));
    assert.ok(results.every(r => r.status < 500), 'contention is an expected business outcome');
    const winner = successes[0].data;
    const beforeCancel = (await ok('/stores/' + storeA.id + '/catalog')).products.find(p => p.id === item.id);
    assert.equal(beforeCancel.skus[0].available, 0);
    await ok('/orders/' + winner.id + '/cancel', { method: 'POST', token: customer, body: { reason: '验收取消' } });
    await ok('/orders/' + winner.id + '/cancel', { method: 'POST', token: customer, body: { reason: '重复请求' } });
    const restored = (await ok('/stores/' + storeA.id + '/catalog')).products.find(p => p.id === item.id);
    assert.equal(restored.skus[0].available, 1);
  });

  await t.test('closed store refuses an existing quote and can reopen', async () => {
    const item = await product();
    const q = await quote(item);
    await ok('/merchant/stores/' + storeA.id, { method: 'PATCH', token: owner, body: { isOpen: false } });
    try {
      const result = await request('/orders', { method: 'POST', token: customer, key: 'acceptance-' + runId + '-closed', body: { quoteId: q.id } });
      assert.ok(result.status >= 400 && result.status < 500);
    } finally {
      await ok('/merchant/stores/' + storeA.id, { method: 'PATCH', token: owner, body: { isOpen: true } });
    }
  });

  await t.test('cash receipt is real and idempotent; fulfillment rejects illegal transitions', async () => {
    const start = await ok('/merchant/overview?storeId=' + storeA.id, { token: owner });
    const partial = await request('/merchant/orders/' + paidOrder.id + '/cash-payment', { method: 'POST', token: clerkA, body: { tenderedFen: 1 } });
    assert.ok(partial.status >= 400 && partial.status < 500);
    const paid = await ok('/merchant/orders/' + paidOrder.id + '/cash-payment', { method: 'POST', token: clerkA, body: { tenderedFen: 5000 } });
    assert.equal(paid.paymentStatus, 'PAID');
    const actualReceipt = { amountFen: paidOrder.totalFen, tenderedFen: 5000, changeFen: 5000 - paidOrder.totalFen };
    assert.deepEqual(paid.cashReceipt, actualReceipt, 'receipt must reflect committed cash, not mutable client input');
    const replay = await ok('/merchant/orders/' + paidOrder.id + '/cash-payment', { method: 'POST', token: clerkA, body: { tenderedFen: 10000 } });
    assert.deepEqual(replay.cashReceipt, actualReceipt, 'retry with another amount returns original committed receipt');
    assert.deepEqual((await ok('/orders/' + paidOrder.id, { token: owner })).cashReceipt, actualReceipt);
    const end = await ok('/merchant/overview?storeId=' + storeA.id, { token: owner });
    assert.equal(end.paidRevenueFen - start.paidRevenueFen, paidOrder.totalFen);
    for (const action of ['ACCEPT', 'READY', 'COMPLETE']) await ok('/merchant/orders/' + paidOrder.id + '/transition', { method: 'POST', token: clerkA, body: { action } });
    assert.equal((await ok('/orders/' + paidOrder.id, { token: customer })).status, 'COMPLETED');
    assert.equal((await request('/merchant/orders/' + paidOrder.id + '/transition', { method: 'POST', token: clerkA, body: { action: 'ACCEPT' } })).status, 409);
  });

  await t.test('wrong store cannot act on order; unconfigured payment cannot fake success', async () => {
    assert.equal((await request('/merchant/orders/' + paidOrder.id + '/transition', { method: 'POST', token: sessions['clerk-b'].token, body: { action: 'ACCEPT' } })).status, 403);
    const item = await product();
    const pending = await order(await quote(item), 'acceptance-' + runId + '-pay');
    const result = await request('/orders/' + pending.id + '/payment', { method: 'POST', token: customer, body: { provider: 'WECHAT' } });
    assert.equal(result.status, 503);
    assert.equal((await ok('/orders/' + pending.id, { token: customer })).paymentStatus, 'UNPAID');
  });

  await t.test('CMS draft is invisible until publication and stale versions conflict', async () => {
    const current = await ok('/merchant/page?storeId=' + storeA.id, { token: owner });
    const publicBefore = await ok('/public-config?storeId=' + storeA.id);
    const title = '验收发布-' + runId;
    await ok('/merchant/page?storeId=' + storeA.id, { method: 'PUT', token: owner, body: { ...current.draft, bannerTitle: title } });
    assert.equal((await ok('/public-config?storeId=' + storeA.id)).home.bannerTitle, publicBefore.home.bannerTitle);
    const saved = await ok('/merchant/page?storeId=' + storeA.id, { token: owner });
    await ok('/merchant/page/publish?storeId=' + storeA.id, { method: 'POST', token: owner, body: { expectedVersion: saved.version } });
    assert.equal((await ok('/public-config?storeId=' + storeA.id)).home.bannerTitle, title);
    assert.equal((await request('/merchant/page/publish?storeId=' + storeA.id, { method: 'POST', token: owner, body: { expectedVersion: saved.version } })).status, 409);
  });
});

