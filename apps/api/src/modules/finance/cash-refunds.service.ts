import {Inject, Injectable} from '@nestjs/common';
import {Db} from '../../common/db';
import {fail} from '../../common/domain';
import {AuthService} from '../auth/auth.service';
import {orderInclude, orderView, OrdersService} from '../orders/orders.service';
import {cashRefundInput} from './cash-refunds.validation';
import {advanceShift, lockActiveShift} from './cash-shift-ledger';

@Injectable()
export class CashRefundsService {
  constructor(@Inject(Db) private db: Db, @Inject(AuthService) private auth: AuthService, @Inject(OrdersService) private orders: OrdersService) {}
  async create(req: any, id: string, body: unknown) {
    const input = cashRefundInput(id, body, req.headers['idempotency-key']);
    await this.auth.staff(req, input.storeId, true);
    return this.db.atomic(async tx => {
      // Authorization must precede even a successful idempotent replay.
      const user = await this.auth.staff(req, input.storeId, true, tx);
      const order = await tx.order.findUnique({where: {id}, include: orderInclude});
      if (!order) fail('NOT_FOUND', '订单不存在', 404);
      this.orders.authorize(user, order);
      if (order.storeId !== input.storeId) fail('FORBIDDEN', '订单不属于此门店', 403);
      const payment = await tx.cashPayment.findUnique({where: {orderId: id}});
      if (!payment || order.paymentStatus !== 'PAID') fail('CASH_REFUND_UNAVAILABLE', '此订单没有可退还的现金收款', 409);
      const existing = await tx.cashRefund.findUnique({where: {paymentId_idempotencyKey: {paymentId: payment.id, idempotencyKey: input.idempotencyKey}}});
      if (existing) {
        if (existing.requestHash !== input.requestHash) fail('IDEMPOTENCY_CONFLICT', '幂等键已绑定其他退款请求', 409);
        return orderView(order);
      }
      const shift = await lockActiveShift(tx, order.storeId);
      if (input.amountFen > payment.amountFen - payment.refundedFen) fail('REFUND_EXCEEDS_REMAINING', '退款金额超过剩余可退金额', 409);
      const refundedFen = payment.refundedFen + input.amountFen, full = refundedFen === payment.amountFen;
      const updated = await tx.cashPayment.updateMany({where: {id: payment.id, refundedFen: payment.refundedFen}, data: {refundedFen}});
      if (!updated.count) fail('REFUND_EXCEEDS_REMAINING', '可退余额已变更，请核对后重试', 409);
      const refund = await tx.cashRefund.create({data: {paymentId: payment.id, staffId: user.id, shiftId: shift.id, amountFen: input.amountFen, reason: input.reason, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash}});
      await advanceShift(tx, shift);
      const refundStatus = full ? 'SUCCEEDED' : 'PARTIAL';
      const status = full && order.status !== 'COMPLETED' ? 'CANCELLED' : order.status;
      // Cash has already settled inventory and CONFIRMED capacity. A financial return never settles them again.
      const result = await tx.order.update({where: {id}, data: {status, refundStatus, events: {create: {status, label: `${full ? '现金全额退款' : '现金部分退款'}，已退还${input.amountFen}分：${input.reason}`}}}, include: orderInclude});
      await tx.audit.create({data: {storeId: order.storeId, actorId: user.id, action: 'CASH_REFUND', entityId: id, before: {refundedFen: payment.refundedFen, status: order.status, refundStatus: order.refundStatus}, after: {refundId: refund.id, shiftId: shift.id, amountFen: input.amountFen, reason: input.reason, refundedFen, status, refundStatus}}});
      return orderView(result);
    });
  }
}
