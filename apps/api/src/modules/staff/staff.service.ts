import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db } from '../../common/db';
import { fail, object, str } from '../../common/domain';
import { AuthService, Identity } from '../auth/auth.service';
import { account, hashPassword, password } from '../auth/credentials';

@Injectable()
export class StaffService {
  constructor(@Inject(Db) private db: Db, @Inject(AuthService) private auth: AuthService) {}

  private view(user: any, actor: Identity) {
    return {id: user.id, name: user.name, role: user.role, enabled: user.enabled, revision: user.revision, account: user.staffAccount,
      storeIds: user.staff.map((s: any) => s.storeId).filter((id: string) => actor.storeIds.includes(id))};
  }
  private stores(value: unknown): string[] {
    if (!Array.isArray(value) || !value.length || value.length > 100) fail('VALIDATION_ERROR', '请选择1至100家授权门店');
    return [...new Set(value.map(id => str(id, '门店', 200)))];
  }
  private revision(value: unknown): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 2_000_000_000) fail('VALIDATION_ERROR', '版本格式不正确');
    return value as number;
  }
  private async allowed(tx: Prisma.TransactionClient, actor: Identity, ids: string[]) {
    if (ids.some(id => !actor.storeIds.includes(id)) || await tx.store.count({where: {id: {in: ids}, brandId: actor.brandId}}) !== ids.length) fail('FORBIDDEN', '无此门店授权权限', 403);
  }
  private async target(tx: Prisma.TransactionClient, id: string, storeId: string, actor: Identity) {
    const user = await tx.user.findUnique({where: {id}, include: {staff: true}});
    if (!user || user.role !== 'CLERK' || user.brandId !== actor.brandId || !user.staff.some(s => s.storeId === storeId)) fail('FORBIDDEN', '无此员工管理权限', 403);
    await this.allowed(tx, actor, user.staff.map(s => s.storeId));
    return user;
  }
  async list(req: any, storeId: unknown) {
    const id = str(storeId, '门店', 200);
    return this.db.atomic(async tx => {
      const actor = await this.auth.staff(req, id, true, tx);
      const users = await tx.user.findMany({where: {brandId: actor.brandId, role: {in: ['OWNER', 'CLERK']}, staff: {some: {storeId: id}}}, include: {staff: true}, orderBy: {id: 'asc'}, take: 100});
      return users.map(user => this.view(user, actor));
    });
  }
  async create(req: any, body: unknown) {
    const b = object(body, ['storeId', 'name', 'account', 'password', 'storeIds']);
    const storeId = str(b.storeId, '门店', 200), name = str(b.name, '姓名', 80), staffAccount = account(b.account), ids = this.stores(b.storeIds);
    password(b.password);
    // Reject unauthorized requests before spending a password KDF, then recheck inside the transaction.
    await this.auth.staff(req, storeId, true);
    const passwordHash = await hashPassword(b.password);
    return this.db.atomic(async tx => {
      const actor = await this.auth.staff(req, storeId, true, tx);
      await this.allowed(tx, actor, ids);
      if (!ids.includes(storeId)) fail('VALIDATION_ERROR', '授权门店需包含当前门店');
      if (await tx.user.findUnique({where: {brandId_staffAccount: {brandId: actor.brandId, staffAccount}}})) fail('ACCOUNT_CONFLICT', '该账号已存在', 409);
      const user = await tx.user.create({data: {brandId: actor.brandId, name, role: 'CLERK', staffAccount, passwordHash, staff: {create: ids.map(storeId => ({storeId}))}}, include: {staff: true}});
      const after = this.view(user, actor);
      await tx.audit.create({data: {storeId, actorId: actor.id, action: 'STAFF_CREATE', entityId: user.id, after}});
      return after;
    });
  }
  async update(req: any, id: string, body: unknown, reset = false) {
    const b = object(body, reset ? ['storeId', 'expectedRevision', 'password'] : ['storeId', 'expectedRevision', 'name', 'enabled', 'storeIds']);
    const storeId = str(b.storeId, '门店', 200), revision = this.revision(b.expectedRevision);
    if (!reset && !['name', 'enabled', 'storeIds'].some(key => b[key] !== undefined)) fail('VALIDATION_ERROR', '请提供要修改的内容');
    const name = b.name === undefined ? undefined : str(b.name, '姓名', 80);
    if (b.enabled !== undefined && typeof b.enabled !== 'boolean') fail('VALIDATION_ERROR', '账号状态格式不正确');
    const ids = b.storeIds === undefined ? undefined : this.stores(b.storeIds);
    if (reset) password(b.password);
    await this.auth.staff(req, storeId, true);
    const passwordHash = reset ? await hashPassword(b.password) : undefined;
    return this.db.atomic(async tx => {
      const actor = await this.auth.staff(req, storeId, true, tx);
      const before = await this.target(tx, id, storeId, actor);
      if (ids) await this.allowed(tx, actor, ids);
      const changed = await tx.user.updateMany({where: {id, revision}, data: {name, enabled: b.enabled, passwordHash, revision: {increment: 1}}});
      if (!changed.count) fail('VERSION_CONFLICT', '员工资料已更新，请刷新后重试', 409);
      const storesChanged = ids && (ids.length !== before.staff.length || before.staff.some(s => !ids.includes(s.storeId)));
      if (storesChanged) {
        await tx.staffStore.deleteMany({where: {userId: id}});
        await tx.staffStore.createMany({data: ids.map(storeId => ({userId: id, storeId}))});
      }
      if (reset || b.enabled === false || storesChanged) await tx.session.deleteMany({where: {userId: id}});
      const updated = await tx.user.findUniqueOrThrow({where: {id}, include: {staff: true}});
      const after = this.view(updated, actor);
      await tx.audit.create({data: {storeId, actorId: actor.id, action: reset ? 'STAFF_PASSWORD_RESET' : 'STAFF_UPDATE', entityId: id, before: this.view(before, actor), after}});
      return after;
    });
  }
}
