import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {seed} from '../prisma/seed';
import {randomBytes, createHash} from 'node:crypto';
import {readFile, readdir, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
const {assertUrl, assertSchema, ownedSchema} = require('./cashier-drafts-schema.cjs');
assertUrl(process.env.DATABASE_URL);
const build = process.env.CASHIER_DRAFTS_TEST_BUILD === 'true';
const {createApp} = build ? require('../dist/src/main') : require('../src/main');
const {OrderExpiryService} = build ? require('../dist/src/modules/orders/order-expiry.service') : require('../src/modules/orders/order-expiry.service');
const {AuthService} = build ? require('../dist/src/modules/auth/auth.service') : require('../src/modules/auth/auth.service');
const storeId = 'experience-store-a', skuId = 'experience-a-chicken-sku-0', modifierId = 'experience-a-chicken-egg';
const selection = {mode: 'PICKUP', note: '', lines: [{skuId, quantity: 1, modifierIds: [modifierId], attributeOptionIds: []}]};
let sequence = 0;
async function fixture(run: (ctx: any) => Promise<void>) {
  const db = new PrismaClient(); await seed(db);
  const app = await createApp(); await app.listen(0, '127.0.0.1'); app.get(OrderExpiryService).onModuleDestroy();
  try {
    const base = await app.getUrl() + '/api/v1';
    const req = async (path: string, token?: string, body?: any, method?: string, key?: string) => {
      const response = await fetch(base + path, {method: method || (body === undefined ? 'GET' : 'POST'), headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {}), ...(key === undefined ? {} : {'Idempotency-Key': key})}, body: body === undefined ? undefined : JSON.stringify(body)});
      const bodyResult = await response.json() as any; assert.ok(bodyResult.requestId); return {status: response.status, body: bodyResult};
    };
    const login = async (account: string) => (await req('/auth/dev-login', undefined, {account})).body.data.token;
    const owner = await login('owner'), otherStaff = await login('clerk-a'), customer = await login('customer'), otherStoreStaff = await login('clerk-b');
    assert.equal((await req('/merchant/cash-shifts', owner, {storeId, openingFen: 0}, 'POST', 'drafts-fixture-shift')).status, 201);
    const inventoryCapacitySequenceCash = () => Promise.all([
      db.sku.findMany({select: {id: true, stock: true, reserved: true}, orderBy: {id: 'asc'}}), db.modifier.findMany({select: {id: true, stock: true, reserved: true}, orderBy: {id: 'asc'}}),
      db.pickupSlot.findMany({select: {id: true, heldCount: true, confirmedCount: true}, orderBy: {id: 'asc'}}), db.pickupReservation.findMany({orderBy: {orderId: 'asc'}}), db.pickupSequence.findMany({orderBy: [{storeId: 'asc'}, {serviceDate: 'asc'}]}),
      db.order.aggregate({_count: true, _sum: {totalFen: true}}), db.cashPayment.aggregate({_count: true, _sum: {amountFen: true, tenderedFen: true, changeFen: true, refundedFen: true}}), db.cashRefund.aggregate({_count: true, _sum: {amountFen: true}})
    ]);
    const save = (s = selection, token = owner, key = 'draft-' + ++sequence, name = '隔离验收挂单') => req('/merchant/cashier-drafts', token, {storeId, name, selection: s}, 'POST', key);
    const get = async (id: string, token = owner) => (await req('/merchant/cashier-drafts/' + id + '?storeId=' + storeId, token));
    const edit = (d: any, extra: any = {}, token = owner) => req('/merchant/cashier-drafts/' + d.id, token, {storeId, name: d.name, selection: d.selection, expectedRevision: d.revision, ...extra}, 'PUT');
    const quote = (d: any, token = owner) => req('/merchant/cashier-drafts/' + d.id + '/quote', token, {storeId, expectedRevision: d.revision});
    const create = (q: any, token = owner, key = 'convert-' + ++sequence) => req('/orders', token, {quoteId: q.id}, 'POST', key);
    const cancel = (d: any, token = owner) => req('/merchant/cashier-drafts/' + d.id + '/cancel', token, {storeId, expectedRevision: d.revision});
    await run({db, app, req, owner, otherStaff, customer, otherStoreStaff, save, get, edit, quote, create, cancel, inventoryCapacitySequenceCash});
  } finally {await app.close(); await db.$disconnect();}
}

test('HTTP saves durable draft without reserving inventory, capacity, sequence, orders or cash', async () => fixture(async ({save, get, otherStaff, inventoryCapacitySequenceCash, db}: any) => {
  const before = await inventoryCapacitySequenceCash(), saved = await save(); console.log('cashier drafts HTTP status=', saved.status);
  assert.equal(saved.status, 201); assert.equal(saved.body.data.state, 'DRAFT'); assert.equal(saved.body.data.revision, 0);
  assert.deepEqual(await inventoryCapacitySequenceCash(), before);
  const d = saved.body.data; assert.deepEqual((await get(d.id, otherStaff)).body.data, d); assert.deepEqual(d.selection, selection);
  assert.equal(d.display.lines[0].productName, '香煎鸡腿饭'); assert.equal(d.orderId, null);
  assert.ok(Math.abs(Date.parse(d.createdAt) - Date.now()) < 10000);
  for (const hidden of ['createKey', 'createHash', 'createdById', 'updatedById']) assert.equal(d[hidden], undefined);
  assert.equal(await db.audit.count({where: {entityId: d.id, action: 'CASHIER_DRAFT_CREATED'}}), 1);
}));

test('HTTP create idempotency canonicalizes input, returns current facts and rechecks staff access', async () => fixture(async ({save, get, edit, cancel, req, owner, otherStaff, db}: any) => {
  const key = 'canonical-' + ++sequence, input = {...selection, lines: [{...selection.lines[0], modifierIds: [modifierId, modifierId]}]};
  const d = (await save(input, owner, key, '  同一挂单  ')).body.data; assert.ok(d?.id); assert.equal(d.name, '同一挂单');
  assert.deepEqual(d.selection.lines[0].modifierIds, [modifierId]);
  const edited = await edit(d, {name: '已编辑'}, otherStaff); assert.equal(edited.status, 200); assert.equal(edited.body.data.revision, 1);
  const replay = await save(selection, owner, key, '同一挂单'); assert.equal(replay.status, 201); assert.deepEqual(replay.body.data, edited.body.data);
  assert.equal((await save(selection, otherStaff, key, '同一挂单')).body.error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await save(selection, owner, key, '其他输入')).body.error.code, 'IDEMPOTENCY_CONFLICT');
  const sameKey = 'concurrent-create-' + ++sequence, same = await Promise.all([save(selection, owner, sameKey), save(selection, owner, sameKey)]);
  assert.deepEqual(same.map((r: any) => r.status), [201, 201]); assert.equal(same[0].body.data.id, same[1].body.data.id);
  assert.equal(await db.audit.count({where: {entityId: same[0].body.data.id}}), 1);
  assert.equal(await db.audit.count({where: {entityId: d.id}}), 2);
  await db.staffStore.delete({where: {userId_storeId: {userId: 'experience-user-owner', storeId}}});
  try {assert.equal((await save(selection, owner, key, '同一挂单')).status, 403); assert.equal((await get(d.id)).status, 403);} finally {await db.staffStore.create({data: {userId: 'experience-user-owner', storeId}});}
  const cancelled = await cancel(edited.body.data); assert.equal(cancelled.status, 201);
  const events = await db.audit.count({where: {entityId: d.id}});
  assert.deepEqual((await cancel(d)).body.data, cancelled.body.data); assert.equal(await db.audit.count({where: {entityId: d.id}}), events);
  assert.deepEqual((await save(selection, owner, key, '同一挂单')).body.data, cancelled.body.data);
  assert.equal((await edit(cancelled.body.data)).body.error.code, 'DRAFT_CHANGED');
  assert.equal((await req('/merchant/cashier-drafts/' + d.id + '/quote', owner, {storeId, expectedRevision: 2})).body.error.code, 'DRAFT_CHANGED');
}));

test('HTTP strict whitelist, limits, relationships, pagination and store/brand permissions', async () => fixture(async ({req, save, owner, otherStoreStaff, customer, db}: any) => {
  for (const extra of [{priceFen: 1}, {state: 'CONVERTED'}, {revision: 9}, {orderId: 'o'}, {display: {}}, {unknown: 1}]) assert.equal((await req('/merchant/cashier-drafts', owner, {storeId, name: 'n', selection, ...extra}, 'POST', 'bad')).status, 400);
  for (const name of ['', '  ', 1, '名'.repeat(61)]) assert.equal((await save(selection, owner, 'bad', name)).status, 400);
  for (const s of [
    {...selection, priceFen: 1}, {...selection, note: 'a'.repeat(501)}, {...selection, note: null}, {...selection, mode: 'DELIVERY'}, {...selection, tableCode: 'EXPERIENCE-A-1'},
    {...selection, mode: 'DINE_IN'}, {...selection, mode: 'DINE_IN', tableCode: 'EXPERIENCE-B-1'}, {...selection, mode: 'DINE_IN', tableCode: 'EXPERIENCE-A-1', pickupSlotId: 'slot'},
    {...selection, pickupSlotId: 1}, {...selection, lines: []}, {...selection, lines: Array(101).fill(selection.lines[0])},
    ...[0, 100, 1.5, '1'].map(quantity => ({...selection, lines: [{...selection.lines[0], quantity}]})),
    ...[{skuId: 1}, {skuId: 'x'.repeat(201)}, {skuId: 'experience-b-chicken-sku-0'}, {modifierIds: ['experience-b-chicken-egg']}, {modifierIds: Array(21).fill(modifierId)}, {modifierIds: [1]}, {attributeOptionIds: ['missing']}, {attributeOptionIds: ['x', 'x']}, {attributeOptionIds: Array(51).fill('x')}, {totalFen: 1}].map(change => ({...selection, lines: [{...selection.lines[0], ...change}]}))
  ]) assert.equal((await save(s)).status, 400, JSON.stringify(s));
  for (const token of [customer, otherStoreStaff]) {
    assert.equal((await save(selection, token)).status, 403);
    assert.equal((await req('/merchant/cashier-drafts?storeId=' + storeId, token)).status, 403);
  }
  assert.equal((await req('/merchant/cashier-drafts?storeId=' + storeId)).status, 401);
  const foreign = await db.user.create({data: {brand: {create: {name: 'private brand'}}, role: 'OWNER', name: 'foreign', staff: {create: {storeId}}}});
  const token = randomBytes(32).toString('base64url'); await db.session.create({data: {userId: foreign.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 60000)}});
  assert.equal((await save(selection, token)).status, 403); assert.equal((await req('/merchant/cashier-drafts?storeId=' + storeId, token)).status, 403);
  for (const suffix of ['&page=0', '&page=-1', '&page=1.5', '&page=x', '&pageSize=0', '&pageSize=51', '&pageSize=2.5', '&state=UNKNOWN', '&unknown=1', '&page[]=1', '&page=1&page=2']) assert.equal((await req('/merchant/cashier-drafts?storeId=' + storeId + suffix, owner)).status, 400, suffix);
  const d = (await save()).body.data;
  for (const token of [customer, otherStoreStaff]) {
    assert.equal((await req('/merchant/cashier-drafts/' + d.id + '?storeId=' + storeId, token)).status, 403);
    assert.equal((await req('/merchant/cashier-drafts/' + d.id, token, {storeId, name: d.name, selection, expectedRevision: 0}, 'PUT')).status, 403);
    for (const action of ['quote', 'cancel']) assert.equal((await req('/merchant/cashier-drafts/' + d.id + '/' + action, token, {storeId, expectedRevision: 0})).status, 403);
  }
  const historyKey = 'history-' + ++sequence;
  await db.cashierDraft.createMany({data: Array.from({length: 2001}, (_, i) => ({storeId, name: '历史已取消', selection, display: {lines: []}, state: 'CANCELLED', createdById: 'experience-user-owner', updatedById: 'experience-user-owner', createKey: historyKey + '-' + i, createHash: 'fixture', updatedAt: new Date(Date.now() + 86400000)}))});
  const list = await req('/merchant/cashier-drafts?storeId=' + storeId + '&page=1&pageSize=1', owner); assert.equal(list.status, 200); assert.equal(list.body.data.pageSize, 1); assert.equal(list.body.data.items[0].id, d.id);
  assert.equal(list.body.data.total, await db.cashierDraft.count({where: {storeId, state: 'DRAFT'}}));
  for (const state of ['CANCELLED', 'CONVERTED']) {const filtered = await req('/merchant/cashier-drafts?storeId=' + storeId + '&state=' + state, owner); assert.equal(filtered.status, 200); assert.equal(filtered.body.data.total, await db.cashierDraft.count({where: {storeId, state}})); assert.ok(filtered.body.data.items.every((row: any) => row.state === state));}
  const far = await req('/merchant/cashier-drafts?storeId=' + storeId + '&page=9007199254740991&pageSize=50', owner); assert.equal(far.status, 200); assert.deepEqual(far.body.data.items, []); assert.equal(far.body.data.total, list.body.data.total);
  assert.equal((await req('/merchant/cashier-drafts/' + d.id + '?storeId=experience-store-b', owner)).status, 403);
  assert.equal((await req('/merchant/cashier-drafts/' + d.id + '?storeId=' + storeId + '&unknown=1', owner)).status, 400);
  assert.equal((await req('/merchant/cashier-drafts/' + d.id + '/cancel', owner, {storeId, expectedRevision: '0'})).status, 400);
  const dine = await save({...selection, mode: 'DINE_IN', tableCode: 'EXPERIENCE-A-1'}); assert.equal(dine.status, 201);
  assert.equal((await req('/quotes', owner, {storeId, ...selection, cashierDraft: {id: d.id, revision: 0}})).status, 400);
}));

test('011 migration preserves every old row/column and original timestamp text with new constraints', async () => {
  const client = new pg.Client({connectionString: process.env.DATABASE_URL}); await client.connect();
  try {await ownedSchema(client, 'test_cashier_drafts_migration_' + randomBytes(6).toString('hex'), async (schema: string) => {
    await client.query(`SET search_path TO "${schema}"`);
    const root = resolve(__dirname, '../prisma/migrations');
    for (const name of (await readdir(root)).filter(x => /^2026102000(0[1-9]|10)_/.test(x)).sort()) await client.query(await readFile(join(root, name, 'migration.sql'), 'utf8'));
    await client.query(`INSERT INTO "Brand" (id,name) VALUES ('b','b'); INSERT INTO "Store" (id,"brandId",name,address,phone) VALUES ('s','b','s','',''); INSERT INTO "User" (id,"brandId",name,role) VALUES ('u','b','u','OWNER'),('editor','b','editor','CLERK'); INSERT INTO "StaffStore" ("userId","storeId") VALUES ('u','s'); INSERT INTO "Quote" (id,"userId","storeId",snapshot,"expiresAt","createdAt") VALUES ('q','u','s','{}','2030-01-01 11:22:33.123','2020-02-03 04:05:06.789'); INSERT INTO "Order" (id,number,"userId","storeId","quoteId","idempotencyKey","requestHash",mode,"subtotalFen","deliveryFeeFen","packagingFeeFen","discountFen","totalFen","storeName",lines,"createdAt","paymentExpiresAt") VALUES ('o','o','u','s','q','k','h','PICKUP',100,0,0,0,100,'s','[]','2020-02-03 04:05:06.789','2020-02-03 04:20:06.789'); UPDATE "Order" SET status='AWAITING_ACCEPTANCE',"paymentStatus"='PAID',"refundStatus"='PARTIAL' WHERE id='o'; INSERT INTO "CashPayment" (id,"orderId","staffId","amountFen","tenderedFen","changeFen","refundedFen","createdAt") VALUES ('p','o','u',100,120,20,10,'2020-02-03 04:05:06.123'); INSERT INTO "CashRefund" (id,"paymentId","staffId","amountFen",reason,"idempotencyKey","requestHash","createdAt") VALUES ('refund','p','u',10,'old','r','h','2020-02-03 04:05:07.456'); INSERT INTO "OrderEvent" (id,"orderId",status,label,"createdAt") VALUES ('event','o','AWAITING_ACCEPTANCE','old','2020-02-03 04:05:06.789'); INSERT INTO "Session" (id,"tokenHash","userId","expiresAt","createdAt") VALUES ('session','hash','u','2030-01-01 11:22:33.123','2020-02-03 04:05:06.789'); INSERT INTO "Category" (id,"brandId",name) VALUES ('c','b','old'); INSERT INTO "Product" (id,"storeId","categoryId",name) VALUES ('product','s','c','old'); INSERT INTO "Sku" (id,"productId",name,"priceFen",stock,reserved) VALUES ('sku','product','old',100,7,2); INSERT INTO "Modifier" (id,"productId",name,"priceFen",stock,reserved) VALUES ('modifier','product','old',10,5,1); INSERT INTO "Audit" (id,"storeId","actorId",action,"entityId","createdAt") VALUES ('audit','s','u','OLD','o','2020-02-03 04:05:06.789')`);
    const columns = new Map<string, string[]>();
    for (const {table_name} of (await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name', [schema])).rows) columns.set(table_name, (await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position', [schema, table_name])).rows.map((r: any) => r.column_name));
    // SQL row_to_json text preserves original timestamp strings, avoiding Date/timezone round trips.
    const snapshot = async () => {const rows: any = {}; for (const [table, names] of columns) rows[table] = (await client.query(`SELECT row_to_json(t)::text AS row FROM (SELECT ${names.map(n => '"' + n + '"').join(',')} FROM "${table}") t ORDER BY row_to_json(t)::text`)).rows; return JSON.stringify(rows);};
    const before = await snapshot(); await client.query(await readFile(join(root, '202610200011_cashier_drafts/migration.sql'), 'utf8')); assert.equal(await snapshot(), before);
    console.log('011 old-column/text-time SHA256 unchanged:', createHash('sha256').update(before).digest('hex'));
    await client.query("SET TIME ZONE 'Asia/Shanghai'");
    const insert = (id: string, key: string, actor = 'u') => client.query('INSERT INTO "CashierDraft" (id,"storeId",name,selection,display,"createdById","updatedById","createKey","createHash","updatedAt") VALUES ($1,\'s\',\'n\',\'{}\',\'{}\',$3,\'editor\',$2,\'hash\',now() AT TIME ZONE \'UTC\')', [id, key, actor]);
    await insert('d', 'key');
    const d = (await client.query(`SELECT state,revision,"orderId", EXTRACT(EPOCH FROM ("createdAt"-(now() AT TIME ZONE 'UTC')))::int AS seconds FROM "CashierDraft" WHERE id='d'`)).rows[0]; assert.equal(d.state, 'DRAFT'); assert.equal(d.revision, 0); assert.equal(d.orderId, null); assert.ok(Math.abs(d.seconds) < 10); console.log('Draft direct SQL UTC deltaSeconds=', d.seconds);
    await assert.rejects(insert('d2', 'key'), (e: any) => e.code === '23505'); await assert.rejects(insert('foreign', 'foreign', 'missing'), (e: any) => e.code === '23503');
    for (const sql of [`UPDATE "CashierDraft" SET revision=-1 WHERE id='d'`, `UPDATE "CashierDraft" SET state='UNKNOWN' WHERE id='d'`, `UPDATE "CashierDraft" SET state='CONVERTED' WHERE id='d'`, `UPDATE "CashierDraft" SET "orderId"='o' WHERE id='d'`]) await assert.rejects(client.query(sql), (e: any) => e.code === '23514');
    await client.query(`UPDATE "CashierDraft" SET state='CONVERTED',"orderId"='o' WHERE id='d'`); await insert('d2', 'key2');
    await assert.rejects(client.query(`UPDATE "CashierDraft" SET state='CONVERTED',"orderId"='o' WHERE id='d2'`), (e: any) => e.code === '23505');
    for (const sql of [`DELETE FROM "User" WHERE id='editor'`, `DELETE FROM "Order" WHERE id='o'`, `DELETE FROM "Store" WHERE id='s'`]) await assert.rejects(client.query(sql), (e: any) => e.code === '23503');
    console.log('011 defaults/CHECK/UNIQUE/RESTRICT enforced; old tables preserved');
  });} finally {await client.end();}
});

test('draft module rejects unsafe schema and wrong database before access', () => {
  for (const value of [undefined, 'postgresql://unused:unused@127.0.0.1:1/unused?schema=test_cashier_drafts_safe', 'postgresql://restaurant_dev:x@127.0.0.1:55432/restaurant_dev?schema=development', 'postgresql://restaurant_dev:x@127.0.0.1:55432/restaurant_dev?schema=public']) {
    const env = {...process.env, TSX_TSCONFIG_PATH: resolve(__dirname, '../tsconfig.json')}; delete env.NODE_TEST_CONTEXT;
    if (value) env.DATABASE_URL = value; else delete env.DATABASE_URL;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'tests/cashier-drafts.test.ts'], {cwd: resolve(__dirname, '..'), env, encoding: 'utf8', windowsHide: true});
    assert.equal(result.status, 1); assert.match(result.stdout + result.stderr, /Cashier drafts tests require/); assert.doesNotMatch(result.stdout + result.stderr, /ECONNREFUSED|PrismaClientInitializationError/);
  }
  for (const schema of ['development', 'public', undefined, 'test_cashier_drafts_bad";DROP SCHEMA public']) assert.throws(() => assertSchema(schema));
});

for (const nested of [false, true]) test('draft ' + (nested ? 'migration fixture' : 'runner') + ' CREATE collision preserves prior schema/OID/owner', async () => {
  const hex = randomBytes(6).toString('hex'), schema = 'test_cashier_drafts_' + (nested ? 'migration_' : '') + hex, client = new pg.Client({connectionString: process.env.DATABASE_URL}); await client.connect();
  const dir = await mkdtemp(join(tmpdir(), 'drafts-'));
  try {await ownedSchema(client, schema, async () => {
    await client.query(`CREATE TABLE "${schema}".sentinel (value integer); INSERT INTO "${schema}".sentinel VALUES (42)`);
    const identity = (await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1', [schema])).rows[0], preload = join(dir, 'fixed.cjs');
    await writeFile(preload, `require('node:crypto').randomBytes=()=>Buffer.from('${hex}','hex');`);
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
    const args = nested ? ['--require', preload, '--import', 'tsx', '--test', '--test-name-pattern', '^011', 'apps/api/tests/cashier-drafts.test.ts'] : ['--require', preload, 'apps/api/tests/run-cashier-drafts.cjs'];
    const result = spawnSync(process.execPath, args, {cwd: resolve(__dirname, '../../..'), env, encoding: 'utf8', windowsHide: true});
    assert.equal(result.status, 1); assert.match(result.stdout + result.stderr, /already exists/); assert.equal((await client.query(`SELECT value FROM "${schema}".sentinel`)).rows[0].value, 42); assert.deepEqual((await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1', [schema])).rows[0], identity);
  });} finally {await client.end(); await rm(dir, {recursive: true, force: true});}
});

test('HTTP competing edits use CAS and stale quotes cannot convert', async () => fixture(async ({save, edit, quote, create, get, otherStaff, inventoryCapacitySequenceCash}: any) => {
  const d = (await save()).body.data, q = await quote(d); assert.equal(q.status, 201); assert.deepEqual(q.body.data.cashierDraft, {id: d.id, revision: 0});
  const before = await inventoryCapacitySequenceCash(), edits = await Promise.all([edit(d, {name: '设备一'}), edit(d, {name: '设备二'}, otherStaff)]);
  assert.deepEqual(edits.map((r: any) => r.status).sort(), [200, 409]); assert.equal(edits.find((r: any) => r.status === 409).body.error.code, 'DRAFT_CHANGED');
  assert.equal((await quote(d)).body.error.code, 'DRAFT_CHANGED'); assert.equal((await create(q.body.data)).body.error.code, 'DRAFT_CHANGED');
  assert.deepEqual(await inventoryCapacitySequenceCash(), before); assert.equal((await get(d.id)).body.data.revision, 1);
}));

test('HTTP two staff quotes compete for exactly one atomic conversion and original key replays after cancellation', async () => fixture(async ({save, quote, create, get, edit, cancel, req, db, owner, otherStaff, inventoryCapacitySequenceCash}: any) => {
  const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const policy = await db.pickupPolicy.findUniqueOrThrow({where: {storeId}}); await db.pickupPolicy.update({where: {storeId}, data: {enabled: true}});
  const slot = await db.pickupSlot.create({data: {storeId, startsAt: new Date(day + 'T12:00:00+08:00'), endsAt: new Date(day + 'T12:30:00+08:00'), capacity: 10}});
  try {
    const d = (await save({...selection, pickupSlotId: slot.id})).body.data;
    const quotes = await Promise.all([quote(d), quote(d, otherStaff)]); assert.deepEqual(quotes.map((r: any) => r.status), [201, 201]);
    assert.equal((await create(quotes[0].body.data, otherStaff)).status, 403, 'staff cannot consume another staff quote');
    const before = await inventoryCapacitySequenceCash(), keys = ['race-a-' + ++sequence, 'race-b-' + ++sequence];
    const race = await Promise.all([create(quotes[0].body.data, owner, keys[0]), create(quotes[1].body.data, otherStaff, keys[1])]); assert.deepEqual(race.map((r: any) => r.status).sort(), [201, 409]);
    assert.equal(race.find((r: any) => r.status === 409).body.error.code, 'DRAFT_ALREADY_CONVERTED');
    const actual = (await get(d.id)).body.data; assert.equal(actual.state, 'CONVERTED'); assert.equal(actual.revision, 1); assert.ok(actual.orderId);
    assert.equal(await db.order.count({where: {cashierDraft: {id: d.id}}}), 1);
    const after = await inventoryCapacitySequenceCash();
    const expected = structuredClone(before); expected[0].find((r: any) => r.id === skuId).stock--; expected[0].find((r: any) => r.id === skuId).reserved++;
    expected[1].find((r: any) => r.id === modifierId).stock--; expected[1].find((r: any) => r.id === modifierId).reserved++;
    expected[2].find((r: any) => r.id === slot.id).heldCount++;
    expected[3] = [...before[3], {orderId: actual.orderId, slotId: slot.id, state: 'HELD'}].sort((a: any, b: any) => a.orderId.localeCompare(b.orderId));
    const seq = expected[4].find((r: any) => r.storeId === storeId && r.serviceDate === day); if (seq) seq.lastNumber++; else expected[4].push({storeId, serviceDate: day, lastNumber: 1}); expected[4].sort((a: any, b: any) => a.storeId.localeCompare(b.storeId) || a.serviceDate.localeCompare(b.serviceDate));
    expected[5]._count++; expected[5]._sum.totalFen = (expected[5]._sum.totalFen || 0) + 3100;
    assert.deepEqual(after, expected, 'exactly one order inventory, HELD and Q number delta');
    assert.equal((await edit(actual)).body.error.code, 'DRAFT_ALREADY_CONVERTED'); assert.equal((await cancel(actual)).body.error.code, 'DRAFT_ALREADY_CONVERTED');
    const winner = race.findIndex((r: any) => r.status === 201), token = winner === 0 ? owner : otherStaff, userId = winner === 0 ? 'experience-user-owner' : 'experience-user-clerk-a';
    assert.equal((await create(quotes[winner].body.data, token, keys[winner])).body.data.id, actual.orderId); assert.deepEqual(await inventoryCapacitySequenceCash(), after);
    await db.staffStore.delete({where: {userId_storeId: {userId, storeId}}});
    try {assert.equal((await create(quotes[winner].body.data, token, keys[winner])).status, 403);} finally {await db.staffStore.create({data: {userId, storeId}});}
    const staff = await db.user.findUniqueOrThrow({where: {id: userId}});
    await db.user.update({where: {id: userId}, data: {role: 'CUSTOMER'}});
    try {assert.equal((await create(quotes[winner].body.data, token, keys[winner])).status, 403);} finally {await db.user.update({where: {id: userId}, data: {role: staff.role}});}
    await db.user.update({where: {id: userId}, data: {enabled: false}});
    try {assert.equal((await create(quotes[winner].body.data, token, keys[winner])).status, 401);} finally {await db.user.update({where: {id: userId}, data: {enabled: true}});}
    assert.equal((await req('/orders/' + actual.orderId + '/cancel', token, {})).status, 201);
    assert.equal((await get(d.id)).body.data.state, 'CONVERTED'); assert.equal((await create(quotes[winner].body.data, token, keys[winner])).body.data.status, 'CANCELLED');
    assert.equal(await db.audit.count({where: {entityId: d.id, action: 'CASHIER_DRAFT_CONVERTED'}}), 1);
  } finally {await db.pickupPolicy.update({where: {storeId}, data: {enabled: policy.enabled}});}
}));

test('HTTP saves inactive selections but re-quotes prices and rejects changed inventory/options/slots without destroying draft', async () => fixture(async ({save, get, quote, create, edit, db, inventoryCapacitySequenceCash}: any) => {
  const sku = await db.sku.findUniqueOrThrow({where: {id: skuId}}), modifier = await db.modifier.findUniqueOrThrow({where: {id: modifierId}});
  const group = await db.productAttributeGroup.create({data: {productId: sku.productId, name: '口味', options: {create: {name: '清淡'}}}, include: {options: true}}), option = group.options[0];
  const s = {...selection, lines: [{...selection.lines[0], attributeOptionIds: [option.id]}]};
  const d = (await save(s)).body.data; assert.equal(d.display.lines[0].attributeNames[0], '清淡');
  try {
    await db.sku.update({where: {id: skuId}, data: {priceFen: sku.priceFen + 100}});
    const repriced = await quote(d); assert.equal(repriced.status, 201); assert.equal(repriced.body.data.totalFen, sku.priceFen + 400);
    const baseline = await inventoryCapacitySequenceCash();
    await db.sku.update({where: {id: skuId}, data: {priceFen: sku.priceFen + 200}}); assert.equal((await create(repriced.body.data)).body.error.code, 'PRICE_CHANGED'); assert.deepEqual(await inventoryCapacitySequenceCash(), baseline);
    for (const [model, id, data, restore] of [
      ['sku', skuId, {enabled: false}, {enabled: sku.enabled}], ['modifier', modifierId, {enabled: false}, {enabled: modifier.enabled}],
      ['sku', skuId, {stock: 0}, {stock: sku.stock}], ['productAttributeOption', option.id, {enabled: false}, {enabled: true}], ['product', sku.productId, {isAvailable: false}, {isAvailable: true}]
    ] as any[]) {
      await (db as any)[model].update({where: {id}, data});
      try {assert.equal((await save(s)).status, 201); assert.equal((await quote(d)).status, model === 'sku' && data.stock === 0 ? 409 : 400); assert.deepEqual((await get(d.id)).body.data, d);} finally {await (db as any)[model].update({where: {id}, data: restore});}
    }
    await db.productAttributeOption.delete({where: {id: option.id}});
    assert.equal((await edit(d)).status, 400); assert.deepEqual((await get(d.id)).body.data, d);
    const pastDay = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const slot = await db.pickupSlot.create({data: {storeId, startsAt: new Date(pastDay + 'T12:00:00+08:00'), endsAt: new Date(pastDay + 'T12:30:00+08:00'), capacity: 1, enabled: false}});
    const expired = (await save({...selection, pickupSlotId: slot.id})).body.data; assert.ok(expired.id); assert.equal((await quote(expired)).status, 409); assert.equal((await get(expired.id)).body.data.selection.pickupSlotId, slot.id);
  } finally {await db.sku.update({where: {id: skuId}, data: {priceFen: sku.priceFen, enabled: sku.enabled, stock: sku.stock}}); await db.productAttributeOption.deleteMany({where: {groupId: group.id}}); await db.productAttributeGroup.delete({where: {id: group.id}});}
}));

test('HTTP rechecks authorization inside write transaction and conversion audit failure rolls all effects back', async () => fixture(async ({save, quote, create, inventoryCapacitySequenceCash, db, app}: any) => {
  const auth = app.get(AuthService), original = auth.staff.bind(auth); let first = true;
  auth.staff = async (...args: any[]) => {const user = await original(...args); if (first) {first = false; await db.staffStore.delete({where: {userId_storeId: {userId: 'experience-user-owner', storeId}}});} return user;};
  try {assert.equal((await save()).status, 403);} finally {auth.staff = original; await db.staffStore.create({data: {userId: 'experience-user-owner', storeId}});}
  const d = (await save()).body.data, q = (await quote(d)).body.data, before = await inventoryCapacitySequenceCash();
  const schema = assertUrl(process.env.DATABASE_URL), client = new pg.Client({connectionString: process.env.DATABASE_URL}); await client.connect();
  try {
    // This schema is owned by the guarded outer runner; all injected objects disappear with it.
    await client.query(`CREATE FUNCTION "${schema}".reject_draft_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='CASHIER_DRAFT_CONVERTED' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$`);
    await client.query(`CREATE TRIGGER reject_draft_audit BEFORE INSERT ON "${schema}"."Audit" FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_draft_audit()`);
    const errors: any[] = [], originalError = console.error; console.error = (...args: any[]) => errors.push(args);
    let result: any; try {result = await create(q);} finally {console.error = originalError;}
    assert.equal(result.status, 500); assert.equal(result.body.error.code, 'INTERNAL_ERROR'); assert.deepEqual(await inventoryCapacitySequenceCash(), before);
    assert.equal(errors.length, 1); assert.equal(errors[0][0], 'API error'); assert.equal(errors[0][1].requestId, result.body.requestId);
    assert.equal((await db.cashierDraft.findUniqueOrThrow({where: {id: d.id}})).state, 'DRAFT');
  } finally {await client.end();}
}));
