import {Inject, Injectable} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import {Db} from '../../common/db';
import {fail, str} from '../../common/domain';
import {AuthService} from '../auth/auth.service';
import {OrdersService} from '../orders/orders.service';
import {assertDraft, lockedDraft} from './draft-conversion';
import {DraftSelection, readQuery, version, write} from './cashier-drafts.validation';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export function draftView(d: any) {
  const {id, storeId, name, revision, state, selection, display, orderId, createdAt, updatedAt} = d;
  return {id, storeId, name, revision, state, selection, display, orderId, createdAt, updatedAt};
}
@Injectable()
export class CashierDraftsService {
  constructor(@Inject(Db) private db: Db, @Inject(AuthService) private auth: AuthService, @Inject(OrdersService) private orders: OrdersService) {}
  // Saving checks existence/ownership. Availability is evaluated by the shared quote path.
  private async display(tx: Prisma.TransactionClient, storeId: string, selection: DraftSelection) {
    if (selection.tableCode && !await tx.diningTable.findFirst({where: {storeId, code: selection.tableCode}})) fail('VALIDATION_ERROR', '桌码不属于此门店');
    if (selection.pickupSlotId && !await tx.pickupSlot.findFirst({where: {id: selection.pickupSlotId, storeId}})) fail('VALIDATION_ERROR', '预约时段不存在或不属于此门店，请重新核对');
    const lines = [];
    for (const line of selection.lines) {
      const sku = await tx.sku.findUnique({where: {id: line.skuId}, include: {product: {include: {modifiers: true, attributeGroups: {include: {options: true}}}}}});
      if (!sku || sku.product.storeId !== storeId) fail('VALIDATION_ERROR', '原商品不存在或不属于此门店，请重新核对后保存');
      const modifierNames = line.modifierIds.map(id => {
        const modifier = sku.product.modifiers.find(m => m.id === id);
        if (!modifier) fail('VALIDATION_ERROR', '原加料不存在或不属于此商品，请重新核对后保存');
        return modifier.name;
      });
      const attributeNames = line.attributeOptionIds.map(id => {
        const option = sku.product.attributeGroups.flatMap(g => g.options).find(o => o.id === id);
        if (!option) fail('VALIDATION_ERROR', '原口味选项不存在或不属于此商品，请重新核对后保存');
        return option.name;
      });
      lines.push({skuId: sku.id, productName: sku.product.name, skuName: sku.name, modifierNames, attributeNames});
    }
    return {lines};
  }
  async create(req: any, body: unknown) {
    const b = write(body), key = str(req.headers['idempotency-key'], 'Idempotency-Key', 120);
    await this.auth.staff(req, b.storeId);
    return this.db.atomic(async tx => {
      const user = await this.auth.staff(req, b.storeId, false, tx);
      const hash = createHash('sha256').update(JSON.stringify({createdById: user.id, storeId: b.storeId, name: b.name, selection: b.selection})).digest('hex');
      const existing = await tx.cashierDraft.findUnique({where: {storeId_createKey: {storeId: b.storeId, createKey: key}}});
      if (existing) {
        if (existing.createHash !== hash) fail('IDEMPOTENCY_CONFLICT', '幂等键已绑定其他挂单请求', 409);
        return draftView(existing);
      }
      const display = await this.display(tx, b.storeId, b.selection), now = new Date();
      const draft = await tx.cashierDraft.create({data: {storeId: b.storeId, name: b.name, selection: json(b.selection), display: json(display), createKey: key, createHash: hash, createdById: user.id, updatedById: user.id, createdAt: now, updatedAt: now}});
      await tx.audit.create({data: {storeId: b.storeId, actorId: user.id, action: 'CASHIER_DRAFT_CREATED', entityId: draft.id, after: {state: 'DRAFT', revision: 0}}});
      return draftView(draft);
    });
  }
  async list(req: any, query: unknown) {
    const {storeId, state, page, pageSize} = readQuery(query, true);
    return this.db.atomic(async tx => {
      await this.auth.staff(req, storeId, false, tx);
      const where = {storeId, state};
      const total = await tx.cashierDraft.count({where}), skip = (page - 1) * pageSize;
      const items = skip >= total ? [] : await tx.cashierDraft.findMany({where, orderBy: [{updatedAt: 'desc'}, {id: 'desc'}], skip, take: pageSize});
      return {items: items.map(draftView), total, page, pageSize};
    });
  }
  async get(req: any, id: string, query: unknown) {
    str(id, 'id'); const {storeId} = readQuery(query);
    return this.db.atomic(async tx => {
      await this.auth.staff(req, storeId, false, tx);
      const draft = await tx.cashierDraft.findUnique({where: {id}});
      if (!draft) fail('NOT_FOUND', '挂单不存在', 404);
      if (draft.storeId !== storeId) fail('FORBIDDEN', '挂单不属于此门店', 403);
      return draftView(draft);
    });
  }
  async update(req: any, id: string, body: unknown) {
    str(id, 'id'); const b = write(body, true); await this.auth.staff(req, b.storeId);
    return this.db.atomic(async tx => {
      const user = await this.auth.staff(req, b.storeId, false, tx), draft = await lockedDraft(tx, id, b.storeId);
      assertDraft(draft, b.expectedRevision!);
      const display = await this.display(tx, b.storeId, b.selection);
      const changed = await tx.cashierDraft.updateMany({where: {id, storeId: b.storeId, state: 'DRAFT', revision: b.expectedRevision}, data: {name: b.name, selection: json(b.selection), display: json(display), revision: {increment: 1}, updatedById: user.id, updatedAt: new Date()}});
      if (!changed.count) fail('DRAFT_CHANGED', '挂单已变更，请重新读取后核对', 409);
      await tx.audit.create({data: {storeId: b.storeId, actorId: user.id, action: 'CASHIER_DRAFT_UPDATED', entityId: id, before: {revision: draft.revision}, after: {revision: draft.revision + 1}}});
      return draftView(await tx.cashierDraft.findUniqueOrThrow({where: {id}}));
    });
  }
  async cancel(req: any, id: string, body: unknown) {
    str(id, 'id'); const b = version(body); await this.auth.staff(req, b.storeId);
    return this.db.atomic(async tx => {
      const user = await this.auth.staff(req, b.storeId, false, tx), draft = await lockedDraft(tx, id, b.storeId);
      if (draft.state === 'CANCELLED') return draftView(draft);
      assertDraft(draft, b.expectedRevision);
      const changed = await tx.cashierDraft.updateMany({where: {id, storeId: b.storeId, state: 'DRAFT', revision: b.expectedRevision}, data: {state: 'CANCELLED', revision: {increment: 1}, updatedById: user.id, updatedAt: new Date()}});
      if (!changed.count) fail('DRAFT_CHANGED', '挂单已变更，请重新读取后核对', 409);
      await tx.audit.create({data: {storeId: b.storeId, actorId: user.id, action: 'CASHIER_DRAFT_CANCELLED', entityId: id, before: {state: draft.state, revision: draft.revision}, after: {state: 'CANCELLED', revision: draft.revision + 1}}});
      return draftView(await tx.cashierDraft.findUniqueOrThrow({where: {id}}));
    });
  }
  async quote(req: any, id: string, body: unknown) {
    str(id, 'id'); const b = version(body); await this.auth.staff(req, b.storeId);
    return this.db.atomic(async tx => {
      await this.auth.staff(req, b.storeId, false, tx); const draft = await lockedDraft(tx, id, b.storeId);
      assertDraft(draft, b.expectedRevision);
      return this.orders.quoteInTransaction(req, {storeId: b.storeId, ...draft.selection as object}, tx, {id, revision: draft.revision});
    });
  }
}
