import {Inject, Injectable} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {Db} from '../../common/db';
import {fail, object, str} from '../../common/domain';
import {AuthService, Identity} from '../auth/auth.service';

type Kind = 'category' | 'unit';
const json = (value:unknown):Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const revision = (value:unknown) => {
  if (!Number.isSafeInteger(value) || (value as number)<0 || (value as number)>2_000_000_000) fail('VALIDATION_ERROR','版本格式不正确');
  return value as number;
};
@Injectable()
export class CatalogAdminService {
  constructor(@Inject(Db) private db:Db,@Inject(AuthService) private auth:AuthService) {}
  private name(value:unknown,kind:Kind) {return str(typeof value==='string'?value.trim():value,kind==='category'?'分类名称':'单位名称',kind==='category'?80:20);}
  private view(row:any,actor:Identity,canManageBrand:boolean,kind:Kind) {
    const common={id:row.id,name:row.name,enabled:row.enabled,revision:row.revision,productCount:row._count.products};
    return kind==='unit' ? common : {...common,sort:row.sort,visibleStoreIds:row.allStores && canManageBrand ? null : (row.allStores?actor.storeIds:row.visibility.map((v:any)=>v.storeId).filter((id:string)=>actor.storeIds.includes(id))).sort()};
  }
  private async context(tx:Prisma.TransactionClient,req:any,storeId:string,write=false) {
    const actor=await this.auth.staff(req,storeId,write,tx);
    const stores=await tx.store.findMany({where:{brandId:actor.brandId},select:{id:true,name:true},orderBy:{id:'asc'}});
    const canManageBrand=actor.role==='OWNER' && stores.every(s=>actor.storeIds.includes(s.id));
    if(write && !canManageBrand) fail('FORBIDDEN','修改品牌分类和单位需要全部门店的店主授权',403);
    return {actor,stores,canManageBrand};
  }
  async settings(req:any,storeValue:unknown) {
    const storeId=str(storeValue,'门店');
    return this.db.atomic(async tx=>{
      const {actor,stores,canManageBrand}=await this.context(tx,req,storeId);
      const categories=await tx.category.findMany({where:{brandId:actor.brandId},include:{visibility:true,_count:{select:{products:true}}},orderBy:[{sort:'asc'},{id:'asc'}]});
      const units=await tx.unit.findMany({where:{brandId:actor.brandId},include:{_count:{select:{products:true}}},orderBy:{id:'asc'}});
      return {canManageBrand,categories:categories.map(c=>this.view(c,actor,canManageBrand,'category')),units:units.map(u=>this.view(u,actor,canManageBrand,'unit')),stores:stores.filter(s=>actor.storeIds.includes(s.id))};
    });
  }
  private async target(tx:Prisma.TransactionClient,kind:Kind,id:string,brandId:string) {
    const row=kind==='category'
      ? await tx.category.findUnique({where:{id},include:{visibility:true,_count:{select:{products:true}}}})
      : await tx.unit.findUnique({where:{id},include:{_count:{select:{products:true}}}});
    if(!row || row.brandId!==brandId) fail('FORBIDDEN','无此品牌配置管理权限',403);
    return row;
  }
  private async audit(tx:Prisma.TransactionClient,storeId:string,actor:Identity,kind:Kind,action:string,id:string,before?:unknown,after?:unknown) {
    await tx.audit.create({data:{storeId,actorId:actor.id,action:`${kind.toUpperCase()}_${action}`,entityId:id,...(before?{before:json(before)}:{}),...(after?{after:json(after)}:{})}});
  }
  async create(req:any,kind:Kind,body:unknown) {
    const b=object(body,['storeId','name']),storeId=str(b.storeId,'门店'),name=this.name(b.name,kind);
    return this.db.atomic(async tx=>{
      const {actor}=await this.context(tx,req,storeId,true);
      if(kind==='unit' && await tx.unit.findUnique({where:{brandId_name:{brandId:actor.brandId,name}}})) fail('NAME_CONFLICT','该单位名称已存在',409);
      const row=kind==='category'
        ? await tx.category.create({data:{brandId:actor.brandId,name},include:{visibility:true,_count:{select:{products:true}}}})
        : await tx.unit.create({data:{brandId:actor.brandId,name},include:{_count:{select:{products:true}}}});
      const after=this.view(row,actor,true,kind); await this.audit(tx,storeId,actor,kind,'CREATE',row.id,undefined,after); return after;
    });
  }
  async edit(req:any,kind:Kind,id:string,body:unknown) {
    const fields=kind==='category'?['name','sort','enabled','visibleStoreIds']:['name','enabled'];
    const b=object(body,['storeId','expectedRevision',...fields]),storeId=str(b.storeId,'门店'),expectedRevision=revision(b.expectedRevision);
    if(!fields.some(k=>b[k]!==undefined)) fail('VALIDATION_ERROR','请提供要修改的内容');
    const data:any={revision:{increment:1}};
    if(b.name!==undefined) data.name=this.name(b.name,kind);
    if(b.enabled!==undefined) {if(typeof b.enabled!=='boolean') fail('VALIDATION_ERROR','启用状态格式不正确'); data.enabled=b.enabled;}
    if(b.sort!==undefined) {if(!Number.isInteger(b.sort)||b.sort<0||b.sort>100000) fail('VALIDATION_ERROR','排序需为0至100000的整数'); data.sort=b.sort;}
    let ids:string[]|undefined;
    if(b.visibleStoreIds!==undefined) {
      if(b.visibleStoreIds!==null && (!Array.isArray(b.visibleStoreIds)||b.visibleStoreIds.length>100)) fail('VALIDATION_ERROR','可见门店格式不正确，最多100家');
      ids=b.visibleStoreIds===null?[]:[...new Set<string>(b.visibleStoreIds.map((id:unknown)=>str(id,'门店')))]; data.allStores=b.visibleStoreIds===null;
    }
    return this.db.atomic(async tx=>{
      const {actor,stores}=await this.context(tx,req,storeId,true);
      const before=await this.target(tx,kind,id,actor.brandId);
      if(before.revision!==expectedRevision) fail('STATE_CONFLICT','内容已被修改，请刷新后重试',409);
      if(ids?.some(id=>!stores.some(s=>s.id===id))) fail('FORBIDDEN','可见门店必须属于当前品牌',403);
      if(kind==='unit' && data.name) {const conflict=await tx.unit.findUnique({where:{brandId_name:{brandId:actor.brandId,name:data.name}}}); if(conflict && conflict.id!==id) fail('NAME_CONFLICT','该单位名称已存在',409);}
      const result=kind==='category'?await tx.category.updateMany({where:{id,brandId:actor.brandId,revision:expectedRevision},data}):await tx.unit.updateMany({where:{id,brandId:actor.brandId,revision:expectedRevision},data});
      if(!result.count) fail('STATE_CONFLICT','内容已被修改，请刷新后重试',409);
      if(ids!==undefined) {await tx.categoryStoreVisibility.deleteMany({where:{categoryId:id}}); if(ids.length) await tx.categoryStoreVisibility.createMany({data:ids.map(storeId=>({categoryId:id,storeId}))});}
      const after=this.view(await this.target(tx,kind,id,actor.brandId),actor,true,kind);
      await this.audit(tx,storeId,actor,kind,'UPDATE',id,this.view(before,actor,true,kind),after); return after;
    });
  }
  async remove(req:any,kind:Kind,id:string,body:unknown) {
    const b=object(body,['storeId','expectedRevision']),storeId=str(b.storeId,'门店'),expectedRevision=revision(b.expectedRevision);
    return this.db.atomic(async tx=>{
      const {actor}=await this.context(tx,req,storeId,true),before=await this.target(tx,kind,id,actor.brandId);
      if(before.revision!==expectedRevision) fail('STATE_CONFLICT','内容已被修改，请刷新后重试',409);
      if(before._count.products) fail('REFERENCE_CONFLICT','已有商品使用此配置，请先调整商品或停用',409);
      const removed=kind==='category'?await tx.category.deleteMany({where:{id,brandId:actor.brandId,revision:expectedRevision}}):await tx.unit.deleteMany({where:{id,brandId:actor.brandId,revision:expectedRevision}});
      if(!removed.count) fail('STATE_CONFLICT','内容已被修改，请刷新后重试',409);
      await this.audit(tx,storeId,actor,kind,'DELETE',id,this.view(before,actor,true,kind)); return {id,deleted:true};
    });
  }
}
