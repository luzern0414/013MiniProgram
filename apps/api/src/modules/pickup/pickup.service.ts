import {Inject,Injectable} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {Db} from '../../common/db';
import {fail,object,str} from '../../common/domain';
import {PublicBrand} from '../../common/public-brand';
import {AuthService} from '../auth/auth.service';
import {bookable,dateRange,pickupBoolean,pickupInteger,pickupDate,PICKUP_TIMEZONE,validateSlots} from './pickup.validation';
const json=(v:any):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(v));
@Injectable()
export class PickupService {
 constructor(@Inject(Db)private db:Db,@Inject(AuthService)private auth:AuthService,@Inject(PublicBrand)private publicBrand:PublicBrand){}
 async policy(req:any,query:unknown){const b=object(query,['storeId']),storeId=str(b.storeId,'门店');return this.db.atomic(async tx=>{await this.auth.staff(req,storeId,false,tx);const policy=await tx.pickupPolicy.findUnique({where:{storeId}});if(!policy)fail('PICKUP_CONFIGURATION_MISSING','此门店预约配置尚未初始化',409);return policy;});}
 async putPolicy(req:any,body:unknown){
  const b=object(body,['storeId','expectedRevision','enabled','leadMinutes','maxAdvanceDays']),storeId=str(b.storeId,'门店'),expectedRevision=pickupInteger(b.expectedRevision),enabled=pickupBoolean(b.enabled),leadMinutes=pickupInteger(b.leadMinutes,0,1440),maxAdvanceDays=pickupInteger(b.maxAdvanceDays,1,90);
  return this.db.atomic(async tx=>{
   const actor=await this.auth.staff(req,storeId,true,tx),before=await tx.pickupPolicy.findUnique({where:{storeId}});
   if((before?.revision??0)!==expectedRevision)fail('STATE_CONFLICT','预约政策已变更，请刷新',409);
   const data={enabled,leadMinutes,maxAdvanceDays};
   if(before){const changed=await tx.pickupPolicy.updateMany({where:{storeId,revision:expectedRevision},data:{...data,revision:{increment:1}}});if(!changed.count)fail('STATE_CONFLICT','预约政策已变更，请刷新',409);}
   else await tx.pickupPolicy.create({data:{storeId,...data,revision:1}});
   const after=await tx.pickupPolicy.findUniqueOrThrow({where:{storeId}});await tx.audit.create({data:{storeId,actorId:actor.id,action:'PICKUP_POLICY_UPDATE',entityId:storeId,...(before?{before:json(before)}:{}),after:json(after)}});return after;
  });
 }
 async slots(req:any,query:unknown){const b=object(query,['storeId','from','to']),storeId=str(b.storeId,'门店'),startsAt=dateRange(b.from,b.to);return this.db.atomic(async tx=>{await this.auth.staff(req,storeId,false,tx);return tx.pickupSlot.findMany({where:{storeId,startsAt},orderBy:[{startsAt:'asc'},{id:'asc'}]});});}
 async create(req:any,body:unknown){
  const b=object(body,['storeId','slots']),storeId=str(b.storeId,'门店'),rows=validateSlots(b.slots);
  return this.db.atomic(async tx=>{
   const actor=await this.auth.staff(req,storeId,true,tx);
   // Serializable predicate reads ensure two overlapping batches cannot both commit, including an initially empty date.
   for(const row of rows){const overlap=await tx.pickupSlot.findFirst({where:{storeId,startsAt:{lt:row.endsAt},endsAt:{gt:row.startsAt}}});if(overlap)fail('STATE_CONFLICT','此门店已存在重叠时段，请刷新',409);}
   const result=[];for(const row of rows)result.push(await tx.pickupSlot.create({data:{storeId,...row}}));
   await tx.audit.create({data:{storeId,actorId:actor.id,action:'PICKUP_SLOTS_CREATE',entityId:storeId,after:json(result)}});return result;
  });
 }
 async patch(req:any,id:string,body:unknown){
  const b=object(body,['storeId','expectedRevision','enabled','capacity']),storeId=str(b.storeId,'门店'),revision=pickupInteger(b.expectedRevision),enabled=pickupBoolean(b.enabled),capacity=pickupInteger(b.capacity,1,1000);
  return this.db.atomic(async tx=>{
   const actor=await this.auth.staff(req,storeId,true,tx),before=await tx.pickupSlot.findUnique({where:{id}});if(!before)fail('NOT_FOUND','取餐时段不存在',404);if(before.storeId!==storeId)fail('FORBIDDEN','时段不属于此门店',403);
   if(before.revision!==revision)fail('STATE_CONFLICT','时段已变更，请刷新',409);if(capacity<before.heldCount+before.confirmedCount)fail('STATE_CONFLICT','容量不可少于已承诺订单数',409);
   const changed=await tx.pickupSlot.updateMany({where:{id,storeId,revision,heldCount:before.heldCount,confirmedCount:before.confirmedCount},data:{enabled,capacity,revision:{increment:1}}});if(!changed.count)fail('STATE_CONFLICT','时段已变更，请刷新',409);
   const after=await tx.pickupSlot.findUniqueOrThrow({where:{id}});await tx.audit.create({data:{storeId,actorId:actor.id,action:'PICKUP_SLOT_UPDATE',entityId:id,before:json(before),after:json(after)}});return after;
  });
 }
 async publicSlots(storeId:string,query:unknown){
  const b=object(query,['date']),date=pickupDate(b.date),store=await this.publicBrand.assertStore(storeId);if(!store.isOpen||!store.serviceModes.includes('PICKUP'))return [];
  return this.db.atomic(async tx=>{const policy=await tx.pickupPolicy.findUnique({where:{storeId}});if(!policy?.enabled)return [];const rows=await tx.pickupSlot.findMany({where:{storeId,startsAt:dateRange(date,date),enabled:true},orderBy:[{startsAt:'asc'},{id:'asc'}]});const now=new Date();return rows.filter(row=>bookable(policy,row,now)&&row.capacity>row.heldCount+row.confirmedCount).map(row=>({id:row.id,startsAt:row.startsAt,endsAt:row.endsAt,timezone:PICKUP_TIMEZONE,remaining:row.capacity-row.heldCount-row.confirmedCount}));});
 }
}
