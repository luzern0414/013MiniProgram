import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { assertProjectDatabase } from '../../scripts/db.mjs';
import { backupDatabase, restoreBackup, localConnection } from '../../scripts/backup.mjs';

const root = resolve('.');
const qi = value => '"' + value.replaceAll('"', '""') + '"';
const random = () => randomBytes(16).toString('hex');

test('PG16 restore accepts legacy nested AND CHECK without weakening summary validation', {timeout: 180000}, async t => {
  const connection = localConnection();
  const source = 'test_backup_' + random();
  const marker = `restaurant-backup-test:${root}:${source}`;
  const admin = new pg.Client({...connection, database: 'postgres'});
  await admin.connect();
  await assertProjectDatabase(admin);
  const channel = 'backup_check_' + random();
  const notifications = [];
  admin.on('notification', message => { if (message.channel === channel) notifications.push(message.payload); });
  await admin.query(`LISTEN ${qi(channel)}`);
  const owned = [];
  let c;
  async function remember(name, expectedMarker) {
    const row = (await admin.query("SELECT oid::text,pg_get_userbyid(datdba)=current_user AS owned,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1", [name])).rows[0];
    assert.equal(row.owned, true);
    if (expectedMarker) assert.equal(row.marker, expectedMarker);
    else assert.ok(row.marker.startsWith(`restaurant-backup-restore:${root}:`));
    owned.push({name, ...row});
  }
  t.after(async () => {
    if (c) await c.end();
    for (const target of owned.reverse()) {
      const row = (await admin.query("SELECT oid::text,pg_get_userbyid(datdba)=current_user AS owned,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1", [target.name])).rows[0];
      if (row?.owned && row.oid === target.oid && row.marker === target.marker) await admin.query(`DROP DATABASE ${qi(target.name)} WITH (FORCE)`);
    }
    await admin.end();
  });
  // Register only after CREATE succeeds; a collision is never adopted or removed.
  await admin.query(`CREATE DATABASE ${qi(source)} TEMPLATE template0`);
  await admin.query(`COMMENT ON DATABASE ${qi(source)} IS '${marker.replaceAll("'", "''")}'`);
  await remember(source, marker);
  c = new pg.Client({...connection, database: source});
  await c.connect();
  for (const character of ['\u00a0', '\u2003', '\ufeff']) {
    const changedColumn = 'sort' + character;
    const result = await c.query(`SELECT sort >= 0 AS original, ${changedColumn} >= 0 AS changed FROM (SELECT 1 AS sort, -1 AS ${qi(changedColumn)}) t`);
    assert.deepEqual(result.rows, [{original: true, changed: false}], 'PostgreSQL treats Unicode whitespace as part of an identifier');
  }
  await c.query(`CREATE SCHEMA development;
    CREATE TABLE development."ProductAttributeGroup" (
      sort integer, "minSelections" integer, "maxSelections" integer,
      CONSTRAINT "ProductAttributeGroup_bounds_valid" CHECK (
        (sort BETWEEN 0 AND 100000 AND "minSelections" >= 0
          AND "maxSelections" >= "minSelections" AND "maxSelections" <= 10)),
      CONSTRAINT zz_backup_unique UNIQUE (sort));
    INSERT INTO development."ProductAttributeGroup" VALUES (0,0,1);`);
  const backup = await backupDatabase({sourceDatabase: source});
  const original = await readFile(backup.manifest, 'utf8');
  const manifest = JSON.parse(original);
  const definition = manifest.summary.constraints[0].definition;
  assert.equal(manifest.format, 1);
  assert.equal(definition, 'CHECK ((((sort >= 0) AND (sort <= 100000)) AND ("minSelections" >= 0) AND ("maxSelections" >= "minSelections") AND ("maxSelections" <= 10)))');
  console.log('Legacy CHECK archive: ' + backup.archive);
  const restored = await restoreBackup(backup.archive);
  await remember(restored.database);
  console.log('Validated legacy CHECK restore: ' + restored.database);
  assert.equal(await readFile(backup.manifest, 'utf8'), original, 'successful restore must not rewrite legacy manifest');
  const target = new pg.Client({...connection, database: restored.database});
  await target.connect();
  try {
    const actual = (await target.query('SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname=$1', ['ProductAttributeGroup_bounds_valid'])).rows[0].definition;
    assert.equal(actual, 'CHECK (((sort >= 0) AND (sort <= 100000) AND ("minSelections" >= 0) AND ("maxSelections" >= "minSelections") AND ("maxSelections" <= 10)))');
    console.log('CHECK before dump: ' + definition);
    console.log('CHECK after restore: ' + actual);
  } finally { await target.end(); }

  for (const [label, mutate] of [
    ['OR instead of AND', m => { m.summary.constraints[0].definition = definition.replace('AND', 'OR'); }],
    ['NOT changes truth', m => { m.summary.constraints[0].definition = definition.replace('CHECK (', 'CHECK (NOT '); }],
    ['comparison operator', m => { m.summary.constraints[0].definition = definition.replace('>= 0', '> 0'); }],
    ['comparison value', m => { m.summary.constraints[0].definition = definition.replace('100000', '100001'); }],
    ['comparison column', m => { m.summary.constraints[0].definition = definition.replace('sort', '"minSelections"'); }],
    ...['\u00a0', '\u2003', '\ufeff'].map(character => [`Unicode identifier U+${character.codePointAt(0).toString(16)}`, m => { m.summary.constraints[0].definition = definition.replace('sort', 'sort' + character); }]),
    ['changed boolean grouping', m => { m.summary.constraints[0].definition = 'CHECK (((sort >= 0) OR ((sort <= 100000) AND ("minSelections" >= 0))) )'; }],
    ['DDL injection', m => { m.summary.constraints[0].definition = definition + `; CREATE TABLE public.backup_injected(id int); SELECT pg_notify('${channel}','executed'); --`; }],
    ['expression injection', m => { m.summary.constraints[0].definition = `CHECK ((pg_notify('${channel}','executed') IS NULL))`; }],
    ...['schema', 'table', 'name', 'type', 'validated'].map(key => [`constraint ${key}`, m => { m.summary.constraints[0][key] = key === 'validated' ? false : 'different'; }]),
    ['missing constraint', m => { m.summary.constraints = []; }],
    ['non-CHECK definition', m => { m.summary.constraints[1].definition = 'UNIQUE ("minSelections")'; }],
    ['row count', m => { m.summary.schemas.development.counts.ProductAttributeGroup = '2'; }],
    ...['cash', 'inventory', 'fingerprints'].map(key => [`summary ${key}`, m => { m.summary.schemas.development[key] = {changed: true}; }]),
  ]) {
    await t.test('rejects ' + label + ' and removes only its new owned target', async () => {
      const changed = structuredClone(manifest);
      mutate(changed);
      const name = 'restore_' + random();
      try {
        await writeFile(backup.manifest, JSON.stringify(changed));
        await assert.rejects(async () => {
          const unexpected = await restoreBackup(backup.archive, {nameGenerator: () => name});
          // Even a regression that wrongly accepts a negative case is tracked
          // for the same OID/owner/marker cleanup as an expected success.
          await remember(unexpected.database);
        }, /summary comparison failed/i);
        assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount, 0);
      } finally { await writeFile(backup.manifest, original); }
    });
  }
  assert.equal(await readFile(backup.manifest, 'utf8'), original);
  await admin.query('SELECT 1');
  assert.deepEqual(notifications, [], 'untrusted manifest SQL must never execute');
  assert.equal((await c.query('SELECT count(*)::int AS n FROM development."ProductAttributeGroup"')).rows[0].n, 1);
  // Keep this round's untouched original backup as reproducible RED/GREEN evidence.
});
