import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { assertProjectDatabase } from '../../scripts/db.mjs';
import { backupDatabase, restoreBackup, localConnection, assertToolVersion, assertPrivatePath } from '../../scripts/backup.mjs';

const root = resolve('.');
const qi = value => '"' + value.replaceAll('"', '""') + '"';
const random = () => randomBytes(16).toString('hex');

for (const operation of ['backup', 'restore']) {
  test(`production rejects local ${operation} without output or connecting`, () => {
    const result = spawnSync(process.execPath, ['scripts/backup.mjs', operation, 'unused.dump'], {encoding: 'utf8', env: {...process.env, NODE_ENV: 'production'}});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /local development/i);
    assert.equal(result.stdout, '');
  });
}
test('tool major is checked strictly', () => {
  assert.equal(assertToolVersion('pg_dump (PostgreSQL) 16.15'), '16.15');
  assert.throws(() => assertToolVersion('pg_dump (PostgreSQL) 17.1'), /PostgreSQL 16/);
  assert.throws(() => assertToolVersion('anything 16.15'), /PostgreSQL 16/);
});

test('real owned PG16 snapshot backup and isolated restore', {timeout: 180000}, async t => {
  const connection = localConnection();
  const source = 'test_backup_' + random();
  const admin = new pg.Client({...connection, database: 'postgres'});
  await admin.connect();
  await assertProjectDatabase(admin);
  const sourceMarker = `restaurant-backup-test:${root}:${source}`;
  await admin.query(`CREATE DATABASE ${qi(source)} TEMPLATE template0`);
  await admin.query(`COMMENT ON DATABASE ${qi(source)} IS '${sourceMarker.replaceAll("'", "''")}'`);
  const c = new pg.Client({...connection, database: source});
  await c.connect();
  const artifacts = [], restored = [];
  t.after(async () => {
    await c.end();
    for (const name of [...restored, source]) {
      const found = await admin.query('SELECT shobj_description(oid, $2) AS marker FROM pg_database WHERE datname=$1', [name, 'pg_database']);
      if (found.rows[0]?.marker?.startsWith('restaurant-backup-')) await admin.query(`DROP DATABASE ${qi(name)} WITH (FORCE)`);
    }
    await admin.end();
    for (const directory of artifacts) await rm(directory, {recursive: true, force: true});
  });
  const migrations = (await readdir(join(root, 'apps/api/prisma/migrations'))).filter(name => /^\d/.test(name)).sort();
  for (const schema of ['public', 'development']) {
    if (schema !== 'public') await c.query(`CREATE SCHEMA ${qi(schema)}`);
    await c.query(`SET search_path TO ${qi(schema)}`);
    for (const migration of migrations) await c.query(await readFile(join(root, 'apps/api/prisma/migrations', migration, 'migration.sql'), 'utf8'));
    await c.query(`
      INSERT INTO "Brand" (id,name) VALUES ('b','Isolated backup test');
      INSERT INTO "Store" (id,"brandId",name,address,phone) VALUES ('s','b','Test store','Test','0');
      INSERT INTO "User" (id,"brandId",name,role) VALUES ('u','b','Test owner','OWNER');
      INSERT INTO "Session" (id,"tokenHash","userId","expiresAt","createdAt") VALUES ('session','isolated-test-session','u',now()+interval '1 hour',now());
      INSERT INTO "Category" (id,"brandId",name,sort) VALUES ('cat','b','Test',0);
      INSERT INTO "Product" (id,"storeId","categoryId",name) VALUES ('p','s','cat','Test product');
      INSERT INTO "Sku" (id,"productId",name,"priceFen",stock,reserved) VALUES ('sku','p','Test',1234,17,2);
      INSERT INTO "Page" ("storeId",draft,published,version) VALUES ('s','{"test":"draft"}','{"test":"published"}',3);
      INSERT INTO "Quote" (id,"userId","storeId",snapshot,"expiresAt","createdAt") VALUES ('q','u','s','{"items":["test"]}',now()+interval '1 hour',now());
      INSERT INTO "Order" (id,number,"userId","storeId","quoteId","idempotencyKey","requestHash",mode,status,"paymentStatus","subtotalFen","deliveryFeeFen","packagingFeeFen","discountFen","totalFen","storeName",lines,"createdAt")
        VALUES ('o','test-order','u','s','q','test-key','test-request','PICKUP','COMPLETED','PAID',1234,0,0,0,1234,'Test store','[{"skuId":"sku","quantity":1}]',now());
      INSERT INTO "CashPayment" (id,"orderId","staffId","amountFen","tenderedFen","changeFen","createdAt") VALUES ('cash','o','u',1234,2000,766,now());
      INSERT INTO "OrderEvent" (id,"orderId",status,label,"createdAt") VALUES ('event','o','COMPLETED','Test',now());
    `);
  }
  const beforeReal = new pg.Client(connection);
  await beforeReal.connect();
  const rootBefore = await beforeReal.query(`SELECT (SELECT count(*) FROM development."Order")::text AS development_orders,(SELECT count(*) FROM public."Order")::text AS public_orders`);
  await beforeReal.end();

  await t.test('source ownership mismatch is refused', async () => {
    await admin.query(`COMMENT ON DATABASE ${qi(source)} IS 'foreign'`);
    await assert.rejects(backupDatabase({sourceDatabase: source}), /ownership/i);
    await admin.query(`COMMENT ON DATABASE ${qi(source)} IS '${sourceMarker.replaceAll("'", "''")}'`);
  });
  let backup;
  await t.test('dump and summary share exported snapshot during concurrent source writes', async () => {
    backup = await backupDatabase({sourceDatabase: source, afterSnapshot: async () => {
      await c.query('UPDATE development."Sku" SET stock=stock+1 WHERE id=$1', ['sku']);
    }});
    artifacts.push(dirname(backup.archive));
    await assertPrivatePath(backup.archive);
    const manifest = JSON.parse(await readFile(backup.manifest, 'utf8'));
    assert.equal(manifest.summary.schemas.development.inventory.sku[0].stock, 17);
    assert.equal(manifest.summary.schemas.development.cash.amountFen, '1234');
    assert.equal(manifest.summary.schemas.public.counts.Session, '1');
    assert.equal(manifest.sha256, createHash('sha256').update(await readFile(backup.archive)).digest('hex'));
    assert.match(manifest.snapshot, /^[A-F0-9]+-[A-F0-9]+-\d+$/);
    assert.ok(!(await readdir(dirname(backup.archive))).some(file => /pass|partial/.test(file)));
    assert.ok(!JSON.stringify(manifest).includes('isolated-test-session'));
  });
  await t.test('restore compares cash, inventory, CMS, snapshots and constraints then revokes restored sessions only', async () => {
    assert.ok(backup, 'backup must succeed');
    const result = await restoreBackup(backup.archive);
    restored.push(result.database);
    assert.match(result.database, /^restore_[a-f0-9]{32}$/);
    assert.equal(result.revokedSessions, 2);
    const target = new pg.Client({...connection, database: result.database});
    await target.connect();
    try {
      assert.equal((await target.query('SELECT stock FROM development."Sku"')).rows[0].stock, 17);
      assert.equal((await target.query('SELECT count(*)::int AS n FROM public."Session"')).rows[0].n, 0);
      assert.equal((await target.query('SELECT published FROM development."Page"')).rows[0].published.test, 'published');
      await assert.rejects(target.query('UPDATE development."Sku" SET stock=-1'), /constraint/i);
    } finally { await target.end(); }
    assert.equal((await c.query('SELECT count(*)::int AS n FROM development."Session"')).rows[0].n, 1);
  });
  await t.test('checksum tampering is rejected before a database is created', async () => {
    const before = await admin.query("SELECT datname FROM pg_database WHERE datname LIKE 'restore_%' ORDER BY datname");
    const archive = await readFile(backup.archive);
    await writeFile(backup.archive, Buffer.concat([archive, Buffer.from('tampered')]));
    await assert.rejects(restoreBackup(backup.archive), /checksum/i);
    await writeFile(backup.archive, archive);
    assert.deepEqual((await admin.query("SELECT datname FROM pg_database WHERE datname LIKE 'restore_%' ORDER BY datname")).rows, before.rows);
  });
  await t.test('random target collision never overwrites or deletes existing database', async () => {
    const name = restored[0];
    await assert.rejects(restoreBackup(backup.archive, {nameGenerator: () => name}), /already exists/i);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1', [name])).rows[0].n, 1);
  });
  await t.test('restore failure removes only this newly created owned target', async () => {
    const name = 'restore_' + random();
    await assert.rejects(restoreBackup(backup.archive, {nameGenerator: () => name, beforeRestore: async target => {
      await target.query('CREATE TABLE public."Brand" (id text)');
    }}), /restore failed/i);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1', [name])).rows[0].n, 0);
    assert.equal((await c.query('SELECT stock FROM development."Sku"')).rows[0].stock, 18);
  });
  await t.test('restore failure retains a target whose ownership marker changed and records a safe error', async () => {
    const name = 'restore_' + random();
    restored.push(name);
    await assert.rejects(restoreBackup(backup.archive, {nameGenerator: () => name, beforeRestore: async target => {
      await target.query(`COMMENT ON DATABASE ${qi(name)} IS 'restaurant-backup-test:changed-marker'`);
      await target.query('CREATE TABLE public."Brand" (id text)');
    }}), /retained for manual inspection/i);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1', [name])).rows[0].n, 1);
    const error = JSON.parse(await readFile(join(dirname(backup.archive), 'restore-' + name + '.failed.json'), 'utf8'));
    assert.equal(error.retained, true);
    assert.equal(error.reason, 'ownership_not_confirmed');
  });
  const verifyRoot = new pg.Client(connection);
  await verifyRoot.connect();
  try {
    assert.deepEqual((await verifyRoot.query(`SELECT (SELECT count(*) FROM development."Order")::text AS development_orders,(SELECT count(*) FROM public."Order")::text AS public_orders`)).rows, rootBefore.rows);
  } finally { await verifyRoot.end(); }
});
