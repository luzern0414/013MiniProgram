import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db } from '../../common/db';
import { fail, money, object, str, maskPhone } from '../../common/domain';
import { AuthService } from '../auth/auth.service';
import { CatalogService } from '../catalog/catalog.service';
import { assertCategory, resolveUnit } from '../catalog/catalog-policy';
import {cashDateRange, cashSummary} from '../finance/cash-summary';
const safeJson = (v: any): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
const image = (v: unknown) => {
  if (v === null) return null;
  const text = str(v, 'imageUrl', 2000); let url: URL;
  try { url = new URL(text); } catch { return fail('VALIDATION_ERROR', '图片地址无效'); }
  if (!['http:', 'https:'].includes(url.protocol)) fail('VALIDATION_ERROR', '图片需使用http(s)地址');
  return text;
};
@Controller('merchant')
export class MerchantController {
  constructor(@Inject(Db) private db: Db, @Inject(AuthService) private auth: AuthService, @Inject(CatalogService) private catalog: CatalogService) {}
  @Get('overview') async overview(@Req() req: any, @Query('storeId') storeId: string) {
    await this.auth.staff(req, storeId);
    const range = cashDateRange();
    const [cash, counts, lowStockCount] = await this.db.$transaction(async tx => Promise.all([
      cashSummary(tx, storeId, range),
      tx.order.groupBy({by: ['status'], orderBy: {status: 'asc'}, where: {storeId, createdAt: range}, _count: {_all: true}}),
      tx.sku.count({where: {product: {storeId, isAvailable: true}, stock: {lte: 5}}}),
    ]));
    const countRows = counts as {status: string; _count: {_all: number}}[];
    const count = (statuses: string[]) => countRows.filter(c => statuses.includes(c.status)).reduce((s, c) => s + c._count._all, 0);
    return {...cash, orderCount: countRows.reduce((s, c) => s + c._count._all, 0), pendingCount: count(['PENDING_PAYMENT', 'AWAITING_ACCEPTANCE']), preparingCount: count(['PREPARING']), readyCount: count(['READY']), lowStockCount};
  }
  @Patch('stores/:storeId') async store(@Req() req: any, @Param('storeId') storeId: string, @Body() body: unknown) {
    const b = object(body, ['name','address','phone','notice','isOpen','pickupMinutes','deliveryFeeFen','minOrderFen','themeColor']);
    const user = await this.auth.staff(req, storeId, Object.keys(b).some(k => k !== 'isOpen'));
    for (const key of ['name','address','phone','notice']) if (b[key] !== undefined) str(b[key], key, key === 'notice' ? 1000 : 300, key === 'notice');
    if (b.isOpen !== undefined && typeof b.isOpen !== 'boolean') fail('VALIDATION_ERROR', 'isOpen需为布尔值');
    for (const key of ['pickupMinutes','deliveryFeeFen','minOrderFen']) if (b[key] !== undefined) money(b[key]);
    if (b.themeColor !== undefined && !/^#[0-9a-f]{6}$/i.test(b.themeColor)) fail('VALIDATION_ERROR', '颜色无效');
    return this.db.atomic(async tx => {
      const before = await tx.store.findUniqueOrThrow({where: {id: storeId}});
      const after = await tx.store.update({where: {id: storeId}, data: b});
      await tx.audit.create({data: {storeId, actorId: user.id, action: 'STORE_UPDATE', entityId: storeId, before: safeJson(before), after: safeJson(after)}});
      return after;
    });
  }
  @Get('products') async products(@Req() req: any, @Query('storeId') storeId: string) { await this.auth.staff(req, storeId); return this.catalog.get(storeId, true); }
  @Post('products') async createProduct(@Req() req: any, @Body() body: unknown) {
    const b = object(body, ['storeId','categoryId','name','description','imageUrl','unit','unitId','skus']);
    const storeId = str(b.storeId, '门店');
    await this.auth.staff(req, storeId, true);
    const categoryId = str(b.categoryId, '分类');
    if (!Array.isArray(b.skus) || !b.skus.length || b.skus.length > 20) fail('VALIDATION_ERROR', '需提供1至20种规格');
    const skus = b.skus.map((v: unknown) => { const s = object(v, ['name','priceFen','stock']); return {name: str(s.name, '规格名称', 80), priceFen: money(s.priceFen), stock: money(s.stock)}; });
    const data = {storeId, categoryId, name: str(b.name, '商品名称', 100), description: str(b.description, '描述', 1000, true), imageUrl: b.imageUrl === undefined ? null : image(b.imageUrl), skus: {create: skus}};
    return this.db.atomic(async tx => {
      const user = await this.auth.staff(req, storeId, true, tx);
      await assertCategory(tx, categoryId, user.brandId, storeId);
      const unit = await resolveUnit(tx, user.brandId, b);
      const p = await tx.product.create({data: {...data, ...unit}, include: {skus: true, modifiers: true, unitDefinition: true}});
      await tx.audit.create({data: {storeId: b.storeId, actorId: user.id, action: 'PRODUCT_CREATE', entityId: p.id, after: safeJson(p)}}); return {...p, unit:p.unitDefinition?.name ?? p.unit};
    });
  }
  @Patch('products/:productId') async editProduct(@Req() req: any, @Param('productId') id: string, @Body() body: unknown) {
    const b = object(body, ['storeId','categoryId','name','description','isAvailable','imageUrl','unit','unitId']);
    await this.auth.staff(req, b.storeId, true);
    const {storeId, ...data} = b;
    for (const k of ['name','description']) if (data[k] !== undefined) str(data[k], k, k === 'description' ? 1000 : 100, k === 'description');
    if (data.imageUrl !== undefined) data.imageUrl = image(data.imageUrl);
    if (data.isAvailable !== undefined && typeof data.isAvailable !== 'boolean') fail('VALIDATION_ERROR', 'isAvailable需为布尔值');
    return this.db.atomic(async tx => {
      const user = await this.auth.staff(req, storeId, true, tx);
      const before = await tx.product.findFirst({where: {id, storeId}}); if (!before) fail('FORBIDDEN', '商品不属于此门店', 403);
      if (data.categoryId !== undefined) await assertCategory(tx, str(data.categoryId, '分类'), user.brandId, storeId);
      const patch = {...data};
      if (data.unitId !== undefined || data.unit !== undefined) Object.assign(patch, await resolveUnit(tx, user.brandId, data));
      const after = await tx.product.update({where: {id}, data:patch, include: {unitDefinition: true}});
      await tx.audit.create({data: {storeId, actorId: user.id, action: 'PRODUCT_UPDATE', entityId: id, before: safeJson(before), after: safeJson(after)}}); return {...after, unit:after.unitDefinition?.name ?? after.unit};
    });
  }
  @Patch('skus/:skuId') async editSku(@Req() req: any, @Param('skuId') id: string, @Body() body: unknown) {
    const b = object(body, ['storeId','priceFen','stock']); await this.auth.staff(req, b.storeId, true);
    const {storeId, ...data} = b; for (const k of Object.keys(data)) money(data[k]);
    return this.db.atomic(async tx => {
      const user = await this.auth.staff(req, storeId, true, tx);
      const before = await tx.sku.findFirst({where: {id, product: {storeId}}}); if (!before) fail('FORBIDDEN', '规格不属于此门店', 403);
      if (data.stock !== undefined && data.stock + before.reserved > 2_000_000_000) fail('VALIDATION_ERROR', '可售库存与预占总量过大');
      // Lock the parent before SKU writes, as configuration saves do.
      const priceChanged = data.priceFen !== undefined && data.priceFen !== before.priceFen;
      await tx.product.update({where:{id:before.productId},data:{configurationRevision:{increment:priceChanged?1:0}}});
      const after = await tx.sku.update({where: {id}, data});
      await tx.audit.create({data: {storeId, actorId: user.id, action: 'SKU_UPDATE', entityId: id, before: safeJson(before), after: safeJson(after)}}); return after;
    });
  }
  @Get('members') async members(@Req() req: any, @Query('storeId') storeId: string, @Query('search') search = '') {
    const user = await this.auth.staff(req, storeId); str(search, 'search', 100, true);
    const members = await this.db.user.findMany({where: {brandId: user.brandId, role: 'CUSTOMER', ...(search ? {OR: [{name: {contains: search, mode: 'insensitive'}}, {phone: {contains: search}}]} : {})}, take: 100, select: {id: true, name: true, phone: true, levelName: true, balanceFen: true, points: true}});
    return members.map(m => ({...m, phone: maskPhone(m.phone)}));
  }
  @Get('audit') async audit(@Req() req: any, @Query('storeId') storeId: string, @Query('page') pageValue = '1') {
    await this.auth.staff(req, storeId, true); const page = Number(pageValue);
    if (!Number.isInteger(page) || page < 1 || page > 10000) fail('VALIDATION_ERROR', '分页无效');
    const [items, total] = await this.db.$transaction([this.db.audit.findMany({where: {storeId}, orderBy: {createdAt: 'desc'}, take: 20, skip: (page - 1) * 20}), this.db.audit.count({where: {storeId}})]);
    return {items, total, page, pageSize: 20};
  }
}
