import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Db } from '../../common/db';
import { assertStoreAccess, fail, object } from '../../common/domain';
import { account, verifyPassword } from './credentials';
import { Prisma } from '@prisma/client';
export type Identity = {id: string; name: string; role: string; brandId: string; storeIds: string[]; balanceFen: number; points: number; levelName: string};
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
@Injectable()
export class AuthService {
  private attempts = new Map<string, {count: number; until: number}>();
  constructor(@Inject(Db) private db: Db) {}
  view(user: any): Identity { return {id: user.id, name: user.name, role: user.role, brandId: user.brandId, storeIds: user.staff.map((s: any) => s.storeId), balanceFen: user.balanceFen, points: user.points, levelName: user.levelName}; }
  async login(body: unknown) {
    if (process.env.NODE_ENV === 'production' || process.env.DEV_AUTH_ENABLED !== 'true') fail('NOT_FOUND', '接口不存在', 404);
    const {account} = object(body, ['account']);
    if (!['customer', 'owner', 'clerk-a', 'clerk-b'].includes(account)) fail('VALIDATION_ERROR', '请选择固定体验账户');
    return this.db.atomic(async tx => {
      const user = await tx.user.findUnique({where: {devAccount: account}, include: {staff: true, brand: true}});
      if (!user?.brand.isExperience) fail('INTEGRATION_UNAVAILABLE', '体验账户尚未初始化', 503);
      if (!user.enabled) fail('UNAUTHENTICATED', '账号已停用', 401);
      return this.session(tx, user, 'development');
    });
  }
  private async session(tx: Prisma.TransactionClient, user: any, environment: string) {
    const token = randomBytes(32).toString('base64url');
    await tx.session.create({data: {tokenHash: hash(token), userId: user.id, expiresAt: new Date(Date.now() + 12 * 3600_000)}});
    return {token, user: this.view(user), environment};
  }
  async staffLogin(body: unknown, req: any) {
    const b = object(body, ['brandId', 'account', 'password']);
    if (typeof b.brandId !== 'string' || !b.brandId || b.brandId.length > 200) fail('VALIDATION_ERROR', '品牌格式不正确');
    const normalized = account(b.account);
    if (typeof b.password !== 'string' || b.password.length > 128) fail('VALIDATION_ERROR', '密码格式不正确');
    const key = hash(JSON.stringify([req.ip || req.socket?.remoteAddress || '', b.brandId, normalized]));
    const now = Date.now();
    for (const [k, entry] of this.attempts) if (entry.until <= now) this.attempts.delete(k);
    let entry = this.attempts.get(key);
    if (!entry) {
      if (this.attempts.size >= 5000) fail('RATE_LIMITED', '登录尝试过多，请稍后重试', 429);
      entry = {count: 0, until: now + 15 * 60_000}; this.attempts.set(key, entry);
    }
    if (++entry.count > 10) fail('RATE_LIMITED', '登录尝试过多，请稍后重试', 429);
    const user = await this.db.user.findUnique({where: {brandId_staffAccount: {brandId: b.brandId, staffAccount: normalized}}});
    const valid = await verifyPassword(b.password, user?.passwordHash);
    if (!valid || !user?.enabled || !['CLERK', 'OWNER'].includes(user.role)) fail('UNAUTHENTICATED', '账号或密码不正确', 401);
    return this.db.atomic(async tx => {
      const current = await tx.user.findUnique({where: {id: user.id}, include: {staff: true}});
      if (!current?.enabled || !['CLERK', 'OWNER'].includes(current.role) || current.passwordHash !== user.passwordHash) fail('UNAUTHENTICATED', '账号或密码不正确', 401);
      return this.session(tx, current, process.env.NODE_ENV || 'development');
    });
  }
  async logout(req: any, body: unknown) {
    object(body, []);
    const token = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,100})$/)?.[1];
    if (token) await this.db.session.deleteMany({where: {tokenHash: hash(token)}});
    return {revoked: true};
  }
  async user(req: any, tx: Prisma.TransactionClient = this.db): Promise<Identity> {
    const token = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,100})$/)?.[1];
    if (!token) fail('UNAUTHENTICATED', '请先登录', 401);
    const session = await tx.session.findUnique({where: {tokenHash: hash(token)}, include: {user: {include: {staff: true, brand: true}}}});
    if (!session || session.expiresAt <= new Date() || !session.user.enabled) fail('UNAUTHENTICATED', '登录已过期', 401);
    if (session.user.devAccount && (process.env.NODE_ENV === 'production' || process.env.DEV_AUTH_ENABLED !== 'true')) fail('UNAUTHENTICATED', '体验会话已停用', 401);
    return this.view(session.user);
  }
  async staff(req: any, storeId: string, owner = false, tx: Prisma.TransactionClient = this.db) {
    const user = await this.user(req, tx);
    assertStoreAccess(user, storeId, owner);
    const store = await tx.store.findUnique({where: {id: storeId}});
    if (!store || store.brandId !== user.brandId) fail('FORBIDDEN', '无此品牌门店权限', 403);
    return user;
  }
}
