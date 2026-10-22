import type { PrismaClient } from '@prisma/client';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, isAbsolute, parse, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { account, hashPassword, password } from '../modules/auth/credentials';

export type BootstrapOptions = {brandId: string; name: string; account: string; storeIds: string[]; passwordFile: string};
function invalid(message: string): never { throw new Error(message); }
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid('初始化参数格式不正确');
  return value;
}
function validate(value: BootstrapOptions): BootstrapOptions {
  const brandId = text(value.brandId, 200), name = text(value.name, 80), staffAccount = account(value.account);
  if (!Array.isArray(value.storeIds) || !value.storeIds.length || value.storeIds.length > 100) invalid('请选择1至100家授权门店');
  const storeIds = value.storeIds.map(id => text(id, 200));
  if (new Set(storeIds).size !== storeIds.length) invalid('授权门店不得重复');
  return {brandId, name, account: staffAccount, storeIds, passwordFile: text(value.passwordFile, 4096)};
}
export function parseBootstrapArgs(args: string[]): BootstrapOptions {
  const allowed = ['--brand-id', '--name', '--account', '--store-ids', '--password-file'];
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!allowed.includes(key) || values.has(key) || !value || value.startsWith('--')) invalid('仅支持且必须提供品牌、姓名、账号、授权门店和密码文件参数');
    values.set(key, value);
  }
  if (values.size !== allowed.length) invalid('初始化参数缺失');
  return validate({brandId: values.get('--brand-id')!, name: values.get('--name')!, account: values.get('--account')!, storeIds: values.get('--store-ids')!.split(','), passwordFile: values.get('--password-file')!});
}
const within = (path: string, directory: string) => { const part = relative(resolve(directory), path); return part === '' || (!part.startsWith('..') && !isAbsolute(part)); };
async function assertPath(path: string) {
  if (!isAbsolute(path) || path.startsWith('\\\\') || path.startsWith('//') || path.includes('\0')) invalid('密码文件须使用本地绝对路径');
  if (process.platform === 'win32' && path.slice(parse(path).root.length).includes(':')) invalid('密码文件不得使用设备路径或备用数据流');
  if ([tmpdir(), process.env.TEMP, process.env.TMP, '/tmp', '/var/tmp'].filter(Boolean).some(directory => within(path, directory!))) invalid('密码文件不得位于临时公用目录');
  let current = path;
  while (true) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) invalid('密码文件路径不得包含符号链接或重解析点');
    if (current === parse(current).root) break;
    current = dirname(current);
  }
  const canonical = resolve(await realpath(path)), supplied = resolve(path);
  if (process.platform === 'win32' ? canonical.toLowerCase() !== supplied.toLowerCase() : canonical !== supplied) invalid('密码文件路径必须为真实路径');
}

// Windows modes do not enforce confidentiality; inspect the actual DACL and reparse attributes.
const windowsAclScript = `
$ErrorActionPreference='Stop'
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1"
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Management/Microsoft.PowerShell.Management.psd1"
$path=$env:RESTAURANT_PRIVATE_FILE
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$trusted=@($sid,'S-1-5-18','S-1-5-32-544')
$current=$path
while($current){
  $item=Get-Item -Force -LiteralPath $current
  if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'reparse'}
  $parent=Split-Path -Parent $current
  if($parent -eq $current){break}; $current=$parent
}
$fileAcl=Get-Acl -LiteralPath $path
$parentAcl=Get-Acl -LiteralPath (Split-Path -Parent $path)
foreach($acl in @($fileAcl,$parentAcl)){
  if(-not $acl.AreAccessRulesProtected){throw 'inherited'}
  if($trusted -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value){throw 'owner'}
}
$writeMask=2 -bor 4 -bor 16 -bor 256 -bor 64 -bor 65536 -bor 262144 -bor 524288 -bor 268435456 -bor 1073741824
foreach($rule in $fileAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
  if($rule.AccessControlType -eq 'Allow' -and $trusted -notcontains $rule.IdentityReference.Value -and [long]$rule.FileSystemRights -ne 0){throw 'file-access'}
}
foreach($rule in $parentAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
  if($rule.AccessControlType -eq 'Allow' -and $trusted -notcontains $rule.IdentityReference.Value -and ([long]$rule.FileSystemRights -band $writeMask) -ne 0){throw 'directory-write'}
}
Write-Output 'restricted'
`;
async function assertPermissions(path: string) {
  if (process.platform === 'win32') {
    await new Promise<void>((done, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsAclScript], {env: {...process.env, RESTAURANT_PRIVATE_FILE: path}, windowsHide: true, timeout: 10000, maxBuffer: 4096}, (error, stdout) => {
        if (error || stdout.trim() !== 'restricted') reject(new Error('密码文件及父目录必须使用受保护的私有ACL'));
        else done();
      });
    });
  } else {
    const file = await lstat(path), directory = await lstat(dirname(path));
    if (file.uid !== process.getuid?.() || directory.uid !== process.getuid?.() || (file.mode & 0o077) !== 0 || (directory.mode & 0o022) !== 0) invalid('密码文件及父目录权限不安全');
  }
}
export async function readRestrictedPasswordFile(path: string): Promise<string> {
  try {
    await assertPath(path);
    const checked = await lstat(path);
    if (!checked.isFile() || checked.size < 12 || checked.size > 1024 || checked.nlink !== 1) invalid('密码文件必须为不超过1KiB的独立普通文件');
    const handle = await open(path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
    try {
      const opened = await handle.stat();
      const same = (other: typeof opened) => opened.dev === other.dev && opened.ino === other.ino && opened.size === other.size && opened.mtimeMs === other.mtimeMs && opened.ctimeMs === other.ctimeMs;
      if (!same(checked) || !opened.isFile()) invalid('密码文件在校验时发生变化');
      await assertPermissions(path);
      // Fixed-size read prevents growth after fstat from causing unbounded allocation.
      const buffer = Buffer.alloc(1025);
      try {
        const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0);
        await assertPath(path);
        if (bytesRead !== opened.size || bytesRead > 1024 || !same(await handle.stat()) || !same(await lstat(path))) invalid('密码文件在读取时发生变化');
        const value = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(buffer.subarray(0, bytesRead));
        const withoutEnding = value.replace(/\r?\n$/, '');
        if (/[\r\n\u0000\ufeff]/.test(withoutEnding)) invalid('密码文件只允许单个尾换行');
        return password(withoutEnding);
      } finally { buffer.fill(0); }
    } finally { await handle.close(); }
  } catch { throw new Error('密码文件读取失败：请检查本地真实路径、文件大小、格式及私有权限'); }
}
export async function bootstrapOwner(db: PrismaClient, input: BootstrapOptions) {
  const options = validate(input);
  const passwordHash = await hashPassword(await readRestrictedPasswordFile(options.passwordFile));
  return db.$transaction(async tx => {
    const brand = await tx.$queryRaw<{id: string}[]>`SELECT "id" FROM "Brand" WHERE "id" = ${options.brandId} FOR UPDATE`;
    if (!brand.length) invalid('品牌不存在');
    if (await tx.user.count({where: {brandId: options.brandId, role: 'OWNER'}})) invalid('该品牌已存在管理员，不能重复初始化');
    if (await tx.store.count({where: {id: {in: options.storeIds}, brandId: options.brandId}}) !== options.storeIds.length) invalid('授权门店不存在或不属于该品牌');
    if (await tx.user.findUnique({where: {brandId_staffAccount: {brandId: options.brandId, staffAccount: options.account}}})) invalid('该账号已存在');
    const owner = await tx.user.create({data: {brandId: options.brandId, name: options.name, role: 'OWNER', staffAccount: options.account, passwordHash, staff: {create: options.storeIds.map(storeId => ({storeId}))}}});
    const result = {id: owner.id, brandId: options.brandId, name: options.name, account: options.account, role: 'OWNER', storeIds: options.storeIds};
    await tx.audit.create({data: {storeId: options.storeIds[0], actorId: owner.id, entityId: owner.id, action: 'OWNER_BOOTSTRAP', after: result}});
    return result;
  }, {isolationLevel: 'ReadCommitted', timeout: 15000});
}
async function main() {
  let db: PrismaClient | undefined;
  try {
    const input = parseBootstrapArgs(process.argv.slice(2));
    if (!process.env.DATABASE_URL) invalid('必须显式配置数据库连接');
    // Disable engine diagnostics even when the caller enables Prisma DEBUG logging.
    delete process.env.DEBUG;
    const {PrismaClient} = await import('@prisma/client');
    db = new PrismaClient({log: []});
    await bootstrapOwner(db, input);
    console.log('管理员初始化成功');
  } catch {
    // Raw database, validation and OS errors may contain supplied credentials or SQL arguments.
    console.error('管理员初始化失败：请检查参数、受限密码文件、品牌及门店；已有管理员时禁止重复初始化');
    process.exitCode = 1;
  } finally { await db?.$disconnect().catch(() => { process.exitCode = 1; }); }
}
if (require.main === module) void main();
