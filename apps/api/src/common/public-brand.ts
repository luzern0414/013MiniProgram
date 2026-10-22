import { Inject, Injectable } from '@nestjs/common';
import { Db } from './db';
import { fail } from './domain';
@Injectable()
export class PublicBrand {
  constructor(@Inject(Db) private db: Db) {}
  async id() {
    if (process.env.PUBLIC_BRAND_ID) {
      const brand = await this.db.brand.findUnique({where: {id: process.env.PUBLIC_BRAND_ID}});
      if (!brand) fail('CONFIGURATION_ERROR', '公开品牌配置无效', 503);
      return brand.id;
    }
    const brands = await this.db.brand.findMany({take: 2, select: {id: true}});
    if (brands.length > 1) fail('CONFIGURATION_ERROR', '多品牌实例必须配置PUBLIC_BRAND_ID', 503);
    if (!brands.length) fail('NOT_FOUND', '品牌尚未初始化', 404);
    return brands[0].id;
  }
  async assertStore(storeId: string) {
    const brandId = await this.id();
    const store = await this.db.store.findFirst({where: {id: storeId, brandId}});
    if (!store) fail('NOT_FOUND', '门店不存在', 404);
    return store;
  }
}
