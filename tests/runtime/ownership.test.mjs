import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as runtime from '../../scripts/db.mjs';

function fixture(t) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'restaurant-runtime-'));
  const clusterDir = join(workspaceRoot, 'postgres');
  const foreignDir = join(workspaceRoot, 'foreign-postgres');
  mkdirSync(clusterDir);
  mkdirSync(foreignDir);
  writeFileSync(join(clusterDir, '.restaurant-owned'), workspaceRoot);
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  return { workspaceRoot, clusterDir, foreignDir };
}

function server(dataDirectory, version = '160014') {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(sql);
      if (sql === 'SHOW data_directory') return { rows: [{ data_directory: dataDirectory }] };
      if (sql === 'SHOW server_version_num') return { rows: [{ server_version_num: version }] };
      throw new Error('Unexpected SQL: ' + sql);
    },
  };
}

test('ownership guard is available without running the database CLI', () => {
  assert.equal(typeof runtime.assertProjectDatabase, 'function');
});

test('rejects a foreign server directory before any SQL writes', async t => {
  const paths = fixture(t);
  const c = server(paths.foreignDir);
  await assert.rejects(runtime.assertProjectDatabase(c, paths), /data directory.*workspace/i);
  assert.deepEqual(c.queries, ['SHOW data_directory']);
});

test('rejects a non-16 server before any SQL writes', async t => {
  const paths = fixture(t);
  const c = server(paths.clusterDir, '170002');
  await assert.rejects(runtime.assertProjectDatabase(c, paths), /PostgreSQL 16/);
  assert.deepEqual(c.queries, ['SHOW data_directory', 'SHOW server_version_num']);
});

test('requires the ownership marker before querying the server', async t => {
  const paths = fixture(t);
  rmSync(join(paths.clusterDir, '.restaurant-owned'));
  const c = server(paths.clusterDir);
  await assert.rejects(runtime.assertProjectDatabase(c, paths), /ownership marker/i);
  assert.deepEqual(c.queries, []);
});

test('rejects a marker belonging to another workspace before querying', async t => {
  const paths = fixture(t);
  writeFileSync(join(paths.clusterDir, '.restaurant-owned'), paths.foreignDir);
  const c = server(paths.clusterDir);
  await assert.rejects(runtime.assertProjectDatabase(c, paths), /ownership marker/i);
  assert.deepEqual(c.queries, []);
});

test('accepts PostgreSQL 16 when canonical data-directory paths match', async t => {
  const paths = fixture(t);
  const alias = join(paths.workspaceRoot, 'postgres-alias');
  symlinkSync(paths.clusterDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const c = server(alias);
  await runtime.assertProjectDatabase(c, paths);
  assert.deepEqual(c.queries, ['SHOW data_directory', 'SHOW server_version_num']);
});
