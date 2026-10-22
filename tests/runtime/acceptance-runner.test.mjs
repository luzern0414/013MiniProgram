import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import pg from 'pg';

test('cancelling acceptance stops its processes and removes only its temporary schema', { timeout: 30000 }, async () => {
  const runner = fork('scripts/integration.mjs', [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, NODE_ENV: 'test' } });
  let ownedSchema;
  let cancelled = false;
  let output = '';
  runner.stdout.on('data', data => { output += data; });
  runner.stderr.on('data', data => { output += data; });
  const finished = new Promise(done => runner.once('exit', (code, signal) => done({ code, signal })));
  runner.on('message', message => {
    if (message.type === 'acceptance-ready') {
      ownedSchema = message.schema;
      cancelled = true;
      runner.send({ type: 'cancel-acceptance' });
    }
  });
  const result = await finished;
  assert.ok(cancelled, 'Runner must announce owned API readiness over IPC, output: ' + output.slice(-2000));
  assert.notEqual(result.code, 0, 'Cancelled acceptance cannot report success');
  const db = new pg.Client({ connectionString: 'postgresql://restaurant_dev:restaurant_dev_local_only@127.0.0.1:55432/restaurant_dev' });
  await db.connect();
  try {
    assert.equal((await db.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [ownedSchema])).rowCount, 0);
    assert.equal((await db.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', ['development'])).rowCount, 1);
  } finally { await db.end(); }
});
