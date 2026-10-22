import {randomUUID} from 'node:crypto';
import {fail,money,object,str} from '../../common/domain';
const invalid=(message:string):never=>fail('VALIDATION_ERROR',message);
export const optionsInteger=(v:unknown,max=2_000_000_000):number=>typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=max?v:invalid('请输入有效范围内的整数');
const name=(v:unknown)=>str(typeof v==='string'?v.trim():v,'名称',80);
const enabled=(v:unknown):boolean=>typeof v==='boolean'?v:invalid('启用状态需为布尔值');
const list=(v:unknown,label:string,max?:number):any[]=>Array.isArray(v)&&(max===undefined||v.length<=max)?v:invalid(`${label}数量超出编辑限制，请先调整配置`);
export type NamedNode={id:string;name:string;enabled:boolean};
export type SpecGroup=NamedNode&{sort:number;values:(NamedNode&{sort:number})[]};
export type AttributeGroup=NamedNode&{sort:number;minSelections:number;maxSelections:number;options:(NamedNode&{sort:number})[]};
export type ConfigSku=NamedNode&{priceFen:number;initialStock?:number;combinationKey:string|null;selections:{groupId:string;valueId:string}[]};
export type ConfigModifier=NamedNode&{priceFen:number;initialStock?:number};
export const optionsInclude={specGroups:{include:{values:{orderBy:[{sort:'asc' as const},{id:'asc' as const}]}},orderBy:[{sort:'asc' as const},{id:'asc' as const}]},skus:{include:{selections:true},orderBy:{id:'asc' as const}},attributeGroups:{include:{options:{orderBy:[{sort:'asc' as const},{id:'asc' as const}]}},orderBy:[{sort:'asc' as const},{id:'asc' as const}]},modifiers:{orderBy:{id:'asc' as const}}};

// Resolve the whole submitted tree against the stored tree before writing anything.
// ID ownership is checked per parent, and every old identity must occur exactly once.
export function validateConfiguration(b:Record<string,any>,existing:any) {
 const seen=new Set<string>(),refs=new Map<string,string>();
 const identity=(node:any,old:any[]):string=>{
  let id:string;
  if(node.id!==undefined){id=str(node.id,'ID');if(!old.some(x=>x.id===id))invalid('节点不属于此商品或父节点');}
  else id=randomUUID();
  if(seen.has(id))invalid('节点ID重复');seen.add(id);
  for(const ref of [id,...(node.clientKey===undefined?[]:[node.clientKey])]){
   if(typeof ref!=='string'||(ref!==id&&!/^[a-zA-Z0-9_-]{1,64}$/.test(ref)))invalid('clientKey格式不正确');
   if(refs.has(ref))invalid('节点引用重复');refs.set(ref,id);
  }
  return id;
 };
 const retained=(old:any[])=>{if(old.some(x=>!seen.has(x.id)))invalid('已有节点不可遗漏，请通过停用保留记录');};
 const named=(node:any,old:any[])=>({id:identity(node,old),name:name(node.name),enabled:enabled(node.enabled)});
 const specGroups:SpecGroup[]=list(b.specGroups,'规格维度',3).map(raw=>{
  const g=object(raw,['id','clientKey','name','sort','enabled','values']),base=named(g,existing.specGroups),old=existing.specGroups.find((x:any)=>x.id===base.id)?.values||[];
  const values=list(g.values,'规格值',20).map(v=>{const n=object(v,['id','clientKey','name','sort','enabled']);return {...named(n,old),sort:optionsInteger(n.sort,100000)};});retained(old);
  if(base.enabled&&!values.some(v=>v.enabled))invalid('启用规格维度至少保留一个启用值');
  return {...base,sort:optionsInteger(g.sort,100000),values};
 });retained(existing.specGroups);
 const attributeGroups:AttributeGroup[]=list(b.attributeGroups,'属性组',5).map(raw=>{
  const g=object(raw,['id','name','sort','enabled','minSelections','maxSelections','options']),base=named(g,existing.attributeGroups),old=existing.attributeGroups.find((x:any)=>x.id===base.id)?.options||[];
  const minSelections=optionsInteger(g.minSelections,10),maxSelections=optionsInteger(g.maxSelections,10);
  if(minSelections>maxSelections)invalid('最少选择数不得超过最多选择数');
  const options=list(g.options,'属性选项',10).map(v=>{const n=object(v,['id','name','sort','enabled']);return {...named(n,old),sort:optionsInteger(n.sort,100000)};});retained(old);
  if(base.enabled&&options.filter(o=>o.enabled).length<minSelections)invalid('启用选项不足以满足最少选择数');
  return {...base,sort:optionsInteger(g.sort,100000),minSelections,maxSelections,options};
 });retained(existing.attributeGroups);
 const inventory=(raw:any,old:any[])=>{
  const base={...named(raw,old),priceFen:money(raw.priceFen)};
  if(raw.initialStock!==undefined&&raw.id!==undefined)invalid('已有库存项不可传initialStock');
  return {...base,...(raw.initialStock===undefined?{}:{initialStock:money(raw.initialStock)})};
 };
 const combinations=new Set<string>();
 const skus:ConfigSku[]=list(b.skus,'SKU').map(raw=>{
  const s=object(raw,['id','name','enabled','priceFen','selections','initialStock']),base=inventory(s,existing.skus),groups=new Set<string>();
  const selections=list(s.selections,'规格选择',3).map(raw=>{
   const v=object(raw,['groupRef','valueRef']);const groupId=refs.get(str(v.groupRef,'规格维度引用')),valueId=refs.get(str(v.valueRef,'规格值引用'));
   const group=specGroups.find(g=>g.id===groupId),value=group?.values.find(v=>v.id===valueId);
   if(!group||!value)invalid('规格引用不属于本次提交的维度和值');
   if(groups.has(group!.id))invalid('每个SKU每个维度只能选择一个值');groups.add(group!.id);
   if(base.enabled&&group!.enabled&&!value!.enabled)invalid('启用SKU不能选择停用的规格值');
   return {groupId:group!.id,valueId:value!.id};
  }).sort((a,b)=>a.groupId.localeCompare(b.groupId)||a.valueId.localeCompare(b.valueId));
  const active=specGroups.filter(g=>g.enabled);
  if(base.enabled&&active.some(g=>!selections.some(s=>s.groupId===g.id)))invalid('启用SKU必须选择全部启用规格维度');
  const combinationKey=base.enabled?(active.length?JSON.stringify(selections.filter(s=>active.some(g=>g.id===s.groupId)).map(s=>[s.groupId,s.valueId])):JSON.stringify(['name',base.name])):null;
  if(combinationKey!==null){if(combinations.has(combinationKey))invalid('SKU规格组合或名称重复，请停用或调整重复SKU');combinations.add(combinationKey);}
  return {...base,selections,combinationKey};
 });retained(existing.skus);
 if(skus.filter(s=>s.enabled).length>20)invalid('启用SKU最多20个，请先调整配置');
 const modifiers:ConfigModifier[]=list(b.modifiers,'加料',20).map(raw=>inventory(object(raw,['id','name','enabled','priceFen','initialStock']),existing.modifiers));retained(existing.modifiers);
 return {specGroups,skus,attributeGroups,modifiers};
}

export function attributeSelection(product:any,input:unknown) {
 const ids=input===undefined?[]:list(input,'口味选择',50).map(id=>str(id,'属性选项ID'));
 if(new Set(ids).size!==ids.length)invalid('口味选项不可重复');
 const groups:any[]=product.attributeGroups||[],selected=new Set(ids);
 const attributes=groups.filter(g=>g.enabled).map(g=>{
  const options=g.options.filter((o:any)=>o.enabled&&selected.has(o.id));
  if(options.length<g.minSelections||options.length>g.maxSelections)invalid(`请按要求选择${g.name}`);
  return {groupId:g.id,groupName:g.name,options:options.map((o:any)=>({id:o.id,name:o.name}))};
 });
 if(ids.some(id=>!attributes.some(g=>g.options.some((o:any)=>o.id===id))))invalid('口味选项不属于此商品或已停用');
 return {attributeOptionIds:ids.sort(),attributes};
}
