import { spawn, fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { assertProjectDatabase } from './db.mjs';

if (process.env.NODE_ENV === 'production') throw new Error('Local acceptance cannot run in production.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schema = 'test_acceptance_' + randomBytes(6).toString('hex');
const databaseUrl = new URL('postgresql://restaurant_dev:restaurant_dev_local_only@127.0.0.1:55432/restaurant_dev');
databaseUrl.searchParams.set('schema', schema);
const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl.href, DEV_AUTH_ENABLED: 'true', DEV_SEED_ENABLED: 'true', PUBLIC_BRAND_ID: 'experience-brand' };
// A parent node:test process must not cause child HTTP suites to be skipped.
delete env.NODE_TEST_CONTEXT;
const db = new pg.Client({ connectionString: databaseUrl.href, connectionTimeoutMillis: 5000 });
const pause = ms => new Promise(done => setTimeout(done, ms));
const active = new Map();
let cancelled = false;
let created = false;

function track(child) {
  const finished = new Promise(done => {
    child.once('exit', (code, signal) => done({ code, signal }));
    child.once('error', () => done({ code: 1 }));
  });
  active.set(child, finished);
  return child;
}
function assertActive() { if (cancelled) throw new Error('Acceptance cancelled'); }
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const finished = active.get(child);
  if (child.connected) child.send({ type: 'shutdown' });
  else child.kill('SIGTERM');
  let stopped = await Promise.race([finished.then(() => true), pause(2000).then(() => false)]);
  if (!stopped) {
    if (process.platform === 'win32') {
      await new Promise(done => {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', done); killer.once('exit', done);
      });
    } else child.kill('SIGKILL');
    stopped = await Promise.race([finished.then(() => true), pause(3000).then(() => false)]);
  }
  if (!stopped) throw new Error('Cannot confirm acceptance child termination; temporary schema preserved.');
}
function cancel() {
  cancelled = true;
  process.exitCode = 130;
  for (const child of active.keys()) void stop(child).catch(error => console.error(error.message));
}
process.on('SIGINT', cancel);
process.on('SIGTERM', cancel);
process.on('message', message => { if (message?.type === 'cancel-acceptance') cancel(); });
async function runNode(args, options = {}) {
  assertActive();
  const child = track(spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true, ...options }));
  const result = await active.get(child);
  assertActive();
  if (result.code !== 0) throw new Error('Acceptance subprocess failed: ' + result.code);
}
try {
  await db.connect();
  await assertProjectDatabase(db);
  assertActive();
  await db.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  await runNode(['apps/api/node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma']);
  await runNode(['apps/api/dist/prisma/seed.js']);
  assertActive();
  const api = track(fork('scripts/acceptance-api.cjs', [], { cwd: root, env, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], windowsHide: true }));
  const apiBase = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Isolated API startup timed out')), 10000);
    api.once('error', reject);
    api.once('exit', () => { clearTimeout(timer); reject(new Error('Isolated API exited during startup')); });
    api.once('message', message => {
      clearTimeout(timer);
      if (message?.type !== 'ready' || !Number.isInteger(message.port) || message.port < 1) reject(new Error('Invalid API readiness proof'));
      else done(`http://127.0.0.1:${message.port}/api/v1`);
    });
  });
  assertActive();
  if (process.connected) {
    process.send({ type: 'acceptance-ready', schema });
    // Give a controlling parent a turn to deliver cancellation before writing.
    await new Promise(done => setImmediate(done));
  }
  await runNode(['--test', 'tests/integration/r1.mjs'], { env: { ...env, API_TEST_URL: apiBase } });
} catch (error) {
  console.error(error.message);
  process.exitCode = cancelled ? 130 : 1;
} finally {
  try {
    await Promise.all([...active.keys()].map(stop));
    if (created) {
      await assertProjectDatabase(db);
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      console.log('Isolated acceptance schema removed.');
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  await db.end();
  if (process.connected) process.disconnect();
}
