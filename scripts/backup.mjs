import { readFileSync, existsSync, createReadStream } from 'node:fs';
import { mkdir, writeFile, readFile, rename, unlink, rm, lstat, realpath } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname, join, basename, parse } from 'node:path';
import pg from 'pg';
import { assertProjectDatabase } from './db.mjs';
import { summariesMatch } from './backup-summary.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backups = join(root, 'data/backups');
const toolsDir = join(root, 'data/runtime/tools/postgresql-16.15/pgsql/bin');
const qi = name => '"' + name.replaceAll('"', '""') + '"';
const random = () => randomBytes(16).toString('hex');
function localOnly() {
  if (process.env.NODE_ENV === 'production') throw new Error('Backup commands are restricted to local development.');
}
export function localConnection() {
  localOnly();
  const values = {};
  const file = existsSync(join(root, '.env.local')) ? join(root, '.env.local') : join(root, 'config/environments/development.env.example');
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const split = line.indexOf('=');
    if (split > 0 && !line.trim().startsWith('#')) values[line.slice(0, split).trim()] = line.slice(split + 1).trim();
  }
  if ((process.env.NODE_ENV ?? values.NODE_ENV) === 'production') throw new Error('Backup commands are restricted to local development.');
  let url;
  try { url = new URL(process.env.DATABASE_URL ?? values.DATABASE_URL); } catch { throw new Error('A local DATABASE_URL is required.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/restaurant_dev' || decodeURIComponent(url.username) !== 'restaurant_dev' || !url.password) {
    throw new Error('Backup commands require the fixed owned local restaurant_dev connection.');
  }
  return {host: '127.0.0.1', port: 55432, user: 'restaurant_dev', password: decodeURIComponent(url.password), database: 'restaurant_dev', connectionTimeoutMillis: 5000};
}
function execute(binary, args, env = process.env) {
  return new Promise((done, reject) => execFile(binary, args, {env, windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024}, (error, stdout) => {
    if (error) reject(new Error('PostgreSQL operation failed; inspect local configuration and archive.'));
    else done(stdout.trim());
  }));
}
export function assertToolVersion(output) {
  const match = /^pg_(?:dump|restore) \(PostgreSQL\) (16\.\d+)(?:\s|$)/.exec(output);
  if (!match) throw new Error('Official PostgreSQL 16 backup tools are required.');
  return match[1];
}
async function toolVersions() {
  const dump = join(toolsDir, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump');
  const restore = join(toolsDir, process.platform === 'win32' ? 'pg_restore.exe' : 'pg_restore');
  return {dump, restore, dumpVersion: assertToolVersion(await execute(dump, ['--version'])), restoreVersion: assertToolVersion(await execute(restore, ['--version']))};
}
const aclScript = `
$ErrorActionPreference='Stop'
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1"
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Management/Microsoft.PowerShell.Management.psd1"
$path=$env:RESTAURANT_BACKUP_PRIVATE_PATH
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
if($env:RESTAURANT_BACKUP_SET_PRIVATE -eq '1'){
  $acl=Get-Acl -LiteralPath $path
  if(@($sid.Value,'S-1-5-18','S-1-5-32-544') -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value){throw 'owner'}
  $acl.SetAccessRuleProtection($true,$false)
  foreach($oldRule in @($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))){$acl.RemoveAccessRuleSpecific($oldRule)}
  $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule)
  $info=New-Object IO.DirectoryInfo($path)
  $info.SetAccessControl($acl)
}
$item=Get-Item -Force -LiteralPath $path
$paths=@($path)
if(-not $item.PSIsContainer){$paths+=Split-Path -Parent $path}
$trusted=@($sid.Value,'S-1-5-18','S-1-5-32-544')
foreach($check in $paths){
  $acl=Get-Acl -LiteralPath $check
  if(-not (Get-Item -Force -LiteralPath $check).PSIsContainer){
    # Files inherit only from the already protected private run directory.
    $parent=Get-Acl -LiteralPath (Split-Path -Parent $check)
    if(-not $parent.AreAccessRulesProtected){throw 'inherited-parent'}
  } elseif(-not $acl.AreAccessRulesProtected){throw 'inherited-directory'}
  if($trusted -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value){throw 'owner'}
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    if($rule.AccessControlType -eq 'Allow' -and $trusted -notcontains $rule.IdentityReference.Value -and [long]$rule.FileSystemRights -ne 0){throw 'public-access'}
  }
}
Write-Output 'private'
`;
async function pathWithoutLinks(path) {
  const original = resolve(path);
  let current = original;
  while (true) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error('Private backup paths cannot contain links.');
    if (current === parse(current).root) break;
    current = dirname(current);
  }
  const actual = await realpath(original);
  if (actual.toLowerCase() !== original.toLowerCase()) throw new Error('Private backup path must be canonical.');
}
export async function assertPrivatePath(path) {
  await pathWithoutLinks(path);
  const stat = await lstat(path);
  if (stat.isFile() && stat.nlink !== 1) throw new Error('Private backup files cannot have hard links.');
  if (process.platform === 'win32') {
    if (await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', aclScript], {...process.env, RESTAURANT_BACKUP_PRIVATE_PATH: path, RESTAURANT_BACKUP_SET_PRIVATE: '0'}) !== 'private') throw new Error('Private Windows ACL required.');
  } else {
    const parent = await lstat(dirname(path));
    if (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 || (!stat.isDirectory() && (parent.uid !== process.getuid() || (parent.mode & 0o077) !== 0))) throw new Error('Private backup permissions required.');
  }
}
async function privateDirectory(path) {
  await mkdir(path, {recursive: true, mode: 0o700});
  await pathWithoutLinks(path);
  if (process.platform === 'win32') await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', aclScript], {...process.env, RESTAURANT_BACKUP_PRIVATE_PATH: path, RESTAURANT_BACKUP_SET_PRIVATE: '1'});
  await assertPrivatePath(path);
}
async function connected(connection, database) {
  const c = new pg.Client({...connection, database});
  try {
    await c.connect();
    await assertProjectDatabase(c);
    const owned = await c.query('SELECT pg_get_userbyid(datdba)=current_user AS owned FROM pg_database WHERE datname=current_database()');
    if (!owned.rows[0]?.owned) throw new Error('Database ownership does not match local operator.');
    return c;
  } catch (error) { await c.end().catch(() => {}); throw error; }
}
async function digestFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function passfile(directory, connection, database) {
  const path = join(directory, '.pgpass-' + random());
  const escape = value => String(value).replaceAll('\\', '\\\\').replaceAll(':', '\\:');
  await writeFile(path, [connection.host, connection.port, database, connection.user, connection.password].map(escape).join(':') + '\n', {flag: 'wx', mode: 0o600});
  try { await assertPrivatePath(path); }
  catch (error) { await unlink(path).catch(() => {}); throw error; }
  // Do not inherit libpq service, URL, options or password variables from the caller.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key) && key !== 'DATABASE_URL'));
  return {path, env: {...env, PGPASSFILE: path, PGSSLMODE: 'disable'}};
}
const connectionArgs = (connection, database) => ['--host=' + connection.host, '--port=' + connection.port, '--username=' + connection.user, '--dbname=' + database, '--no-password'];

// Summary contains no credential fields, session tokens, personal profiles or order addresses.
async function summary(c) {
  const tables = await c.query(`SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' ORDER BY 1,2`);
  const schemas = Object.create(null);
  for (const {schema, name} of tables.rows) {
    const entry = schemas[schema] ??= {counts: Object.create(null)};
    entry.counts[name] = (await c.query(`SELECT count(*)::text AS count FROM ${qi(schema)}.${qi(name)}`)).rows[0].count;
  }
  for (const [schema, entry] of Object.entries(schemas)) {
    const table = name => qi(schema) + '.' + qi(name);
    if ('CashPayment' in entry.counts) entry.cash = (await c.query(`SELECT coalesce(sum("amountFen"),0)::text AS "amountFen",coalesce(sum("tenderedFen"),0)::text AS "tenderedFen",coalesce(sum("changeFen"),0)::text AS "changeFen" FROM ${table('CashPayment')}`)).rows[0];
    entry.inventory = {};
    for (const [name, key] of [['Sku', 'sku'], ['Modifier', 'modifier']]) if (name in entry.counts) entry.inventory[key] = (await c.query(`SELECT id,stock,reserved FROM ${table(name)} ORDER BY id`)).rows;
    entry.fingerprints = {};
    for (const [name, columns, order] of [['Page', '"storeId",draft,published,version', '"storeId"'], ['Quote', 'id,snapshot', 'id'], ['Order', 'id,lines,"totalFen",status,"paymentStatus","refundStatus","inventoryReleased"', 'id'], ['OrderEvent', 'id,"orderId",status,label', 'id']]) {
      if (name in entry.counts) entry.fingerprints[name] = (await c.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY ${order}), '[]'::jsonb)::text) AS digest FROM (SELECT ${columns} FROM ${table(name)}) t`)).rows[0].digest;
    }
  }
  const constraints = (await c.query(`SELECT n.nspname AS schema,c.relname AS table,p.conname AS name,p.contype AS type,p.convalidated AS validated,pg_get_constraintdef(p.oid) AS definition FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' ORDER BY 1,2,3`)).rows;
  return {schemas, constraints};
}
async function assertSource(c, database) {
  if (database === 'restaurant_dev') return;
  if (!/^test_backup_[a-f0-9]{32}$/.test(database)) throw new Error('Source database ownership is not a permitted local test.');
  const result = await c.query("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
  if (result.rows[0]?.marker !== `restaurant-backup-test:${root}:${database}`) throw new Error('Source database ownership marker does not match.');
}
export async function backupDatabase({sourceDatabase = 'restaurant_dev', afterSnapshot} = {}) {
  const connection = localConnection(), tools = await toolVersions();
  const c = await connected(connection, sourceDatabase);
  let directory, pass;
  try {
    await assertSource(c, sourceDatabase);
    await privateDirectory(backups);
    const candidate = join(backups, 'backup_' + random());
    // Never adopt or clean an existing directory, even on an improbable random collision.
    await mkdir(candidate, {mode: 0o700});
    directory = candidate;
    await privateDirectory(directory);
    pass = await passfile(directory, connection, sourceDatabase);
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await c.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    if (afterSnapshot) await afterSnapshot();
    const archive = join(directory, 'database.dump'), partial = archive + '.partial';
    await execute(tools.dump, [...connectionArgs(connection, sourceDatabase), '--format=custom', '--snapshot=' + snapshot, '--file=' + partial], pass.env);
    const manifest = {format: 1, archive: basename(archive), createdAt: new Date().toISOString(), source: {database: sourceDatabase, serverVersion: (await c.query('SHOW server_version')).rows[0].server_version}, tools: {dump: tools.dumpVersion, restore: tools.restoreVersion}, snapshot, summary: await summary(c), sha256: await digestFile(partial)};
    await c.query('COMMIT');
    await unlink(pass.path); pass = undefined;
    await assertPrivatePath(partial);
    await writeFile(join(directory, 'manifest.json.partial'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    await writeFile(join(directory, 'sha256.partial'), manifest.sha256 + '  database.dump\n', {flag: 'wx', mode: 0o600});
    await rename(partial, archive);
    await rename(join(directory, 'sha256.partial'), join(directory, 'sha256'));
    // Manifest is the final publish marker; a partially published archive is never accepted.
    await rename(join(directory, 'manifest.json.partial'), join(directory, 'manifest.json'));
    return {archive, manifest: join(directory, 'manifest.json'), sha256: manifest.sha256};
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    if (directory) await rm(directory, {recursive: true, force: true});
    throw error;
  } finally { if (pass) await unlink(pass.path).catch(() => {}); await c.end(); }
}
async function validateArchive(archive, tools) {
  await assertPrivatePath(archive);
  const manifestPath = join(dirname(archive), 'manifest.json');
  await assertPrivatePath(manifestPath);
  if ((await lstat(manifestPath)).size > 32 * 1024 * 1024) throw new Error('Backup manifest is too large.');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.format !== 1 || manifest.archive !== basename(archive) || !manifest.summary?.schemas || !Array.isArray(manifest.summary.constraints) || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('Unsupported backup manifest.');
  if (!/^16\.\d+$/.test(manifest.tools?.dump) || !/^16\.\d+$/.test(manifest.tools?.restore) || !/^16\./.test(manifest.source?.serverVersion)) throw new Error('Backup requires PostgreSQL 16.');
  if (await digestFile(archive) !== manifest.sha256) throw new Error('Archive checksum mismatch.');
  await execute(tools.restore, ['--list', archive]);
  return manifest;
}
async function stillOwned(admin, target) {
  const result = await admin.query("SELECT oid::text AS oid,pg_get_userbyid(datdba)=current_user AS owned,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1", [target.name]);
  const found = result.rows[0];
  return found && found.oid === target.oid && found.owned && found.marker === target.marker;
}
export async function restoreBackup(file, {nameGenerator = () => 'restore_' + random(), beforeRestore} = {}) {
  const connection = localConnection(), tools = await toolVersions(), archive = resolve(file);
  const manifest = await validateArchive(archive, tools);
  const admin = await connected(connection, 'postgres');
  const target = {name: nameGenerator(), marker: 'restaurant-backup-restore:' + root + ':' + random()};
  let created = false, c, pass;
  try {
    if (!/^restore_[a-f0-9]{32}$/.test(target.name)) throw new Error('Restore requires a newly generated random database.');
    if ((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [target.name])).rowCount) throw new Error('Random restore target already exists; nothing was overwritten.');
    await admin.query(`CREATE DATABASE ${qi(target.name)} TEMPLATE template0`);
    created = true;
    target.oid = (await admin.query('SELECT oid::text AS oid FROM pg_database WHERE datname=$1', [target.name])).rows[0].oid;
    await admin.query(`COMMENT ON DATABASE ${qi(target.name)} IS '${target.marker.replaceAll("'", "''")}'`);
    c = await connected(connection, target.name);
    if (beforeRestore) await beforeRestore(c);
    pass = await passfile(dirname(archive), connection, target.name);
    try { await execute(tools.restore, [...connectionArgs(connection, target.name), '--exit-on-error', '--no-owner', '--no-acl', '--single-transaction', archive], pass.env); }
    catch { throw new Error('Archive restore failed; source database was not changed.'); }
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    if (!summariesMatch(await summary(c), manifest.summary)) throw new Error('Restore summary comparison failed.');
    let revokedSessions = 0;
    for (const [schema, entry] of Object.entries(manifest.summary.schemas)) if ('Session' in entry.counts) revokedSessions += (await c.query(`DELETE FROM ${qi(schema)}."Session"`)).rowCount;
    await c.query('COMMIT');
    await writeFile(join(dirname(archive), 'restore-' + target.name + '.json'), JSON.stringify({database: target.name, restoredAt: new Date().toISOString(), validated: true, revokedSessions}, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    return {database: target.name, revokedSessions};
  } catch (error) {
    if (c) { await c.query('ROLLBACK').catch(() => {}); await c.end().catch(() => {}); c = undefined; }
    if (created) {
      let retained = true;
      try {
        if (await stillOwned(admin, target)) {
          await admin.query(`DROP DATABASE ${qi(target.name)} WITH (FORCE)`);
          retained = false;
        }
      } catch { /* Keep an uncertain target for inspection; never broaden cleanup. */ }
      await writeFile(join(dirname(archive), 'restore-' + target.name + '.failed.json'), JSON.stringify({database: target.name, failedAt: new Date().toISOString(), retained, reason: retained ? 'ownership_not_confirmed' : 'restore_failed_target_removed'}, null, 2) + '\n', {flag: 'wx', mode: 0o600}).catch(() => {});
      if (retained) throw new Error('Restore failed; ownership could not be confirmed, so the new target was retained for manual inspection.');
    }
    throw error;
  } finally { if (pass) await unlink(pass.path).catch(() => {}); if (c) await c.end(); await admin.end(); }
}
async function main() {
  localOnly();
  const [operation, ...raw] = process.argv.slice(2), args = raw[0] === '--' ? raw.slice(1) : raw;
  if (operation === 'backup' && args.length === 0) {
    const result = await backupDatabase();
    console.log('Backup: ' + result.archive);
    console.log('SHA256: ' + result.sha256);
    console.log('Manifest: ' + result.manifest);
  } else if (operation === 'restore' && args.length === 1 && !args[0].startsWith('--')) {
    const result = await restoreBackup(args[0]);
    console.log('Validated restore: ' + result.database);
    console.log('Restored sessions revoked: ' + result.revokedSessions);
  } else throw new Error('Usage: pnpm db:backup | pnpm db:restore -- <archive>');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main().catch(error => {
    // Never echo raw SQL, tool stderr or connection errors containing source data.
    const safe = /^(Backup commands|Backup requires|Usage:|A local DATABASE_URL|Official PostgreSQL|Archive checksum|Unsupported backup|Private backup|Private Windows|Restore |Random restore|Archive restore)/;
    console.error(safe.test(error.message) ? error.message : 'Local backup operation failed; verify owned database, official PG16 tools and private artifact permissions.');
    process.exitCode = 1;
  });
}
