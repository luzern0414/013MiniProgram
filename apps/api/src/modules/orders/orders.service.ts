import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Db } from '../../common/db';
import { assertPositiveQuantity, assertStoreAccess, fail, money, object, str, canTransition, transitions } from '../../common/domain';
import { AuthService, Identity } from '../auth/auth.service';
import { assertCategory } from '../catalog/catalog-policy';
import {attributeSelection} from '../catalog/product-options.validation';
import {allocatePickupNumber,bookingFromQuote,holdPickup,pickupQuote,settlePickup} from '../pickup/pickup-capacity';
import {dateRange,pickupDate,serviceDate} from '../pickup/pickup.validation';
import {effectivePaymentDeadline,paymentDeadline,PAYMENT_WINDOW_MS} from './payment-deadline';
import {DraftBinding} from '../cashier-drafts/cashier-drafts.validation';
import {finishConversion, prepareConversion} from '../cashier-drafts/draft-conversion';
import {advanceShift, lockActiveShift} from '../finance/cash-shift-ledger';
export const orderInclude = {events: {orderBy: {createdAt: 'asc' as const}}, store: {select: {brandId: true}}, cash: {select: {amountFen: true, tenderedFen: true, changeFen: true, refundedFen: true, shiftId: true, refunds: {select: {id: true, amountFen: true, reason: true, createdAt: true, shiftId: true}, orderBy: [{createdAt: 'asc' as const}, {id: 'asc' as const}]}}}};
const include = orderInclude;
function inventoryCounts(lines: any[]) {
  const skus = new Map<string, number>(), modifiers = new Map<string, number>();
  for (const line of lines) {
    skus.set(line.skuId, (skus.get(line.skuId) || 0) + line.quantity);
    for (const m of line.modifiers) modifiers.set(m.id, (modifiers.get(m.id) || 0) + line.quantity);
  }
  return {skus: [...skus].sort(([a], [b]) => a.localeCompare(b)), modifiers: [...modifiers].sort(([a], [b]) => a.localeCompare(b))};
}
export const orderView = (o: any) => {
  const {quoteId, idempotencyKey, requestHash, address, inventoryReleased, paymentExpiresAt, cash, store, ...view} = o;
  const refundedFen = cash?.refundedFen ?? 0;
  const cashReceipt = cash ? {amountFen: cash.amountFen, tenderedFen: cash.tenderedFen, changeFen: cash.changeFen, refundedFen, shiftId: cash.shiftId ?? null} : null;
  return {...view, cashReceipt, cashRefunds: cash?.refunds ?? [], refundedFen, netPaidFen: (cash?.amountFen ?? 0) - refundedFen};
};
const json = (value: any): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
@Injectable()
export class OrdersService {
  constructor(@Inject(Db) private db: Db, @Inject(AuthService) private auth: AuthService) {}
  async quote(req: any, body: unknown) {
    await this.auth.user(req);
    return this.db.atomic(tx => this.quoteInTransaction(req, body, tx));
  }
  async quoteInTransaction(req: any, body: unknown, tx: Prisma.TransactionClient, draftBinding?: DraftBinding) {
    const user = await this.auth.user(req, tx);
    const b = object(body, ['storeId', 'mode', 'lines', 'tableCode', 'address', 'note', 'couponId', 'pickupSlotId']);
    const pickupSlotId=b.pickupSlotId===undefined?null:str(b.pickupSlotId,'取餐时段');
    if(pickupSlotId&&b.mode!=='PICKUP')fail('VALIDATION_ERROR','预约时段仅适用于自取订单');
    if (b.mode === 'DELIVERY') fail('INTEGRATION_UNAVAILABLE', '配送范围与配送服务尚未配置，暂不可下配送单', 503);
    const storeId = str(b.storeId, 'storeId');
    if (user.role !== 'CUSTOMER') assertStoreAccess(user, storeId);
    if (b.couponId !== undefined) fail('COUPON_UNSUPPORTED', 'R1尚不支持此优惠券');
    if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 100) fail('VALIDATION_ERROR', '购物车需包含1至100项');
      if (draftBinding) await this.auth.staff(req, storeId, false, tx);
      if (user.role !== 'CUSTOMER') assertStoreAccess(user, storeId);
      const store = await tx.store.findUnique({where: {id: storeId}});
      if (!store || store.brandId !== user.brandId) fail('FORBIDDEN', '门店不可访问', 403);
      if (!store.isOpen) fail('STORE_CLOSED', '门店休息中', 409);
      if (!store.serviceModes.includes(b.mode)) fail('VALIDATION_ERROR', '不支持此服务方式');
      let tableName: string | null = null;
      if (b.mode === 'DINE_IN') {
        const table = await tx.diningTable.findFirst({where: {storeId, code: str(b.tableCode, 'tableCode')}});
        if (!table) fail('VALIDATION_ERROR', '桌码无效');
        tableName = table.name;
      }
      let address: any = undefined;
      if (b.mode === 'DELIVERY') {
        const a = object(b.address, ['name', 'phone', 'detail']);
        address = {name: str(a.name, '姓名', 40), phone: str(a.phone, '电话', 30), detail: str(a.detail, '地址', 300)};
      }
      const lines = [];
      const needed = new Map<string, number>();
      const modifierNeeded = new Map<string, number>();
      for (const input of b.lines) {
        const l = object(input, ['skuId', 'quantity', 'modifierIds', 'attributeOptionIds']);
        const quantity = assertPositiveQuantity(l.quantity);
        if (!Array.isArray(l.modifierIds) || l.modifierIds.length > 20 || l.modifierIds.some((v: any) => typeof v !== 'string')) fail('VALIDATION_ERROR', '加料格式无效');
        const modifierIds = [...new Set<string>(l.modifierIds)].sort();
        const sku = await tx.sku.findUnique({where: {id: str(l.skuId, 'skuId')}, include: {product: {include: {modifiers: true, attributeGroups: {include: {options: true}}}}}});
        if (!sku || sku.product.storeId !== storeId || !sku.product.isAvailable || !sku.enabled) fail('VALIDATION_ERROR', '商品不属于此门店或已下架');
        await assertCategory(tx, sku.product.categoryId, user.brandId, storeId);
        needed.set(sku.id, (needed.get(sku.id) || 0) + quantity);
        if (sku.stock < needed.get(sku.id)!) fail('OUT_OF_STOCK', '商品库存不足', 409);
        const modifiers = modifierIds.map(id => {
          const m = sku.product.modifiers.find(x => x.id === id);
          if (!m || !m.enabled) fail('VALIDATION_ERROR', '加料不属于此商品');
          modifierNeeded.set(id, (modifierNeeded.get(id) || 0) + quantity);
          if (m.stock < modifierNeeded.get(id)!) fail('OUT_OF_STOCK', '加料库存不足', 409);
          return {id, name: m.name, priceFen: m.priceFen};
        });
        const unitPriceFen = money(sku.priceFen + modifiers.reduce((s, m) => s + m.priceFen, 0));
        const attributes = attributeSelection(sku.product, l.attributeOptionIds);
        lines.push({configurationRevision:sku.product.configurationRevision, ...attributes, skuId: sku.id, productName: sku.product.name, skuName: sku.name, quantity, unitPriceFen, modifierIds, modifiers, lineTotalFen: money(quantity * unitPriceFen)});
      }
      const subtotalFen = money(lines.reduce((s, l) => s + l.lineTotalFen, 0));
      if (subtotalFen < store.minOrderFen) fail('MIN_ORDER', '未达到起送/起订金额');
      const deliveryFeeFen = b.mode === 'DELIVERY' ? store.deliveryFeeFen : 0;
      const pickup=pickupSlotId?await pickupQuote(tx,storeId,pickupSlotId):{pickupBooking:null,pickupWindow:null};
      const snapshot = {storeId, mode: b.mode, lines, subtotalFen, packagingFeeFen: 0, deliveryFeeFen, discountFen: 0, totalFen: money(subtotalFen + deliveryFeeFen), note: b.note === undefined ? '' : str(b.note, '备注', 500, true), tableName, address,...pickup, ...(draftBinding ? {cashierDraft: draftBinding} : {})};
      const quote = await tx.quote.create({data: {userId: user.id, storeId, expiresAt: new Date(Date.now() + 5 * 60_000), snapshot: json(snapshot)}});
      const {note, tableName: t, address: a, pickupBooking, ...publicQuote} = snapshot;
      return {id: quote.id, ...publicQuote, expiresAt: quote.expiresAt};
  }
  authorize(user: Identity, order: any) {
    if (order.store?.brandId !== user.brandId) fail('FORBIDDEN', '无此品牌订单权限', 403);
    if (user.role === 'CUSTOMER') { if (order.userId !== user.id) fail('FORBIDDEN', '只能查看本人订单', 403); }
    else assertStoreAccess(user, order.storeId);
  }
  async create(req: any, body: unknown) {
    await this.auth.user(req);
    const b = object(body, ['quoteId']); const quoteId = str(b.quoteId, 'quoteId');
    const key = str(req.headers['idempotency-key'], 'Idempotency-Key', 120);
    const requestHash = createHash('sha256').update(JSON.stringify({quoteId})).digest('hex');
    return this.db.atomic(async tx => {
      const user = await this.auth.user(req, tx);
      const existing = await tx.order.findUnique({where: {userId_idempotencyKey: {userId: user.id, idempotencyKey: key}}, include});
      if (existing) {
        // A successful draft key still requires current staff/store/brand permission.
        if (await tx.cashierDraft.findUnique({where: {orderId: existing.id}})) await this.auth.staff(req, existing.storeId, false, tx);
        this.authorize(user, existing);
        if (existing.requestHash !== requestHash) fail('STATE_CONFLICT', '幂等键已绑定其他请求', 409);
        return orderView(existing);
      }
      const quote = await tx.quote.findUnique({where: {id: quoteId}, include: {store: true, order: true}});
      if (!quote || quote.userId !== user.id) fail('FORBIDDEN', '报价不属于当前用户', 403);
      const q = quote.snapshot as any;
      if (q.cashierDraft) await prepareConversion(tx, this.auth, req, quote.storeId, q.cashierDraft);
      if (quote.order) fail('STATE_CONFLICT', '报价已用于下单', 409);
      if (quote.expiresAt <= new Date()) fail('PRICE_CHANGED', '报价已过期，请重新报价', 409);
      if (!quote.store.isOpen) fail('STORE_CLOSED', '门店休息中', 409);
      if (user.role !== 'CUSTOMER') assertStoreAccess(user, quote.storeId);
      if (!quote.store.serviceModes.includes(q.mode) || q.deliveryFeeFen !== (q.mode === 'DELIVERY' ? quote.store.deliveryFeeFen : 0) || q.subtotalFen < quote.store.minOrderFen) fail('PRICE_CHANGED', '门店规则已变更，请重新报价', 409);
      for (const line of q.lines) {
        const sku = await tx.sku.findUnique({where: {id: line.skuId}, include: {product: {include:{attributeGroups:{include:{options:true}}}}}});
        if (sku && (sku.product.configurationRevision !== (line.configurationRevision ?? 0) || !sku.enabled)) fail('PRODUCT_OPTIONS_CHANGED', '商品选项已变更，请刷新菜单', 409);
        if (!sku || sku.product.storeId !== quote.storeId || !sku.product.isAvailable) fail('OUT_OF_STOCK', '商品已下架', 409);
        await assertCategory(tx, sku.product.categoryId, user.brandId, quote.storeId);
        attributeSelection(sku.product, line.attributeOptionIds);
        let unit = sku.priceFen;
        for (const m of line.modifiers) {
          const current = await tx.modifier.findUnique({where: {id: m.id}});
          if(current && !current.enabled) fail('PRODUCT_OPTIONS_CHANGED','商品选项已变更，请刷新菜单',409);
          if (!current || current.productId !== sku.productId || current.priceFen !== m.priceFen) fail('PRICE_CHANGED', '加料价格已变更', 409);
          unit += current.priceFen;
        }
        if (unit !== line.unitPriceFen) fail('PRICE_CHANGED', '商品价格已变更，请重新报价', 409);
      }
      // Every writer locks aggregated modifier IDs, then SKU IDs, in stable order.
      const counts = inventoryCounts(q.lines);
      for (const [id, quantity] of counts.modifiers) {
        const reserved = await tx.modifier.updateMany({where: {id, enabled:true, product: {storeId: quote.storeId}, stock: {gte: quantity}}, data: {stock: {decrement: quantity}, reserved: {increment: quantity}}});
        if (!reserved.count) fail('OUT_OF_STOCK', '加料库存不足', 409);
      }
      for (const [id, quantity] of counts.skus) {
        const reserved = await tx.sku.updateMany({where: {id, enabled:true, product: {storeId: quote.storeId}, stock: {gte: quantity}}, data: {stock: {decrement: quantity}, reserved: {increment: quantity}}});
        if (!reserved.count) fail('OUT_OF_STOCK', '商品库存不足', 409);
      }
      const booking=bookingFromQuote(q);
      const pickupDate=booking?await holdPickup(tx,quote.storeId,booking):serviceDate(new Date());
      const pickupIdentity=q.mode==='PICKUP'?await allocatePickupNumber(tx,quote.storeId,pickupDate):{};
      const suffix = randomBytes(5).toString('hex').toUpperCase();
      const createdAt = new Date();
      const order = await tx.order.create({data: {createdAt, paymentExpiresAt: paymentDeadline(createdAt), number: `R${Date.now()}${suffix}`, userId: user.id, storeId: quote.storeId, storeName: quote.store.name, quoteId, idempotencyKey: key, requestHash, mode: q.mode, subtotalFen: q.subtotalFen, deliveryFeeFen: q.deliveryFeeFen, packagingFeeFen: q.packagingFeeFen, discountFen: q.discountFen, totalFen: q.totalFen, note: q.note, tableName: q.tableName,...pickupIdentity,pickupWindow:booking?json(q.pickupWindow):Prisma.DbNull,address: q.address ? json(q.address) : undefined, lines: q.lines, events: {create: {status: 'PENDING_PAYMENT', label: '订单已创建，等待付款'}}}, include});
      if(booking)await tx.pickupReservation.create({data:{orderId:order.id,slotId:booking.slotId,state:'HELD'}});
      if (q.cashierDraft) await finishConversion(tx, q.cashierDraft, order.id, quote.storeId, user.id);
      return orderView(order);
    });
  }
  async get(req: any, id: string) {
    const user = await this.auth.user(req);
    const order = await this.db.order.findUnique({where: {id}, include});
    if (!order) fail('NOT_FOUND', '订单不存在', 404);
    this.authorize(user, order); return orderView(order);
  }
  async list(req: any, query: any) {
    const user = await this.auth.user(req);
    if (Object.keys(query).some(key => /^(storeId|pickupNumber|pickupServiceDate)\[/.test(key))) fail('VALIDATION_ERROR', '查询字段必须为字符串');
    if (query.storeId !== undefined) str(query.storeId, 'storeId');
    const pickupSearch = query.pickupNumber !== undefined || query.pickupServiceDate !== undefined;
    let pickupNumber: string | undefined, pickupServiceDate: string | undefined;
    if (pickupSearch) {
      str(query.storeId, 'storeId');
      pickupNumber = str(query.pickupNumber, '取餐号', 100).trim().toUpperCase();
      if (!/^(Q\d{4,}|[A-F0-9]{10})$/.test(pickupNumber)) fail('VALIDATION_ERROR', '请输入完整取餐号');
      pickupServiceDate = pickupDate(query.pickupServiceDate);
      // Refresh authorization against the actual store and brand for every request.
      const store = await this.db.store.findUnique({where: {id: query.storeId}, select: {brandId: true}});
      if (!store || store.brandId !== user.brandId) fail('FORBIDDEN', '门店不可访问', 403);
    }
    if (query.storeId && user.role !== 'CUSTOMER') assertStoreAccess(user, query.storeId);
    const page = Math.max(1, Math.min(10000, Number(query.page) || 1));
    const pageSize = Math.max(1, Math.min(100, Number(query.pageSize) || 20));
    if (!Number.isInteger(page) || !Number.isInteger(pageSize)) fail('VALIDATION_ERROR', '分页必须为整数');
    const where: Prisma.OrderWhereInput = user.role === 'CUSTOMER' ? {userId: user.id} : {storeId: {in: user.storeIds}, store: {brandId: user.brandId}};
    if (query.storeId) where.storeId = query.storeId;
    if (pickupSearch) {
      where.mode = 'PICKUP';
      where.pickupNumber = pickupNumber;
      where.OR = [
        {pickupServiceDate},
        {pickupServiceDate: null, createdAt: dateRange(pickupServiceDate, pickupServiceDate)},
      ];
    }
    if (query.status) {
      if (!['PENDING_PAYMENT','AWAITING_ACCEPTANCE','PREPARING','READY','DELIVERING','COMPLETED','CANCELLED'].includes(query.status)) fail('VALIDATION_ERROR', '状态无效');
      where.status = query.status;
    }
    const [items, total] = await this.db.$transaction([this.db.order.findMany({where, include, orderBy: [{createdAt: 'desc'}, {id: 'desc'}], skip: (page - 1) * pageSize, take: pageSize}), this.db.order.count({where})]);
    return {items: items.map(orderView), total, page, pageSize};
  }
  async settleInventory(tx: Prisma.TransactionClient, order: any, release: boolean) {
    const counts = inventoryCounts(order.lines);
    for (const [id, quantity] of counts.modifiers) {
      const result = await tx.modifier.updateMany({where: {id, product: {storeId: order.storeId}, reserved: {gte: quantity}}, data: {reserved: {decrement: quantity}, ...(release ? {stock: {increment: quantity}} : {})}});
      if (!result.count) fail('STATE_CONFLICT', '加料预占记录冲突', 409);
    }
    for (const [id, quantity] of counts.skus) {
      const result = await tx.sku.updateMany({where: {id, product: {storeId: order.storeId}, reserved: {gte: quantity}}, data: {reserved: {decrement: quantity}, ...(release ? {stock: {increment: quantity}} : {})}});
      if (!result.count) fail('STATE_CONFLICT', '库存预占记录冲突', 409);
    }
    await settlePickup(tx,order.id,release);
  }
  async expireUnpaid(now = new Date()): Promise<number> {
    const candidates = await this.db.order.findMany({where: {status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', inventoryReleased: false, OR: [{paymentExpiresAt: {lte: now}}, {createdAt: {lte: new Date(now.getTime() - PAYMENT_WINDOW_MS)}}]}, orderBy: [{paymentExpiresAt: 'asc'}, {id: 'asc'}], take: 100, select: {id: true}});
    let expired = 0;
    for (const candidate of candidates) {
      expired += await this.db.atomic(async tx => {
        const order = await tx.order.findUniqueOrThrow({where: {id: candidate.id}, include});
        if (order.status !== 'PENDING_PAYMENT' || order.paymentStatus !== 'UNPAID' || order.inventoryReleased || effectivePaymentDeadline(order) > now) return 0;
        await this.settleInventory(tx, order, true);
        await tx.order.update({where: {id: order.id}, data: {status: 'CANCELLED', paymentStatus: 'CLOSED', inventoryReleased: true, events: {create: {status: 'CANCELLED', label: '超过付款时限，订单自动关闭'}}}});
        await tx.audit.create({data: {storeId: order.storeId, actorId: 'system:expiry', action: 'ORDER_EXPIRED', entityId: order.id, before: {status: 'PENDING_PAYMENT'}, after: {status: 'CANCELLED'}}});
        return 1;
      });
    }
    return expired;
  }
  async cancel(req: any, id: string, body: unknown) {
    const b = object(body, ['reason']); if (b.reason !== undefined) str(b.reason, '原因', 500, true);
    await this.auth.user(req);
    return this.db.atomic(async tx => {
      const user = await this.auth.user(req, tx);
      const order = await tx.order.findUnique({where: {id}, include});
      if (!order) fail('NOT_FOUND', '订单不存在', 404); this.authorize(user, order);
      if (order.status === 'CANCELLED') return orderView(order);
      if (order.paymentStatus === 'PAID') fail('REFUND_UNAVAILABLE', '已收款订单请联系门店，由店主处理实际返款', 409);
      if (order.status !== 'PENDING_PAYMENT' || order.inventoryReleased) fail('STATE_CONFLICT', '订单无法取消', 409);
      await this.settleInventory(tx, order, true);
      return orderView(await tx.order.update({where: {id}, data: {status: 'CANCELLED', paymentStatus: 'CLOSED', inventoryReleased: true, events: {create: {status: 'CANCELLED', label: b.reason || '订单已取消'}}}, include}));
    });
  }
  async cash(req: any, id: string, body: unknown) {
    const b = object(body, ['tenderedFen']); const tenderedFen = money(b.tenderedFen);
    await this.auth.user(req);
    return this.db.atomic(async tx => {
      const user = await this.auth.user(req, tx);
      const order = await tx.order.findUnique({where: {id}, include});
      if (!order) fail('NOT_FOUND', '订单不存在', 404); assertStoreAccess(user, order.storeId); this.authorize(user, order);
      if (order.status === 'CANCELLED' && order.refundStatus === 'SUCCEEDED') fail('STATE_CONFLICT', '全额退款订单已关闭，不能再次收款', 409);
      if (order.cash) return orderView(order);
      if (order.status !== 'PENDING_PAYMENT' || order.paymentStatus !== 'UNPAID') fail('STATE_CONFLICT', '订单不可现金收款', 409);
      if (effectivePaymentDeadline(order) <= new Date()) fail('STATE_CONFLICT', '订单付款时限已过，不能收款', 409);
      if (tenderedFen < order.totalFen) fail('VALIDATION_ERROR', '实收金额不足');
      const shift = await lockActiveShift(tx, order.storeId);
      await this.settleInventory(tx, order, false);
      await tx.cashPayment.create({data: {orderId: id, staffId: user.id, shiftId: shift.id, amountFen: order.totalFen, tenderedFen, changeFen: tenderedFen - order.totalFen}});
      await advanceShift(tx, shift);
      await tx.audit.create({data: {storeId: order.storeId, actorId: user.id, action: 'CASH_PAYMENT', entityId: id, after: {shiftId: shift.id, amountFen: order.totalFen, tenderedFen, changeFen: tenderedFen - order.totalFen}}});
      return orderView(await tx.order.update({where: {id}, data: {paymentStatus: 'PAID', status: 'AWAITING_ACCEPTANCE', inventoryReleased: true, events: {create: {status: 'AWAITING_ACCEPTANCE', label: '员工已确认现金收款'}}}, include}));
    });
  }
  async transition(req: any, id: string, body: unknown) {
    const b = object(body, ['action', 'reason']);
    if (b.reason !== undefined) str(b.reason, '原因', 500, true);
    return this.transitionOrder(req,id,b);
  }
  async pickup(req:any,id:string,body:unknown){
    const b=object(body,['storeId','pickupNumber']),storeId=str(b.storeId,'门店'),pickupNumber=str(b.pickupNumber,'取餐号',100);
    return this.transitionOrder(req,id,{action:'COMPLETE'},{storeId,pickupNumber});
  }
  private async transitionOrder(req:any,id:string,b:Record<string,any>,pickup?:{storeId:string;pickupNumber:string}){
    await this.auth.user(req);
    return this.db.atomic(async tx => {
      const user = await this.auth.user(req, tx);
      const order = await tx.order.findUnique({where: {id}, include});
      if (!order) fail('NOT_FOUND', '订单不存在', 404); assertStoreAccess(user, order.storeId); this.authorize(user, order);
      if(pickup){
        if(order.storeId!==pickup.storeId)fail('FORBIDDEN','订单不属于此门店',403);
        if(order.mode!=='PICKUP')fail('STATE_CONFLICT','此订单不是自取订单',409);
        if(order.pickupNumber!==pickup.pickupNumber)fail('VALIDATION_ERROR','取餐号不匹配，请核对顾客凭证');
        if(order.status==='COMPLETED'&&order.paymentStatus==='PAID')return orderView(order);
        if(order.status!=='READY'||order.paymentStatus!=='PAID')fail('STATE_CONFLICT','仅已付款且已备好的订单可以核销取餐',409);
      }
      if (b.action === 'REJECT' && order.paymentStatus === 'PAID') fail('REFUND_UNAVAILABLE', '已收款订单需由店主处理实际返款后关闭', 409);
      if (!canTransition(order.status, b.action, order.mode)) fail('STATE_CONFLICT', '不允许此状态转换', 409);
      const status = b.action === 'REJECT' ? 'CANCELLED' : transitions[order.status][b.action];
      if (b.action === 'REJECT') await this.settleInventory(tx, order, true);
      await tx.audit.create({data: {storeId: order.storeId, actorId: user.id, action: b.action, entityId: id, before: {status: order.status}, after: {status}}});
      return orderView(await tx.order.update({where: {id}, data: {status, ...(b.action === 'REJECT' ? {paymentStatus: 'CLOSED', inventoryReleased: true} : {}), events: {create: {status, label: b.reason || ({PREPARING: '门店已接单，正在制作', READY: '餐品已备好', DELIVERING: '配送中', COMPLETED: '订单已完成', CANCELLED: '门店已拒绝订单'} as any)[status]}}}, include}));
    });
  }
}
