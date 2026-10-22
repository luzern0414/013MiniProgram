import {Inject,Injectable} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {Db} from '../../common/db';
import {fail} from '../../common/domain';
import {AuthService} from '../auth/auth.service';
import {addressFields,key,pathId,versionBody} from './addresses.validation';
import {increment,lockBook,view} from './address-book';
const json=(v:any):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(v));
@Injectable()
export class AddressesService {
 constructor(@Inject(Db) private db:Db,@Inject(AuthService) private auth:AuthService){}
 private async customer(req:any,tx:any){const user=await this.auth.user(req,tx);if(user.role!=='CUSTOMER')fail('FORBIDDEN','仅顾客可管理地址',403);return user;}
 private query(req:any){if(req.query&&Object.keys(req.query).length)fail('VALIDATION_ERROR','不支持查询参数');}
 private async find(tx:any,userId:string,id:string){const a=await tx.customerAddress.findUnique({where:{id}});if(!a||a.userId!==userId)fail('ADDRESS_NOT_FOUND','地址不存在',404);return a;}
 private result(op:any,address:any,bookRevision:number,replayed=false){return {operation:{kind:op.kind,addressId:op.addressId,addressRevision:op.resultAddressRevision,bookRevision:op.resultBookRevision,succeededAt:op.createdAt.toISOString()},address:view(address),bookRevision,replayed};}
 async list(req:any){this.query(req);return this.db.atomic(async tx=>{const u=await this.customer(req,tx),book=await tx.customerAddressBook.findUnique({where:{userId:u.id}});if(!book)return {items:[],bookRevision:0,limit:20};const items=await tx.customerAddress.findMany({where:{userId:u.id,deletedAt:null},orderBy:[{isDefault:'desc'},{updatedAt:'desc'},{id:'desc'}]});return {items:items.map(view),bookRevision:book.revision,limit:20};});}
 async detail(req:any,id:string){this.query(req);pathId(id);return this.db.atomic(async tx=>{const u=await this.customer(req,tx),a=await this.find(tx,u.id,id),book=await tx.customerAddressBook.findUnique({where:{userId:u.id}});return {address:view(a),bookRevision:book?.revision??0};});}
 private async write(req:any,kind:string,id:string|undefined,body:any){
  this.query(req);const k=key(req.headers['idempotency-key']);const parsed:any=kind==='CREATE'?addressFields(body):kind==='UPDATE'?addressFields(body,true):versionBody(body);if(id)pathId(id);
  await this.customer(req,this.db);
  return this.db.atomic(async tx=>{
   const u=await this.customer(req,tx),book=await lockBook(tx,u.id),checked=await this.customer(req,tx);if(checked.id!==u.id)fail('UNAUTHENTICATED','登录状态已变化',401);await this.customer(req,this.db);const payload={kind,addressId:id??null,...parsed},hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
   const old=await tx.customerAddressOperation.findUnique({where:{userId_key:{userId:u.id,key:k}},include:{address:true}});
   if(old){if(old.requestHash!==hash)fail('IDEMPOTENCY_CONFLICT','幂等键已绑定其他地址请求',409);const current=await this.find(tx,u.id,old.addressId);return this.result(old,current,book.revision,true);}
   if(book.revision!==parsed.expectedBookRevision)fail('ADDRESS_CHANGED','地址簿已变更，请重新读取后核对',409);
   if(book.revision>=2_000_000_000)fail('ADDRESS_VERSION_LIMIT','地址版本已达上限，请重新读取后重试',409);
   let address:any;
   if(kind==='CREATE'){
    const count=await tx.customerAddress.count({where:{userId:u.id,deletedAt:null}});if(count>=20)fail('ADDRESS_LIMIT','地址数量已达上限',409);
    if(parsed.isDefault){const defaults=await tx.customerAddress.findMany({where:{userId:u.id,isDefault:true,deletedAt:null},select:{revision:true}});if(defaults.some((d:any)=>d.revision>=2_000_000_000))fail('ADDRESS_VERSION_LIMIT','地址版本已达上限，请重新读取后重试',409);}
    const now=new Date(),next=increment(book.revision);address=await tx.customerAddress.create({data:{userId:u.id,name:parsed.name,phone:parsed.phone,region:parsed.region,detail:parsed.detail,point:parsed.point?json(parsed.point):undefined,isDefault:false,createdAt:now,updatedAt:now}});
    if(parsed.isDefault){await tx.customerAddress.updateMany({where:{userId:u.id,isDefault:true,deletedAt:null},data:{isDefault:false,revision:{increment:1},updatedAt:now}});address=await tx.customerAddress.update({where:{id:address.id},data:{isDefault:true}});}
    await tx.customerAddressBook.update({where:{userId:u.id},data:{revision:next,updatedAt:now}});
   } else {
    address=await this.find(tx,u.id,id!);if(address.deletedAt)fail('ADDRESS_DELETED','地址已删除',409);if(address.revision!==parsed.expectedRevision)fail('ADDRESS_CHANGED','地址已变更，请重新读取后核对',409);if(address.revision>=2_000_000_000)fail('ADDRESS_VERSION_LIMIT','地址版本已达上限，请重新读取后重试',409);
    if(kind==='DEFAULT'||(kind==='UPDATE'&&parsed.isDefault)){
      const defaults=await tx.customerAddress.findMany({where:{userId:u.id,isDefault:true,deletedAt:null,id:{not:id}},select:{revision:true}});
      if(defaults.some((d:any)=>d.revision>=2_000_000_000))fail('ADDRESS_VERSION_LIMIT','地址版本已达上限，请重新读取后重试',409);
    }
    const now=new Date(),next=increment(book.revision),addressNext=increment(address.revision);if(kind==='UPDATE'){
      if(parsed.isDefault)await tx.customerAddress.updateMany({where:{userId:u.id,isDefault:true,deletedAt:null,id:{not:id}},data:{isDefault:false,revision:{increment:1},updatedAt:now}});
      address=await tx.customerAddress.update({where:{id:id!},data:{name:parsed.name,phone:parsed.phone,region:parsed.region,detail:parsed.detail,point:parsed.point?json(parsed.point):Prisma.JsonNull,isDefault:parsed.isDefault,revision:addressNext,updatedAt:now}});
    } else if(kind==='DEFAULT') {await tx.customerAddress.updateMany({where:{userId:u.id,isDefault:true,deletedAt:null,id:{not:id}},data:{isDefault:false,revision:{increment:1},updatedAt:now}});address=await tx.customerAddress.update({where:{id:id!},data:{isDefault:true,revision:addressNext,updatedAt:now}});
    } else address=await tx.customerAddress.update({where:{id:id!},data:{isDefault:false,deletedAt:now,revision:addressNext,updatedAt:now}});
    await tx.customerAddressBook.update({where:{userId:u.id},data:{revision:next,updatedAt:now}});
   }
   const op=await tx.customerAddressOperation.create({data:{userId:u.id,key:k,kind,requestHash:hash,addressId:address.id,resultAddressRevision:address.revision,resultBookRevision:book.revision+1}});
   return this.result(op,address,book.revision+1,false);
  });
 }
 create(req:any,b:any){return this.write(req,'CREATE',undefined,b);}
 update(req:any,id:string,b:any){return this.write(req,'UPDATE',id,b);}
 setDefault(req:any,id:string,b:any){return this.write(req,'DEFAULT',id,b);}
 remove(req:any,id:string,b:any){return this.write(req,'DELETE',id,b);}
}
