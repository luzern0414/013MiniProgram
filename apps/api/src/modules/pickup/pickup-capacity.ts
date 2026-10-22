import {Prisma} from '@prisma/client';
import {fail} from '../../common/domain';
import {bookable,PICKUP_TIMEZONE,serviceDate} from './pickup.validation';
export type PickupBooking={version:1;slotId:string;slotRevision:number;policyRevision:number};
export function bookingFromQuote(q:any):PickupBooking|null {return q.mode==='PICKUP'&&q.pickupBooking?.version===1?q.pickupBooking:null;}
export async function pickupQuote(tx:Prisma.TransactionClient,storeId:string,slotId:string){
 const slot=await tx.pickupSlot.findUnique({where:{id:slotId}});if(!slot)fail('PICKUP_TIME_UNAVAILABLE','取餐时段不存在',409);if(slot.storeId!==storeId)fail('FORBIDDEN','取餐时段不属于此门店',403);
 const policy=await tx.pickupPolicy.findUnique({where:{storeId}});
 if(!bookable(policy,slot))fail('PICKUP_TIME_UNAVAILABLE','此取餐时间已不可预约',409);
 if(slot.heldCount+slot.confirmedCount>=slot.capacity)fail('PICKUP_SLOT_FULL','此时段已约满',409);
 return {pickupBooking:{version:1 as const,slotId,slotRevision:slot.revision,policyRevision:policy!.revision},pickupWindow:{slotId,startsAt:slot.startsAt.toISOString(),endsAt:slot.endsAt.toISOString(),timezone:PICKUP_TIMEZONE,serviceDate:serviceDate(slot.startsAt)}};
}
export async function holdPickup(tx:Prisma.TransactionClient,storeId:string,booking:PickupBooking){
 const slot=await tx.pickupSlot.findUnique({where:{id:booking.slotId}});if(!slot)fail('PICKUP_TIME_UNAVAILABLE','取餐时段不存在',409);if(slot.storeId!==storeId)fail('FORBIDDEN','取餐时段不属于此门店',403);
 const policy=await tx.pickupPolicy.findUnique({where:{storeId}});
 if(!policy||policy.revision!==booking.policyRevision||slot.revision!==booking.slotRevision)fail('PICKUP_RULES_CHANGED','预约规则已变更，请重新选择时段',409);
 if(!bookable(policy,slot))fail('PICKUP_TIME_UNAVAILABLE','此取餐时间已不可预约',409);
 if(slot.heldCount+slot.confirmedCount>=slot.capacity)fail('PICKUP_SLOT_FULL','此时段已约满',409);
 const held=await tx.pickupSlot.updateMany({where:{id:slot.id,revision:slot.revision,heldCount:slot.heldCount,confirmedCount:slot.confirmedCount,capacity:slot.capacity},data:{heldCount:{increment:1}}});
 if(!held.count)fail('PICKUP_SLOT_FULL','此时段余量已变更，请重新选择',409);
 return serviceDate(slot.startsAt);
}
// All order inventory writers call this after modifier/SKU writes; capacity never changes the configuration revision.
export async function settlePickup(tx:Prisma.TransactionClient,orderId:string,release:boolean){
 const reservation=await tx.pickupReservation.findUnique({where:{orderId}});if(!reservation||reservation.state!=='HELD')return;
 const changed=await tx.pickupSlot.updateMany({where:{id:reservation.slotId,heldCount:{gte:1}},data:{heldCount:{decrement:1},...(release?{}:{confirmedCount:{increment:1}})}});
 if(!changed.count)fail('STATE_CONFLICT','预约容量记录冲突',409);
 const state=release?'RELEASED':'CONFIRMED';const settled=await tx.pickupReservation.updateMany({where:{orderId,state:'HELD'},data:{state}});
 if(!settled.count)fail('STATE_CONFLICT','预约状态已改变',409);
}
export async function allocatePickupNumber(tx:Prisma.TransactionClient,storeId:string,date:string){
 const sequence=await tx.pickupSequence.upsert({where:{storeId_serviceDate:{storeId,serviceDate:date}},create:{storeId,serviceDate:date,lastNumber:1},update:{lastNumber:{increment:1}}});
 return {pickupServiceDate:date,pickupOrdinal:sequence.lastNumber,pickupNumber:'Q'+String(sequence.lastNumber).padStart(4,'0')};
}
