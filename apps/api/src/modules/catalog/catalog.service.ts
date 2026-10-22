import { Inject, Injectable } from '@nestjs/common';
import { Db } from '../../common/db';
import { fail } from '../../common/domain';
import { PublicBrand } from '../../common/public-brand';
import {optionsInclude} from './product-options.validation';
import { visibleCategory } from './catalog-policy';
export const productView = (p: any, employee=false) => ({id:p.id, categoryId:p.categoryId, name:p.name, description:p.description,imageUrl:p.imageUrl,unit:p.unitDefinition?.name??p.unit,unitId:p.unitId??null,isAvailable:p.isAvailable,configurationRevision:p.configurationRevision,
 specGroups:(p.specGroups||[]).filter((g:any)=>employee||g.enabled).map((g:any)=>({id:g.id,name:g.name,sort:g.sort,enabled:g.enabled,values:g.values.filter((v:any)=>employee||v.enabled).map((v:any)=>({id:v.id,name:v.name,sort:v.sort,enabled:v.enabled}))})),
 attributeGroups:(p.attributeGroups||[]).filter((g:any)=>employee||g.enabled).map((g:any)=>({id:g.id,name:g.name,sort:g.sort,enabled:g.enabled,minSelections:g.minSelections,maxSelections:g.maxSelections,options:g.options.filter((o:any)=>employee||o.enabled).map((o:any)=>({id:o.id,name:o.name,sort:o.sort,enabled:o.enabled}))})),
 skus:p.skus.filter((s:any)=>employee||s.enabled).map((s:any)=>({id:s.id,name:s.name,priceFen:s.priceFen,available:s.stock,enabled:s.enabled,selections:(s.selections||[]).filter((v:any)=>employee||p.specGroups?.some((g:any)=>g.enabled&&g.id===v.groupId&&g.values.some((value:any)=>value.enabled&&value.id===v.valueId))).map((v:any)=>({groupRef:v.groupId,valueRef:v.valueId}))})),
 modifiers:p.modifiers.filter((m:any)=>employee||m.enabled).map((m:any)=>({id:m.id,name:m.name,priceFen:m.priceFen,available:m.stock,enabled:m.enabled}))});
@Injectable()
export class CatalogService {
  constructor(@Inject(Db) private db: Db, @Inject(PublicBrand) private publicBrand: PublicBrand) {}
  async get(storeId: string, employee = false) {
    if (!employee) await this.publicBrand.assertStore(storeId);
    const store = await this.db.store.findUnique({where: {id: storeId}});
    if (!store) fail('NOT_FOUND', '门店不存在', 404);
    const [categories, products] = await Promise.all([
      this.db.category.findMany({where: {brandId: store.brandId, ...(employee ? {} : visibleCategory(storeId))}, orderBy: [{sort: 'asc'}, {id: 'asc'}], select: {id: true, name: true, sort: true}}),
      this.db.product.findMany({where: {storeId, ...(employee ? {} : {isAvailable: true, category: {brandId: store.brandId, ...visibleCategory(storeId)}})}, include: {...optionsInclude, unitDefinition: true}, orderBy: {id: 'asc'}})
    ]);
    return {categories, products: products.map(p=>productView(p,employee))};
  }
}
