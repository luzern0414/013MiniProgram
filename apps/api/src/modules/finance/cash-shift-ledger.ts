import {Prisma} from '@prisma/client';
import {fail} from '../../common/domain';

export const shiftInclude = {openedBy: {select: {id: true, name: true}}, closedBy: {select: {id: true, name: true}}};
export function safeShiftInteger(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) fail('SHIFT_TOTAL_TOO_LARGE', '班次汇总金额或笔数过大，无法安全处理', 409);
  return Number(value);
}
async function lock(tx: Prisma.TransactionClient, id: string, storeId: string, active: boolean) {
  try {
    return active
      ? await tx.$queryRaw<{id: string}[]>`SELECT "id" FROM "CashShift" WHERE "storeId"=${storeId} AND "state"='OPEN' FOR UPDATE`
      : await tx.$queryRaw<{id: string}[]>`SELECT "id" FROM "CashShift" WHERE "id"=${id} AND "storeId"=${storeId} FOR UPDATE`;
  } catch (error: any) {
    // Prisma wraps raw PostgreSQL serialization/deadlock errors. Retry the entire atomic transaction.
    if (error.code === 'P2010' && ['40001', '40P01'].includes(error.meta?.code)) throw new Prisma.PrismaClientKnownRequestError('Cash shift lock transaction retry', {code: 'P2034', clientVersion: Prisma.prismaVersion.client});
    throw error;
  }
}
export async function lockShift(tx: Prisma.TransactionClient, id: string, storeId: string) {
  await lock(tx, id, storeId, false);
  const shift = await tx.cashShift.findUnique({where: {id}, include: shiftInclude});
  if (!shift) fail('NOT_FOUND', '班次不存在', 404);
  if (shift.storeId !== storeId) fail('FORBIDDEN', '班次不属于此门店', 403);
  return shift;
}
export async function lockActiveShift(tx: Prisma.TransactionClient, storeId: string) {
  const rows = await lock(tx, '', storeId, true);
  if (!rows.length) fail('SHIFT_REQUIRED', '请店主先开班，再办理现金收退款', 409);
  const shift = await tx.cashShift.findUniqueOrThrow({where: {id: rows[0].id}});
  if (shift.state !== 'OPEN') fail('SHIFT_REQUIRED', '请店主先开班，再办理现金收退款', 409);
  return shift;
}
export async function advanceShift(tx: Prisma.TransactionClient, shift: {id: string; revision: number; openingFen: bigint}) {
  if (shift.revision >= 2_000_000_000) fail('SHIFT_TOTAL_TOO_LARGE', '班次版本已达上限，请联系店主处理', 409);
  await tx.cashShift.update({where: {id: shift.id}, data: {revision: {increment: 1}}});
  // Refuse an unsafe resulting ledger inside the same financial transaction, before it can commit.
  await shiftSummary(tx, shift);
}
export async function shiftSummary(tx: Prisma.TransactionClient, shift: {id: string; openingFen: bigint}) {
  // SUM(Int) and COUNT(*) remain BIGINT until the explicit safe-integer boundary.
  const [row] = await tx.$queryRaw<{paymentCount: bigint; refundCount: bigint; paidFen: bigint; refundFen: bigint}[]>`
    SELECT p."paymentCount",p."paidFen",r."refundCount",r."refundFen"
    FROM (SELECT COUNT(*) AS "paymentCount",COALESCE(SUM("amountFen"),0)::bigint AS "paidFen" FROM "CashPayment" WHERE "shiftId"=${shift.id}) p
    CROSS JOIN (SELECT COUNT(*) AS "refundCount",COALESCE(SUM("amountFen"),0)::bigint AS "refundFen" FROM "CashRefund" WHERE "shiftId"=${shift.id}) r`;
  const netFen = row.paidFen - row.refundFen, expectedFen = shift.openingFen + netFen;
  const values = {...row, netFen, expectedFen};
  for (const value of Object.values(values)) safeShiftInteger(value);
  return values;
}
export async function shiftView(tx: Prisma.TransactionClient, shift: Prisma.CashShiftGetPayload<{include: typeof shiftInclude}>) {
  const summary = shift.state === 'OPEN' ? {...await shiftSummary(tx, shift), countedFen: null, differenceFen: null, reason: null}
    : {paymentCount: shift.paymentCount!, refundCount: shift.refundCount!, paidFen: shift.paidFen!, refundFen: shift.refundFen!, netFen: shift.netFen!, expectedFen: shift.expectedFen!, countedFen: shift.countedFen!, differenceFen: shift.differenceFen!, reason: shift.reason};
  return {id: shift.id, storeId: shift.storeId, state: shift.state, revision: shift.revision, openingFen: safeShiftInteger(shift.openingFen), openedBy: shift.openedBy, openedAt: shift.openedAt.toISOString(), closedBy: shift.closedBy, closedAt: shift.closedAt?.toISOString() ?? null,
    summary: {paymentCount: safeShiftInteger(summary.paymentCount), refundCount: safeShiftInteger(summary.refundCount), paidFen: safeShiftInteger(summary.paidFen), refundFen: safeShiftInteger(summary.refundFen), netFen: safeShiftInteger(summary.netFen), expectedFen: safeShiftInteger(summary.expectedFen), countedFen: summary.countedFen === null ? null : safeShiftInteger(summary.countedFen), differenceFen: summary.differenceFen === null ? null : safeShiftInteger(summary.differenceFen), reason: summary.reason}};
}
