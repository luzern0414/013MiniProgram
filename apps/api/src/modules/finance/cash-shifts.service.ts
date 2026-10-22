import {Inject, Injectable} from '@nestjs/common';
import {Db} from '../../common/db';
import {fail, str} from '../../common/domain';
import {AuthService} from '../auth/auth.service';
import {closeInput, openInput, readQuery, requestHash} from './cash-shifts.validation';
import {lockShift, safeShiftInteger, shiftInclude, shiftSummary, shiftView} from './cash-shift-ledger';

@Injectable()
export class CashShiftsService {
  constructor(@Inject(Db) private db: Db, @Inject(AuthService) private auth: AuthService) {}
  async list(req: any, query: unknown) {
    const {storeId, state, page, pageSize} = readQuery(query, true);
    await this.auth.staff(req, storeId);
    return this.db.atomic(async tx => {
      await this.auth.staff(req, storeId, false, tx);
      const where = {storeId, ...(state === 'ALL' ? {} : {state})};
      const total = await tx.cashShift.count({where});
      const offset = (page - 1) * pageSize;
      const rows = offset >= total ? [] : await tx.cashShift.findMany({where, include: shiftInclude, orderBy: [{openedAt: 'desc'}, {id: 'desc'}], skip: offset, take: pageSize});
      return {items: await Promise.all(rows.map(row => shiftView(tx, row))), total, page, pageSize};
    });
  }
  async current(req: any, query: unknown) {
    const {storeId} = readQuery(query);
    await this.auth.staff(req, storeId);
    return this.db.atomic(async tx => {
      await this.auth.staff(req, storeId, false, tx);
      const shift = await tx.cashShift.findFirst({where: {storeId, state: 'OPEN'}, include: shiftInclude});
      return {shift: shift ? await shiftView(tx, shift) : null};
    });
  }
  async detail(req: any, id: string, query: unknown) {
    str(id, '班次'); const {storeId} = readQuery(query);
    await this.auth.staff(req, storeId);
    return this.db.atomic(async tx => {
      await this.auth.staff(req, storeId, false, tx);
      const shift = await tx.cashShift.findUnique({where: {id}, include: shiftInclude});
      if (!shift) fail('NOT_FOUND', '班次不存在', 404);
      if (shift.storeId !== storeId) fail('FORBIDDEN', '班次不属于此门店', 403);
      return shiftView(tx, shift);
    });
  }
  async open(req: any, body: unknown) {
    const input = openInput(body, req.headers['idempotency-key']);
    await this.auth.staff(req, input.storeId, true);
    return this.db.atomic(async tx => {
      const user = await this.auth.staff(req, input.storeId, true, tx);
      const hash = requestHash(user.id, {storeId: input.storeId, openingFen: input.openingFen});
      const existing = await tx.cashShift.findUnique({where: {storeId_createKey: {storeId: input.storeId, createKey: input.key}}, include: shiftInclude});
      if (existing) {
        if (existing.createHash !== hash) fail('IDEMPOTENCY_CONFLICT', '幂等键已绑定其他开班请求', 409);
        return shiftView(tx, existing);
      }
      if (await tx.cashShift.findFirst({where: {storeId: input.storeId, state: 'OPEN'}})) fail('SHIFT_ALREADY_OPEN', '此门店已经开班，请查看当前班次', 409);
      const shift = await tx.cashShift.create({data: {storeId: input.storeId, openingFen: BigInt(input.openingFen), openedById: user.id, createKey: input.key, createHash: hash}, include: shiftInclude});
      await tx.audit.create({data: {storeId: input.storeId, actorId: user.id, action: 'CASH_SHIFT_OPENED', entityId: shift.id, after: {openingFen: input.openingFen, revision: 0}}});
      return shiftView(tx, shift);
    });
  }
  async close(req: any, id: string, body: unknown) {
    str(id, '班次'); const input = closeInput(body, req.headers['idempotency-key']);
    await this.auth.staff(req, input.storeId, true);
    return this.db.atomic(async tx => {
      const user = await this.auth.staff(req, input.storeId, true, tx);
      const shift = await lockShift(tx, id, input.storeId);
      const hash = requestHash(user.id, {id, storeId: input.storeId, expectedRevision: input.expectedRevision, countedFen: input.countedFen, reason: input.reason});
      const existing = await tx.cashShift.findUnique({where: {storeId_closeKey: {storeId: input.storeId, closeKey: input.key}}});
      if (existing) {
        if (existing.id !== id || existing.closeHash !== hash) fail('IDEMPOTENCY_CONFLICT', '幂等键已绑定其他关班请求', 409);
        return shiftView(tx, shift);
      }
      if (shift.state !== 'OPEN' || shift.revision !== input.expectedRevision) fail('SHIFT_CHANGED', '班次已变化，请重新核对后确认', 409);
      if (shift.revision >= 2_000_000_000) fail('SHIFT_TOTAL_TOO_LARGE', '班次版本已达上限', 409);
      const summary = await shiftSummary(tx, shift), differenceFen = BigInt(input.countedFen) - summary.expectedFen;
      safeShiftInteger(differenceFen);
      if (differenceFen !== 0n && !input.reason) fail('VALIDATION_ERROR', '现金存在差额，请填写原因');
      const result = await tx.cashShift.update({where: {id}, data: {state: 'CLOSED', revision: {increment: 1}, closedById: user.id, closedAt: new Date(), closeKey: input.key, closeHash: hash, ...summary, countedFen: BigInt(input.countedFen), differenceFen, reason: input.reason || null}, include: shiftInclude});
      const view = await shiftView(tx, result);
      await tx.audit.create({data: {storeId: input.storeId, actorId: user.id, action: 'CASH_SHIFT_CLOSED', entityId: id, before: {revision: shift.revision, state: 'OPEN'}, after: {revision: result.revision, state: 'CLOSED', summary: view.summary}}});
      return view;
    });
  }
}
