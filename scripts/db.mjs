import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, realpathSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data', 'postgres');
const runtimeDir = join(root, 'data', 'runtime');
const marker = join(dataDir, '.restaurant-owned');
const command = process.argv[2];
const user = 'restaurant_dev';
const password = 'restaurant_dev_local_only';
const port = 55432;
const database = 'restaurant_dev';

function localOnly() {
  if (process.env.NODE_ENV === 'production') throw new Error('Portable PostgreSQL is restricted to local development.');
}
function assertProjectMarker(workspaceRoot, clusterDir) {
  const ownershipFile = join(clusterDir, '.restaurant-owned');
  if (!existsSync(ownershipFile) || readFileSync(ownershipFile, 'utf8') !== workspaceRoot) {
    throw new Error('Database ownership marker does not match this workspace.');
  }
}
function canonicalPath(path) {
  const canonical = realpathSync(path);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}
export async function assertProjectDatabase(c, { workspaceRoot = root, clusterDir = dataDir } = {}) {
  assertProjectMarker(workspaceRoot, clusterDir);
  const directory = await c.query('SHOW data_directory');
  if (canonicalPath(directory.rows[0].data_directory) !== canonicalPath(clusterDir)) {
    throw new Error('Connected database data directory does not match this workspace.');
  }
  const version = await c.query('SHOW server_version_num');
  if (Math.floor(Number(version.rows[0].server_version_num) / 10000) !== 16) {
    throw new Error('Project database must run PostgreSQL 16.');
  }
}
function run(binary, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(binary, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('exit', code => {
      child.stdout.destroy();
      child.stderr.destroy();
      code === 0 ? resolveRun(output) : reject(new Error(output || 'PostgreSQL process failed'));
    });
  });
}
async function client(db = database) {
  assertProjectMarker(root, dataDir);
  const c = new pg.Client({ user, password, port, host: '127.0.0.1', database: db, connectionTimeoutMillis: 5000 });
  try {
    await c.connect();
    await assertProjectDatabase(c);
    return c;
  } catch (error) {
    await c.end().catch(() => {});
    throw error;
  }
}
async function binaries() {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('embedded-postgres');
  const module = await import(pathToFileURL(join(dirname(entry), 'binary.js')).href);
  return module.default();
}

async function main() {
  localOnly();
  mkdirSync(runtimeDir, { recursive: true });
  if (command === 'start') {
    const bin = await binaries();
    if (existsSync(join(dataDir, 'PG_VERSION')) && !existsSync(marker)) throw new Error('Refusing to use an unowned PostgreSQL directory.');
    if (!existsSync(join(dataDir, 'PG_VERSION'))) {
      const passwordFile = join(runtimeDir, 'pg-init-' + randomBytes(8).toString('hex'));
      writeFileSync(passwordFile, password + '\n', { mode: 0o600 });
      try {
        await run(bin.initdb, ['--pgdata=' + dataDir, '--username=' + user, '--pwfile=' + passwordFile, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C']);
      } finally { unlinkSync(passwordFile); }
      writeFileSync(marker, root, 'utf8');
    }
    if (readFileSync(marker, 'utf8') !== root) throw new Error('Database ownership marker does not match this workspace.');
    const status = await run(bin.pg_ctl, ['status', '-D', dataDir]).catch(() => null);
    if (!status) {
      await run(bin.pg_ctl, ['start', '-D', dataDir, '-l', join(runtimeDir, 'postgres.log'), '-o', '-h 127.0.0.1 -p ' + port, '-w', '-t', '30']);
    }
    const c = await client('postgres');
    try {
      const found = await c.query('SELECT 1 FROM pg_database WHERE datname=$1', [database]);
      if (!found.rowCount) await c.query('CREATE DATABASE restaurant_dev');
    } finally { await c.end(); }
    console.log('Project PostgreSQL ready at 127.0.0.1:' + port + '/' + database);
  } else if (command === 'stop') {
    if (!existsSync(marker) || readFileSync(marker, 'utf8') !== root) throw new Error('Refusing to stop an unowned database.');
    const bin = await binaries();
    await run(bin.pg_ctl, ['stop', '-D', dataDir, '-m', 'fast', '-w', '-t', '30']);
    console.log('Project PostgreSQL stopped; data retained.');
  } else if (command === 'verify') {
    const c = await client();
    try {
      const version = await c.query('SELECT version() AS version');
      await c.query('CREATE TEMP TABLE restaurant_runtime_verify (id integer)');
      await c.query('BEGIN');
      await c.query('INSERT INTO restaurant_runtime_verify VALUES (1)');
      await c.query('ROLLBACK');
      const result = await c.query('SELECT COUNT(*)::int AS count FROM restaurant_runtime_verify');
      if (result.rows[0].count !== 0) throw new Error('Database transaction did not roll back.');
      console.log(version.rows[0].version);
      console.log('rollback verified');
    } finally { await c.end(); }
  } else {
    throw new Error('Usage: node scripts/db.mjs start|stop|verify');
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

