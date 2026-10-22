import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {seed} from '../prisma/seed';
import {createApp} from '../src/main';
import {OrdersService} from '../src/modules/orders/orders.service';
import {OrderExpiryService} from '../src/modules/orders/order-expiry.service';
import {effectivePaymentDeadline,paymentDeadline,PAYMENT_WINDOW_MS} from '../src/modules/orders/payment-deadline';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,readdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
let safe=false;
try{safe=/^test_pickup_deadline_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL||'').searchParams.get('schema')||'');}catch{}
if(!safe)throw new Error('Payment deadline tests require an isolated test_pickup_deadline_* schema');
const windowMs=15*60_000;

test('UTC payment rule caps longer historical deadlines and preserves shorter millisecond cutoffs',()=>{
 const createdAt=new Date('2026-10-20T15:59:59.999Z'),deadline=paymentDeadline(createdAt);
 assert.equal(PAYMENT_WINDOW_MS,windowMs);assert.equal(deadline.toISOString(),'2026-10-20T16:14:59.999Z');
 for(const offset of [-1,0,1,8*3600000]){
  const paymentExpiresAt=new Date(deadline.getTime()+offset);
  assert.equal(effectivePaymentDeadline({createdAt,paymentExpiresAt}).getTime(),deadline.getTime()+Math.min(offset,0));
 }
 assert.equal(createdAt.toISOString(),'2026-10-20T15:59:59.999Z');
});

async function httpFixture(run:(ctx:any)=>Promise<void>){
 const db=new PrismaClient();await seed(db);const app=await createApp();await app.listen(0,'127.0.0.1');
 // Deterministic explicit sweep calls below; do not race the local fixture with its timer.
 app.get(OrderExpiryService).onModuleDestroy();
 try{
  const base=await app.getUrl()+'/api/v1';
  const req=async(path:string,token?:string,body?:any,method?:string,key?:string)=>{
   const response=await fetch(base+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});
   const data=await response.json() as any;assert.ok(data.requestId);return {status:response.status,body:data};
  };
  const login=async(account:string)=>(await req('/auth/dev-login',undefined,{account})).body.data.token;
  const owner=await login('owner'),customer=await login('customer'),clerk=await login('clerk-a');
  assert.equal((await req('/merchant/cash-shifts',owner,{storeId:'experience-store-a',openingFen:0},'POST','deadline-fixture-shift')).status,201);
  const create=async(key:string,pickupSlotId?:string,legacy=false)=>{
   const quote=await req('/quotes',customer,{storeId:'experience-store-a',mode:'PICKUP',lines:[{skuId:'experience-a-chicken-sku-0',quantity:1,modifierIds:['experience-a-chicken-egg']}],...(pickupSlotId?{pickupSlotId}:{})});assert.equal(quote.status,201);
   if(legacy){const q=await db.quote.findUniqueOrThrow({where:{id:quote.body.data.id}}),snapshot=q.snapshot as any;delete snapshot.pickupBooking;delete snapshot.pickupWindow;await db.quote.update({where:{id:q.id},data:{snapshot}});}
   const result=await req('/orders',customer,{quoteId:quote.body.data.id},undefined,key);assert.equal(result.status,201);assert.equal('paymentExpiresAt' in result.body.data,false);return result.body.data;
  };
  await run({db,app,req,owner,customer,clerk,create});
 }finally{await app.close();await db.$disconnect();}
}

test('HTTP new orders persist exactly fifteen UTC minutes in the non-UTC database session',async()=>httpFixture(async({db,app,create,req,customer}:any)=>{
 const timezone=await db.$queryRawUnsafe('SHOW TimeZone');console.log('Prisma session timezone:',JSON.stringify(timezone));assert.equal(timezone[0].TimeZone,'Asia/Shanghai');
 const order=await create('deadline-default'),stored=await db.order.findUniqueOrThrow({where:{id:order.id}});
 console.log('HTTP deadline SQL:',stored.createdAt.toISOString(),stored.paymentExpiresAt.toISOString(),'deltaMs=',stored.paymentExpiresAt.getTime()-stored.createdAt.getTime());
 assert.equal(stored.paymentExpiresAt.getTime()-stored.createdAt.getTime(),windowMs,'HTTP order deadline must use the same UTC creation instant +15min');
 assert.equal(await app.get(OrdersService).expireUnpaid(new Date(stored.createdAt.getTime()+windowMs-1)),0,'future order remains open until its deadline');
 assert.equal((await req('/orders/'+order.id,customer)).body.data.status,'PENDING_PAYMENT');
 assert.equal(await app.get(OrdersService).expireUnpaid(new Date(stored.createdAt.getTime()+windowMs)),1,'exact deadline closes');
 assert.equal(await app.get(OrdersService).expireUnpaid(new Date(stored.createdAt.getTime()+windowMs)),0);
}));

test('legacy polluted pending deadlines share cash and sweep cutoff without rewriting stored deadlines',async()=>httpFixture(async({db,app,req,owner,clerk,customer,create}:any)=>{
 const storeId='experience-store-a',day=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
 const policy=(await req('/merchant/pickup-policy?storeId='+storeId,owner)).body.data;
 assert.equal((await req('/merchant/pickup-policy',owner,{storeId,expectedRevision:policy.revision,enabled:true,leadMinutes:15,maxAdvanceDays:14},'PUT')).status,200);
 const slots=await req('/merchant/pickup-slots',owner,{storeId,slots:[{startsAt:day+'T12:00:00+08:00',endsAt:day+'T12:30:00+08:00',capacity:10}]});assert.equal(slots.status,201);const slotId=slots.body.data[0].id;
 const paid=await create('guard-paid',slotId);
 const cash=(o:any)=>req('/merchant/orders/'+o.id+'/cash-payment',clerk,{tenderedFen:o.totalFen});
 assert.equal((await cash(paid)).status,201);
 for(const action of ['ACCEPT','READY'])assert.equal((await req('/merchant/orders/'+paid.id+'/transition',clerk,{action})).status,201);
 assert.equal((await req('/merchant/orders/'+paid.id+'/pickup',clerk,{storeId,pickupNumber:paid.pickupNumber})).status,201);
 const paidBefore=await db.order.findUniqueOrThrow({where:{id:paid.id}}),confirmedBefore=await db.pickupReservation.findUniqueOrThrow({where:{orderId:paid.id}});
 const legacy=await create('guard-old-instant',undefined,true),spec=await create('guard-spec-instant'),booked=await create('guard-booked',slotId),short=await create('guard-short',slotId),future=await create('guard-future',slotId);
 const oldCreated=new Date(Date.now()-windowMs-60_000),polluted=new Date(oldCreated.getTime()+windowMs+8*3600000),shortDeadline=new Date(Date.now()-1000);
 for(const o of [legacy,spec,booked])await db.order.update({where:{id:o.id},data:{createdAt:oldCreated,paymentExpiresAt:polluted}});
 await db.order.update({where:{id:short.id},data:{paymentExpiresAt:shortDeadline}});
 const before=await db.pickupSlot.findUniqueOrThrow({where:{id:slotId}});assert.equal(before.heldCount,3);assert.equal(before.confirmedCount,1);
 const inventory=await db.sku.findUniqueOrThrow({where:{id:'experience-a-chicken-sku-0'}}),modifier=await db.modifier.findUniqueOrThrow({where:{id:'experience-a-chicken-egg'}});
 for(const o of [legacy,spec,booked,short]){
  const result=await cash(o);assert.equal(result.status,409,'expired legacy/short deadline cash must be rejected');assert.equal(result.body.error.code,'STATE_CONFLICT');assert.equal(await db.cashPayment.count({where:{orderId:o.id}}),0);
 }
 const now=new Date();assert.equal(await app.get(OrdersService).expireUnpaid(now),4,'candidate query must include polluted stored deadlines via createdAt');assert.equal(await app.get(OrdersService).expireUnpaid(now),0);
 for(const o of [legacy,spec,booked,short]){
  const row=await db.order.findUniqueOrThrow({where:{id:o.id}});assert.equal(row.status,'CANCELLED');assert.equal(row.paymentStatus,'CLOSED');assert.equal(row.inventoryReleased,true);
  assert.equal(row.paymentExpiresAt.getTime(),o.id===short.id?shortDeadline.getTime():polluted.getTime(),'stored deadline remains unchanged');
  assert.equal(await db.orderEvent.count({where:{orderId:o.id,status:'CANCELLED'}}),1);assert.equal(await db.audit.count({where:{entityId:o.id,action:'ORDER_EXPIRED'}}),1);
  assert.equal('paymentExpiresAt' in (await req('/orders/'+o.id,customer)).body.data,false);
 }
 for(const o of [booked,short])assert.equal((await db.pickupReservation.findUniqueOrThrow({where:{orderId:o.id}})).state,'RELEASED');
 assert.deepEqual(await db.order.findUniqueOrThrow({where:{id:paid.id}}),paidBefore);assert.deepEqual(await db.pickupReservation.findUniqueOrThrow({where:{orderId:paid.id}}),confirmedBefore);
 assert.equal((await db.order.findUniqueOrThrow({where:{id:future.id}})).status,'PENDING_PAYMENT');
 const after=await db.pickupSlot.findUniqueOrThrow({where:{id:slotId}});assert.equal(after.heldCount,1);assert.equal(after.confirmedCount,1);
 const finalSku=await db.sku.findUniqueOrThrow({where:{id:inventory.id}}),finalModifier=await db.modifier.findUniqueOrThrow({where:{id:modifier.id}});
 assert.equal(finalSku.stock,inventory.stock+4);assert.equal(finalSku.reserved,inventory.reserved-4);assert.equal(finalModifier.stock,modifier.stock+4);assert.equal(finalModifier.reserved,modifier.reserved-4);
 assert.equal((await cash(paid)).status,201,'paid receipt idempotency is preserved');
 await req('/orders/'+future.id+'/cancel',customer,{});
 console.log('Legacy guard: instant/spec/booking/short deadline rejected; 4 closures, repeat=0; inventory +4 once; CONFIRMED completed unchanged; stored deadlines unchanged');
}));

test('legacy sweeper selects a pending order even while its polluted stored deadline is in the future',async()=>httpFixture(async({db,app,create}:any)=>{
 const o=await create('guard-sweep-only',undefined,true),createdAt=new Date(Date.now()-windowMs-60_000),paymentExpiresAt=new Date(createdAt.getTime()+windowMs+8*3600000);
 await db.order.update({where:{id:o.id},data:{createdAt,paymentExpiresAt}});
 const counts=await Promise.all([app.get(OrdersService).expireUnpaid(),app.get(OrdersService).expireUnpaid()]);
 assert.equal(counts.reduce((sum,n)=>sum+n,0),1,'legacy candidate must be selected and concurrent sweep must close it only once');
 assert.equal(await app.get(OrdersService).expireUnpaid(),0);
 assert.equal(await db.orderEvent.count({where:{orderId:o.id,status:'CANCELLED'}}),1);
 assert.equal(await db.audit.count({where:{entityId:o.id,action:'ORDER_EXPIRED'}}),1);
 assert.equal((await db.order.findUniqueOrThrow({where:{id:o.id}})).paymentExpiresAt.getTime(),paymentExpiresAt.getTime());
}));

test('009 changes only default and direct SQL uses UTC in both session timezones',async()=>{
 const client=new pg.Client({connectionString:process.env.DATABASE_URL}),schema='test_pickup_deadline_migration_'+randomBytes(6).toString('hex');let created=false,identity:any;
 await client.connect();
 try{
  await client.query(`CREATE SCHEMA "${schema}"`);created=true;identity=(await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];await client.query(`SET search_path TO "${schema}"`);
  const root=resolve(__dirname,'../prisma/migrations');
  for(const name of (await readdir(root)).filter(x=>/^20261020000[1-8]_/.test(x)).sort())await client.query(await readFile(join(root,name,'migration.sql'),'utf8'));
  await client.query(`SET TIME ZONE 'Asia/Shanghai'`);
  await client.query(`INSERT INTO "Brand" (id,name) VALUES ('b','b');INSERT INTO "Store" (id,"brandId",name,address,phone) VALUES ('s','b','s','','');INSERT INTO "User" (id,"brandId",name,role) VALUES ('u','b','u','CUSTOMER')`);
  const insert=async(id:string)=>{await client.query(`INSERT INTO "Quote" (id,"userId","storeId",snapshot,"expiresAt") VALUES ($1,'u','s','{}',now()+interval '1 day')`,['q'+id]);await client.query(`INSERT INTO "Order" (id,number,"userId","storeId","quoteId","idempotencyKey","requestHash",mode,"subtotalFen","deliveryFeeFen","packagingFeeFen","discountFen","totalFen","storeName",lines,"createdAt") VALUES ($1,$1,'u','s',$2,$1,'h','PICKUP',100,0,0,0,100,'s','[]',now() AT TIME ZONE 'UTC')`,[id,'q'+id]);};
  await insert('old');
  const oldDelta=(await client.query(`SELECT EXTRACT(EPOCH FROM ("paymentExpiresAt"-"createdAt"))::int AS seconds FROM "Order" WHERE id='old'`)).rows[0].seconds;assert.equal(oldDelta,8*3600+900);console.log('Pre-009 Asia/Shanghai SQL default seconds=',oldDelta);
  const snapshot=async()=>{const tables=(await client.query('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename',[schema])).rows;const rows:any={};for(const {tablename} of tables)rows[tablename]=(await client.query(`SELECT row_to_json(t)::text AS row FROM "${tablename}" t ORDER BY row_to_json(t)::text`)).rows;return createHash('sha256').update(JSON.stringify(rows)).digest('hex');};
  const before=await snapshot(),sql=await readFile(join(root,'202610200009_payment_deadline_utc/migration.sql'),'utf8');
  await client.query(sql);assert.equal(await snapshot(),before,'every preexisting table/row remains byte-identical');console.log('009 old-row SHA256 unchanged:',before);
  for(const timezone of ['UTC','Asia/Shanghai']){
   await client.query(`SET TIME ZONE '${timezone}'`);await insert(timezone==='UTC'?'utc':'shanghai');
   const seconds=(await client.query(`SELECT EXTRACT(EPOCH FROM ("paymentExpiresAt"-"createdAt"))::int AS seconds FROM "Order" WHERE id=$1`,[timezone==='UTC'?'utc':'shanghai'])).rows[0].seconds;assert.equal(seconds,900);console.log('Post-009 direct SQL timezone='+timezone+' deltaSeconds='+seconds);
  }
 }finally{try{if(created){const current=(await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];assert.deepEqual(current,identity);await client.query(`DROP SCHEMA "${schema}" CASCADE`);}}finally{await client.end();}}
});

test('deadline module rejects unsafe schemas before connecting',()=>{
 for(const schema of ['development','public',undefined]){
  const env={...process.env,TSX_TSCONFIG_PATH:resolve(__dirname,'../tsconfig.json')};delete env.NODE_TEST_CONTEXT;
  if(schema)env.DATABASE_URL='postgresql://unused:unused@127.0.0.1:1/unused?schema='+schema;else delete env.DATABASE_URL;
  const result=spawnSync(process.execPath,['--import','tsx','--test','tests/payment-deadline.test.ts'],{cwd:resolve(__dirname,'..'),env,encoding:'utf8',windowsHide:true});assert.equal(result.status,1);assert.match(result.stdout+result.stderr,/Payment deadline tests require an isolated/);assert.doesNotMatch(result.stdout+result.stderr,/ECONNREFUSED|PrismaClientInitializationError/);
 }
});

for(const nested of [false,true])test('deadline '+(nested?'migration fixture':'runner')+' preserves collision sentinel',async()=>{
 const hex=randomBytes(6).toString('hex'),schema='test_pickup_deadline_'+(nested?'migration_':'')+hex,client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();const dir=await mkdtemp(join(tmpdir(),'deadline-'));let created=false,identity:any;
 try{
  await client.query(`CREATE SCHEMA "${schema}"`);created=true;identity=(await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];await client.query(`CREATE TABLE "${schema}".sentinel (value integer);INSERT INTO "${schema}".sentinel VALUES (42)`);
  const preload=join(dir,'fixed.cjs');await writeFile(preload,`require('node:crypto').randomBytes=()=>Buffer.from('${hex}','hex');`);const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const args=nested?['--require',preload,'--import','tsx','--test','--test-name-pattern','^009','apps/api/tests/payment-deadline.test.ts']:['--require',preload,'apps/api/tests/payment-deadline-runner.cjs'];
  const result=spawnSync(process.execPath,args,{cwd:resolve(__dirname,'../../..'),env,encoding:'utf8',windowsHide:true});assert.equal(result.status,1);assert.equal((await client.query(`SELECT value FROM "${schema}".sentinel`)).rows[0].value,42);
 }finally{try{if(created){assert.deepEqual((await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0],identity);await client.query(`DROP SCHEMA "${schema}" CASCADE`);}}finally{await client.end();await rm(dir,{recursive:true,force:true});}}
});
