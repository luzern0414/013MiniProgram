import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {seed} from '../prisma/seed';
import {randomBytes, createHash} from 'node:crypto';
import {readFile, readdir, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
const {assertUrl, assertSchema, ownedSchema} = require('./customer-addresses-schema.cjs');
assertUrl(process.env.DATABASE_URL);
const build = process.env.CUSTOMER_ADDRESSES_TEST_BUILD === 'true';
const {createApp} = build ? require('../dist/src/main') : require('../src/main');
const {OrderExpiryService} = build ? require('../dist/src/modules/orders/order-expiry.service') : require('../src/modules/orders/order-expiry.service');
const {Db} = build ? require('../dist/src/common/db') : require('../src/common/db');
const {AuthService} = build ? require('../dist/src/modules/auth/auth.service') : require('../src/modules/auth/auth.service');
const fields = {name:'本地验收',phone:'13800000000',region:'本地验收地区',detail:'本地验收地址一号',point:null,isDefault:true};
const firstRequestBody = {expectedBookRevision:0,...fields};
const customerId = 'experience-user-customer';
async function fixture(run: (ctx: any) => Promise<void>) {
  const originalUrl = process.env.DATABASE_URL!, client = new pg.Client({connectionString: originalUrl}); await client.connect();
  try {return await ownedSchema(client, 'test_customer_addresses_case_' + randomBytes(6).toString('hex'), async (schema: string) => {
    const url = new URL(originalUrl); url.searchParams.set('schema', schema); assertUrl(url.href);
    await client.query(`SET search_path TO "${schema}"`);
    const root = resolve(__dirname, '../prisma/migrations');
    for (const name of (await readdir(root)).filter(x => /^\d+_/.test(x)).sort()) await client.query(await readFile(join(root, name, 'migration.sql'), 'utf8'));
    process.env.DATABASE_URL = url.href;
    const db = new PrismaClient(); await seed(db);
    const app = await createApp(); await app.listen(0, '127.0.0.1'); app.get(OrderExpiryService).onModuleDestroy();
    try {
      const base = await app.getUrl() + '/api/v1';
      const req = async (path: string, token?: string, body?: any, method?: string, key?: string) => {
        const response = await fetch(base + path, {method: method || (body === undefined ? 'GET' : 'POST'), headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {}), ...(key === undefined ? {} : {'Idempotency-Key': key})}, body: body === undefined ? undefined : JSON.stringify(body)});
        const result = await response.json() as any; assert.ok(result.requestId); return {status: response.status, body: result};
      };
      const login = async (account: string) => (await req('/auth/dev-login', undefined, {account})).body.data.token;
      const customer = await login('customer'), owner = await login('owner'), clerk = await login('clerk-a');
      const tokenFor = async (id: string) => {const token = randomBytes(32).toString('base64url'); await db.session.create({data:{userId:id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+60000)}});return token;};
      const other = await db.user.create({data:{id:'other-customer',brandId:'experience-brand',name:'other',role:'CUSTOMER'}});
      const foreign = await db.user.create({data:{id:'foreign-customer',brand:{create:{name:'foreign'}},name:'foreign',role:'CUSTOMER'}});
      const otherCustomer = await tokenFor(other.id), foreignCustomer = await tokenFor(foreign.id);
      let sequence = 0;
      const create = (revision=0, extra={}, key='create-'+ ++sequence, token=customer) => req('/customer/addresses',token,{expectedBookRevision:revision,...fields,...extra},'POST',key);
      const write = (kind:string,address:any,revision:number,extra={},key=kind+'-'+ ++sequence,token=customer) => req('/customer/addresses/'+address.id+(kind==='UPDATE'?'':'/'+kind.toLowerCase()),token,{expectedBookRevision:revision,expectedRevision:address.revision,...(kind==='UPDATE'?fields:{}),...extra},kind==='UPDATE'?'PUT':'POST',key);
      const list = (token=customer) => req('/customer/addresses',token);
      const detail = (id:string,token=customer) => req('/customer/addresses/'+id,token);
      await run({db,app,req,customer,owner,clerk,otherCustomer,foreignCustomer,create,write,list,detail,client,schema});
    } finally {await app.close(); await db.$disconnect();}
  });} finally {process.env.DATABASE_URL = originalUrl; await client.end();}
}
test('HTTP empty address book does not write; creates and replays original receipt', async () => fixture(async ({db,list,create,detail}:any) => {
  const empty = await list(); console.log('customer addresses focused RED empty status=',empty.status);
  assert.equal(empty.status,200); assert.deepEqual(empty.body.data,{items:[],bookRevision:0,limit:20});
  assert.equal(await db.customerAddressBook.count(),0);
  const first = await create(0,{},'address-create-a'); assert.equal(first.status,201); assert.equal(first.body.data.address.isDefault,true);assert.equal(first.body.data.bookRevision,1);
  const replay = await create(0,{},'address-create-a'); assert.equal(replay.status,201);assert.equal(replay.body.data.operation.addressId,first.body.data.address.id);assert.equal(replay.body.data.replayed,true);
  assert.deepEqual((await detail(first.body.data.address.id)).body.data.address,first.body.data.address);
}));
test('HTTP CAS/default/update/delete receipts retain original operation and current facts', async () => fixture(async ({db,create,write,list,detail}:any) => {
  const first = await create(0,{},'original'), a=first.body.data.address;
  const second=await create(1,{isDefault:false}), b=second.body.data.address;
  assert.equal((await write('UPDATE',a,1)).body.error.code,'ADDRESS_CHANGED');
  const defaults=await Promise.all([write('DEFAULT',a,2),write('DEFAULT',b,2)]);assert.deepEqual(defaults.map((r:any)=>r.status).sort(),[201,409]);
  assert.equal(await db.customerAddress.count({where:{userId:customerId,isDefault:true,deletedAt:null}}),1);
  let current=(await list()).body.data;
  const selected=current.items.find((x:any)=>x.isDefault), other=current.items.find((x:any)=>!x.isDefault);
  const unset=await write('UPDATE',selected,current.bookRevision,{isDefault:false,name:'  新姓名  '},'unset');assert.equal(unset.status,200);assert.equal(unset.body.data.address.name,'新姓名');
  assert.equal((await list()).body.data.items.some((x:any)=>x.isDefault),false);
  const set=await write('DEFAULT',other,unset.body.data.bookRevision,{},'set');assert.equal(set.status,201);
  const target=set.body.data.address, deleted=await write('DELETE',target,set.body.data.bookRevision,{},'delete');assert.equal(deleted.status,201);assert.ok(deleted.body.data.address.deletedAt);assert.equal(deleted.body.data.address.isDefault,false);
  const before=await db.customerAddress.findMany({orderBy:{id:'asc'}}), book=await db.customerAddressBook.findMany();
  const replay=await write('DELETE',target,set.body.data.bookRevision,{},'delete');assert.equal(replay.body.data.replayed,true);assert.deepEqual(replay.body.data.operation,deleted.body.data.operation);
  assert.equal((await write('DEFAULT',replay.body.data.address,replay.body.data.bookRevision)).body.error.code,'ADDRESS_DELETED');
  const old=await create(0,{},'original');assert.equal(old.body.data.replayed,true);assert.deepEqual(old.body.data.operation,first.body.data.operation);assert.ok(old.body.data.address.revision>0);assert.equal(old.body.data.bookRevision,deleted.body.data.bookRevision);
  assert.deepEqual(await db.customerAddress.findMany({orderBy:{id:'asc'}}),before);assert.deepEqual(await db.customerAddressBook.findMany(),book);
  assert.equal((await create(0,{name:'different'},'original')).body.error.code,'IDEMPOTENCY_CONFLICT');
  assert.deepEqual((await detail(target.id)).body.data.address,deleted.body.data.address);
  const items=(await list()).body.data.items;assert.equal(items.length,1);assert.equal(items[0].isDefault,false);
  for(const hidden of ['userId','brandId','key','requestHash','operations']) assert.equal(old.body.data.address[hidden],undefined);
  assert.deepEqual(Object.keys(old.body.data.operation).sort(),['kind','addressId','addressRevision','bookRevision','succeededAt'].sort());
}));
test('HTTP same-key race and 20/21 capacity serialize within one book', async () => fixture(async ({db,create,write}:any) => {
  const same=await Promise.all([create(0,{isDefault:false},'same'),create(0,{isDefault:false},'same')]);assert.deepEqual(same.map((r:any)=>r.status),[201,201]);assert.equal(same[0].body.data.address.id,same[1].body.data.address.id);assert.equal(await db.customerAddressOperation.count(),1);
  for(let revision=1;revision<19;revision++) assert.equal((await create(revision,{isDefault:false})).status,201);
  const competing=await Promise.all([create(19,{isDefault:false}),create(19,{isDefault:false})]);assert.deepEqual(competing.map((r:any)=>r.status).sort(),[201,409]);assert.equal(await db.customerAddress.count({where:{deletedAt:null}}),20);
  assert.equal((await create(20,{isDefault:false})).body.error.code,'ADDRESS_LIMIT');
  const a=same[0].body.data.address;assert.equal((await write('DELETE',a,20)).status,201);assert.equal((await create(21,{isDefault:false})).status,201);
}));
test('HTTP ownership, brand, staff, missing ID and revoked identity boundaries', async () => fixture(async ({db,req,create,detail,list,customer,owner,clerk,otherCustomer,foreignCustomer}:any) => {
  const a=(await create()).body.data.address;
  for(const token of [otherCustomer,foreignCustomer]) {
    assert.equal((await detail(a.id,token)).body.error.code,'ADDRESS_NOT_FOUND');assert.deepEqual((await list(token)).body.data.items,[]);
    assert.equal((await req('/customer/addresses/'+a.id+'/delete',token,{expectedBookRevision:0,expectedRevision:0},'POST','other-delete')).body.error.code,'ADDRESS_NOT_FOUND');
  }
  for(const token of [owner,clerk]) {assert.equal((await list(token)).status,403);assert.equal((await detail(a.id,token)).status,403);assert.equal((await create(0,{},'staff',token)).status,403);}
  assert.equal((await list('')).status,401);assert.equal((await detail('missing')).body.error.code,'ADDRESS_NOT_FOUND');
  assert.equal((await detail('a'.repeat(201))).status,400);
  await db.user.update({where:{id:customerId},data:{enabled:false}});assert.equal((await create(0,{},'create-1')).status,401);assert.equal((await list()).status,401);
  await db.user.update({where:{id:customerId},data:{enabled:true,role:'CLERK'}});assert.equal((await create(0,{},'create-1')).status,403);
}));
test('HTTP strict whitelist, required fields, coordinate, UTC and integer boundaries', async () => fixture(async ({req,create,customer}:any) => {
  const path='/customer/addresses';
  for(const field of Object.keys(firstRequestBody)) {const body:any={...firstRequestBody};delete body[field];assert.equal((await req(path,customer,body,'POST','missing')).status,400,field);}
  for(const extra of [{userId:customerId},{brandId:'experience-brand'},{id:'x'},{revision:0},{deletedAt:null},{name:''},{name:'a'.repeat(41)},{name:'a\u0000b'},{name:'a\u0085b'},{region:'x'},{region:'a\u009Fb'},{detail:'x'},{phone:'12800000000'},{phone:13800000000},{phone:' 13800000000 '},{isDefault:0},{isDefault:null},{expectedBookRevision:-1},{expectedBookRevision:1.1},{expectedBookRevision:'0'},{expectedBookRevision:2000000001}]) assert.equal((await create(0,extra)).status,400,JSON.stringify(extra));
  const point:any={system:'WGS84',latitudeE6:90000000,longitudeE6:-180000000,source:'MANUAL',confirmedAt:'2020-01-01T00:00:00.000Z'};
  for(const patch of [{system:'GCJ-02'},{latitudeE6:90000001},{latitudeE6:'0'},{latitudeE6:0.5},{longitudeE6:-180000001},{source:'GPS'},{confirmedAt:'2020-01-01T00:00:00Z'},{confirmedAt:'2020-02-30T00:00:00.000Z'},{confirmedAt:new Date(Date.now()+301000).toISOString()},{extra:1}]) assert.equal((await create(0,{point:{...point,...patch}})).status,400,JSON.stringify(patch));
  for(const p of [false,[],{},'point']) assert.equal((await create(0,{point:p})).status,400);
  for(const field of Object.keys(point)){const p={...point};delete p[field];assert.equal((await create(0,{point:p})).status,400);}
  for(const key of [undefined,'','bad key','x'.repeat(121)]) assert.equal((await req(path,customer,firstRequestBody,'POST',key)).status,400);
  assert.equal((await req(path+'?userId=x',customer)).status,400);
  const good=await create(0,{point,isDefault:false,name:'  姓名  ',region:'  地区  ',detail:'  街道  '},'canonical');assert.equal(good.status,201);assert.deepEqual(good.body.data.address.point,point);assert.equal(good.body.data.address.isDefault,false);
  assert.equal((await create(0,{point,isDefault:false,name:'姓名',region:'地区',detail:'街道'},'canonical')).body.data.replayed,true);
}));
test('HTTP operation-log failure and version overflow roll back all address changes', async () => fixture(async ({db,create,write,schema}:any) => {
  const a=(await create()).body.data.address,b=(await create(1,{isDefault:false})).body.data.address;
  const snapshot=()=>Promise.all([db.customerAddressBook.findMany(),db.customerAddress.findMany({orderBy:{id:'asc'}}),db.customerAddressOperation.findMany({orderBy:{id:'asc'}})]);
  await db.$executeRawUnsafe(`CREATE FUNCTION "${schema}".reject_address_operation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture operation failure'; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER reject_address_operation BEFORE INSERT ON "${schema}"."CustomerAddressOperation" FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_address_operation()`);
  const before=await snapshot();for(const op of [()=>write('DEFAULT',b,2),()=>write('UPDATE',a,2),()=>write('DELETE',a,2),()=>create(2)]) {assert.equal((await op()).status,500);assert.deepEqual(await snapshot(),before);}
  await db.$executeRawUnsafe('DROP TRIGGER reject_address_operation ON "CustomerAddressOperation"');
  for(const target of ['book','target','old-default']) {
    if(target==='book') await db.customerAddressBook.update({where:{userId:customerId},data:{revision:2000000000}});
    else await db.customerAddress.update({where:{id:target==='target'?b.id:a.id},data:{revision:2000000000}});
    const before=await snapshot(),currentBook=await db.customerAddressBook.findUniqueOrThrow({where:{userId:customerId}}),currentB=await db.customerAddress.findUniqueOrThrow({where:{id:b.id}});
    assert.equal((await write('DEFAULT',currentB,currentBook.revision)).body.error.code,'ADDRESS_VERSION_LIMIT');assert.deepEqual(await snapshot(),before);
    await db.customerAddressBook.update({where:{userId:customerId},data:{revision:2}});await db.customerAddress.updateMany({data:{revision:0}});
  }
}));
test('HTTP transaction rechecks session/role after initial authentication and book lock', async () => fixture(async ({app,db,create}:any) => {
  const auth=app.get(AuthService), original=auth.user.bind(auth);
  for(const index of [1,2]) {
    let calls=0;
    auth.user=async (...args:any[])=>{const user=await original(...args);if(++calls===index)await db.user.update({where:{id:customerId},data:{enabled:false}});return user;};
    try {assert.equal((await create()).status,401);assert.equal(await db.customerAddress.count(),0);assert.equal(await db.customerAddressBook.count(),0);} finally {auth.user=original;await db.user.update({where:{id:customerId},data:{enabled:true}});}
  }
}));
