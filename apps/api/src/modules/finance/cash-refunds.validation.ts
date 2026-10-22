import {createHash} from 'node:crypto';
import {fail, money, object, str} from '../../common/domain';

export function cashRefundInput(orderId: string, body: unknown, header: unknown) {
  const b = object(body, ['storeId', 'amountFen', 'reason']);
  const storeId = str(b.storeId, '门店');
  const amountFen = money(b.amountFen);
  if (amountFen === 0) fail('VALIDATION_ERROR', '退款金额必须大于零');
  const reason = str(b.reason, '退款原因', 500).trim();
  const idempotencyKey = str(header, 'Idempotency-Key', 120);
  const requestHash = createHash('sha256').update(JSON.stringify({orderId, storeId, amountFen, reason})).digest('hex');
  return {storeId, amountFen, reason, idempotencyKey, requestHash};
}
