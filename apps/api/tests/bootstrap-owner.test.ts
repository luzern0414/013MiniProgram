import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/main';
import { hashPassword } from '../src/modules/auth/credentials';

let isolatedSchema = false;
try { isolatedSchema = new URL(process.env.DATABASE_URL || '').searchParams.get('schema') === 'test_bootstrap_owner'; } catch {}
if (!isolatedSchema) throw new Error('Bootstrap tests require the isolated test_bootstrap_owner schema');

const secret = ' Restricted-owner-secret ';
async function protect(path: string, directory = false) {
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference="Stop"; Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1"; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[IO.File]::GetAccessControl($env:BOOTSTRAP_TEST_PATH,[Security.AccessControl.AccessControlSections]::Access); $acl.SetAccessRuleProtection($true,$false); foreach($rule in @($acl.Access)){[void]$acl.RemoveAccessRuleSpecific($rule)}; $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,"FullControl","Allow"); $acl.SetAccessRule($rule); [IO.File]::SetAccessControl($env:BOOTSTRAP_TEST_PATH,$acl)'], {env: {...process.env, BOOTSTRAP_TEST_PATH: path}, windowsHide: true});
  } else await chmod(path, directory ? 0o700 : 0o600);
}
async function load() {
  try { return await import('../src/commands/bootstrap-owner'); }
  catch { assert.fail('The controlled OWNER bootstrap command must exist'); }
}
async function cli(args: string[]) {
  const env = {...process.env, DEBUG: 'prisma:*'}; delete env.NODE_TEST_CONTEXT;
  return new Promise<{code: number | null; output: string}>(done => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/commands/bootstrap-owner.ts', ...args], {cwd: resolve(__dirname, '..'), env, windowsHide: true});
    let output = ''; child.stdout.on('data', value => output += value); child.stderr.on('data', value => output += value);
    child.on('exit', code => done({code, output}));
  });
}

test('the entire bootstrap suite rejects unsafe database configuration before registering tests', async () => {
  for (const schema of ['development', 'public', undefined]) {
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
    if (schema) env.DATABASE_URL = `postgresql://unused:unused@127.0.0.1:1/unused?schema=${schema}`;
    else delete env.DATABASE_URL;
    const result = await new Promise<{code: number | null; output: string}>(done => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-name-pattern', '^strict CLI arguments', 'tests/bootstrap-owner.test.ts'], {cwd: resolve(__dirname, '..'), env, windowsHide: true});
      let output = ''; child.stdout.on('data', value => output += value); child.stderr.on('data', value => output += value);
      child.on('exit', code => done({code, output}));
    });
    assert.equal(result.code, 1, 'Module-level schema guard must abort even a filesystem-only test selection');
    assert.match(result.output, /Bootstrap tests require the isolated test_bootstrap_owner schema/);
    assert.doesNotMatch(result.output, /Can't reach database server|ECONNREFUSED|PrismaClientInitializationError/);
  }
});

test('OWNER credentials work with production development authentication disabled', async () => {
  const db = new PrismaClient();
  process.env.NODE_ENV = 'production'; process.env.DEV_AUTH_ENABLED = 'false';
  await db.audit.deleteMany(); await db.session.deleteMany(); await db.staffStore.deleteMany(); await db.user.deleteMany(); await db.store.deleteMany(); await db.brand.deleteMany();
  await db.brand.create({data: {id: 'login-brand', name: '登录测试'}});
  await db.user.create({data: {brandId: 'login-brand', name: '真实店主', role: 'OWNER', staffAccount: 'owner.real', passwordHash: await hashPassword(secret)}});
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  try {
    const response = await fetch(await app.getUrl() + '/api/v1/auth/staff-login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({brandId: 'login-brand', account: 'owner.real', password: secret})});
    assert.equal(response.status, 201, 'Real OWNER credentials must use the staff session flow');
  } finally { await app.close(); await db.$disconnect(); }
});

test('strict CLI arguments and restricted password files reject unsafe input', async () => {
  const {parseBootstrapArgs, readRestrictedPasswordFile} = await load();
  const directory = await mkdtemp(join(homedir(), '.restaurant-bootstrap-test-')); await protect(directory, true);
  const file = join(directory, 'owner.pass');
  const args = ['--brand-id', 'brand', '--name', '店主', '--account', 'OWNER.One', '--store-ids', 'a,b', '--password-file', file];
  try {
    assert.equal(parseBootstrapArgs(args).account, 'owner.one');
    for (const invalid of [[], [...args, '--password', secret], [...args, '--force', 'true'], [...args, '--name', '其他'], args.slice(0, -2), args.map(x => x === 'a,b' ? 'a,,b' : x), args.map(x => x === 'a,b' ? '' : x), args.map(x => x === 'a,b' ? 'a,a' : x)]) assert.throws(() => parseBootstrapArgs(invalid));
    await writeFile(file, secret + '\r\n'); await protect(file);
    assert.equal(await readRestrictedPasswordFile(file), secret, 'Preserves significant spaces');
    for (const content of ['short', 'x'.repeat(129), secret + '\n\n', secret + '\ninside', 'x'.repeat(1025), Buffer.from([0xff,0xfe,0x41])]) {
      await writeFile(file, content); await assert.rejects(readRestrictedPasswordFile(file));
    }
    await writeFile(file, secret); await assert.rejects(readRestrictedPasswordFile(directory));
    await assert.rejects(readRestrictedPasswordFile('owner.pass'));
    const shared = join(tmpdir(), 'owner-must-not-be-readable.pass'); await assert.rejects(readRestrictedPasswordFile(shared));
    const link = join(directory, 'linked.pass');
    if (process.platform === 'win32') {
      execFileSync('icacls.exe', [file, '/grant', '*S-1-1-0:(R)'], {windowsHide: true, stdio: 'ignore'});
      await assert.rejects(readRestrictedPasswordFile(file)); await protect(file);
      execFileSync('icacls.exe', [directory, '/grant', '*S-1-1-0:(W)'], {windowsHide: true, stdio: 'ignore'});
      await assert.rejects(readRestrictedPasswordFile(file)); await protect(directory, true);
      await symlink(directory, join(directory, 'junction'), 'junction');
      await assert.rejects(readRestrictedPasswordFile(join(directory, 'junction', 'owner.pass')));
    } else {
      await chmod(file, 0o644); await assert.rejects(readRestrictedPasswordFile(file)); await protect(file);
      await symlink(file, link); await assert.rejects(readRestrictedPasswordFile(link));
    }
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('offline CLI creates one OWNER atomically with explicit same-brand grants and secret-free output', async () => {
  const {bootstrapOwner} = await load();
  const db = new PrismaClient();
  const directory = await mkdtemp(join(homedir(), '.restaurant-bootstrap-db-test-')); await protect(directory, true);
  const file = join(directory, 'owner.pass'); await writeFile(file, secret + '\n'); await protect(file);
  const input = {brandId: 'bootstrap-brand', name: '首位店主', account: 'owner.first', storeIds: ['store-a'], passwordFile: file};
  const args = (brandId = input.brandId) => ['--brand-id', brandId, '--name', input.name, '--account', input.account, '--store-ids', 'store-a', '--password-file', file];
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    await db.brand.createMany({data: ['bootstrap-brand', 'other-brand', 'race-brand', 'invalid-brand', 'legacy-brand'].map(id => ({id, name: id}))});
    await db.store.createMany({data: [{id: 'store-a', brandId: 'bootstrap-brand'}, {id: 'store-b', brandId: 'bootstrap-brand'}, {id: 'foreign-store', brandId: 'other-brand'}, {id: 'race-store', brandId: 'race-brand'}, {id: 'invalid-store', brandId: 'invalid-brand'}, {id: 'legacy-store', brandId: 'legacy-brand'}].map(data => ({...data, name: data.id, address: '', phone: ''}))});
    const result = await cli(args()); assert.equal(result.code, 0, result.output); assert.equal(result.output.includes(secret), false); assert.equal(/scrypt\$|passwordHash|token/i.test(result.output), false);
    const owner = await db.user.findUniqueOrThrow({where: {brandId_staffAccount: {brandId: input.brandId, staffAccount: input.account}}, include: {staff: true}});
    assert.equal(owner.role, 'OWNER'); assert.deepEqual(owner.staff.map(s => s.storeId), ['store-a']); assert.ok(owner.passwordHash?.startsWith('scrypt$')); assert.equal(owner.devAccount, null);
    assert.equal((await cli(args())).code, 1);
    assert.equal(await db.user.count({where: {brandId: input.brandId, role: 'OWNER'}}), 1);
    const raced = await Promise.allSettled([bootstrapOwner(db, {...input, brandId: 'race-brand', storeIds: ['race-store']}), bootstrapOwner(db, {...input, brandId: 'race-brand', account: 'owner.second', storeIds: ['race-store']})]);
    assert.equal(raced.filter(r => r.status === 'fulfilled').length, 1); assert.equal(await db.user.count({where: {brandId: 'race-brand', role: 'OWNER'}}), 1);
    for (const storeIds of [['invalid-store', 'foreign-store'], ['invalid-store', 'missing-store']]) await assert.rejects(bootstrapOwner(db, {...input, brandId: 'invalid-brand', storeIds}));
    await assert.rejects(bootstrapOwner(db, {...input, brandId: 'absent-brand'}));
    assert.equal(await db.user.count({where: {brandId: 'invalid-brand'}}), 0); assert.equal(await db.staffStore.count({where: {storeId: 'invalid-store'}}), 0); assert.equal(await db.audit.count({where: {storeId: 'invalid-store'}}), 0);
    await db.user.create({data: {brandId: 'legacy-brand', role: 'OWNER', name: '旧店主', enabled: false}});
    await assert.rejects(bootstrapOwner(db, {...input, brandId: 'legacy-brand', storeIds: ['legacy-store']}));
    const audit = await db.audit.findMany({where: {entityId: owner.id}}); assert.equal(audit.length, 1); assert.equal(audit[0].action, 'OWNER_BOOTSTRAP');
    assert.equal(JSON.stringify(audit).includes(secret), false); assert.equal(/scrypt\$|passwordHash|"password"|token/i.test(JSON.stringify(audit)), false);
    process.env.NODE_ENV = 'production'; process.env.DEV_AUTH_ENABLED = 'false';
    app = await createApp(); await app.listen(0, '127.0.0.1');
    const base = await app.getUrl() + '/api/v1';
    const login = (account = input.account, password = secret, brandId = input.brandId) => fetch(base + '/auth/staff-login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({brandId, account, password})});
    const auth = await login(); assert.equal(auth.status, 201); const session = (await auth.json() as any).data;
    assert.equal(session.user.role, 'OWNER'); assert.deepEqual(session.user.storeIds, ['store-a']); assert.equal(session.environment, 'production');
    assert.equal((await login(input.account, secret.trim())).status, 401);
    assert.equal((await fetch(base + '/merchant/staff?storeId=store-b', {headers: {Authorization: 'Bearer ' + session.token}})).status, 403);
    await db.user.update({where: {id: owner.id}, data: {enabled: false}}); assert.equal((await login()).status, 401);
    assert.equal((await fetch(base + '/me', {headers: {Authorization: 'Bearer ' + session.token}})).status, 401);
    await db.user.create({data: {brandId: 'legacy-brand', role: 'OWNER', name: '无凭据店主', staffAccount: 'legacy.owner'}});
    assert.equal((await login('legacy.owner', secret, 'legacy-brand')).status, 401);
    const unsafeArg = await cli([...args(), '--password', secret]); assert.equal(unsafeArg.code, 1); assert.equal(unsafeArg.output.includes(secret), false);
  } finally { await app?.close(); await db.$disconnect(); await rm(directory, {recursive: true, force: true}); }
});
