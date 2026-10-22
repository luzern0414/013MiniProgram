import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/main';
import { seed } from '../prisma/seed';
import { hashPassword, verifyPassword } from '../src/modules/auth/credentials';
import { Errors } from '../src/common/http';

test('unexpected database failures never log query arguments or credentials', () => {
  const original = console.error, recorded: unknown[][] = [];
  console.error = (...values: unknown[]) => { recorded.push(values); };
  try {
    const response = {status(_value: number) { return this; }, json(_value: unknown) {}};
    const context = {switchToHttp: () => ({getResponse: () => response, getRequest: () => ({})})};
    new Errors().catch(new Error('query args: passwordHash=scrypt$secret password=test-password'), context as any);
    assert.ok(!JSON.stringify(recorded).includes('secret'));
    assert.ok(!JSON.stringify(recorded).includes('test-password'));
  } finally { console.error = original; }
});

test('scrypt credentials use fresh salts and reject malformed or uncontrolled formats', async () => {
  const secret = ' a-long-test-password ';
  const first = await hashPassword(secret), second = await hashPassword(secret);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(secret, first), true);
  assert.equal(await verifyPassword(secret.trim(), first), false);
  for (const invalid of [null, '', first + '$extra', first.replace('$1$', '$2$'), first.replace('$16384$', '$1048576$'), first.toUpperCase(), 'scrypt$1$16384$8$1$zz$zz']) {
    assert.equal(await verifyPassword(secret, invalid), false);
  }
});

test('staff credentials and authorization persist through real HTTP and PostgreSQL', async () => {
  assert.equal(new URL(process.env.DATABASE_URL!).searchParams.get('schema'), 'test_staff_access', 'Staff tests require their isolated schema');
  process.env.NODE_ENV = 'test'; process.env.DEV_AUTH_ENABLED = 'true'; process.env.DEV_SEED_ENABLED = 'true';
  const db = new PrismaClient();
  await db.$transaction([
    db.session.deleteMany(), db.audit.deleteMany(), db.cashPayment.deleteMany(), db.orderEvent.deleteMany(),
    db.order.deleteMany(), db.quote.deleteMany(), db.staffStore.deleteMany(), db.page.deleteMany(), db.diningTable.deleteMany(),
    db.modifier.deleteMany(), db.sku.deleteMany(), db.product.deleteMany(), db.category.deleteMany(), db.unit.deleteMany(), db.user.deleteMany(), db.store.deleteMany(), db.brand.deleteMany()
  ]);
  await seed(db);
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  const base = await app.getUrl() + '/api/v1';
  const a = 'experience-store-a', b = 'experience-store-b';
  const password = ' Test-secret-2026 ';
  async function request(path: string, token?: string, body?: unknown, method?: string) {
    const res = await fetch(base + path, {method: method || (body ? 'POST' : 'GET'), headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}, body: body ? JSON.stringify(body) : undefined});
    return {status: res.status, body: await res.json() as any};
  }
  const auth = (account = 'cashier.one', pass = password, brandId = 'experience-brand') => request('/auth/staff-login', undefined, {brandId, account, password: pass});
  try {
    const owner = (await request('/auth/dev-login', undefined, {account: 'owner'})).body.data.token;
    const clerk = (await request('/auth/dev-login', undefined, {account: 'clerk-a'})).body.data.token;
    const create = (overrides = {}, token = owner) => request('/merchant/staff', token, {storeId: a, name: '收银员', account: 'Cashier.One', password, storeIds: [a, b, a], ...overrides});
    const created = await create();
    assert.equal(created.status, 201, 'OWNER can create a real CLERK account');
    const staff = created.body.data;
    assert.equal(staff.account, 'cashier.one'); assert.equal(staff.role, 'CLERK'); assert.equal(staff.enabled, true); assert.equal(staff.revision, 0);
    assert.deepEqual([...staff.storeIds].sort(), [a, b]); assert.ok(!JSON.stringify(staff).includes('password'));
    assert.equal((await create()).status, 409);
    const createRace = await Promise.all([create({account: 'concurrent.clerk'}), create({account: 'CONCURRENT.CLERK'})]);
    assert.deepEqual(createRace.map(r => r.status).sort(), [201, 409], 'Duplicate create race commits one account');
    assert.equal(await db.user.count({where: {brandId: 'experience-brand', staffAccount: 'concurrent.clerk'}}), 1);
    assert.equal((await create({account: 'other.clerk'}, clerk)).status, 403);
    assert.equal((await create({account: 'role.inject', role: 'OWNER'})).status, 400);
    for (const account of ['ab', 'space user', '中账号', 'a'.repeat(65)]) assert.equal((await create({account})).status, 400);
    for (const patch of [{password: 'short'}, {password: 'x'.repeat(129)}, {name: ''}, {name: 'x'.repeat(81)}, {storeIds: []}, {storeIds: [1]}, {storeIds: Array(101).fill(a)}]) assert.equal((await create({account: 'bad.input', ...patch})).status, 400);
    const loggedIn = await auth('CASHIER.ONE'); assert.equal(loggedIn.status, 201); assert.equal(loggedIn.body.data.environment, 'test');
    let token = loggedIn.body.data.token;
    const wrong = await auth('cashier.one', 'wrong-password'); const absent = await auth('unknown.person');
    assert.equal(wrong.status, 401); assert.deepEqual(wrong.body.error, absent.body.error);
    assert.equal((await auth('cashier.one', password.trim())).status, 401, 'Passwords are not trimmed');
    assert.equal((await request(`/merchant/staff?storeId=${a}`, token)).status, 403);
    const patch = (data: any, id = staff.id, actor = owner) => request(`/merchant/staff/${id}`, actor, {storeId: a, expectedRevision: 0, ...data}, 'PATCH');
    assert.equal((await patch({name: '越权'}, staff.id, clerk)).status, 403);
    assert.equal((await patch({name: '店主'}, 'experience-user-owner')).status, 403);
    assert.equal((await request('/merchant/staff/experience-user-owner/reset-password', owner, {storeId: a, expectedRevision: 0, password})).status, 403);
    assert.equal((await patch({enabled: 'false'})).status, 400);
    assert.equal((await patch({expectedRevision: -1, name: '非法版本'})).status, 400);
    await db.brand.create({data: {id: 'staff-other-brand', name: '隔离品牌'}});
    await db.store.create({data: {id: 'staff-other-store', brandId: 'staff-other-brand', name: '隔离门店', address: '', phone: ''}});
    const foreignUser = await db.user.create({data: {brandId: 'staff-other-brand', name: '其他品牌员工', role: 'CLERK', staff: {create: {storeId: 'staff-other-store'}}}});
    assert.equal((await patch({name: '跨品牌'}, foreignUser.id)).status, 403);
    assert.equal((await create({account: 'cross.store', storeIds: ['staff-other-store']})).status, 403);
    const limited = await db.user.create({data: {brandId: 'experience-brand', name: '受限店主', role: 'OWNER', staff: {create: {storeId: a}}}});
    const limitedToken = 'L'.repeat(43);
    await db.session.create({data: {userId: limited.id, tokenHash: createHash('sha256').update(limitedToken).digest('hex'), expiresAt: new Date(Date.now() + 60000)}});
    assert.equal((await create({account: 'over.scope', storeIds: [b]}, limitedToken)).status, 403);
    assert.equal((await patch({name: '不能编辑他店授权员工'}, staff.id, limitedToken)).status, 403);
    const list = (await request(`/merchant/staff?storeId=${a}`, limitedToken)).body.data;
    assert.deepEqual(list.find((x: any) => x.id === staff.id).storeIds, [a], 'List does not disclose unauthorized store IDs');
    const renamed = await patch({name: '新姓名'}); assert.equal(renamed.status, 200); assert.equal(renamed.body.data.revision, 1);
    assert.equal((await patch({name: '旧版本'})).status, 409);
    assert.equal((await request('/me', token)).body.data.name, '新姓名');
    assert.equal((await patch({expectedRevision: 1, storeIds: [a]})).status, 200);
    assert.equal(await db.session.count({where: {userId: staff.id}}), 0);
    assert.equal((await request('/me', token)).status, 401, 'Store removal revokes old sessions');
    token = (await auth()).body.data.token;
    assert.deepEqual((await request('/me', token)).body.data.storeIds, [a]);
    const replacement = 'Replacement-secret-2026';
    const reset = (revision: number) => request(`/merchant/staff/${staff.id}/reset-password`, owner, {storeId: a, expectedRevision: revision, password: replacement});
    assert.equal((await reset(1)).status, 409); assert.equal((await reset(2)).status, 201);
    assert.equal(await db.session.count({where: {userId: staff.id}}), 0);
    assert.equal((await request('/me', token)).status, 401); assert.equal((await auth()).status, 401);
    token = (await auth('cashier.one', replacement)).body.data.token;
    assert.equal((await patch({expectedRevision: 3, enabled: false})).status, 200);
    assert.equal(await db.session.count({where: {userId: staff.id}}), 0);
    assert.equal((await request('/me', token)).status, 401); assert.equal((await auth('cashier.one', replacement)).status, 401);
    assert.equal((await patch({expectedRevision: 4, enabled: true})).status, 200);
    token = (await auth('cashier.one', replacement)).body.data.token;
    assert.equal((await request('/auth/logout', token, {})).status, 201);
    assert.equal((await request('/auth/logout', token, {})).status, 201); assert.equal((await request('/me', token)).status, 401);
    const sessionOne = (await auth('cashier.one', replacement)).body.data.token;
    const sessionTwo = (await auth('cashier.one', replacement)).body.data.token;
    await request('/auth/logout', sessionOne, {});
    assert.equal((await request('/me', sessionTwo)).status, 200, 'Logout only revokes its own session');
    const updateRace = await Promise.all([patch({expectedRevision: 5, name: '并发一'}), patch({expectedRevision: 5, name: '并发二'})]);
    assert.deepEqual(updateRace.map(r => r.status).sort(), [200, 409]);
    await db.user.update({where: {id: 'experience-user-clerk-a'}, data: {enabled: false} as any});
    assert.equal((await request('/me', clerk)).status, 401); assert.equal((await request('/auth/dev-login', undefined, {account: 'clerk-a'})).status, 401);
    const audit = await db.audit.findMany({where: {entityId: staff.id}}); assert.ok(audit.length >= 6);
    const serialized = JSON.stringify(audit); assert.ok(!/"password"|passwordHash|scrypt\$|secret-2026/i.test(serialized), 'Audit fields and values never contain credentials');
    const stored = await db.user.findUniqueOrThrow({where: {id: staff.id}}) as any;
    assert.notEqual(stored.passwordHash, password); assert.match(stored.passwordHash, /^scrypt\$/);
    for (let i = 0; i < 12; i++) await auth('throttled.account');
    assert.equal((await auth('throttled.account')).status, 429);
  } finally { await app.close(); await db.$disconnect(); }
});
