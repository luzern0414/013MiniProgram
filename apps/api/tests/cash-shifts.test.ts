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
const {assertUrl, assertSchema, ownedSchema} = require('./cash-shifts-schema.cjs');
assertUrl(process.env.DATABASE_URL);
const build = process.env.CASH_SHIFTS_TEST_BUILD === 'true';
const {createApp} = build ? require('../dist/src/main') : require('../src/main');
const {OrderExpiryService} = build ? require('../dist/src/modules/orders/order-expiry.service') : require('../src/modules/orders/order-expiry.service');
const {Db} = build ? require('../dist/src/common/db') : require('../src/common/db');
const {AuthService} = build ? require('../dist/src/modules/auth/auth.service') : require('../src/modules/auth/auth.service');
const {advanceShift, lockActiveShift, lockShift, safeShiftInteger} = build ? require('../dist/src/modules/finance/cash-shift-ledger') : require('../src/modules/finance/cash-shift-ledger');
const storeId = 'experience-store-a';
let sequence = 0;
async function fixture(run: (ctx: any) => Promise<void>) {
  const originalUrl = process.env.DATABASE_URL!, client = new pg.Client({connectionString: originalUrl}); await client.connect();
  try {return await ownedSchema(client, 'test_cash_shifts_case_' + randomBytes(6).toString('hex'), async (schema: string) => {
  const url = new URL(originalUrl); url.searchParams.set('schema', schema); assertUrl(url.href);
  await client.query(`SET search_path TO "${schema}"`);
  const root = resolve(__dirname, '../prisma/migrations');
  for (const name of (await readdir(root)).filter(x => /^\d+_/.test(x)).sort()) await client.query(await readFile(join(root, name, 'migration.sql'), 'utf8'));
  process.env.DATABASE_URL = url.href;
  const db = new PrismaClient(); await seed(db);
  const app = await createApp(); await app.listen(0, '127.0.0.1'); app.get(OrderExpiryService).onModuleDestroy();
  try {
    const base = await app.getUrl() + '/api/v1';
    const req = async (path: string, token?: string, body?: any, method?: string, key?: string) => {
      const response = await fetch(base + path, {method: method || (body === undefined ? 'GET' : 'POST'), headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {}), ...(key === undefined ? {} : {'Idempotency-Key': key})}, body: body === undefined ? undefined : JSON.stringify(body)});
      const result = await response.json() as any; assert.ok(result.requestId); return {status: response.status, body: result};
    };
    const login = async (account: string) => (await req('/auth/dev-login', undefined, {account})).body.data.token;
    const owner = await login('owner'), clerk = await login('clerk-a'), customer = await login('customer'), otherStore = await login('clerk-b');
    const open = (openingFen: any = 0, key = 'open-' + ++sequence, token = owner, extra = {}) => req('/merchant/cash-shifts', token, {storeId, openingFen, ...extra}, 'POST', key);
    const current = (token = owner) => req('/merchant/cash-shifts/current?storeId=' + storeId, token);
    const detail = (id: string, token = owner) => req('/merchant/cash-shifts/' + id + '?storeId=' + storeId, token);
    const close = (shift: any, countedFen = shift.summary.expectedFen, key = 'close-' + ++sequence, extra = {}, token = owner) => req('/merchant/cash-shifts/' + shift.id + '/close', token, {storeId, expectedRevision: shift.revision, countedFen, reason: '', ...extra}, 'POST', key);
    const create = async () => {
      const q = await req('/quotes', customer, {storeId, mode: 'PICKUP', lines: [{skuId: 'experience-a-chicken-sku-0', quantity: 2, modifierIds: ['experience-a-chicken-egg']}]}); assert.equal(q.status, 201);
      const result = await req('/orders', customer, {quoteId: q.body.data.id}, 'POST', 'order-' + ++sequence); assert.equal(result.status, 201); return result.body.data;
    };
    const pay = (o: any, tenderedFen = 7000) => req('/merchant/orders/' + o.id + '/cash-payment', clerk, {tenderedFen});
    const refund = (o: any, amountFen = 1000, key = 'refund-' + ++sequence) => req('/merchant/orders/' + o.id + '/cash-refunds', owner, {storeId, amountFen, reason: '现金已退回'}, 'POST', key);
    const ledger = () => Promise.all([db.cashPayment.findMany({orderBy: {id: 'asc'}}), db.cashRefund.findMany({orderBy: {id: 'asc'}}), db.sku.findMany({orderBy: {id: 'asc'}}), db.modifier.findMany({orderBy: {id: 'asc'}}), db.order.findMany({orderBy: {id: 'asc'}}), db.orderEvent.findMany({orderBy: {id: 'asc'}}), db.audit.findMany({orderBy: {id: 'asc'}})]);
    await run({db, app, req, owner, clerk, customer, otherStore, open, current, detail, close, create, pay, refund, ledger});
  } finally {await app.close(); await db.$disconnect();}
  });} finally {process.env.DATABASE_URL = originalUrl; await client.end();}
}

test('HTTP missing shift blocks new cash payment and refund without financial or inventory writes', async () => fixture(async ({create, pay, refund, ledger, db}: any) => {
  const o = await create(), before = await ledger();
  const result = await pay(o); console.log('cash shifts RED missing payment status=', result.status);
  assert.equal(result.status, 409); assert.equal(result.body.error.code, 'SHIFT_REQUIRED'); assert.deepEqual(await ledger(), before);
  // A migrated, already paid receipt is deliberately unassigned.
  await db.cashPayment.create({data: {orderId: o.id, staffId: 'experience-user-owner', amountFen: o.totalFen, tenderedFen: o.totalFen, changeFen: 0}});
  await db.order.update({where: {id: o.id}, data: {status: 'AWAITING_ACCEPTANCE', paymentStatus: 'PAID'}});
  const paidBefore = await ledger(), returned = await refund(o);
  assert.equal(returned.status, 409); assert.equal(returned.body.error.code, 'SHIFT_REQUIRED'); assert.deepEqual(await ledger(), paidBefore);
  const payment = await db.cashPayment.findUniqueOrThrow({where: {orderId: o.id}}), amountFen = 50, reason = '现金已退回';
  await db.cashRefund.create({data: {paymentId: payment.id, staffId: 'experience-user-owner', amountFen, reason, idempotencyKey: 'legacy-null', requestHash: createHash('sha256').update(JSON.stringify({orderId: o.id, storeId, amountFen, reason})).digest('hex')}});
  await db.cashPayment.update({where: {id: payment.id}, data: {refundedFen: amountFen}});
  const legacyBefore = await ledger(), replay = await refund(o, amountFen, 'legacy-null'); assert.equal(replay.status, 201); assert.equal(replay.body.data.cashReceipt.shiftId, null); assert.equal(replay.body.data.cashRefunds[0].shiftId, null); assert.deepEqual(await ledger(), legacyBefore);
}));

test('HTTP zero opening, owner permissions, same-key replay and competing opens', async () => fixture(async ({open, current, detail, req, owner, clerk, customer, otherStore, db}: any) => {
  const empty = await current(); assert.equal(empty.status, 200); assert.equal(empty.body.data.shift, null);
  for (const token of [clerk, customer, otherStore]) assert.equal((await open(0, 'forbidden', token)).status, 403);
  assert.equal((await open(0, 'unauthenticated', '')).status, 401);
  const same = await Promise.all([open(0, 'one'), open(0, 'one')]); assert.deepEqual(same.map((r: any) => r.status), [201, 201]);
  const shift = same[0].body.data; assert.equal(shift.id, same[1].body.data.id); assert.equal(shift.openingFen, 0); assert.equal(shift.revision, 0);
  assert.equal((await detail(shift.id, clerk)).status, 200); assert.equal((await current(clerk)).body.data.shift.id, shift.id);
  assert.equal((await open(1, 'one')).body.error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await open(0, 'two')).body.error.code, 'SHIFT_ALREADY_OPEN');
  assert.equal(await db.cashShift.count({where: {storeId}}), 1); assert.equal(await db.audit.count({where: {entityId: shift.id}}), 1);
  for (const token of [customer, otherStore]) assert.equal((await detail(shift.id, token)).status, 403);
  await db.staffStore.delete({where: {userId_storeId: {userId: 'experience-user-owner', storeId}}});
  assert.equal((await open(0, 'one')).status, 403); assert.equal((await req('/merchant/cash-shifts?storeId=' + storeId, owner)).status, 403);
}));

test('HTTP cash receipts expose true nullable shift attribution and retain closed snapshots', async () => fixture(async ({db, open, create, pay, refund, current, close, detail, req, owner}: any) => {
  await db.sku.update({where: {id: 'experience-a-chicken-sku-0'}, data: {priceFen: 2780}});
  const s = (await open(100)).body.data, o = await create();
  assert.equal(o.totalFen, 6160);
  const paid = await pay(o); assert.equal(paid.status, 201); assert.equal(paid.body.data.cashReceipt.shiftId, s.id);
  assert.equal(paid.body.data.cashReceipt.changeFen, 840);
  const payment = await db.cashPayment.findUniqueOrThrow({where: {orderId: o.id}}); assert.equal(payment.shiftId, s.id);
  let shift = (await current()).body.data.shift; assert.equal(shift.revision, 1); assert.equal(shift.summary.paidFen, 6160); assert.equal(shift.summary.expectedFen, 6260);
  const returned = await refund(o, 1000, 'refund-one'); assert.equal(returned.status, 201); assert.equal(returned.body.data.cashRefunds[0].shiftId, s.id);
  shift = (await current()).body.data.shift; assert.equal(shift.revision, 2); assert.equal(shift.summary.refundFen, 1000); assert.equal(shift.summary.expectedFen, 5260);
  const stale = await close(s, 100); assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'SHIFT_CHANGED');
  const closed = await close(shift); assert.equal(closed.status, 201); const frozen = closed.body.data; assert.equal(frozen.revision, 3); assert.equal(frozen.summary.countedFen, 5260); assert.equal(frozen.summary.differenceFen, 0);
  const count = await db.audit.count(); assert.equal((await pay(o)).status, 201); assert.equal((await refund(o, 1000, 'refund-one')).status, 201); assert.equal(await db.audit.count(), count);
  assert.deepEqual((await detail(s.id)).body.data, frozen); assert.equal((await refund(o, 100)).body.error.code, 'SHIFT_REQUIRED');
  const second = (await open(0)).body.data; assert.equal((await refund(o, 100)).status, 201);
  assert.equal((await db.cashPayment.findUniqueOrThrow({where: {id: payment.id}})).shiftId, s.id);
  assert.equal((await current()).body.data.shift.summary.expectedFen, -100); assert.deepEqual((await detail(s.id)).body.data, frozen);
  assert.equal((await db.cashRefund.findFirstOrThrow({where: {shiftId: second.id}})).amountFen, 100);
  // Explicitly unassigned legacy receipt: reads/replays preserve NULL, a new return enters the current shift.
  const legacy = await create(); await db.cashPayment.create({data: {orderId: legacy.id, staffId: 'experience-user-owner', amountFen: 6160, tenderedFen: 7000, changeFen: 840}});
  await db.order.update({where: {id: legacy.id}, data: {status: 'AWAITING_ACCEPTANCE', paymentStatus: 'PAID'}});
  const legacyRead = await req('/orders/' + legacy.id, owner); assert.equal(legacyRead.body.data.cashReceipt.shiftId, null);
  assert.equal((await pay(legacy)).body.data.cashReceipt.shiftId, null); const lr = await refund(legacy, 50); assert.equal(lr.status, 201); assert.equal(lr.body.data.cashRefunds[0].shiftId, second.id);
  assert.equal((await db.cashPayment.findUniqueOrThrow({where: {orderId: legacy.id}})).shiftId, null);
}));

test('HTTP strict write/query contract, pagination, cross-brand and revoked identities', async () => fixture(async ({db, req, open, close, detail, owner, clerk, customer}: any) => {
  for (const value of [-1, 2_000_000_001, 1.5, '0', [], null]) assert.equal((await open(value)).status, 400);
  for (const extra of [{state: 'OPEN'}, {shiftId: 'x'}, {openedById: 'x'}, {openedAt: 'x'}, {summary: {}}, {revision: 1}]) assert.equal((await open(0, 'invalid', owner, extra)).status, 400);
  for (const key of ['', ' '.repeat(2), 'a'.repeat(121)]) assert.equal((await open(0, key)).status, 400);
  for (const suffix of ['&unknown=1', '&state=BAD', '&page=0', '&pageSize=51', '&page=1.1', '&page=1&page=2', '&page[]=1', '&pageSize=2.5', '&storeId=x']) assert.equal((await req('/merchant/cash-shifts?storeId=' + storeId + suffix, owner)).status, 400, suffix);
  const foreign = await db.user.create({data: {brand: {create: {name: 'foreign'}}, role: 'OWNER', name: 'foreign', staff: {create: {storeId}}}});
  const token = randomBytes(32).toString('base64url'); await db.session.create({data: {userId: foreign.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 60000)}});
  assert.equal((await open(0, 'foreign', token)).status, 403); assert.equal((await req('/merchant/cash-shifts?storeId=' + storeId, token)).status, 403);
  const shift = (await open(2_000_000_000)).body.data;
  assert.equal((await req('/merchant/cash-shifts/' + shift.id + '/close', owner, {storeId: 'experience-store-b', expectedRevision: 0, countedFen: 0, reason: ''}, 'POST', 'wrong-store')).status, 403);
  assert.equal((await close(shift, 2_000_000_000, 'clerk-close', {}, clerk)).status, 403);
  for (const extra of [{countedFen: '0'}, {countedFen: -1}, {countedFen: 2_000_000_001}, {expectedRevision: '0'}, {expectedRevision: 2_000_000_001}, {expectedRevision: []}, {reason: 'a'.repeat(501)}, {reason: []}, {status: 'CLOSED'}, {expectedFen: 0}, {closedById: 'x'}]) assert.equal((await close(shift, 0, 'invalid', extra)).status, 400);
  assert.equal((await close(shift, 0)).status, 400);
  const closed = await close(shift, 0, 'with-reason', {reason: '  记录现金差额  '}); assert.equal(closed.status, 201); assert.equal(closed.body.data.summary.reason, '记录现金差额'); assert.equal(closed.body.data.summary.differenceFen, -2_000_000_000);
  assert.equal((await detail('missing')).status, 404); assert.equal((await req('/merchant/cash-shifts/' + shift.id + '?storeId=experience-store-b', owner)).status, 403);
  assert.equal((await req('/merchant/cash-shifts/current?storeId=' + storeId + '&state=OPEN', owner)).status, 400);
  assert.equal((await req('/merchant/cash-shifts/' + shift.id + '?storeId=' + storeId + '&unknown=1', owner)).status, 400);
  const second = (await open()).body.data;
  for (const state of ['OPEN', 'CLOSED', 'ALL']) {
    const list = await req('/merchant/cash-shifts?storeId=' + storeId + '&state=' + state + '&pageSize=1', clerk); assert.equal(list.status, 200); assert.equal(list.body.data.total, state === 'ALL' ? 2 : 1); assert.equal(list.body.data.items.length, 1);
  }
  const list = await req('/merchant/cash-shifts?storeId=' + storeId, owner); assert.equal(list.body.data.total, 2); assert.equal(list.body.data.items[0].id, second.id);
  const far = await req('/merchant/cash-shifts?storeId=' + storeId + '&page=9007199254740991&pageSize=50', owner); assert.equal(far.status, 200); assert.deepEqual(far.body.data.items, []); assert.equal(far.body.data.total, 2);
  for (const hidden of ['createKey', 'createHash', 'closeKey', 'closeHash', 'openedById', 'closedById', 'staffAccount', 'passwordHash']) assert.equal(closed.body.data[hidden], undefined);
  assert.deepEqual(Object.keys(closed.body.data.openedBy).sort(), ['id', 'name']); assert.deepEqual(Object.keys(closed.body.data.closedBy).sort(), ['id', 'name']);
  await db.user.update({where: {id: 'experience-user-owner'}, data: {enabled: false}}); assert.equal((await open()).status, 401); assert.equal((await detail(shift.id)).status, 401);
  await db.user.update({where: {id: 'experience-user-owner'}, data: {enabled: true}});
  await db.staffStore.delete({where: {userId_storeId: {userId: 'experience-user-owner', storeId}}}); assert.equal((await close(shift, 0, 'with-reason', {reason: '记录现金差额'})).status, 403);
  assert.equal((await req('/merchant/cash-shifts/current?storeId=' + storeId, customer)).status, 403);
}));

test('HTTP competing open/close devices commit one audit and original keys return current facts', async () => fixture(async ({db, open, close, detail, owner}: any) => {
  const opens = await Promise.all([open(0, 'device-1'), open(0, 'device-2')]); assert.deepEqual(opens.map((r: any) => r.status).sort(), [201, 409]); assert.equal(opens.find((r: any) => r.status === 409).body.error.code, 'SHIFT_ALREADY_OPEN');
  const s = opens.find((r: any) => r.status === 201).body.data;
  const closes = await Promise.all([close(s, 0, 'device-close-1'), close(s, 0, 'device-close-2')]); assert.deepEqual(closes.map((r: any) => r.status).sort(), [201, 409]); assert.equal(closes.find((r: any) => r.status === 409).body.error.code, 'SHIFT_CHANGED');
  const closed = closes.find((r: any) => r.status === 201).body.data, key = closes[0].status === 201 ? 'device-close-1' : 'device-close-2';
  assert.deepEqual((await close(s, 0, key)).body.data, closed); assert.equal((await close(s, 1, key, {reason: 'changed'})).body.error.code, 'IDEMPOTENCY_CONFLICT');
  const openKey = opens[0].status === 201 ? 'device-1' : 'device-2'; assert.deepEqual((await open(0, openKey, owner)).body.data, closed);
  assert.equal(await db.audit.count({where: {entityId: s.id}}), 2); assert.deepEqual((await detail(s.id)).body.data, closed);
  const next = (await open()).body.data; assert.equal((await close(next, 0, key)).body.error.code, 'IDEMPOTENCY_CONFLICT');
}));

test('HTTP same-key concurrent close replays once and changed input never overwrites snapshot', async () => fixture(async ({db, open, close}: any) => {
  const s = (await open()).body.data;
  const results = await Promise.all([close(s, 0, 'same'), close(s, 0, 'same')]); assert.deepEqual(results.map((r: any) => r.status), [201, 201]); assert.deepEqual(results[0].body.data, results[1].body.data);
  assert.equal(await db.audit.count({where: {entityId: s.id, action: 'CASH_SHIFT_CLOSED'}}), 1);
  assert.equal((await close(s, 10, 'same', {reason: 'other'})).body.error.code, 'IDEMPOTENCY_CONFLICT');
}));

test('HTTP trimmed reason accepts 500 meaningful characters and canonical replay', async () => fixture(async ({open, close}: any) => {
  const shift = (await open()).body.data, reason = '差'.repeat(500);
  const result = await close(shift, 1, 'reason-max', {reason: '  ' + reason + '  '}); assert.equal(result.status, 201); assert.equal(result.body.data.summary.reason, reason);
  assert.deepEqual((await close(shift, 1, 'reason-max', {reason})).body.data, result.body.data);
}));

test('HTTP business-date totals use occurrence dates while one explicit shift crosses Shanghai midnight', async () => fixture(async ({db, open, create, pay, refund, current, close, detail, req, owner}: any) => {
  const s = (await open(100)).body.data, o = await create(); assert.equal((await pay(o)).status, 201);
  const now = new Date(), local = new Date(now.getTime() + 8 * 3600000), start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 8 * 3600000), end = new Date(start.getTime() + 86400000);
  await db.cashShift.update({where: {id: s.id}, data: {openedAt: new Date(start.getTime() - 1000)}});
  await db.cashPayment.update({where: {orderId: o.id}, data: {createdAt: new Date(start.getTime() - 1)}});
  for (const [index, date] of [new Date(start.getTime() - 1), start, new Date(end.getTime() - 1), end].entries()) {
    const key = 'day-' + index; assert.equal((await refund(o, (index + 1) * 100, key)).status, 201);
    const receipt = await db.cashRefund.findFirstOrThrow({where: {idempotencyKey: key}}); await db.cashRefund.update({where: {id: receipt.id}, data: {createdAt: date}});
  }
  const overview = await req('/merchant/overview?storeId=' + storeId, owner); assert.equal(overview.status, 200); assert.equal(overview.body.data.paidRevenueFen, 0); assert.equal(overview.body.data.refundFen, 500); assert.equal(overview.body.data.netRevenueFen, -500);
  const shift = (await current()).body.data.shift; assert.equal(shift.id, s.id); assert.equal(shift.summary.paidFen, o.totalFen); assert.equal(shift.summary.refundFen, 1000); assert.equal(shift.summary.expectedFen, 100 + o.totalFen - 1000);
  assert.equal((await close(shift)).status, 201); const frozen = (await detail(s.id)).body.data;
  const second = (await open(0)).body.data; assert.equal((await refund(o, 100)).status, 201); assert.equal((await current()).body.data.shift.id, second.id); assert.deepEqual((await detail(s.id)).body.data, frozen);
}));

test('HTTP close/payment/refund races admit only legal serial order and closed receipts stay fixed', async () => fixture(async ({db, create, pay, refund, open, current, close, detail}: any) => {
  const s = (await open()).body.data, o = await create();
  const [closing, paying] = await Promise.all([close(s), pay(o)]);
  if (closing.status === 201) {assert.equal(paying.status, 409); assert.equal(paying.body.error.code, 'SHIFT_REQUIRED'); assert.equal(await db.cashPayment.count({where: {shiftId: s.id}}), 0);}
  else {assert.equal(closing.body.error.code, 'SHIFT_CHANGED'); assert.equal(paying.status, 201); assert.equal((await close((await current()).body.data.shift)).status, 201);}
  const frozen = (await detail(s.id)).body.data; assert.equal(frozen.summary.paymentCount, paying.status === 201 ? 1 : 0);
  const second = (await open()).body.data; if (paying.status !== 201) assert.equal((await pay(o)).status, 201);
  const beforeRefund = (await current()).body.data.shift;
  const [closingRefund, returning] = await Promise.all([close(beforeRefund), refund(o, 100)]);
  if (closingRefund.status === 201) {assert.equal(returning.status, 409); assert.equal(returning.body.error.code, 'SHIFT_REQUIRED'); assert.equal(await db.cashRefund.count({where: {shiftId: second.id}}), 0);}
  else {assert.equal(closingRefund.body.error.code, 'SHIFT_CHANGED'); assert.equal(returning.status, 201); assert.equal((await close((await current()).body.data.shift)).status, 201);}
  assert.deepEqual((await detail(s.id)).body.data, frozen);
  const secondClosed = (await detail(second.id)).body.data; assert.equal(secondClosed.summary.refundCount, returning.status === 201 ? 1 : 0);
  assert.equal(secondClosed.revision, secondClosed.summary.paymentCount + secondClosed.summary.refundCount + 1);
}));

test('HTTP revision and snapshot safe-integer overflow reject atomically', async () => fixture(async ({db, open, create, pay, refund, current, close, detail, ledger}: any) => {
  const s = (await open()).body.data, o = await create();
  await db.cashShift.update({where: {id: s.id}, data: {revision: 2_000_000_000}}); const before = await ledger();
  assert.equal((await pay(o)).body.error.code, 'SHIFT_TOTAL_TOO_LARGE'); assert.deepEqual(await ledger(), before);
  assert.equal((await close({...s, revision: 2_000_000_000})).body.error.code, 'SHIFT_TOTAL_TOO_LARGE');
  await db.cashShift.update({where: {id: s.id}, data: {revision: 0}}); assert.equal((await pay(o)).status, 201);
  await db.cashShift.update({where: {id: s.id}, data: {revision: 2_000_000_000}}); const paidBefore = await ledger();
  assert.equal((await refund(o)).body.error.code, 'SHIFT_TOTAL_TOO_LARGE'); assert.deepEqual(await ledger(), paidBefore);
  await db.cashShift.update({where: {id: s.id}, data: {revision: 1}}); const opened = (await current()).body.data.shift; assert.equal((await close(opened)).status, 201);
  await db.cashShift.update({where: {id: s.id}, data: {paymentCount: 9007199254740992n}});
  const large = await detail(s.id); assert.equal(large.status, 409); assert.equal(large.body.error.code, 'SHIFT_TOTAL_TOO_LARGE');
}));

test('actual raw PostgreSQL 40001/40P01 and complete bounded Db.atomic lock retries', async () => fixture(async ({app, db, open, req, owner}: any) => {
  const s = (await open()).body.data;
  await assert.rejects(db.$transaction(async (tx: any) => {
    await tx.cashShift.findUniqueOrThrow({where: {id: s.id}});
    await db.cashShift.update({where: {id: s.id}, data: {revision: {increment: 1}}});
    await tx.$queryRaw`SELECT id FROM "CashShift" WHERE id=${s.id} FOR UPDATE`;
  }, {isolationLevel: 'Serializable'}), (error: any) => {assert.equal(error.code, 'P2010'); assert.equal(error.meta?.code, '40001'); console.log('Actual raw lock:', error.code, error.meta.code); return true;});
  let attempts = 0;
  await app.get(Db).atomic(async (tx: any) => {
    attempts++; await tx.cashShift.findUniqueOrThrow({where: {id: s.id}});
    if (attempts === 1) await db.cashShift.update({where: {id: s.id}, data: {revision: {increment: 1}}});
    await lockActiveShift(tx, storeId);
  });
  assert.equal(attempts, 2);
  const other = await req('/merchant/cash-shifts', owner, {storeId: 'experience-store-b', openingFen: 0}, 'POST', 'other-store'); assert.equal(other.status, 201); const second = other.body.data.id;
  const barrier = () => {let arrived = 0; let release: () => void; const ready = new Promise<void>(done => {release = done;}); return async () => {if (++arrived === 2) release!(); await ready;};};
  const rawReady = barrier();
  const raw = await Promise.allSettled([[s.id, second], [second, s.id]].map(([first, last]) => db.$transaction(async (tx: any) => {
    await tx.$queryRaw`SELECT id FROM "CashShift" WHERE id=${first} FOR UPDATE`; await rawReady();
    await tx.$queryRaw`SELECT id FROM "CashShift" WHERE id=${last} FOR UPDATE`;
  }, {timeout: 15000})));
  assert.equal(raw.filter(r => r.status === 'rejected').length, 1); const error = (raw.find(r => r.status === 'rejected') as PromiseRejectedResult).reason;
  assert.equal(error.code, 'P2010'); assert.equal(error.meta?.code, '40P01'); console.log('Actual raw lock:', error.code, error.meta.code);
  const mappedReady = barrier(), tries = [0, 0];
  await Promise.all([[s.id, second], [second, s.id]].map(([first, last], index) => app.get(Db).atomic(async (tx: any) => {
    tries[index]++; const firstStore = first === s.id ? storeId : 'experience-store-b', lastStore = last === s.id ? storeId : 'experience-store-b';
    await lockShift(tx, first, firstStore); if (tries[index] === 1) await mappedReady(); await lockShift(tx, last, lastStore);
  })));
  assert.equal(tries[0] + tries[1], 3); console.log('Atomic full retries: 40001 attempts=', attempts, '; 40P01 attempts=', tries.join('/'));
  for (const value of [9007199254740992n, -9007199254740992n]) assert.throws(() => safeShiftInteger(value), {code: 'SHIFT_TOTAL_TOO_LARGE'});
}));

test('real SQL bigint ledger aggregate crossing safe integer rolls back the new receipt and revision', async () => fixture(async ({db, open, create, pay, current, app}: any) => {
  const s = (await open()).body.data, old = await create(); assert.equal((await pay(old)).status, 201); const next = await create();
  // Widen only two isolated fixture columns to reach the aggregate boundary without millions of fake orders.
  // Production migration leaves existing Int receipt columns intact; SUM(Int) is the same PostgreSQL BIGINT result.
  await db.$executeRawUnsafe('ALTER TABLE "CashPayment" ALTER COLUMN "amountFen" TYPE BIGINT, ALTER COLUMN "tenderedFen" TYPE BIGINT');
  await db.$executeRaw`UPDATE "CashPayment" SET "amountFen"=9007199254740990,"tenderedFen"=9007199254740990,"changeFen"=0 WHERE "orderId"=${old.id}`;
  assert.equal((await current()).body.data.shift.summary.paidFen, 9007199254740990);
  const snapshot = () => Promise.all([db.sku.findMany({orderBy: {id: 'asc'}}), db.modifier.findMany({orderBy: {id: 'asc'}}), db.audit.count(), db.orderEvent.count(), db.cashPayment.count(), db.order.findUnique({where: {id: next.id}}), db.cashShift.findUnique({where: {id: s.id}})]);
  const before = await snapshot();
  await assert.rejects(app.get(Db).atomic(async (tx: any) => {
    const shift = await lockActiveShift(tx, storeId);
    await tx.$executeRaw`INSERT INTO "CashPayment" (id,"orderId","staffId","shiftId","amountFen","tenderedFen","changeFen") VALUES ('overflow-receipt',${next.id},'experience-user-owner',${s.id},6200,7000,800)`;
    await advanceShift(tx, shift);
  }), {code: 'SHIFT_TOTAL_TOO_LARGE'});
  assert.deepEqual(await snapshot(), before);
}));

test('HTTP shift writes recheck transaction authorization and audit failures roll back open/close atomically', async () => fixture(async ({app, db, open, close, req, owner}: any) => {
  const s = (await open()).body.data, auth = app.get(AuthService), original = auth.staff.bind(auth);
  for (const operation of [() => open(), () => close(s)]) {
    let first = true;
    auth.staff = async (...args: any[]) => {const user = await original(...args); if (first) {first = false; await db.staffStore.delete({where: {userId_storeId: {userId: 'experience-user-owner', storeId}}});} return user;};
    try {assert.equal((await operation()).status, 403);} finally {auth.staff = original; await db.staffStore.create({data: {userId: 'experience-user-owner', storeId}});}
  }
  const schema = assertUrl(process.env.DATABASE_URL);
  // This schema was created by fixture(), with OID/owner verified before final cleanup.
  await db.$executeRawUnsafe(`CREATE FUNCTION "${schema}".reject_shift_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('CASH_SHIFT_OPENED','CASH_SHIFT_CLOSED') THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER reject_shift_audit BEFORE INSERT ON "${schema}"."Audit" FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_shift_audit()`);
  const snapshot = () => Promise.all([db.cashShift.findMany({orderBy: {id: 'asc'}}), db.audit.findMany({orderBy: {id: 'asc'}}), db.cashPayment.count(), db.cashRefund.count()]);
  const before = await snapshot();
  const failedClose = await close(s); assert.equal(failedClose.status, 500); assert.equal(failedClose.body.error.code, 'INTERNAL_ERROR'); assert.deepEqual(await snapshot(), before);
  const failedOpen = await req('/merchant/cash-shifts', owner, {storeId: 'experience-store-b', openingFen: 0}, 'POST', 'failed-open'); assert.equal(failedOpen.status, 500); assert.equal(failedOpen.body.error.code, 'INTERNAL_ERROR'); assert.deepEqual(await snapshot(), before);
}));

test('012 migration preserves every old row/column and original timestamp text with new constraints', async () => {
  const client = new pg.Client({connectionString: process.env.DATABASE_URL}); await client.connect();
  try {await ownedSchema(client, 'test_cash_shifts_migration_' + randomBytes(6).toString('hex'), async (schema: string) => {
    await client.query(`SET search_path TO "${schema}"`);
    const root = resolve(__dirname, '../prisma/migrations');
    for (const name of (await readdir(root)).filter(x => /^2026102000(0[1-9]|1[01])_/.test(x)).sort()) await client.query(await readFile(join(root, name, 'migration.sql'), 'utf8'));
    await client.query(`INSERT INTO "Brand" (id,name) VALUES ('b','b'); INSERT INTO "Store" (id,"brandId",name,address,phone) VALUES ('s','b','s','',''); INSERT INTO "User" (id,"brandId",name,role) VALUES ('u','b','u','OWNER'),('editor','b','editor','CLERK'); INSERT INTO "StaffStore" ("userId","storeId") VALUES ('u','s'); INSERT INTO "Quote" (id,"userId","storeId",snapshot,"expiresAt","createdAt") VALUES ('q','u','s','{}','2030-01-01 11:22:33.123','2020-02-03 04:05:06.789'); INSERT INTO "Order" (id,number,"userId","storeId","quoteId","idempotencyKey","requestHash",mode,"subtotalFen","deliveryFeeFen","packagingFeeFen","discountFen","totalFen","storeName",lines,"createdAt","paymentExpiresAt") VALUES ('o','o','u','s','q','k','h','PICKUP',100,0,0,0,100,'s','[]','2020-02-03 04:05:06.789','2020-02-03 04:20:06.789'); UPDATE "Order" SET status='AWAITING_ACCEPTANCE',"paymentStatus"='PAID',"refundStatus"='PARTIAL' WHERE id='o'; INSERT INTO "CashPayment" (id,"orderId","staffId","amountFen","tenderedFen","changeFen","refundedFen","createdAt") VALUES ('p','o','u',100,120,20,10,'2020-02-03 04:05:06.123'); INSERT INTO "CashRefund" (id,"paymentId","staffId","amountFen",reason,"idempotencyKey","requestHash","createdAt") VALUES ('refund','p','u',10,'old','r','h','2020-02-03 04:05:07.456'); INSERT INTO "OrderEvent" (id,"orderId",status,label,"createdAt") VALUES ('event','o','AWAITING_ACCEPTANCE','old','2020-02-03 04:05:06.789'); INSERT INTO "Session" (id,"tokenHash","userId","expiresAt","createdAt") VALUES ('session','hash','u','2030-01-01 11:22:33.123','2020-02-03 04:05:06.789'); INSERT INTO "Category" (id,"brandId",name) VALUES ('c','b','old'); INSERT INTO "Product" (id,"storeId","categoryId",name) VALUES ('product','s','c','old'); INSERT INTO "Sku" (id,"productId",name,"priceFen",stock,reserved) VALUES ('sku','product','old',100,7,2); INSERT INTO "Modifier" (id,"productId",name,"priceFen",stock,reserved) VALUES ('modifier','product','old',10,5,1); INSERT INTO "Audit" (id,"storeId","actorId",action,"entityId","createdAt") VALUES ('audit','s','u','OLD','o','2020-02-03 04:05:06.789')`);
    await client.query(`INSERT INTO "CashierDraft" (id,"storeId",name,selection,display,"createdById","updatedById","createKey","createHash","createdAt","updatedAt") VALUES ('old-draft','s','old','{}','{}','u','editor','old-key','old-hash','2020-02-03 04:05:06.789','2020-02-03 05:06:07.890')`);
    const columns = new Map<string, string[]>();
    for (const {table_name} of (await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name', [schema])).rows) columns.set(table_name, (await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position', [schema, table_name])).rows.map((r: any) => r.column_name));
    // SQL row_to_json text preserves original timestamp strings, avoiding Date/timezone round trips.
    const snapshot = async () => {const rows: any = {}; for (const [table, names] of columns) rows[table] = (await client.query(`SELECT row_to_json(t)::text AS row FROM (SELECT ${names.map(n => '"' + n + '"').join(',')} FROM "${table}") t ORDER BY row_to_json(t)::text`)).rows; return JSON.stringify(rows);};
    const before = await snapshot(); await client.query(await readFile(join(root, '202610210012_cash_shifts/migration.sql'), 'utf8')); assert.equal(await snapshot(), before);
    console.log('012 old-column/text-time SHA256 unchanged:', createHash('sha256').update(before).digest('hex'));
    assert.equal((await client.query(`SELECT "shiftId" FROM "CashPayment" WHERE id='p'`)).rows[0].shiftId, null);
    assert.equal((await client.query(`SELECT "shiftId" FROM "CashRefund" WHERE id='refund'`)).rows[0].shiftId, null);
    await client.query("SET TIME ZONE 'Asia/Shanghai'");
    const insert = (id: string, key: string, store = 's') => client.query(`INSERT INTO "CashShift" (id,"storeId","openingFen","openedById","createKey","createHash") VALUES ($1,$3,0,'u',$2,'h')`, [id, key, store]);
    await insert('shift', 'open');
    const row = (await client.query(`SELECT state,revision,"closedAt",EXTRACT(EPOCH FROM ("openedAt"-(now() AT TIME ZONE 'UTC')))::int AS seconds FROM "CashShift" WHERE id='shift'`)).rows[0]; assert.equal(row.state, 'OPEN'); assert.equal(row.revision, 0); assert.equal(row.closedAt, null); assert.ok(Math.abs(row.seconds) < 10);
    await assert.rejects(insert('duplicate-open', 'different-key'), (e: any) => e.code === '23505');
    for (const sql of [`UPDATE "CashShift" SET state='BAD' WHERE id='shift'`, `UPDATE "CashShift" SET revision=-1 WHERE id='shift'`, `UPDATE "CashShift" SET revision=2000000001 WHERE id='shift'`, `UPDATE "CashShift" SET "openingFen"=-1 WHERE id='shift'`, `UPDATE "CashShift" SET "openingFen"=2000000001 WHERE id='shift'`, `UPDATE "CashShift" SET state='CLOSED' WHERE id='shift'`, `UPDATE "CashShift" SET "countedFen"=0 WHERE id='shift'`]) await assert.rejects(client.query(sql), (e: any) => e.code === '23514');
    await assert.rejects(insert('missing-store', 'other', 'missing'), (e: any) => e.code === '23503');
    await assert.rejects(client.query(`UPDATE "CashShift" SET "openedById"='missing' WHERE id='shift'`), (e: any) => e.code === '23503');
    for (const table of ['CashPayment', 'CashRefund']) {
      await assert.rejects(client.query(`UPDATE "${table}" SET "shiftId"='missing'`), (e: any) => e.code === '23503');
      await client.query(`UPDATE "${table}" SET "shiftId"='shift'`);
      await assert.rejects(client.query(`DELETE FROM "CashShift" WHERE id='shift'`), (e: any) => e.code === '23503');
      await client.query(`UPDATE "${table}" SET "shiftId"=NULL`);
    }
    const closeSql = `UPDATE "CashShift" SET state='CLOSED',"closedById"='u',"closedAt"=(now() AT TIME ZONE 'UTC'),"closeKey"='close',"closeHash"='h',"paymentCount"=0,"refundCount"=0,"paidFen"=0,"refundFen"=0,"netFen"=0,"expectedFen"=0,"countedFen"=0,"differenceFen"=0 WHERE id='shift'`;
    await client.query(closeSql); await insert('second', 'second');
    await assert.rejects(client.query(`UPDATE "CashShift" SET "countedFen"=2000000001,"differenceFen"=2000000001,reason='large' WHERE id='shift'`), (e: any) => e.code === '23514');
    await assert.rejects(client.query(`UPDATE "CashShift" SET "differenceFen"=1,"countedFen"=1 WHERE id='shift'`), (e: any) => e.code === '23514');
    await assert.rejects(client.query(`UPDATE "CashShift" SET "differenceFen"=1,"countedFen"=1,reason='   ' WHERE id='shift'`), (e: any) => e.code === '23514');
    await assert.rejects(client.query(`UPDATE "CashShift" SET "paymentCount"=-1 WHERE id='shift'`), (e: any) => e.code === '23514');
    await assert.rejects(client.query(`UPDATE "CashShift" SET "createKey"='open' WHERE id='second'`), (e: any) => e.code === '23505');
    for (const sql of [`DELETE FROM "User" WHERE id='u'`, `DELETE FROM "Store" WHERE id='s'`]) await assert.rejects(client.query(sql), (e: any) => e.code === '23503');
    console.log('012 default UTC deltaSeconds=', row.seconds, '; nullable/FK RESTRICT/partial UNIQUE/state/range CHECK enforced');
  });} finally {await client.end();}
});

test('shift module rejects unsafe schema and wrong database before access', () => {
  for (const value of [undefined, 'postgresql://unused:unused@127.0.0.1:1/unused?schema=test_cash_shifts_safe', 'postgresql://restaurant_dev:x@127.0.0.1:55432/restaurant_dev?schema=development', 'postgresql://restaurant_dev:x@127.0.0.1:55432/restaurant_dev?schema=public']) {
    const env = {...process.env, TSX_TSCONFIG_PATH: resolve(__dirname, '../tsconfig.json')}; delete env.NODE_TEST_CONTEXT;
    if (value) env.DATABASE_URL = value; else delete env.DATABASE_URL;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'tests/cash-shifts.test.ts'], {cwd: resolve(__dirname, '..'), env, encoding: 'utf8', windowsHide: true});
    assert.equal(result.status, 1); assert.match(result.stdout + result.stderr, /Cash shifts tests require/); assert.doesNotMatch(result.stdout + result.stderr, /ECONNREFUSED|PrismaClientInitializationError/);
  }
  for (const schema of ['development', 'public', undefined, 'test_cash_shifts_bad";DROP SCHEMA public']) assert.throws(() => assertSchema(schema));
});

for (const nested of [false, true]) test('shift ' + (nested ? 'migration fixture' : 'runner') + ' CREATE collision preserves prior schema/OID/owner', async () => {
  const hex = randomBytes(6).toString('hex'), schema = 'test_cash_shifts_' + (nested ? 'migration_' : '') + hex, client = new pg.Client({connectionString: process.env.DATABASE_URL}); await client.connect();
  const dir = await mkdtemp(join(tmpdir(), 'drafts-'));
  try {await ownedSchema(client, schema, async () => {
    await client.query(`CREATE TABLE "${schema}".sentinel (value integer); INSERT INTO "${schema}".sentinel VALUES (42)`);
    const identity = (await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1', [schema])).rows[0], preload = join(dir, 'fixed.cjs');
    await writeFile(preload, `require('node:crypto').randomBytes=()=>Buffer.from('${hex}','hex');`);
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
    const args = nested ? ['--require', preload, '--import', 'tsx', '--test', '--test-name-pattern', '^012', 'apps/api/tests/cash-shifts.test.ts'] : ['--require', preload, 'apps/api/tests/run-cash-shifts.cjs'];
    const result = spawnSync(process.execPath, args, {cwd: resolve(__dirname, '../../..'), env, encoding: 'utf8', windowsHide: true});
    assert.equal(result.status, 1); assert.match(result.stdout + result.stderr, /already exists/); assert.equal((await client.query(`SELECT value FROM "${schema}".sentinel`)).rows[0].value, 42); assert.deepEqual((await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1', [schema])).rows[0], identity);
  });} finally {await client.end(); await rm(dir, {recursive: true, force: true});}
});
