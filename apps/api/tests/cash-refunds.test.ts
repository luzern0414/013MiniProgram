import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {seed} from '../prisma/seed';
import {cashDateRange, cashSummary} from '../src/modules/finance/cash-summary';
import {randomBytes, createHash} from 'node:crypto';
import {readFile, readdir, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
const {assertUrl, assertSchema, ownedSchema} = require('./cash-refunds-schema.cjs');
assertUrl(process.env.DATABASE_URL);
const build = process.env.CASH_REFUNDS_TEST_BUILD === 'true';
const {createApp} = build ? require('../dist/src/main') : require('../src/main');
const {OrderExpiryService} = build ? require('../dist/src/modules/orders/order-expiry.service') : require('../src/modules/orders/order-expiry.service');
const {AuthService} = build ? require('../dist/src/modules/auth/auth.service') : require('../src/modules/auth/auth.service');
const storeId = 'experience-store-a';

async function fixture(run: (ctx: any) => Promise<void>) {
  const db = new PrismaClient(); await seed(db);
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  app.get(OrderExpiryService).onModuleDestroy();
  try {
    const base = await app.getUrl() + '/api/v1';
    const req = async (path: string, token?: string, body?: any, method?: string, key?: string) => {
      const response = await fetch(base + path, {method: method || (body === undefined ? 'GET' : 'POST'), headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {}), ...(key === undefined ? {} : {'Idempotency-Key': key})}, body: body === undefined ? undefined : JSON.stringify(body)});
      const data = await response.json() as any; assert.ok(data.requestId);
      return {status: response.status, body: data};
    };
    const login = async (account: string) => (await req('/auth/dev-login', undefined, {account})).body.data.token;
    const owner = await login('owner'), customer = await login('customer'), clerk = await login('clerk-a');
    assert.equal((await req('/merchant/cash-shifts', owner, {storeId, openingFen: 0}, 'POST', 'refund-fixture-shift')).status, 201);
    let sequence = 0;
    const create = async (pickupSlotId?: string) => {
      const q = await req('/quotes', customer, {storeId, mode: 'PICKUP', lines: [{skuId: 'experience-a-chicken-sku-0', quantity: 1, modifierIds: ['experience-a-chicken-egg']}], ...(pickupSlotId ? {pickupSlotId} : {})}); assert.equal(q.status, 201);
      const result = await req('/orders', customer, {quoteId: q.body.data.id}, undefined, 'refund-order-' + Date.now() + '-' + ++sequence); assert.equal(result.status, 201);
      return result.body.data;
    };
    const pay = async (o: any) => {const result = await req('/merchant/orders/' + o.id + '/cash-payment', clerk, {tenderedFen: o.totalFen + 1000}); assert.equal(result.status, 201); return result.body.data;};
    const refund = (o: any, amountFen: any, key = 'refund-' + ++sequence, reason: any = '顾客已收到现金', token = owner, extra: any = {}) => req('/merchant/orders/' + o.id + '/cash-refunds', token, {storeId, amountFen, reason, ...extra}, undefined, key);
    await run({db, app, req, owner, customer, clerk, create, pay, refund});
  } finally {await app.close(); await db.$disconnect();}
}

test('HTTP partial cash refund creates a real receipt with integer remaining balance', async () => fixture(async ({create, pay, refund, db}: any) => {
  const o = await pay(await create());
  const result = await refund(o, 1000, 'partial-first');
  console.log('cash refund HTTP status=', result.status);
  assert.equal(result.status, 201);
  assert.equal(result.body.data.refundStatus, 'PARTIAL');
  assert.equal(result.body.data.refundedFen, 1000);
  assert.equal(result.body.data.netPaidFen, o.totalFen - 1000);
  assert.equal((await db.cashPayment.findUniqueOrThrow({where: {orderId: o.id}})).refundedFen, 1000);
  assert.ok(Math.abs(Date.parse(result.body.data.cashRefunds[0].createdAt) - Date.now()) < 10000, 'HTTP refund occurrence time must be UTC even in an Asia/Shanghai database session');
}));

test('HTTP partial then full refund preserves payment, snapshots, inventory and CONFIRMED pickup capacity', async () => fixture(async ({create, pay, refund, db, req, owner, clerk, customer}: any) => {
  const policy = (await req('/merchant/pickup-policy?storeId=' + storeId, owner)).body.data;
  assert.equal((await req('/merchant/pickup-policy', owner, {storeId, expectedRevision: policy.revision, enabled: true, leadMinutes: 15, maxAdvanceDays: 14}, 'PUT')).status, 200);
  const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const slots = await req('/merchant/pickup-slots', owner, {storeId, slots: [{startsAt: day + 'T12:00:00+08:00', endsAt: day + 'T12:30:00+08:00', capacity: 10}]}); assert.equal(slots.status, 201);
  const slotId = slots.body.data[0].id, unpaid = await create(slotId);
  assert.equal(unpaid.cashReceipt, null); assert.deepEqual(unpaid.cashRefunds, []); assert.equal(unpaid.refundedFen, 0); assert.equal(unpaid.netPaidFen, 0);
  const o = await pay(unpaid), original = await db.cashPayment.findUniqueOrThrow({where: {orderId: o.id}});
  assert.equal(o.cashReceipt.refundedFen, 0); assert.equal(o.netPaidFen, original.amountFen);
  const cancel = await req('/orders/' + o.id + '/cancel', customer, {}); assert.equal(cancel.body.error.code, 'REFUND_UNAVAILABLE'); assert.match(cancel.body.error.message, /联系门店/);
  const reject = await req('/merchant/orders/' + o.id + '/transition', clerk, {action: 'REJECT'}); assert.equal(reject.body.error.code, 'REFUND_UNAVAILABLE'); assert.match(reject.body.error.message, /店主/);
  const orderBefore = await db.order.findUniqueOrThrow({where: {id: o.id}}), eventsBefore = await db.orderEvent.findMany({where: {orderId: o.id}, orderBy: {id: 'asc'}});
  const inventory = () => Promise.all([db.sku.findMany({orderBy: {id: 'asc'}}), db.modifier.findMany({orderBy: {id: 'asc'}})]);
  const beforeInventory = await inventory(), beforeCapacity = await db.pickupSlot.findUniqueOrThrow({where: {id: slotId}}), beforeReservation = await db.pickupReservation.findUniqueOrThrow({where: {orderId: o.id}});
  const partial = await refund(o, 1000, 'lifecycle-partial', '  顾客退回一部分现金  '); assert.equal(partial.status, 201);
  assert.equal(partial.body.data.status, 'AWAITING_ACCEPTANCE'); assert.equal(partial.body.data.cashRefunds[0].reason, '顾客退回一部分现金');
  const counts = () => Promise.all([db.orderEvent.count({where: {orderId: o.id}}), db.audit.count({where: {entityId: o.id, action: 'CASH_REFUND'}})]);
  const afterPartialCounts = await counts();
  const replay = await refund(o, 1000, 'lifecycle-partial', '顾客退回一部分现金'); assert.equal(replay.status, 201); assert.deepEqual(replay.body.data.cashRefunds, partial.body.data.cashRefunds); assert.deepEqual(await counts(), afterPartialCounts);
  for (const [amount, reason] of [[1001, '顾客退回一部分现金'], [1000, '另一个原因']]) {const conflict = await refund(o, amount, 'lifecycle-partial', reason); assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');}
  const over = await refund(o, original.amountFen - 999); assert.equal(over.status, 409); assert.equal(over.body.error.code, 'REFUND_EXCEEDS_REMAINING');
  const full = await refund(o, original.amountFen - 1000, 'lifecycle-full'); assert.equal(full.status, 201);
  assert.equal(full.body.data.refundStatus, 'SUCCEEDED'); assert.equal(full.body.data.status, 'CANCELLED'); assert.equal(full.body.data.paymentStatus, 'PAID'); assert.equal(full.body.data.refundedFen, original.amountFen); assert.equal(full.body.data.netPaidFen, 0);
  assert.match(full.body.data.events.at(-1).label, /现金全额退款/);
  assert.equal((await db.cashRefund.aggregate({where: {paymentId: original.id}, _sum: {amountFen: true}}))._sum.amountFen, original.amountFen);
  const {refundedFen: _, ...unchanged} = await db.cashPayment.findUniqueOrThrow({where: {id: original.id}}), {refundedFen: __, ...originalFields} = original;
  assert.deepEqual(unchanged, originalFields, 'original amount/tendered/change/staff/time remain byte-identical');
  const {status, refundStatus, ...afterSnapshot} = await db.order.findUniqueOrThrow({where: {id: o.id}}), {status: oldStatus, refundStatus: oldRefund, ...beforeSnapshot} = orderBefore;
  assert.deepEqual(afterSnapshot, beforeSnapshot);
  assert.deepEqual(await db.orderEvent.findMany({where: {id: {in: eventsBefore.map((e: any) => e.id)}}, orderBy: {id: 'asc'}}), eventsBefore);
  assert.deepEqual(await inventory(), beforeInventory); assert.deepEqual(await db.pickupSlot.findUniqueOrThrow({where: {id: slotId}}), beforeCapacity); assert.deepEqual(await db.pickupReservation.findUniqueOrThrow({where: {orderId: o.id}}), beforeReservation); assert.equal(beforeReservation.state, 'CONFIRMED');
  for (const token of [customer, clerk, owner]) {
    const detail = await req('/orders/' + o.id, token); assert.equal(detail.status, 200); assert.deepEqual(detail.body.data.cashRefunds, full.body.data.cashRefunds); assert.equal(detail.body.data.refundedFen, original.amountFen); assert.equal(detail.body.data.cashReceipt.refundedFen, original.amountFen);
    assert.deepEqual(Object.keys(detail.body.data.cashRefunds[0]).sort(), ['amountFen', 'createdAt', 'id', 'reason', 'shiftId']);
    assert.deepEqual(Object.keys(detail.body.data.cashReceipt).sort(), ['amountFen', 'changeFen', 'refundedFen', 'shiftId', 'tenderedFen']);
    const list = await req('/orders?storeId=' + storeId + '&pageSize=100', token); assert.deepEqual(list.body.data.items.find((row: any) => row.id === o.id).cashRefunds, full.body.data.cashRefunds);
  }
  for (const action of ['ACCEPT', 'READY', 'COMPLETE']) assert.equal((await req('/merchant/orders/' + o.id + '/transition', clerk, {action})).status, 409);
  assert.equal((await req('/merchant/orders/' + o.id + '/pickup', clerk, {storeId, pickupNumber: o.pickupNumber})).status, 409);
  assert.equal((await req('/merchant/orders/' + o.id + '/cash-payment', clerk, {tenderedFen: o.totalFen})).status, 409);
  const countsBefore = await counts(); assert.equal((await refund(o, original.amountFen - 1000, 'lifecycle-full')).status, 201); assert.deepEqual(await counts(), countsBefore);
}));

test('HTTP completed orders preserve completion; competing keys cannot overdraw the last balance', async () => fixture(async ({create, pay, refund, db, req, clerk}: any) => {
  const o = await pay(await create());
  for (const action of ['ACCEPT', 'READY', 'COMPLETE']) assert.equal((await req('/merchant/orders/' + o.id + '/transition', clerk, {action})).status, 201);
  const completedEvents = await db.orderEvent.findMany({where: {orderId: o.id}, orderBy: {id: 'asc'}});
  const same = await Promise.all([refund(o, 1000, 'same-concurrent'), refund(o, 1000, 'same-concurrent')]); assert.deepEqual(same.map((r: any) => r.status), [201, 201]);
  assert.equal(same[0].body.data.cashRefunds[0].id, same[1].body.data.cashRefunds[0].id);
  const payment = await db.cashPayment.findUniqueOrThrow({where: {orderId: o.id}});
  assert.equal(await db.cashRefund.count({where: {paymentId: payment.id, idempotencyKey: 'same-concurrent'}}), 1);
  const lastBalanceRace = await Promise.all([refund(o, o.totalFen - 1000, 'last-a'), refund(o, o.totalFen - 1000, 'last-b')]); assert.deepEqual(lastBalanceRace.map((r: any) => r.status).sort(), [201, 409]);
  assert.equal(lastBalanceRace.find((r: any) => r.status === 409).body.error.code, 'REFUND_EXCEEDS_REMAINING');
  assert.equal((await db.cashRefund.aggregate({where: {paymentId: payment.id}, _sum: {amountFen: true}}))._sum.amountFen, o.totalFen);
  const current = (await req('/orders/' + o.id, clerk)).body.data; assert.equal(current.status, 'COMPLETED'); assert.equal(current.refundStatus, 'SUCCEEDED'); assert.equal(current.netPaidFen, 0);
  assert.equal(current.events.filter((e: any) => e.status === 'COMPLETED' && e.label === '订单已完成').length, 1);
  assert.deepEqual(await db.orderEvent.findMany({where: {id: {in: completedEvents.map((e: any) => e.id)}}, orderBy: {id: 'asc'}}), completedEvents);
  assert.equal(await db.audit.count({where: {entityId: o.id, action: 'CASH_REFUND'}}), 2);
  assert.equal(await db.orderEvent.count({where: {orderId: o.id}}), completedEvents.length + 2);
  await db.cashRefund.updateMany({where: {paymentId: payment.id}, data: {createdAt: new Date('2026-10-20T03:00:00Z')}});
  const ordered = (await req('/orders/' + o.id, clerk)).body.data.cashRefunds;
  assert.deepEqual(ordered.map((r: any) => r.id), ordered.map((r: any) => r.id).sort(), 'equal timestamps use stable id order');
  const other = await pay(await create()); assert.equal((await refund(other, 100, 'same-concurrent')).status, 201, 'idempotency scope is each original cash payment');
}));

test('HTTP rejects invalid input and unavailable payments, and rechecks current OWNER, store and brand before replay', async () => fixture(async ({create, pay, refund, db, req, owner, clerk, customer}: any) => {
  const unpaid = await create(), o = await pay(await create());
  const unavailable = await refund(unpaid, 1); assert.equal(unavailable.status, 409); assert.equal(unavailable.body.error.code, 'CASH_REFUND_UNAVAILABLE');
  await db.order.update({where: {id: unpaid.id}, data: {paymentStatus: 'PAID', status: 'AWAITING_ACCEPTANCE'}});
  const noncash = await refund(unpaid, 1); assert.equal(noncash.status, 409); assert.equal(noncash.body.error.code, 'CASH_REFUND_UNAVAILABLE');
  for (const value of [0, -1, 1.5, '100', null, true, 2_000_000_001, Number.MAX_SAFE_INTEGER]) assert.equal((await refund(o, value)).status, 400);
  for (const reason of ['', '   ', null, 1, 'a'.repeat(501)]) assert.equal((await refund(o, 1, 'bad-reason', reason)).status, 400);
  for (const extra of [{paymentId: 'foreign'}, {refundStatus: 'SUCCEEDED'}, {refundedFen: 100}, {staffId: 'someone'}, {unknown: true}, {storeId: ['experience-store-a']}]) assert.equal((await refund(o, 1, 'bad-extra', 'reason', owner, extra)).status, 400);
  for (const key of [undefined, '', 'a'.repeat(121)]) {const result = await req('/merchant/orders/' + o.id + '/cash-refunds', owner, {storeId, amountFen: 1, reason: 'reason'}, 'POST', key); assert.equal(result.status, 400);}
  for (const token of [customer, clerk]) assert.equal((await refund(o, 1, 'forbidden', 'reason', token)).status, 403);
  assert.equal((await refund(o, 1, 'cross-store', 'reason', owner, {storeId: 'experience-store-b'})).status, 403);
  await db.brand.upsert({where: {id: 'refund-other-brand'}, update: {}, create: {id: 'refund-other-brand', name: 'isolated other brand'}});
  await db.store.create({data: {id: 'refund-other-store', brandId: 'refund-other-brand', name: 'private', address: '', phone: ''}});
  const foreign = await db.user.create({data: {brandId: 'refund-other-brand', name: 'other owner', role: 'OWNER', staff: {create: {storeId: 'refund-other-store'}}}});
  const foreignToken = 'f'.repeat(43); await db.session.create({data: {userId: foreign.id, tokenHash: createHash('sha256').update(foreignToken).digest('hex'), expiresAt: new Date(Date.now() + 60000)}});
  assert.equal((await refund(o, 1, 'cross-brand', 'reason', foreignToken)).status, 403);
  await db.staffStore.create({data: {userId: foreign.id, storeId}}); // corrupt cross-brand membership cannot grant access
  assert.equal((await refund(o, 1, 'cross-brand-member', 'reason', foreignToken)).status, 403);
  const before = await db.cashPayment.findUniqueOrThrow({where: {orderId: o.id}}); assert.equal(before.refundedFen, 0); assert.equal(await db.cashRefund.count({where: {paymentId: before.id}}), 0);
  assert.equal((await refund(o, 1, 'revoke-key')).status, 201);
  await db.staffStore.delete({where: {userId_storeId: {userId: 'experience-user-owner', storeId}}});
  assert.equal((await refund(o, 1, 'revoke-key')).status, 403);
  await db.staffStore.create({data: {userId: 'experience-user-owner', storeId}});
  await db.user.update({where: {id: 'experience-user-owner'}, data: {role: 'CLERK'}}); assert.equal((await refund(o, 1, 'revoke-key')).status, 403);
  await db.user.update({where: {id: 'experience-user-owner'}, data: {role: 'OWNER', enabled: false}}); assert.equal((await refund(o, 1, 'revoke-key')).status, 401);
  await db.user.update({where: {id: 'experience-user-owner'}, data: {enabled: true}});
  const otherCustomer = await db.user.create({data: {brandId: 'experience-brand', name: 'other customer', role: 'CUSTOMER'}}), otherToken = 'c'.repeat(43);
  await db.session.create({data: {userId: otherCustomer.id, tokenHash: createHash('sha256').update(otherToken).digest('hex'), expiresAt: new Date(Date.now() + 60000)}});
  assert.equal((await req('/orders/' + o.id, otherToken)).status, 403); assert.equal((await req('/orders/' + o.id, foreignToken)).status, 403);
  assert.equal(await db.cashRefund.count({where: {paymentId: before.id}}), 1); assert.equal(await db.audit.count({where: {entityId: o.id, action: 'CASH_REFUND'}}), 1);
}));

test('HTTP overview uses cash and refund occurrence dates with Shanghai half-open boundaries and negative net', async () => fixture(async ({create, pay, refund, db, req, owner}: any) => {
  const o = await pay(await create()), now = new Date(), shifted = new Date(now.getTime() + 8 * 3600000);
  const start = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 8 * 3600000), end = new Date(start.getTime() + 86400000), yesterday = new Date(start.getTime() - 1000);
  await db.cashPayment.updateMany({data: {createdAt: yesterday}}); await db.cashRefund.updateMany({data: {createdAt: yesterday}});
  await db.order.update({where: {id: o.id}, data: {createdAt: new Date(start.getTime() - 3 * 86400000)}});
  const yesterdayDate = new Date(start.getTime() - 1).toISOString().slice(0, 10), yesterdayBefore = await cashSummary(db, storeId, cashDateRange(yesterdayDate));
  const dates = [new Date(start.getTime() - 1), start, new Date(end.getTime() - 1), end];
  for (const [index, date] of dates.entries()) {
    const result = await refund(o, (index + 1) * 100, 'boundary-' + index); assert.equal(result.status, 201);
    const receipt = await db.cashRefund.findUniqueOrThrow({where: {paymentId_idempotencyKey: {paymentId: (await db.cashPayment.findUniqueOrThrow({where: {orderId: o.id}})).id, idempotencyKey: 'boundary-' + index}}});
    await db.cashRefund.update({where: {id: receipt.id}, data: {createdAt: date}});
  }
  const result = await req('/merchant/overview?storeId=' + storeId, owner); assert.equal(result.status, 200); assert.equal(result.body.data.paidRevenueFen, 0); assert.equal(result.body.data.refundFen, 500); assert.equal(result.body.data.netRevenueFen, -500);
  const original = await db.cashPayment.findUniqueOrThrow({where: {orderId: o.id}}); assert.equal(original.amountFen, o.totalFen); assert.equal(original.createdAt.toISOString(), yesterday.toISOString());
  assert.equal((await cashSummary(db, storeId, cashDateRange(yesterdayDate))).paidRevenueFen, yesterdayBefore.paidRevenueFen, 'today returns never rewrite yesterday income');
  const detail = (await req('/orders/' + o.id, owner)).body.data; assert.deepEqual(detail.cashRefunds.map((r: any) => r.amountFen), [100, 200, 300, 400]); assert.equal(detail.refundedFen, 1000);
}));

test('HTTP revalidates authorization inside the transaction and rolls back all ledger writes on audit failure', async () => fixture(async ({app, create, pay, refund, db}: any) => {
  const o = await pay(await create()), auth = app.get(AuthService), originalStaff = auth.staff.bind(auth);
  let first = true;
  auth.staff = async (...args: any[]) => {
    const user = await originalStaff(...args);
    if (first) {first = false; await db.staffStore.delete({where: {userId_storeId: {userId: 'experience-user-owner', storeId}}});}
    return user;
  };
  try {assert.equal((await refund(o, 100, 'inside-auth')).status, 403);} finally {auth.staff = originalStaff; await db.staffStore.create({data: {userId: 'experience-user-owner', storeId}});}
  const schema = assertUrl(process.env.DATABASE_URL), client = new pg.Client({connectionString: process.env.DATABASE_URL}); await client.connect();
  const snapshot = () => Promise.all([db.cashPayment.findUniqueOrThrow({where: {orderId: o.id}}), db.order.findUniqueOrThrow({where: {id: o.id}}), db.cashRefund.findMany({where: {payment: {orderId: o.id}}}), db.orderEvent.findMany({where: {orderId: o.id}, orderBy: {id: 'asc'}}), db.audit.findMany({where: {entityId: o.id}, orderBy: {id: 'asc'}})]);
  const before = await snapshot();
  let functionCreated = false, triggerCreated = false, identity: any, triggerIdentity: any;
  try {
    await client.query(`CREATE FUNCTION "${schema}".reject_refund_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='CASH_REFUND' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$`);
    functionCreated = true;
    const routineIdentity = async () => (await client.query('SELECT p.oid,p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname=\'reject_refund_audit\'', [schema])).rows[0];
    identity = await routineIdentity();
    await client.query(`CREATE TRIGGER reject_refund_audit BEFORE INSERT ON "${schema}"."Audit" FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_refund_audit()`);
    triggerCreated = true;
    triggerIdentity = (await client.query('SELECT t.oid,t.tgfoid FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=\'Audit\' AND t.tgname=\'reject_refund_audit\'', [schema])).rows[0];
    const result = await refund(o, 100, 'audit-rollback'); assert.equal(result.status, 500); assert.equal(result.body.error.code, 'INTERNAL_ERROR'); assert.deepEqual(await snapshot(), before);
  } finally {
    try {
      if (functionCreated) {
        const current = (await client.query('SELECT p.oid,p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.proname=\'reject_refund_audit\'', [schema])).rows[0];
        assert.deepEqual(current, identity, 'only this fixture may clean its function and dependent trigger');
        if (triggerCreated) {
          const currentTrigger = (await client.query('SELECT t.oid,t.tgfoid FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=\'Audit\' AND t.tgname=\'reject_refund_audit\'', [schema])).rows[0];
          assert.deepEqual(currentTrigger, triggerIdentity);
          await client.query(`DROP TRIGGER reject_refund_audit ON "${schema}"."Audit"`);
        }
        await client.query(`DROP FUNCTION "${schema}".reject_refund_audit()`);
      }
    } finally {await client.end();}
  }
  const retry = await refund(o, 100, 'audit-rollback'); assert.equal(retry.status, 201); assert.equal(retry.body.data.refundedFen, 100);
}));

test('010 migration preserves every old column/row and adds default, positive, bounds and RESTRICT constraints', async () => {
  const client = new pg.Client({connectionString: process.env.DATABASE_URL}); await client.connect();
  try {await ownedSchema(client, 'test_cash_refunds_migration_' + randomBytes(6).toString('hex'), async (schema: string) => {
    await client.query(`SET search_path TO "${schema}"`);
    const root = resolve(__dirname, '../prisma/migrations');
    for (const name of (await readdir(root)).filter(x => /^20261020000[1-9]_/.test(x)).sort()) await client.query(await readFile(join(root, name, 'migration.sql'), 'utf8'));
    await client.query(`INSERT INTO "Brand" (id,name) VALUES ('b','b'); INSERT INTO "Store" (id,"brandId",name,address,phone) VALUES ('s','b','s','',''); INSERT INTO "User" (id,"brandId",name,role) VALUES ('u','b','u','CUSTOMER'); INSERT INTO "Quote" (id,"userId","storeId",snapshot,"expiresAt") VALUES ('q','u','s','{}',now()+interval '1 day'); INSERT INTO "Order" (id,number,"userId","storeId","quoteId","idempotencyKey","requestHash",mode,"subtotalFen","deliveryFeeFen","packagingFeeFen","discountFen","totalFen","storeName",lines) VALUES ('o','o','u','s','q','k','h','PICKUP',100,0,0,0,100,'s','[]'); INSERT INTO "CashPayment" (id,"orderId","staffId","amountFen","tenderedFen","changeFen") VALUES ('p','o','u',100,120,20)`);
    await client.query(`INSERT INTO "Category" (id,"brandId",name) VALUES ('c','b','old category'); INSERT INTO "Product" (id,"storeId","categoryId",name) VALUES ('product','s','c','old product'); INSERT INTO "Sku" (id,"productId",name,"priceFen",stock,reserved) VALUES ('sku','product','old sku',100,7,2); INSERT INTO "Modifier" (id,"productId",name,"priceFen",stock,reserved) VALUES ('modifier','product','old modifier',10,5,1); INSERT INTO "Session" (id,"tokenHash","userId","expiresAt") VALUES ('session','fixture-session-hash','u',now()+interval '1 day'); UPDATE "Order" SET status='AWAITING_ACCEPTANCE',"paymentStatus"='PAID' WHERE id='o'; INSERT INTO "OrderEvent" (id,"orderId",status,label) VALUES ('old-event','o','AWAITING_ACCEPTANCE','old cash event')`);
    const tables = (await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name', [schema])).rows;
    const columns = new Map<string, string[]>();
    for (const {table_name} of tables) columns.set(table_name, (await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position', [schema, table_name])).rows.map((r: any) => r.column_name));
    const snapshot = async () => {const rows: any = {}; for (const [table, names] of columns) rows[table] = (await client.query(`SELECT row_to_json(t)::text AS row FROM (SELECT ${names.map(n => '"' + n + '"').join(',')} FROM "${table}") t ORDER BY row_to_json(t)::text`)).rows; return JSON.stringify(rows);};
    const before = await snapshot(); await client.query(await readFile(join(root, '202610200010_cash_refunds/migration.sql'), 'utf8')); assert.equal(await snapshot(), before); console.log('010 old-column SHA256 unchanged:', createHash('sha256').update(before).digest('hex'));
    assert.equal((await client.query('SELECT "refundedFen" FROM "CashPayment" WHERE id=\'p\'')).rows[0].refundedFen, 0);
    for (const value of [-1, 101]) await assert.rejects(client.query('UPDATE "CashPayment" SET "refundedFen"=$1 WHERE id=\'p\'', [value]), (e: any) => e.code === '23514');
    const insert = (id: string, amount: number, key: string) => client.query('INSERT INTO "CashRefund" (id,"paymentId","staffId","amountFen",reason,"idempotencyKey","requestHash") VALUES ($1,\'p\',\'u\',$2,\'reason\',$3,\'hash\')', [id, amount, key]);
    for (const value of [-1, 0]) await assert.rejects(insert('invalid', value, 'invalid'), (e: any) => e.code === '23514');
    await client.query("SET TIME ZONE 'Asia/Shanghai'");
    await insert('r', 100, 'same'); await assert.rejects(insert('r2', 1, 'same'), (e: any) => e.code === '23505');
    const utcDelta = (await client.query(`SELECT EXTRACT(EPOCH FROM ("createdAt"-(now() AT TIME ZONE 'UTC')))::int AS seconds FROM "CashRefund" WHERE id='r'`)).rows[0].seconds;
    console.log('Direct SQL refund default UTC deltaSeconds=', utcDelta); assert.ok(Math.abs(utcDelta) < 10, 'direct SQL refund timestamp must use UTC under a Shanghai session');
    await client.query("SET TIME ZONE 'UTC'"); await insert('r-utc', 1, 'utc');
    assert.ok(Math.abs((await client.query(`SELECT EXTRACT(EPOCH FROM ("createdAt"-(now() AT TIME ZONE 'UTC')))::int AS seconds FROM "CashRefund" WHERE id='r-utc'`)).rows[0].seconds) < 10);
    await client.query(`UPDATE "Order" SET status='AWAITING_ACCEPTANCE',"paymentStatus"='PAID',"refundStatus"='PARTIAL' WHERE id='o'`);
    await assert.rejects(client.query(`UPDATE "Order" SET status='CANCELLED' WHERE id='o'`), (e: any) => e.code === '23514');
    await client.query(`UPDATE "Order" SET status='CANCELLED',"refundStatus"='SUCCEEDED' WHERE id='o'`);
    await assert.rejects(client.query('DELETE FROM "CashPayment" WHERE id=\'p\''), (e: any) => e.code === '23503');
    console.log('010 old-column snapshot unchanged; refundedFen default=0; CHECK/UNIQUE/RESTRICT enforced');
  });} finally {await client.end();}
});

test('refund test module rejects unsafe schemas before database access', () => {
  for (const schema of ['development', 'public', undefined]) {
    const env = {...process.env, TSX_TSCONFIG_PATH: resolve(__dirname, '../tsconfig.json')}; delete env.NODE_TEST_CONTEXT;
    if (schema) env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused?schema=' + schema; else delete env.DATABASE_URL;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'tests/cash-refunds.test.ts'], {cwd: resolve(__dirname, '..'), env, encoding: 'utf8', windowsHide: true});
    assert.equal(result.status, 1); assert.match(result.stdout + result.stderr, /Cash refunds tests require an isolated/); assert.doesNotMatch(result.stdout + result.stderr, /ECONNREFUSED|PrismaClientInitializationError/);
  }
  for (const schema of ['development', 'public', undefined, 'test_cash_refunds_bad";DROP SCHEMA public']) assert.throws(() => assertSchema(schema));
});

for (const nested of [false, true]) test('cash refund ' + (nested ? 'nested fixture' : 'runner') + ' preserves an existing schema after CREATE collision', async () => {
  const hex = randomBytes(6).toString('hex'), schema = 'test_cash_refunds_' + (nested ? 'migration_' : '') + hex, client = new pg.Client({connectionString: process.env.DATABASE_URL}); await client.connect();
  const dir = await mkdtemp(join(tmpdir(), 'refunds-'));
  try {await ownedSchema(client, schema, async () => {
    await client.query(`CREATE TABLE "${schema}".sentinel (value integer); INSERT INTO "${schema}".sentinel VALUES (42)`);
    const identity = (await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1', [schema])).rows[0], preload = join(dir, 'fixed.cjs');
    await writeFile(preload, `require('node:crypto').randomBytes=()=>Buffer.from('${hex}','hex');`);
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
    const args = nested ? ['--require', preload, '--import', 'tsx', '--test', '--test-name-pattern', '^010', 'apps/api/tests/cash-refunds.test.ts'] : ['--require', preload, 'apps/api/tests/cash-refunds-runner.cjs'];
    const result = spawnSync(process.execPath, args, {cwd: resolve(__dirname, '../../..'), env, encoding: 'utf8', windowsHide: true});
    assert.equal(result.status, 1); assert.match(result.stdout + result.stderr, /already exists/); assert.equal((await client.query(`SELECT value FROM "${schema}".sentinel`)).rows[0].value, 42); assert.deepEqual((await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1', [schema])).rows[0], identity);
  });} finally {await client.end(); await rm(dir, {recursive: true, force: true});}
});
