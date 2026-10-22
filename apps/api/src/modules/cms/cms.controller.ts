import { Body, Controller, Get, Inject, Post, Put, Query, Req } from '@nestjs/common';
import { Db } from '../../common/db';
import { AuthService } from '../auth/auth.service';
import { fail, object, str } from '../../common/domain';
import { PublicBrand } from '../../common/public-brand';
@Controller()
export class CmsController {
  constructor(@Inject(Db) private db: Db, @Inject(AuthService) private auth: AuthService, @Inject(PublicBrand) private publicBrand: PublicBrand) {}
  @Get('public-config') async config(@Query('storeId') storeId?: string) {
    const brandId = await this.publicBrand.id();
    const store = await this.db.store.findFirst({where: {brandId, ...(storeId ? {id: storeId} : {})}, orderBy: {id: 'asc'}, include: {brand: true, page: true}});
    if (!store?.page) fail('NOT_FOUND', '品牌页面尚未发布', 404);
    const p = store.page.published as any;
    return {brandId, brandName: store.brand.name, environment: process.env.NODE_ENV === 'production' ? 'production' : process.env.NODE_ENV === 'test' ? 'test' : 'development', home: {notice: p.notice, bannerTitle: p.bannerTitle, bannerSubtitle: p.bannerSubtitle}, theme: {primaryColor: p.primaryColor}};
  }
  @Get('merchant/page') async get(@Req() req: any, @Query('storeId') storeId: string) {
    await this.auth.staff(req, storeId); const p = await this.db.page.findUnique({where: {storeId}});
    if (!p) fail('NOT_FOUND', '页面尚未初始化', 404); return {draft: p.draft, published: p.published, version: p.version};
  }
  @Put('merchant/page') async draft(@Req() req: any, @Query('storeId') storeId: string, @Body() body: unknown) {
    const user = await this.auth.staff(req, storeId, true); const b = object(body, ['notice','bannerTitle','bannerSubtitle','primaryColor']);
    const data = {notice: str(b.notice, 'notice', 1000, true), bannerTitle: str(b.bannerTitle, 'bannerTitle', 100, true), bannerSubtitle: str(b.bannerSubtitle, 'bannerSubtitle', 200, true), primaryColor: str(b.primaryColor, 'primaryColor', 7)};
    if (!/^#[0-9a-f]{6}$/i.test(data.primaryColor)) fail('VALIDATION_ERROR', '颜色无效');
    return this.db.atomic(async tx => {
      const p = await tx.page.update({where: {storeId}, data: {draft: data, version: {increment: 1}}});
      await tx.audit.create({data: {storeId, actorId: user.id, action: 'PAGE_DRAFT', entityId: storeId, after: data}});
      return {draft: p.draft, published: p.published, version: p.version};
    });
  }
  @Post('merchant/page/publish') async publish(@Req() req: any, @Query('storeId') storeId: string, @Body() body: unknown) {
    const user = await this.auth.staff(req, storeId, true); const b = object(body, ['expectedVersion']);
    if (!Number.isInteger(b.expectedVersion) || b.expectedVersion < 0) fail('VALIDATION_ERROR', '版本无效');
    return this.db.atomic(async tx => {
      const p = await tx.page.findUnique({where: {storeId}});
      if (!p || p.version !== b.expectedVersion) fail('VERSION_CONFLICT', '草稿已修改，请刷新后发布', 409);
      const updated = await tx.page.updateMany({where: {storeId, version: b.expectedVersion}, data: {published: p.draft!, version: {increment: 1}}});
      if (!updated.count) fail('VERSION_CONFLICT', '版本冲突', 409);
      await tx.audit.create({data: {storeId, actorId: user.id, action: 'PAGE_PUBLISH', entityId: storeId, after: p.draft!}});
      return {draft: p.draft, published: p.draft, version: p.version + 1};
    });
  }
}
