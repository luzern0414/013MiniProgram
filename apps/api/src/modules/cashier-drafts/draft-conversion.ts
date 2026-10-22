import {Prisma} from '@prisma/client';
import {fail} from '../../common/domain';
import {AuthService} from '../auth/auth.service';
import {DraftBinding} from './cashier-drafts.validation';
// Draft row first; order creation keeps its modifier -> SKU -> slot -> sequence order.
export async function lockedDraft(tx: Prisma.TransactionClient, id: string, storeId: string) {
  try {
    await tx.$queryRaw`SELECT "id" FROM "CashierDraft" WHERE "id"=${id} AND "storeId"=${storeId} FOR UPDATE`;
  } catch (error: any) {
    // Raw queries surface PostgreSQL serialization/deadlock SQLSTATE as P2010 rather than P2034.
    // Normalize only those states so Db.atomic retries the complete transaction, including authorization.
    if (error.code === 'P2010' && ['40001', '40P01'].includes(error.meta?.code)) throw new Prisma.PrismaClientKnownRequestError('Draft lock transaction retry', {code: 'P2034', clientVersion: Prisma.prismaVersion.client});
    throw error;
  }
  const draft = await tx.cashierDraft.findUnique({where: {id}});
  if (!draft) fail('NOT_FOUND', '挂单不存在', 404);
  if (draft.storeId !== storeId) fail('FORBIDDEN', '挂单不属于此门店', 403);
  return draft;
}
export function assertDraft(draft: {state: string; revision: number}, expectedRevision: number) {
  if (draft.state === 'CONVERTED') fail('DRAFT_ALREADY_CONVERTED', '挂单已转为订单，请查看订单', 409);
  if (draft.state !== 'DRAFT' || draft.revision !== expectedRevision) fail('DRAFT_CHANGED', '挂单已变更，请重新读取后核对', 409);
}
export async function prepareConversion(tx: Prisma.TransactionClient, auth: AuthService, req: any, storeId: string, binding: DraftBinding) {
  await auth.staff(req, storeId, false, tx);
  const draft = await lockedDraft(tx, binding.id, storeId); assertDraft(draft, binding.revision);
  return draft;
}
export async function finishConversion(tx: Prisma.TransactionClient, binding: DraftBinding, orderId: string, storeId: string, actorId: string) {
  const changed = await tx.cashierDraft.updateMany({where: {id: binding.id, storeId, state: 'DRAFT', revision: binding.revision}, data: {state: 'CONVERTED', orderId, revision: {increment: 1}, updatedById: actorId, updatedAt: new Date()}});
  if (!changed.count) fail('DRAFT_CHANGED', '挂单已变更，请重新读取后核对', 409);
  await tx.audit.create({data: {storeId, actorId, action: 'CASHIER_DRAFT_CONVERTED', entityId: binding.id, before: {state: 'DRAFT', revision: binding.revision}, after: {state: 'CONVERTED', revision: binding.revision + 1, orderId}}});
}
