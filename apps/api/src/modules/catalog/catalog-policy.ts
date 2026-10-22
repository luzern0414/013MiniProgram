import {Prisma} from '@prisma/client';
import {fail, str} from '../../common/domain';

export const visibleCategory = (storeId: string): Prisma.CategoryWhereInput => ({enabled:true, OR:[{allStores:true},{visibility:{some:{storeId}}}]});
export async function assertCategory(tx: Prisma.TransactionClient, categoryId: string, brandId: string, storeId: string) {
  const category = await tx.category.findUnique({where:{id:categoryId}, include:{visibility:true}});
  if (!category || category.brandId !== brandId) fail('FORBIDDEN','分类不属于此品牌',403);
  if (!category.enabled || (!category.allStores && !category.visibility.some(v=>v.storeId===storeId))) fail('CATALOG_CHANGED','商品分类已停用或在本店隐藏，请刷新菜单后重试',409);
  return category;
}
export async function resolveUnit(tx: Prisma.TransactionClient, brandId: string, body: Record<string, any>) {
  const unit = body.unitId !== undefined
    ? await tx.unit.findUnique({where:{id:str(body.unitId,'单位',200)}})
    : await tx.unit.findUnique({where:{brandId_name:{brandId,name:str(typeof body.unit==='string'?body.unit.trim():body.unit,'单位',20)}}});
  if (!unit) fail('VALIDATION_ERROR','请选择已有的有效单位');
  if (unit.brandId !== brandId) fail('FORBIDDEN','单位不属于此品牌',403);
  if (!unit.enabled) fail('STATE_CONFLICT','该单位已停用，请选择其他单位',409);
  if (body.unitId !== undefined && body.unit !== undefined && str(body.unit,'单位',20).trim() !== unit.name) fail('VALIDATION_ERROR','单位名称与所选单位不一致');
  return {unitId:unit.id,unit:unit.name};
}
