import {Inject,Injectable} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {Db} from '../../common/db';
import {fail,object,str} from '../../common/domain';
import {AuthService} from '../auth/auth.service';
import {optionsInclude,optionsInteger,validateConfiguration} from './product-options.validation';
const named=(n:any)=>({id:n.id,name:n.name,sort:n.sort,enabled:n.enabled});
export const productOptionsView=(p:any)=>({productId:p.id,configurationRevision:p.configurationRevision,specGroups:p.specGroups.map((g:any)=>({...named(g),values:g.values.map(named)})),skus:p.skus.map((s:any)=>({id:s.id,name:s.name,enabled:s.enabled,priceFen:s.priceFen,available:s.stock,reserved:s.reserved,selections:s.selections.map((v:any)=>({groupRef:v.groupId,valueRef:v.valueId}))})),attributeGroups:p.attributeGroups.map((g:any)=>({...named(g),minSelections:g.minSelections,maxSelections:g.maxSelections,options:g.options.map(named)})),modifiers:p.modifiers.map((m:any)=>({id:m.id,name:m.name,enabled:m.enabled,priceFen:m.priceFen,available:m.stock,reserved:m.reserved}))});
const json=(v:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(v));
@Injectable()
export class ProductOptionsService {
 constructor(@Inject(Db) private db:Db,@Inject(AuthService) private auth:AuthService){}
 private async context(tx:Prisma.TransactionClient,req:any,storeId:string,id:string){
  const actor=await this.auth.staff(req,storeId,true,tx);
  const product=await tx.product.findFirst({where:{id,storeId},include:optionsInclude});
  if(!product)fail('FORBIDDEN','商品不属于此门店',403);
  return {actor,product};
 }
 async get(req:any,id:string,storeValue:unknown){
  const storeId=str(storeValue,'门店');
  return this.db.atomic(async tx=>productOptionsView((await this.context(tx,req,storeId,id)).product));
 }
 async put(req:any,id:string,body:unknown){
  const b=object(body,['storeId','expectedRevision','specGroups','skus','attributeGroups','modifiers']);
  const storeId=str(b.storeId,'门店'),expectedRevision=optionsInteger(b.expectedRevision);
  return this.db.atomic(async tx=>{
   const {actor,product}=await this.context(tx,req,storeId,id);
   if(product.configurationRevision!==expectedRevision)fail('STATE_CONFLICT','配置已被修改，请刷新后重试',409);
   const tree=validateConfiguration(b,product);
   const updated=await tx.product.updateMany({where:{id,storeId,configurationRevision:expectedRevision},data:{configurationRevision:{increment:1}}});
   if(!updated.count)fail('STATE_CONFLICT','配置已被修改，请刷新后重试',409);
   for(const g of tree.specGroups){
    const {values,...data}=g;await tx.productSpecGroup.upsert({where:{id:g.id},create:{...data,productId:id},update:data});
    for(const value of values)await tx.productSpecValue.upsert({where:{id:value.id},create:{...value,groupId:g.id},update:value});
   }
   for(const g of tree.attributeGroups){
    const {options,...data}=g;await tx.productAttributeGroup.upsert({where:{id:g.id},create:{...data,productId:id},update:data});
    for(const option of options)await tx.productAttributeOption.upsert({where:{id:option.id},create:{...option,groupId:g.id},update:option});
   }
   // Match order inventory locking: modifiers then SKUs, each in stable ID order.
   for(const m of [...tree.modifiers].sort((a,b)=>a.id.localeCompare(b.id))){
    const {initialStock,...data}=m;
    await tx.modifier.upsert({where:{id:m.id},create:{...data,productId:id,stock:initialStock??0},update:data});
   }
   // Clear only derived keys so valid combination swaps cannot hit transient uniqueness.
   // Stable SKU lock order also protects held inventory while configurations change.
   const skus=[...tree.skus].sort((a,b)=>a.id.localeCompare(b.id));
   for(const s of skus)if(product.skus.some(old=>old.id===s.id))await tx.sku.update({where:{id:s.id},data:{combinationKey:null}});
   for(const s of skus){
    const {initialStock,selections,...data}=s;
    await tx.sku.upsert({where:{id:s.id},create:{...data,productId:id,stock:initialStock??0},update:data});
    await tx.skuSpecSelection.deleteMany({where:{skuId:s.id}});
    if(selections.length)await tx.skuSpecSelection.createMany({data:selections.map(v=>({...v,skuId:s.id}))});
   }
   const after=productOptionsView(await tx.product.findUniqueOrThrow({where:{id},include:optionsInclude}));
   await tx.audit.create({data:{storeId,actorId:actor.id,action:'PRODUCT_OPTIONS_UPDATE',entityId:id,before:json(productOptionsView(product)),after:json(after)}});
   return after;
  });
 }
 async inventory(req:any,id:string,body:unknown){
  const b=object(body,['storeId','expectedAvailable','available']),storeId=str(b.storeId,'门店'),expectedAvailable=optionsInteger(b.expectedAvailable),available=optionsInteger(b.available);
  return this.db.atomic(async tx=>{
   const actor=await this.auth.staff(req,storeId,true,tx);
   const before=await tx.modifier.findFirst({where:{id,product:{storeId}}});if(!before)fail('FORBIDDEN','加料不属于此门店',403);
   if(available+before.reserved>2_000_000_000)fail('VALIDATION_ERROR','可售库存与预占总量过大');
   const changed=await tx.modifier.updateMany({where:{id,stock:expectedAvailable,reserved:before.reserved},data:{stock:available}});
   if(!changed.count)fail('STATE_CONFLICT','库存已变更，请刷新后核对',409);
   const after=await tx.modifier.findUniqueOrThrow({where:{id}});
   await tx.audit.create({data:{storeId,actorId:actor.id,action:'MODIFIER_INVENTORY_UPDATE',entityId:id,before:json(before),after:json(after)}});
   return {id,available:after.stock,reserved:after.reserved};
  });
 }
}
