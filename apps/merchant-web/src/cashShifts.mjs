import { validShift, readShiftAttempt } from '../../../packages/mini-core/src/cash-shifts.mjs';
import { readRefundAttempt } from '../../../packages/mini-core/src/cash-refunds.mjs';
import { readDraftAttempt } from '../../../packages/mini-core/src/cashier-drafts.mjs';
import { webDraftStorage } from './cashierDrafts.mjs';
import { createRecovery } from './recovery.mjs';

export async function readActiveShift(request, storeId) {
  const value = await request(`/merchant/cash-shifts/current?storeId=${encodeURIComponent(storeId)}`);
  if (!value || !Object.hasOwn(value,'shift') || (value.shift !== null && (!validShift(value.shift,storeId) || value.shift.state !== 'OPEN'))) throw Error('活动班次读取不完整，请重新读取');
  return value.shift;
}
export async function requireActiveShift(request, storeId) {
  const shift = await readActiveShift(request,storeId);
  if (!shift) throw Object.assign(Error('尚未开班，请店主先开班，再返回原订单确认现金。'), {code:'SHIFT_REQUIRED',status:409});
  return shift;
}
// A new cash/refund must respect an unresolved shift even when its page is absent.
// Existing unknown operations keep their original recovery path and payload.
export function requireSettledShift(storage, userId) {
  const pending = readShiftAttempt(webDraftStorage(storage), userId);
  if (pending.error || pending.attempt) throw Object.assign(Error('原交班操作待核对，请先恢复现金交班。'), {code:'SHIFT_RECOVERY'});
}
// Orders uses the existing cashier state machine; handing off never sends cash.
export function handoffCashOrder({ storage, userId, storeId, order, tendered, key }) {
  const adapter = webDraftStorage(storage);
  for (const read of [readShiftAttempt,readRefundAttempt,readDraftAttempt]) {
    const pending = read(adapter,userId);
    if (pending.error || pending.attempt) throw Error('请先核对原收银、退款或交班操作');
  }
  const hint = storage.getItem('merchant-active-checkout');
  if (hint) {
    let active;try {active=JSON.parse(hint);}catch {throw Error('原收银记录尚待核对');}
    if (active.userId === userId && active.storeId !== storeId) throw Error('请先回原门店核对收银');
  }
  const recovery = createRecovery(storage,userId,storeId), existing = recovery.read();
  const raw = storage.getItem(`merchant-checkout:${encodeURIComponent(userId)}:${encodeURIComponent(storeId)}`);
  if ((raw !== null && !existing) || existing?.uncertain || existing?.paid || (existing?.order && existing.order.id !== order.id)) throw Error('已有收银账单待核对，请先前往门店收银');
  if (!order || order.storeId !== storeId || order.paymentStatus !== 'UNPAID' || order.status !== 'PENDING_PAYMENT') throw Error('订单状态已变化，请重新读取详情');
  const next = {...existing,order,tendered,submittedFen:undefined,uncertain:false,terminal:false,orderKey:existing?.orderKey || key};
  recovery.save(next);
  if (JSON.stringify(recovery.read()) !== JSON.stringify(JSON.parse(JSON.stringify(next)))) throw Error('收银进度保存失败，请检查存储后重试');
  return next;
}
