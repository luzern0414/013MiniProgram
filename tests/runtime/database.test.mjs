import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('project database is real PostgreSQL and rolls back a transaction', () => {
  const result = spawnSync(process.execPath, ['scripts/db.mjs', 'verify'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PostgreSQL 16\./);
  assert.match(result.stdout, /rollback verified/);
});

for (const command of ['start', 'stop', 'verify']) {
  test(`production rejects database ${command}`, () => {
    const result = spawnSync(process.execPath, ['scripts/db.mjs', command], {
      encoding: 'utf8', timeout: 30000, env: { ...process.env, NODE_ENV: 'production' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /restricted to local development/);
    assert.equal(result.stdout, '');
  });
}

