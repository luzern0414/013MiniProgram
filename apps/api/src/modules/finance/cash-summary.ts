import {Prisma} from '@prisma/client';
import {dateRange, serviceDate} from '../pickup/pickup.validation';

// Cash receipts and returns use the same Shanghai business-date range, each on its own occurrence date.
export function cashDateRange(from = serviceDate(new Date()), to = from) {
  return dateRange(from, to);
}
export async function cashSummary(tx: Prisma.TransactionClient, storeId: string, range: {gte: Date; lt: Date}) {
  const [payments, refunds] = await Promise.all([
    tx.cashPayment.aggregate({where: {order: {storeId}, createdAt: range}, _sum: {amountFen: true}}),
    tx.cashRefund.aggregate({where: {payment: {order: {storeId}}, createdAt: range}, _sum: {amountFen: true}}),
  ]);
  const paidRevenueFen = payments._sum.amountFen || 0, refundFen = refunds._sum.amountFen || 0;
  return {paidRevenueFen, refundFen, netRevenueFen: paidRevenueFen - refundFen};
}
