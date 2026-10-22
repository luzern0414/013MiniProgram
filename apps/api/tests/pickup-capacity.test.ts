import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {seed} from '../prisma/seed';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFile,readdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import pg from 'pg';
import {bookable,dateRange,pickupDate,serviceDate,validateSlots,zonedInstant} from '../src/modules/pickup/pickup.validation';
let safe=false;
try {safe=/^test_pickup_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL||'').searchParams.get('schema')||'');}catch{}
if(!safe)throw new Error('Pickup tests require an isolated test_pickup_* schema');
const {createApp}=process.env.PICKUP_TEST_BUILD==='true'?require('../dist/src/main'):require('../src/main');
const {OrdersService}=process.env.PICKUP_TEST_BUILD==='true'?require('../dist/src/modules/orders/orders.service'):require('../src/modules/orders/orders.service');
test('pickup HTTP capacity, sequence, lifecycle, rules and permissions are database-backed',async()=>{
 const db=new PrismaClient();await seed(db);const app=await createApp();await app.listen(0,'127.0.0.1');
 try{
  const base=await app.getUrl()+'/api/v1';
  const login=await fetch(base+'/auth/dev-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:'owner'})});
  const token=(await login.json() as any).data.token;
  const response=await fetch(base+'/merchant/pickup-policy?storeId=experience-store-a',{headers:{Authorization:'Bearer '+token}});
  assert.equal(response.status,200,'missing pickup-policy endpoint is the expected RED');
  const storeId='experience-store-a',otherStore='experience-store-b';
  const req=async(path:string,token?:string,body?:any,method?:string,key?:string)=>{const r=await fetch(base+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});const b=await r.json() as any;assert.ok(b.requestId);return {status:r.status,body:b};};
  const loginAs=async(account:string)=>(await req('/auth/dev-login',undefined,{account})).body.data.token;
  const owner=token,clerk=await loginAs('clerk-a'),customer=await loginAs('customer'),foreign=await loginAs('clerk-b');
  assert.equal((await req('/merchant/cash-shifts',owner,{storeId,openingFen:0},'POST','pickup-fixture-shift')).status,201);
  let policy=(await response.json() as any).data;assert.equal(policy.enabled,false);assert.equal(policy.leadMinutes,15);assert.equal(policy.maxAdvanceDays,14);
  const date=new Date(Date.now()+2*86400000).toISOString().slice(0,10),date2=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
  const mkSlot=(day=date,start='12:00',end='12:30',capacity=1)=>({startsAt:`${day}T${start}:00+08:00`,endsAt:`${day}T${end}:00+08:00`,capacity});
  const putPolicy=(changes:any={},who=owner)=>req('/merchant/pickup-policy',who,{storeId,expectedRevision:policy.revision,enabled:true,leadMinutes:15,maxAdvanceDays:14,...changes},'PUT');
  const slots=(list:any[],who=owner)=>req('/merchant/pickup-slots',who,{storeId,slots:list});
  const getPublic=(day=date)=>req(`/stores/${storeId}/pickup-slots?date=${day}`);
  assert.deepEqual((await getPublic()).body.data,[]);
  for(const who of [clerk,customer,foreign])assert.equal((await putPolicy({},who)).status,403);
  assert.equal((await req('/merchant/pickup-policy?storeId='+storeId,clerk)).status,200);
  assert.equal((await req('/merchant/pickup-policy?storeId='+storeId,foreign)).status,403);
  for(const bad of [{leadMinutes:'1'},{leadMinutes:1441},{leadMinutes:-1},{maxAdvanceDays:0},{maxAdvanceDays:91},{enabled:1},{timezone:'UTC'},{unknown:1}])assert.equal((await putPolicy(bad)).status,400);
  let p=await putPolicy();assert.equal(p.status,200);policy=p.body.data;
  assert.equal((await putPolicy({expectedRevision:0})).status,409);
  for(const bad of [[{...mkSlot(),startsAt:date+'T12:00:00'}],[mkSlot(date,'12:30','12:00')],[mkSlot(date,'12:00','12:04')],[mkSlot(date,'12:00','16:01')],[mkSlot(date,'23:50','00:10')],[{...mkSlot(),capacity:0}],[{...mkSlot(),heldCount:0}],[{...mkSlot(),capacity:'1'}],Array.from({length:97},()=>mkSlot()),[mkSlot(),mkSlot(date,'12:15','12:45')]])assert.equal((await slots(bad)).status,400);
  const batchRace=await Promise.all([slots([mkSlot()]),slots([mkSlot()])]);assert.deepEqual(batchRace.map(x=>x.status).sort(),[201,409]);
  let slot=batchRace.find(x=>x.status===201)!.body.data[0];
  assert.equal((await slots([mkSlot(date,'11:50','12:10')])).status,409);
  assert.equal((await slots([mkSlot(date,'12:30','13:00'),mkSlot(date,'13:00','13:30')])).status,201);
  assert.equal((await req(`/merchant/pickup-slots?storeId=${storeId}&from=${date}&to=${date}`,owner)).body.data.length,3);
  assert.equal((await req(`/merchant/pickup-slots?storeId=${storeId}&from=2026-02-30&to=${date}`,owner)).status,400);
  assert.equal((await req(`/merchant/pickup-slots?storeId=${storeId}&from=2026-01-01&to=2026-02-01`,owner)).status,400);
  assert.equal((await req(`/merchant/pickup-slots?storeId=${storeId}&from=${date}&to=${date}&remaining=5`,owner)).status,400);
  const publicList=(await getPublic()).body.data;assert.equal(publicList.length,3);assert.deepEqual(Object.keys(publicList[0]).sort(),['endsAt','id','remaining','startsAt','timezone']);
  const skuId='experience-a-chicken-sku-0',modifierId='experience-a-chicken-egg';
  const quote=(pickupSlotId:any=slot.id,who=customer,extra:any={})=>req('/quotes',who,{storeId,mode:'PICKUP',lines:[{skuId,quantity:1,modifierIds:[modifierId]}],...(pickupSlotId===null?{}:{pickupSlotId}),...extra});
  const create=(q:any,key:string)=>req('/orders',customer,{quoteId:q.body.data.id},undefined,key);
  assert.equal((await quote(slot.id,customer,{mode:'DINE_IN',tableCode:'EXPERIENCE-A-1'})).status,400);
  const q1=await quote(),q2=await quote();assert.equal(q1.status,201);assert.equal(q1.body.data.pickupWindow.timezone,'Asia/Shanghai');
  assert.equal((await db.pickupSlot.findUniqueOrThrow({where:{id:slot.id}})).heldCount,0);
  const race=await Promise.all([create(q1,'race-1'),create(q2,'race-2')]);assert.deepEqual(race.map(x=>x.status).sort(),[201,409]);assert.equal(race.find(x=>x.status===409)!.body.error.code,'PICKUP_SLOT_FULL');
  const winning=race.find(x=>x.status===201)!.body.data;assert.equal(winning.pickupNumber,'Q0001');assert.equal(winning.pickupServiceDate,date);
  assert.equal((await db.pickupSlot.findUniqueOrThrow({where:{id:slot.id}})).heldCount,1);
  assert.equal((await db.sku.findUniqueOrThrow({where:{id:skuId}})).reserved,1);
  assert.equal((await db.modifier.findUniqueOrThrow({where:{id:modifierId}})).reserved,1);
  const same=await create(race[0].status===201?q1:q2,race[0].status===201?'race-1':'race-2');assert.equal(same.body.data.id,winning.id);
  assert.equal((await getPublic()).body.data.some((x:any)=>x.id===slot.id),false);
  const patch=(changes:any={},who=owner)=>req('/merchant/pickup-slots/'+slot.id,who,{storeId,expectedRevision:slot.revision,enabled:true,capacity:1,...changes},'PATCH');
  assert.equal((await patch({startsAt:mkSlot().startsAt})).status,400);
  assert.equal((await patch({},clerk)).status,403);
  let edited=await patch({enabled:false});assert.equal(edited.status,200);slot=edited.body.data;
  const cancel=()=>req('/orders/'+winning.id+'/cancel',customer,{});
  assert.equal((await cancel()).status,201);assert.equal((await cancel()).status,201);
  assert.equal((await db.pickupSlot.findUniqueOrThrow({where:{id:slot.id}})).heldCount,0);
  assert.equal((await db.sku.aggregate({_sum:{reserved:true}}))._sum.reserved,0);assert.equal((await db.modifier.aggregate({_sum:{reserved:true}}))._sum.reserved,0);
  assert.equal((await db.pickupReservation.findUniqueOrThrow({where:{orderId:winning.id}})).state,'RELEASED');
  edited=await patch({enabled:true,capacity:2});assert.equal(edited.status,200);slot=edited.body.data;
  assert.equal((await patch({expectedRevision:0})).status,409);
  const paid=await create(await quote(),'paid');assert.equal(paid.status,201);assert.equal(paid.body.data.pickupNumber,'Q0002');
  const held=await create(await quote(),'held');assert.equal(held.status,201);
  assert.equal((await patch({capacity:1})).status,409);
  const available=(await getPublic()).body.data[0];const staleQuote=await quote(available.id);assert.equal(staleQuote.status,201);
  p=await putPolicy({enabled:false});assert.equal(p.status,200);policy=p.body.data;
  assert.equal((await create(staleQuote,'changed-policy')).body.error.code,'PICKUP_RULES_CHANGED');assert.deepEqual((await getPublic()).body.data,[]);
  const cash=()=>req('/merchant/orders/'+paid.body.data.id+'/cash-payment',clerk,{tenderedFen:paid.body.data.totalFen});
  const cashRace=await Promise.all([cash(),cash()]);assert.deepEqual(cashRace.map(x=>x.status),[201,201]);
  const counts=await db.pickupSlot.findUniqueOrThrow({where:{id:slot.id}});assert.equal(counts.heldCount,1);assert.equal(counts.confirmedCount,1);
  assert.equal(await db.cashPayment.count({where:{orderId:paid.body.data.id}}),1);
  assert.equal((await req('/orders/'+paid.body.data.id+'/cancel',customer,{})).body.error.code,'REFUND_UNAVAILABLE');
  await db.order.update({where:{id:held.body.data.id},data:{paymentExpiresAt:new Date(Date.now()-1000)}});
  assert.equal(await app.get(OrdersService).expireUnpaid(),1);assert.equal(await app.get(OrdersService).expireUnpaid(),0);
  assert.equal((await db.pickupSlot.findUniqueOrThrow({where:{id:slot.id}})).heldCount,0);
  const transition=(action:string,id=paid.body.data.id)=>req('/merchant/orders/'+id+'/transition',clerk,{action});
  assert.equal((await transition('REJECT')).body.error.code,'REFUND_UNAVAILABLE');assert.equal((await transition('ACCEPT')).status,201);assert.equal((await transition('READY')).status,201);
  const pickup=(number:string,who=clerk,id=paid.body.data.id,s=storeId)=>req('/merchant/orders/'+id+'/pickup',who,{storeId:s,pickupNumber:number});
  assert.equal((await pickup('Q9999')).status,400);assert.equal((await pickup(paid.body.data.pickupNumber,foreign)).status,403);
  assert.equal((await pickup(paid.body.data.pickupNumber,owner,paid.body.data.id,otherStore)).status,403);
  assert.equal((await pickup(paid.body.data.pickupNumber)).body.data.status,'COMPLETED');assert.equal((await pickup(paid.body.data.pickupNumber)).body.data.status,'COMPLETED');
  assert.equal(await db.orderEvent.count({where:{orderId:paid.body.data.id,status:'COMPLETED'}}),1);
  assert.equal((await db.pickupSlot.findUniqueOrThrow({where:{id:slot.id}})).confirmedCount,1);
  p=await putPolicy();policy=p.body.data;
  const additional=await slots([mkSlot(date2)]);assert.equal(additional.status,201);
  const nextDay=await create(await quote(additional.body.data[0].id),'next-day');assert.equal(nextDay.body.data.pickupNumber,'Q0001');
  const instant=await create(await quote(null),'instant');assert.equal(instant.body.data.pickupNumber,'Q0001');assert.equal(instant.body.data.pickupWindow,null);
  assert.equal((await pickup(instant.body.data.pickupNumber,clerk,instant.body.data.id)).status,409);
  const legacyQ=await quote(null),legacySnapshot=(await db.quote.findUniqueOrThrow({where:{id:legacyQ.body.data.id}})).snapshot as any;delete legacySnapshot.pickupBooking;delete legacySnapshot.pickupWindow;await db.quote.update({where:{id:legacyQ.body.data.id},data:{snapshot:legacySnapshot}});
  const legacy=await create(legacyQ,'legacy');assert.equal(legacy.status,201);
  await db.order.update({where:{id:legacy.body.data.id},data:{pickupNumber:'ABCDEF5678',pickupServiceDate:null,pickupOrdinal:null}});
  const before=await db.order.findUniqueOrThrow({where:{id:legacy.body.data.id}});
  assert.equal((await req('/orders/'+legacy.body.data.id,customer)).body.data.pickupNumber,'ABCDEF5678');
  await req('/merchant/orders/'+legacy.body.data.id+'/cash-payment',clerk,{tenderedFen:before.totalFen});await transition('ACCEPT',before.id);await transition('READY',before.id);assert.equal((await pickup('ABCDEF5678',clerk,before.id)).status,201);
  const after=await db.order.findUniqueOrThrow({where:{id:before.id}});assert.deepEqual(after.lines,before.lines);assert.equal(after.pickupWindow,null);assert.equal(after.pickupNumber,before.pickupNumber);
  const otherSlot=(await req('/merchant/pickup-slots',owner,{storeId:otherStore,slots:[mkSlot()]})).body.data[0];assert.equal((await quote(otherSlot.id)).status,403);
  const otherQ=await quote(null,customer,{storeId:otherStore,lines:[{skuId:'experience-b-chicken-sku-0',quantity:1,modifierIds:[]}]});const other=await create(otherQ,'other-store');assert.equal(other.body.data.pickupNumber,'Q0001');
  const extraSlot=(await getPublic()).body.data.find((s:any)=>s.id!==slot.id),slotQuote=await quote(extraSlot.id);assert.equal(slotQuote.status,201);
  const slotUpdate=await req('/merchant/pickup-slots/'+extraSlot.id,owner,{storeId,expectedRevision:0,enabled:true,capacity:2},'PATCH');assert.equal(slotUpdate.status,200);assert.equal((await create(slotQuote,'changed-slot')).body.error.code,'PICKUP_RULES_CHANGED');
  const retired=await create(await quote(extraSlot.id),'rejected');assert.equal(retired.status,201);
  const reject=()=>req('/merchant/orders/'+retired.body.data.id+'/transition',clerk,{action:'REJECT'});assert.equal((await reject()).status,201);assert.equal((await reject()).status,409);assert.equal((await db.pickupSlot.findUniqueOrThrow({where:{id:extraSlot.id}})).heldCount,0);
  for(const o of [nextDay.body.data,instant.body.data,other.body.data])assert.equal((await req('/orders/'+o.id+'/cancel',customer,{})).status,201);
  assert.equal((await db.sku.aggregate({_sum:{reserved:true}}))._sum.reserved,0);assert.equal((await db.modifier.aggregate({_sum:{reserved:true}}))._sum.reserved,0);
  assert.equal((await db.pickupSlot.aggregate({_sum:{heldCount:true}}))._sum.heldCount,0);
  assert.deepEqual((await db.order.findUniqueOrThrow({where:{id:paid.body.data.id}})).pickupWindow,paid.body.data.pickupWindow);
  const largeDate=new Date(Date.now()+4*86400000).toISOString().slice(0,10);await db.pickupSequence.create({data:{storeId,serviceDate:largeDate,lastNumber:9999}});const largeSlot=(await slots([mkSlot(largeDate)])).body.data[0];const large=await create(await quote(largeSlot.id),'large');assert.equal(large.body.data.pickupNumber,'Q10000');await req('/orders/'+large.body.data.id+'/cancel',customer,{});
  const now=new Date(),timeStart=new Date(now.getTime()+16*60000),timeEnd=new Date(now.getTime()+21*60000);
  if(serviceDate(timeStart)===serviceDate(timeEnd)){
   const timed=await slots([{startsAt:timeStart.toISOString(),endsAt:timeEnd.toISOString(),capacity:1}]);assert.equal(timed.status,201);const timedQ=await quote(timed.body.data[0].id);assert.equal(timedQ.status,201);
   // Simulate persisted time passing without altering configuration versions or quote validity.
   await db.pickupSlot.update({where:{id:timed.body.data[0].id},data:{startsAt:new Date(timeStart.getTime()-2*60000),endsAt:new Date(timeEnd.getTime()-2*60000)}});
   assert.equal((await create(timedQ,'time-unavailable')).body.error.code,'PICKUP_TIME_UNAVAILABLE');assert.equal((await db.pickupSlot.findUniqueOrThrow({where:{id:timed.body.data[0].id}})).heldCount,0);
  }
  await db.pickupPolicy.delete({where:{storeId:otherStore}});assert.equal((await req('/merchant/pickup-policy?storeId='+otherStore,owner)).body.error.code,'PICKUP_CONFIGURATION_MISSING');assert.equal(await db.pickupPolicy.count({where:{storeId:otherStore}}),0);
  assert.deepEqual((await req(`/stores/${otherStore}/pickup-slots?date=${date}`)).body.data,[]);
  assert.equal((await req('/merchant/pickup-policy',owner,{storeId:otherStore,expectedRevision:0,enabled:false,leadMinutes:15,maxAdvanceDays:14},'PUT')).status,200);
  await db.staffStore.delete({where:{userId_storeId:{userId:'experience-user-owner',storeId}}});assert.equal((await putPolicy()).status,403);await db.staffStore.create({data:{userId:'experience-user-owner',storeId}});
  await db.user.update({where:{id:'experience-user-owner'},data:{enabled:false}});assert.equal((await putPolicy()).status,401);await db.user.update({where:{id:'experience-user-owner'},data:{enabled:true}});
  assert.ok(await db.audit.count({where:{action:{in:['PICKUP_POLICY_UPDATE','PICKUP_SLOTS_CREATE','PICKUP_SLOT_UPDATE','COMPLETE']}}}));
  console.log('SQL capacity after settlement:',JSON.stringify(await db.pickupSlot.findUnique({where:{id:slot.id}})),'inventory reserved=',(await db.sku.aggregate({_sum:{reserved:true}}))._sum.reserved);
 }finally{await app.close();await db.$disconnect();}
});

test('pickup lookup filters over 2000 SQL historical orders with scoped date, number and pagination',async()=>{
 const db=new PrismaClient(),app=await createApp();await app.listen(0,'127.0.0.1');
 try {
  const base=await app.getUrl()+'/api/v1',storeId='experience-store-a',otherStore='experience-store-b';
  const req=async(path:string,token:string)=>{const r=await fetch(base+path,{headers:{Authorization:'Bearer '+token}});const body=await r.json() as any;assert.ok(body.requestId);return {status:r.status,body};};
  const login=async(account:string)=>{const r=await fetch(base+'/auth/dev-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account})});return (await r.json() as any).data.token;};
  const owner=await login('owner'),clerk=await login('clerk-a'),foreign=await login('clerk-b'),customer=await login('customer');
  const user=await db.user.findUniqueOrThrow({where:{devAccount:'customer'}});
  const another=await db.user.create({data:{id:'lookup-other-user',brandId:user.brandId,name:'lookup other',role:'CUSTOMER'}});
  const at=new Date('2026-10-20T16:00:00Z');
  const fixture=(id:string,extra:any={})=>({id:'lookup-'+id,number:'lookup-'+id,userId:user.id,storeId,quoteId:'lookup-q-'+id,idempotencyKey:'lookup-'+id,requestHash:'lookup',mode:'PICKUP',subtotalFen:100,deliveryFeeFen:0,packagingFeeFen:0,discountFen:0,totalFen:100,storeName:'lookup',lines:[],pickupNumber:'ABCDEF9999',pickupServiceDate:null,createdAt:new Date('2026-10-01T00:00:00Z'),...extra});
  const orders=[...Array.from({length:2001},(_,i)=>fixture('history-'+i)),
   fixture('new',{pickupNumber:'Q10000',pickupServiceDate:'2026-10-21',pickupOrdinal:10000,createdAt:at}),
   fixture('other-day',{pickupNumber:'Q10000',pickupServiceDate:'2026-10-22',pickupOrdinal:10000}),
   fixture('other-store',{storeId:otherStore,pickupNumber:'Q10000',pickupServiceDate:'2026-10-21',pickupOrdinal:10000}),
   fixture('other-customer',{userId:another.id,pickupNumber:'Q10000',pickupServiceDate:'2026-10-21',pickupOrdinal:10001}),
   fixture('dine-in',{mode:'DINE_IN',pickupNumber:'Q10000',pickupServiceDate:'2026-10-21',pickupOrdinal:10002}),
   fixture('legacy-before',{pickupNumber:'ABCDEF1234',pickupServiceDate:null,createdAt:new Date(at.getTime()-1)}),
   ...Array.from({length:103},(_,i)=>fixture('legacy-'+String(i).padStart(3,'0'),{pickupNumber:'ABCDEF1234',pickupServiceDate:null,createdAt:at})),
   fixture('legacy-last',{pickupNumber:'ABCDEF1234',pickupServiceDate:null,createdAt:new Date(at.getTime()+86400000-1)}),
   fixture('legacy-after',{pickupNumber:'ABCDEF1234',pickupServiceDate:null,createdAt:new Date(at.getTime()+86400000)})];
  await db.quote.createMany({data:orders.map(o=>({id:o.quoteId,userId:o.userId,storeId:o.storeId,snapshot:{},expiresAt:new Date('2030-01-01')}))});
  await db.order.createMany({data:orders});
  const before=await db.order.findMany({where:{id:{startsWith:'lookup-'}},orderBy:{id:'asc'}});
  const path=(number='q10000',date='2026-10-21',store=storeId)=>`/orders?storeId=${store}&pickupNumber=${number}&pickupServiceDate=${date}&pageSize=100`;
  for(const who of [owner,clerk]){
   const result=await req(path(),who);assert.equal(result.status,200);assert.equal(result.body.data.total,2,'server predicate must exclude >2000 unrelated histories');
   assert.deepEqual(result.body.data.items.map((o:any)=>o.id),['lookup-new','lookup-other-customer']);
  }
  const mine=await req(path()+'&userId='+another.id,customer);assert.equal(mine.status,200);assert.deepEqual(mine.body.data.items.map((o:any)=>o.id),['lookup-new']);
  assert.equal((await req(path(),foreign)).status,403);
  assert.equal((await req(path('Q10000','2026-10-21',otherStore),clerk)).status,403);
  assert.equal((await req(path('Q10000','2026-10-21',otherStore),owner)).body.data.items[0].id,'lookup-other-store');
  assert.equal((await req(path('Q10000','2026-10-22'),owner)).body.data.items[0].id,'lookup-other-day');
  const first=await req(path('abcdef1234'),clerk),second=await req(path('ABCDEF1234')+'&page=2',clerk);
  assert.equal(first.status,200);assert.equal(first.body.data.total,104);assert.equal(first.body.data.items.length,100);assert.equal(second.body.data.items.length,4);
  const expected=before.filter(o=>o.pickupNumber==='ABCDEF1234'&&o.createdAt>=at&&o.createdAt<new Date(at.getTime()+86400000)).sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()||b.id.localeCompare(a.id));
  assert.deepEqual([...first.body.data.items,...second.body.data.items].map((o:any)=>o.id),expected.map(o=>o.id));
  const invalid=[`storeId=${storeId}&pickupNumber=Q0001`,`storeId=${storeId}&pickupServiceDate=2026-10-21`,'pickupNumber=Q0001&pickupServiceDate=2026-10-21',
   ...['Q001','X1234','ABC123','Q0001%20x',''].map(n=>`storeId=${storeId}&pickupNumber=${n}&pickupServiceDate=2026-10-21`),
   ...['2026-02-30','2026-13-01','2026-1-01',''].map(d=>`storeId=${storeId}&pickupNumber=Q0001&pickupServiceDate=${d}`),
   `storeId=${storeId}&pickupNumber=Q0001&pickupNumber=Q0002&pickupServiceDate=2026-10-21`,
   `storeId=${storeId}&pickupNumber[x]=Q0001&pickupServiceDate=2026-10-21`,
   `storeId=${storeId}&pickupNumber=Q0001&pickupServiceDate[]=2026-10-21`,
   `storeId=${storeId}&storeId=${otherStore}&pickupNumber=Q0001&pickupServiceDate=2026-10-21`];
  for(const query of invalid)assert.equal((await req('/orders?'+query,owner)).status,400,query);
  assert.equal((await req('/orders?storeId='+storeId,clerk)).status,200,'ordinary lists stay compatible');
  await db.staffStore.delete({where:{userId_storeId:{userId:'experience-user-clerk-a',storeId}}});
  assert.equal((await req(path(),clerk)).status,403,'permissions are refreshed per request');
  await db.staffStore.create({data:{userId:'experience-user-clerk-a',storeId}});
  assert.deepEqual(await db.order.findMany({where:{id:{startsWith:'lookup-'}},orderBy:{id:'asc'}}),before,'lookup must not rewrite old/new orders');
  console.log('Lookup SQL: 2001 unrelated histories; exact new/legacy lookup, Shanghai half-open boundaries, 104 collisions, permissions and malformed queries passed');
 }finally{await app.close();await db.$disconnect();}
});

test('pickup dates, timezone, lead and horizon boundaries are exact',()=>{
 assert.equal(serviceDate(new Date('2026-10-20T16:00:00Z')),'2026-10-21');
 for(const input of ['2026-02-30','2026-13-01','2026-1-01','2026-01-00',1,null])assert.throws(()=>pickupDate(input));
 for(const input of ['2026-02-30T12:00:00+08:00','2026-10-20T12:00:00','2026-10-20T24:00:00Z','2026-10-20T12:60:00Z','2026-10-20T12:00:60Z','2026-10-20T12:00:00+14:30'])assert.throws(()=>zonedInstant(input));
 assert.equal(zonedInstant('2026-10-20T12:00:00+08:00').toISOString(),'2026-10-20T04:00:00.000Z');
 assert.doesNotThrow(()=>dateRange('2026-01-01','2026-01-31'));assert.throws(()=>dateRange('2026-01-01','2026-02-01'));assert.throws(()=>dateRange('2026-01-02','2026-01-01'));
 const now=new Date('2026-10-20T04:00:00Z'),policy={enabled:true,leadMinutes:15,maxAdvanceDays:14};
 const available=(iso:string)=>bookable(policy,{enabled:true,startsAt:new Date(iso)},now);
 assert.equal(available('2026-10-20T04:15:00Z'),true);assert.equal(available('2026-10-20T04:14:59.999Z'),false);
 assert.equal(available('2026-11-03T15:59:59.999Z'),true);assert.equal(available('2026-11-03T16:00:00Z'),false);
 assert.equal(bookable(null,{enabled:true,startsAt:new Date('2026-10-21T04:00:00Z')},now),false);assert.equal(bookable({...policy,enabled:false},{enabled:true,startsAt:new Date('2026-10-21T04:00:00Z')},now),false);assert.equal(bookable(policy,{enabled:false,startsAt:new Date('2026-10-21T04:00:00Z')},now),false);
 for(const minutes of [5,240])assert.doesNotThrow(()=>validateSlots([{startsAt:'2026-10-20T08:00:00+08:00',endsAt:new Date(new Date('2026-10-20T08:00:00+08:00').getTime()+minutes*60000).toISOString(),capacity:1000}]));
 assert.throws(()=>validateSlots([{startsAt:'2026-10-20T23:55:00+08:00',endsAt:'2026-10-21T00:05:00+08:00',capacity:1}]));
});

test('module rejects unsafe schemas before connecting',()=>{
 for(const schema of ['development','public',undefined]){
  const env={...process.env,TSX_TSCONFIG_PATH:resolve(__dirname,'../tsconfig.json')};delete env.NODE_TEST_CONTEXT;
  if(schema)env.DATABASE_URL='postgresql://unused:unused@127.0.0.1:1/unused?schema='+schema;else delete env.DATABASE_URL;
  const r=spawnSync(process.execPath,['--import','tsx','--test','tests/pickup-capacity.test.ts'],{cwd:resolve(__dirname,'..'),env,encoding:'utf8',windowsHide:true});assert.equal(r.status,1);assert.match(r.stdout+r.stderr,/Pickup tests require an isolated/);assert.doesNotMatch(r.stdout+r.stderr,/ECONNREFUSED|PrismaClientInitializationError/);
 }
});

async function migrationFixture(){
 const schema='test_pickup_migration_'+randomBytes(6).toString('hex'),client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();let created=false,identity:any;
 try{
  await client.query(`CREATE SCHEMA "${schema}"`);created=true;identity=(await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];await client.query(`SET search_path TO "${schema}"`);
  const root=resolve(__dirname,'../prisma/migrations');for(const m of (await readdir(root)).filter(x=>/^20261020000[1-7]_/.test(x)).sort())await client.query(await readFile(join(root,m,'migration.sql'),'utf8'));
  await client.query(`INSERT INTO "Brand" (id,name) VALUES ('b','old'); INSERT INTO "Store" (id,"brandId",name,address,phone) VALUES ('s','b','old','',''); INSERT INTO "Category" (id,"brandId",name) VALUES ('c','b','old'); INSERT INTO "User" (id,"brandId",name,role) VALUES ('u','b','old','CUSTOMER'); INSERT INTO "Session" (id,"tokenHash","userId","expiresAt") VALUES ('session','hash','u',now()+interval '1 day'); INSERT INTO "Product" (id,"storeId","categoryId",name) VALUES ('p','s','c','old'); INSERT INTO "Sku" (id,"productId",name,"priceFen",stock,reserved) VALUES ('sku','p','old',100,12,3); INSERT INTO "Modifier" (id,"productId",name,"priceFen",stock,reserved) VALUES ('m','p','old',10,7,2); INSERT INTO "Quote" (id,"userId","storeId",snapshot,"expiresAt") VALUES ('q','u','s','{"lines":[]}',now()+interval '1 day'); INSERT INTO "Order" (id,number,"userId","storeId","quoteId","idempotencyKey","requestHash",mode,"subtotalFen","deliveryFeeFen","packagingFeeFen","discountFen","totalFen","storeName",lines,"pickupNumber") VALUES ('o','n','u','s','q','key','hash','PICKUP',100,0,0,0,100,'old','[]','AABBCC1234'); INSERT INTO "CashPayment" (id,"orderId","staffId","amountFen","tenderedFen","changeFen") VALUES ('cash','o','u',100,100,0);`);
  const tables=['Store','Product','Sku','Modifier','Order','Quote','Session','CashPayment'],snapshots=new Map<string,any>();for(const table of tables)snapshots.set(table,(await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows);
  await client.query(await readFile(join(root,'202610200008_pickup_capacity/migration.sql'),'utf8'));
  for(const table of tables){const rows=(await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows;assert.deepEqual(rows.map(({pickupServiceDate,pickupOrdinal,pickupWindow,...r}:any)=>r),snapshots.get(table));}
  const order=(await client.query('SELECT * FROM "Order"')).rows[0];assert.equal(order.pickupServiceDate,null);assert.equal(order.pickupOrdinal,null);assert.equal(order.pickupWindow,null);assert.equal(order.pickupNumber,'AABBCC1234');
  assert.deepEqual((await client.query('SELECT * FROM "PickupPolicy"')).rows,[{storeId:'s',enabled:false,revision:0,timezone:'Asia/Shanghai',leadMinutes:15,maxAdvanceDays:14}]);
  console.log('Migration 008 preserved Store/Product/Sku/Modifier/Order/Quote/Session/CashPayment; old number and snapshots unchanged');
 }finally{try{if(created){const current=(await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];assert.deepEqual(current,identity);await client.query(`DROP SCHEMA "${schema}" CASCADE`);}}finally{await client.end();}}
}
test('incremental migration preserves legacy data and initializes closed policy',migrationFixture);
for(const nested of [false,true])test((nested?'migration fixture':'runner')+' preserves collision sentinel',async()=>{
 const hex=randomBytes(6).toString('hex'),schema='test_pickup_'+(nested?'migration_':'')+hex,client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();const dir=await mkdtemp(join(tmpdir(),'pickup-'));let created=false,identity:any;
 try{await client.query(`CREATE SCHEMA "${schema}"`);created=true;identity=(await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];await client.query(`CREATE TABLE "${schema}".sentinel (value integer); INSERT INTO "${schema}".sentinel VALUES (42)`);const preload=join(dir,'fixed.cjs');await writeFile(preload,`require('node:crypto').randomBytes=()=>Buffer.from('${hex}','hex');`);
  const env={...process.env,TSX_TSCONFIG_PATH:'apps/api/tsconfig.json'};delete env.NODE_TEST_CONTEXT;
  const args=nested?['--require',preload,'--import','tsx','--test','--test-name-pattern','^incremental migration','apps/api/tests/pickup-capacity.test.ts']:['--require',preload,'apps/api/tests/pickup-runner.cjs'];
  const r=spawnSync(process.execPath,args,{cwd:resolve(__dirname,'../../..'),env,encoding:'utf8',windowsHide:true});assert.equal(r.status,1);assert.equal((await client.query(`SELECT value FROM "${schema}".sentinel`)).rows[0].value,42);
 }finally{try{if(created){const current=(await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];assert.deepEqual(current,identity);await client.query(`DROP SCHEMA "${schema}" CASCADE`);}}finally{await client.end();await rm(dir,{recursive:true,force:true});}}
});
