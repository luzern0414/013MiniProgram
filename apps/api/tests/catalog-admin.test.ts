import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm,rmdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import pg from 'pg';
import {PrismaClient} from '@prisma/client';
import {createApp} from '../src/main';
import {seed} from '../prisma/seed';

let safe = false;
try { safe = /^test_catalog_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL || '').searchParams.get('schema') || ''); } catch {}
if (!safe) throw new Error('Catalog tests require an isolated test_catalog_* schema');

test('catalog module guard rejects unsafe schemas before database work', () => {
  for (const schema of ['development','public',undefined]) {
    const env={...process.env}; delete env.NODE_TEST_CONTEXT;
    if(schema) env.DATABASE_URL=`postgresql://unused:unused@127.0.0.1:1/unused?schema=${schema}`; else delete env.DATABASE_URL;
    const result=spawnSync(process.execPath,['--import','tsx','--test','--test-name-pattern','^catalog module guard','tests/catalog-admin.test.ts'],{cwd:resolve(__dirname,'..'),env:{...env,TSX_TSCONFIG_PATH:resolve(__dirname,'../tsconfig.json')},encoding:'utf8',windowsHide:true});
    assert.equal(result.status,1); assert.match(result.stdout+result.stderr,/Catalog tests require an isolated test_catalog_\* schema/);
    assert.doesNotMatch(result.stdout+result.stderr,/ECONNREFUSED|PrismaClientInitializationError/);
  }
});

test('catalog runner preserves an existing schema and sentinel on create-name collision',async()=>{
  const hex=randomBytes(6).toString('hex'),schema='test_catalog_'+hex;
  const directory=await mkdtemp(join(tmpdir(),'catalog-runner-')),preload=join(directory,'fixed-random.cjs');
  const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();let created=false;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);created=true;
    await client.query(`CREATE TABLE "${schema}".sentinel (value integer); INSERT INTO "${schema}".sentinel VALUES (42)`);
    await writeFile(preload,`require('node:crypto').randomBytes=()=>Buffer.from('${hex}','hex');`);
    const result=spawnSync(process.execPath,['--require',preload,'.superpowers/sdd/catalog-runner.cjs'],{cwd:resolve(__dirname,'../../..'),env:{...process.env},encoding:'utf8',windowsHide:true});
    assert.equal(result.status,1,'colliding runner must fail safely');
    assert.equal((await client.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[schema])).rowCount,1,'collision must preserve pre-existing schema');
    assert.equal((await client.query(`SELECT value FROM "${schema}".sentinel`)).rows[0].value,42);
  } finally {if(created) await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await client.end();await rm(preload,{force:true});await rmdir(directory);}
});

test('catalog migration fixture preserves an existing schema and sentinel on create-name collision',async()=>{
  const parentSchema='test_catalog_'+randomBytes(6).toString('hex'),schema=parentSchema+'_migration';
  const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
  let created=false,identity: {oid:number;nspowner:number}|undefined;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);created=true;
    identity=(await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];
    await client.query(`CREATE TABLE "${schema}".sentinel (value integer); INSERT INTO "${schema}".sentinel VALUES (42)`);
    const url=new URL(process.env.DATABASE_URL!);url.searchParams.set('schema',parentSchema);
    const env={...process.env,DATABASE_URL:url.href,TSX_TSCONFIG_PATH:resolve(__dirname,'../tsconfig.json')};delete env.NODE_TEST_CONTEXT;
    const result=spawnSync(process.execPath,['--import','tsx','--test','--test-name-pattern','^catalog migration preserves legacy','tests/catalog-admin.test.ts'],{cwd:resolve(__dirname,'..'),env,encoding:'utf8',windowsHide:true});
    assert.equal(result.status,1,'colliding migration fixture must fail safely');
    assert.match(result.stdout+result.stderr,/already exists/,'child must reach the CREATE SCHEMA collision');
    assert.deepEqual((await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0],identity,'collision must preserve pre-existing schema identity');
    assert.equal((await client.query(`SELECT value FROM "${schema}".sentinel`)).rows[0].value,42);
  } finally {
    try {
      if(created) {
        const current=(await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];
        if(current) {
          assert.deepEqual(current,identity,'collision regression cleanup must own the schema');
          await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        }
      }
    } finally {await client.end();}
  }
});

test('catalog Prisma schema restricts deletion of referenced units',()=>{
  const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','diff','--from-empty','--to-schema-datamodel','prisma/schema.prisma','--script'],{cwd:resolve(__dirname,'..'),env:{...process.env},encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/ADD CONSTRAINT "Product_unitId_fkey" FOREIGN KEY \("unitId"\) REFERENCES "Unit"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/);
});

test('catalog migration preserves legacy products, orders, inventory, sessions and unit text',async()=>{
  const schema=new URL(process.env.DATABASE_URL!).searchParams.get('schema')!+'_migration';
  assert.match(schema,/^test_catalog_[a-z0-9_]+$/);
  const client=new pg.Client({connectionString:process.env.DATABASE_URL}); await client.connect();
  let created=false,identity: {oid:number;nspowner:number}|undefined;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);created=true;
    identity=(await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];
    await client.query(`SET search_path TO "${schema}"`);
    for(const name of ['202610200001_initial','202610200002_integrity','202610200003_stock_capacity','202610200004_payment_expiry','202610200005_staff_access']) {
      await client.query(await readFile(resolve(__dirname,'../prisma/migrations',name,'migration.sql'),'utf8'));
    }
    await client.query(`INSERT INTO "Brand" (id,name) VALUES ('legacy-b','旧品牌'),('other-b','其他品牌');
      INSERT INTO "Store" (id,"brandId",name,address,phone) VALUES ('legacy-s','legacy-b','旧店','',''),('other-s','other-b','其他店','','');
      INSERT INTO "Category" (id,"brandId",name) VALUES ('legacy-c','legacy-b','旧分类'),('other-c','other-b','其他分类');
      INSERT INTO "Product" (id,"storeId","categoryId",name,unit) VALUES ('legacy-p1','legacy-s','legacy-c','重复商品',' 份 '),('legacy-p2','legacy-s','legacy-c','重复商品',' 份 '),('legacy-p3','legacy-s','legacy-c','杯装','杯'),('other-p','other-s','other-c','其他',' 份 ');
      INSERT INTO "Sku" (id,"productId",name,"priceFen",stock,reserved) VALUES ('legacy-sku','legacy-p1','标准',100,7,2);
      INSERT INTO "User" (id,"brandId",name,role) VALUES ('legacy-user','legacy-b','旧顾客','CUSTOMER');
      INSERT INTO "Session" (id,"tokenHash","userId","expiresAt") VALUES ('legacy-session','legacy-hash','legacy-user',now()+interval '1 day');
      INSERT INTO "Quote" (id,"userId","storeId",snapshot,"expiresAt") VALUES ('legacy-q','legacy-user','legacy-s','{"lines":[{"unit":" 份 "}]}',now()+interval '1 day');
      INSERT INTO "Order" (id,number,"userId","storeId","quoteId","idempotencyKey","requestHash",mode,"subtotalFen","deliveryFeeFen","packagingFeeFen","discountFen","totalFen","storeName",lines) VALUES ('legacy-order','legacy-number','legacy-user','legacy-s','legacy-q','key','hash','PICKUP',100,0,0,0,100,'旧店','[{"unit":" 份 "}]');`);
    const beforeProducts=(await client.query('SELECT * FROM "Product" ORDER BY id')).rows;
    const tables=['Order','Quote','Sku','Session']; const snapshots=new Map<string,string>();
    for(const table of tables) snapshots.set(table,JSON.stringify((await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows));
    await client.query(await readFile(resolve(__dirname,'../prisma/migrations/202610200006_catalog_settings/migration.sql'),'utf8'));
    const products=(await client.query('SELECT * FROM "Product" ORDER BY id')).rows;
    assert.deepEqual(products.map(({unitId,...p}:any)=>p),beforeProducts);
    assert.ok(products.every((p:any)=>p.unitId)); assert.equal(products.find((p:any)=>p.id==='legacy-p1').unitId,products.find((p:any)=>p.id==='legacy-p2').unitId);
    assert.notEqual(products.find((p:any)=>p.id==='legacy-p1').unitId,products.find((p:any)=>p.id==='other-p').unitId);
    assert.equal((await client.query('SELECT * FROM "Unit"')).rowCount,3);
    assert.equal((await client.query('SELECT * FROM "Category" WHERE NOT enabled OR revision<>0 OR NOT "allStores"')).rowCount,0);
    for(const table of tables) assert.equal(JSON.stringify((await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows),snapshots.get(table),table+' unchanged');
  } finally {
    try {
      await client.query('ROLLBACK');
      if(created) {
        const current=(await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];
        if(!identity || JSON.stringify(current)!==JSON.stringify(identity)) throw new Error('Catalog migration schema identity changed; preserved');
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally {await client.end();}
  }
});

test('catalog settings enforce real database permissions, revisions, visibility, units and existing orders', async () => {
  process.env.NODE_ENV = 'test'; process.env.DEV_AUTH_ENABLED = 'true'; process.env.DEV_SEED_ENABLED = 'true';
  const db = new PrismaClient();
  await seed(db);
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  const base = await app.getUrl() + '/api/v1', a = 'experience-store-a', b = 'experience-store-b';
  async function req(path: string, token?: string, body?: any, method?: string, key?: string) {
    const response = await fetch(base + path, {method: method || (body ? 'POST' : 'GET'), headers: {'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {}), ...(key ? {'Idempotency-Key':key} : {})}, body: body ? JSON.stringify(body) : undefined});
    return {status:response.status, body:await response.json() as any};
  }
  try {
    const login = async (account: string) => (await req('/auth/dev-login', undefined, {account})).body.data.token;
    const owner = await login('owner'), clerk = await login('clerk-a'), customer = await login('customer');
    const settings = () => req(`/merchant/catalog-settings?storeId=${a}`, owner);
    const initial = await settings(); assert.equal(initial.status, 200, 'settings endpoint exists');
    assert.equal(initial.body.data.canManageBrand, true); assert.equal(initial.body.data.stores.length, 2);
    const create = (kind: string, name: string, token = owner) => req(`/merchant/${kind}`, token, {storeId:a, name});
    const patch = (kind: string, id: string, body: any, token = owner) => req(`/merchant/${kind}/${id}`, token, {storeId:a, expectedRevision:0, ...body}, 'PATCH');
    const del = (kind: string, id: string, revision = 0) => req(`/merchant/${kind}/${id}`, owner, {storeId:a, expectedRevision:revision}, 'DELETE');
    const category = (await create('categories','新分类')).body.data;
    assert.equal(category.enabled, true); assert.equal(category.revision,0); assert.equal(category.visibleStoreIds,null);
    assert.equal((await create('categories','店员修改',clerk)).status,403);
    const limited = await db.user.create({data:{brandId:'experience-brand',name:'单店店主',role:'OWNER',staff:{create:{storeId:a}}}});
    const limitedToken = 'L'.repeat(43);
    await db.session.create({data:{userId:limited.id,tokenHash:createHash('sha256').update(limitedToken).digest('hex'),expiresAt:new Date(Date.now()+60000)}});
    assert.equal((await create('categories','部分授权',limitedToken)).status,403);
    const restricted = await req(`/merchant/catalog-settings?storeId=${a}`,limitedToken);
    assert.equal(restricted.body.data.canManageBrand,false); assert.deepEqual(restricted.body.data.stores.map((x:any)=>x.id),[a]);
    assert.ok(!JSON.stringify(restricted.body.data).includes(b),'settings redact unauthorized store ids');
    assert.equal((await req(`/merchant/catalog-settings?storeId=${b}`,limitedToken)).status,403);
    await db.brand.create({data:{id:'catalog-foreign',name:'隔离品牌'}});
    await db.store.create({data:{id:'catalog-foreign-store',brandId:'catalog-foreign',name:'秘密门店',address:'',phone:''}});
    const foreign = await db.category.create({data:{brandId:'catalog-foreign',name:'隔离分类'}});
    assert.equal((await patch('categories',foreign.id,{name:'越权'})).status,403);
    for (const body of [{},{sort:-1},{sort:1.5},{sort:100001},{enabled:'false'},{name:' '},{name:'x'.repeat(81)},{extra:1},{expectedRevision:-1,name:'bad'},{visibleStoreIds:1},{visibleStoreIds:[1]},{visibleStoreIds:Array(101).fill(a)},{visibleStoreIds:['catalog-foreign-store']}]) {
      assert.ok([400,403].includes((await patch('categories',category.id,body)).status));
    }
    const changed = await patch('categories',category.id,{name:'改名分类',sort:100,visibleStoreIds:[b]});
    assert.equal(changed.status,200); assert.equal(changed.body.data.revision,1); assert.deepEqual(changed.body.data.visibleStoreIds,[b]);
    assert.equal((await patch('categories',category.id,{name:'过期'})).status,409);
    const races = await Promise.all([patch('categories',category.id,{expectedRevision:1,sort:2}),patch('categories',category.id,{expectedRevision:1,sort:3})]);
    assert.deepEqual(races.map(x=>x.status).sort(),[200,409]);
    assert.equal((await del('categories',category.id,2)).status,200);
    const signature = 'experience-cat-signature', productId = 'experience-a-chicken', skuId = productId+'-sku-0';
    const quote = async () => req('/quotes',customer,{storeId:a,mode:'PICKUP',lines:[{skuId,quantity:1,modifierIds:[]}]});
    const order = async (key:string) => {const q=await quote(); assert.equal(q.status,201); return req('/orders',customer,{quoteId:q.body.data.id},undefined,key);};
    const cancelOrder = (await order('catalog-cancel')).body.data, cashOrder = (await order('catalog-cash')).body.data;
    const old = (await quote()).body.data;
    const disabled = await patch('categories',signature,{enabled:false}); assert.equal(disabled.status,200);
    const menu = (await req(`/stores/${a}/catalog`)).body.data;
    assert.ok(!menu.categories.some((c:any)=>c.id===signature)); assert.ok(!menu.products.some((p:any)=>p.categoryId===signature));
    assert.equal((await quote()).status,409);
    const stale = await req('/orders',customer,{quoteId:old.id},undefined,'catalog-stale'); assert.equal(stale.status,409); assert.match(stale.body.error.message,/刷新/); assert.ok(stale.body.requestId);
    assert.equal((await req(`/orders/${cancelOrder.id}/cancel`,customer,{})).status,201);
    assert.equal((await req(`/merchant/orders/${cashOrder.id}/cash-payment`,clerk,{tenderedFen:cashOrder.totalFen})).body.data.paymentStatus,'PAID');
    for(const action of ['ACCEPT','READY','COMPLETE']) assert.equal((await req(`/merchant/orders/${cashOrder.id}/transition`,clerk,{action})).status,201,'existing paid orders remain fulfillable under disabled categories');
    assert.equal((await db.sku.findUniqueOrThrow({where:{id:skuId}})).reserved,0);
    assert.equal((await del('categories',signature,1)).body.error.code,'REFERENCE_CONFLICT');
    await patch('categories',signature,{expectedRevision:1,enabled:true});
    const oldVisibleQuote=(await quote()).body.data;
    await patch('categories',signature,{expectedRevision:2,visibleStoreIds:[b]});
    assert.equal((await quote()).status,409);
    assert.equal((await req('/orders',customer,{quoteId:oldVisibleQuote.id},undefined,'catalog-hidden-stale')).status,409);
    assert.ok(!(await req(`/stores/${a}/catalog`)).body.data.products.some((p:any)=>p.id===productId));
    assert.ok((await req(`/stores/${b}/catalog`)).body.data.categories.some((c:any)=>c.id===signature));
    const restrictedExplicit = (await req(`/merchant/catalog-settings?storeId=${a}`,limitedToken)).body.data;
    assert.ok(!JSON.stringify(restrictedExplicit).includes(b));
    await patch('categories',signature,{expectedRevision:3,visibleStoreIds:[]});
    assert.ok(!(await req(`/stores/${b}/catalog`)).body.data.categories.some((c:any)=>c.id===signature));
    await patch('categories',signature,{expectedRevision:4,visibleStoreIds:null});
    const sorted = (await settings()).body.data.categories; assert.deepEqual(sorted.map((x:any)=>x.id),[...sorted].sort((x:any,y:any)=>x.sort-y.sort||x.id.localeCompare(y.id)).map((x:any)=>x.id));
    const u = (await create('units','  碗  ')).body.data; assert.equal(u.name,'碗');
    assert.equal((await create('units','碗')).status,409); assert.equal((await create('units','店员单位',clerk)).status,403); assert.equal((await create('units','受限单位',limitedToken)).status,403);
    for (const name of ['', 'x'.repeat(21)]) assert.equal((await create('units',name)).status,400);
    const duplicateUnits=await Promise.all([create('units','并发同名'),create('units','并发同名')]); assert.deepEqual(duplicateUnits.map(x=>x.status).sort(),[201,409]);
    assert.equal(await db.unit.count({where:{brandId:'experience-brand',name:'并发同名'}}),1);
    const foreignUnit=await db.unit.create({data:{brandId:'catalog-foreign',name:'外国单位'}});
    assert.equal((await patch('units',foreignUnit.id,{enabled:false})).status,403);
    assert.equal((await patch('units',u.id,{name:'禁止'},clerk)).status,403); assert.equal((await patch('units',u.id,{name:'禁止'},limitedToken)).status,403);
    assert.equal((await req(`/merchant/units/${u.id}`,clerk,{storeId:a,expectedRevision:0},'DELETE')).status,403);
    const productBody = {storeId:a,categoryId:signature,name:'单位商品',description:'',unitId:u.id,skus:[{name:'标准',priceFen:100,stock:5}]};
    const made = await req('/merchant/products',owner,productBody); assert.equal(made.status,201); const product=made.body.data;
    assert.equal((await req('/merchant/products',owner,{...productBody,unitId:foreignUnit.id})).status,403);
    assert.equal((await req('/merchant/products',owner,{...productBody,categoryId:foreign.id})).status,403);
    assert.equal((await del('units',u.id)).body.error.code,'REFERENCE_CONFLICT');
    const unitQuote=await req('/quotes',customer,{storeId:a,mode:'PICKUP',lines:[{skuId:product.skus[0].id,quantity:1,modifierIds:[]}]});
    const unitOrder=await req('/orders',customer,{quoteId:unitQuote.body.data.id},undefined,'catalog-unit-snapshot'); assert.equal(unitOrder.status,201);
    const snapshotBefore=(await db.order.findUniqueOrThrow({where:{id:unitOrder.body.data.id}})).lines;
    assert.equal((await patch('units',u.id,{name:'大碗'})).status,200);
    assert.equal((await req(`/stores/${a}/catalog`)).body.data.products.find((p:any)=>p.id===product.id).unit,'大碗');
    assert.deepEqual((await db.order.findUniqueOrThrow({where:{id:unitOrder.body.data.id}})).lines,snapshotBefore);
    assert.equal((await req(`/orders/${unitOrder.body.data.id}/cancel`,customer,{})).status,201);
    assert.equal((await patch('units',u.id,{expectedRevision:1,enabled:false})).status,200);
    assert.equal((await req('/merchant/products',owner,productBody)).status,409);
    assert.equal((await req(`/merchant/products/${product.id}`,owner,{storeId:a,unitId:u.id},'PATCH')).status,409);
    assert.equal((await req(`/merchant/products/${product.id}`,owner,{storeId:a,name:'仍可改名'},'PATCH')).status,200);
    assert.equal((await req(`/merchant/skus/${product.skus[0].id}`,owner,{storeId:a,priceFen:120,stock:3},'PATCH')).status,200);
    assert.equal((await req('/quotes',customer,{storeId:a,mode:'PICKUP',lines:[{skuId:product.skus[0].id,quantity:1,modifierIds:[]}]})).status,201);
    assert.equal((await req('/merchant/products',owner,{...productBody,unitId:undefined,unit:'不存在'})).status,400);
    const byText = await req('/merchant/products',owner,{...productBody,unitId:undefined,unit:'份'}); assert.equal(byText.status,201); assert.ok(byText.body.data.unitId);
    const unused = (await create('units','盒')).body.data;
    assert.equal((await patch('units',unused.id,{name:'大碗'})).status,409);
    const unitRace=await Promise.all([patch('units',unused.id,{name:'小盒'}),patch('units',unused.id,{name:'中盒'})]); assert.deepEqual(unitRace.map(x=>x.status).sort(),[200,409]);
    assert.equal((await del('units',unused.id,0)).status,409); assert.equal((await del('units',unused.id,1)).status,200);
    for(let i=0;i<5;i++) {
      const racing=(await create('units','引用竞争'+i)).body.data;
      const results=await Promise.all([req('/merchant/products',owner,{...productBody,unitId:racing.id}),del('units',racing.id)]);
      assert.ok(results.every(r=>r.status<500),'reference/create race returns controlled business errors');
      if(results[0].status===201) {assert.equal(results[1].status,409);assert.ok(await db.unit.findUnique({where:{id:racing.id}}));}
    }
    const raw = await db.product.create({data:{storeId:a,categoryId:signature,name:'旧记录',unit:'盘'}});
    assert.equal((await req(`/stores/${a}/catalog`)).body.data.products.find((p:any)=>p.id===raw.id).unit,'盘');
    await seed(db); assert.equal((await db.product.findUniqueOrThrow({where:{id:product.id}})).name,'仍可改名');
    assert.equal((await db.unit.findUniqueOrThrow({where:{id:u.id}})).enabled,false);
    const defaultUnit=await db.unit.findUniqueOrThrow({where:{brandId_name:{brandId:'experience-brand',name:'份'}}});
    const seededUnit=await db.unit.update({where:{id:defaultUnit.id},data:{id:'legacy-seeded-unit'}});
    assert.equal((await patch('units',seededUnit.id,{name:'餐份',enabled:false})).status,200);
    await seed(db);
    assert.equal(await db.unit.count({where:{brandId:'experience-brand',name:'份'}}),0,'re-seed must not recreate renamed default units');
    assert.equal((await db.unit.findUniqueOrThrow({where:{id:seededUnit.id}})).enabled,false);
    const future = await db.store.create({data:{brandId:'experience-brand',name:'未来门店',address:'',phone:''}});
    assert.ok((await req(`/stores/${future.id}/catalog`)).body.data.categories.some((c:any)=>c.id===signature),'allStores applies to future stores');
    assert.equal((await create('units','新增门店后缺授权')).status,403);
    await db.staffStore.create({data:{userId:'experience-user-owner',storeId:future.id}});
    const preflight=await fetch(base+'/merchant/units/'+u.id,{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:5175','Access-Control-Request-Method':'DELETE','Access-Control-Request-Headers':'Authorization,Content-Type,X-Request-Id'}});
    assert.equal(preflight.status,204); assert.match(preflight.headers.get('access-control-allow-methods')||'',/DELETE/);
    assert.ok(await db.audit.count({where:{action:'CATEGORY_UPDATE'}})>0); assert.ok(await db.audit.count({where:{action:'UNIT_UPDATE'}})>0);
    const auditCount=await db.audit.count({where:{entityId:u.id}});
    assert.equal((await patch('units',u.id,{expectedRevision:0,name:'旧版本'})).status,409);
    assert.equal(await db.audit.count({where:{entityId:u.id}}),auditCount,'rejected edits do not create audit records');
    await db.staffStore.delete({where:{userId_storeId:{userId:'experience-user-owner',storeId:future.id}}});
    assert.equal((await create('units','旧会话撤权')).status,403);
    const newOwner=await login('owner'); assert.equal((await create('units','新会话撤权',newOwner)).status,403);
    await db.staffStore.create({data:{userId:'experience-user-owner',storeId:future.id}});
    await db.user.update({where:{id:'experience-user-owner'},data:{enabled:false}});
    assert.equal((await create('units','停用会话')).status,401); assert.equal((await req('/auth/dev-login',undefined,{account:'owner'})).status,401);
  } finally {await app.close(); await db.$disconnect();}
});
