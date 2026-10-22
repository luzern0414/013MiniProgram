import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {createApp} from '../src/main';
import {spawnSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import pg from 'pg';
import {validateConfiguration,attributeSelection,optionsInteger} from '../src/modules/catalog/product-options.validation';
import {OrdersService} from '../src/modules/orders/orders.service';
import {seed} from '../prisma/seed';
let safe=false;
try {safe=/^test_product_options_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL||'').searchParams.get('schema')||'');} catch {}
if(!safe) throw new Error('Product-options tests require an isolated test_product_options_* schema');

const emptyStored=()=>({specGroups:[],skus:[{id:'sku'}],attributeGroups:[],modifiers:[{id:'mod'}]});
const emptyTree=()=>({specGroups:[],skus:[{id:'sku',name:'标准',enabled:true,priceFen:100,selections:[]}],attributeGroups:[],modifiers:[{id:'mod',name:'蛋',enabled:true,priceFen:20}]});
test('configuration validation rejects unknown fields, coercions and overwriting old inventory',()=>{
 const check=(mutate:(b:any)=>void)=>{const b:any=emptyTree();mutate(b);assert.throws(()=>validateConfiguration(b,emptyStored()),{code:'VALIDATION_ERROR'});};
 for(const value of [-1,1.5,'1',NaN,2_000_000_001])assert.throws(()=>optionsInteger(value));
 check(b=>b.skus[0].stock=10);check(b=>b.modifiers[0].initialStock=10);check(b=>b.skus[0].initialStock=10);
 check(b=>b.skus[0].priceFen='100');check(b=>b.skus[0].enabled=1);check(b=>b.skus[0].name=' '.repeat(2));check(b=>b.skus[0].name='长'.repeat(81));
 const b=emptyTree();b.skus[0].name=' 标准 ';assert.equal(validateConfiguration(b,emptyStored()).skus[0].name,'标准');
});
test('configuration validation retains every old parent and child and rejects foreign or duplicate identities',()=>{
 const stored:any={specGroups:[{id:'g',values:[{id:'v'}]}],skus:[{id:'sku'}],attributeGroups:[{id:'a',options:[{id:'o'}]}],modifiers:[{id:'mod'}]};
 const tree:any={...emptyTree(),specGroups:[{id:'g',name:'尺寸',enabled:true,sort:0,values:[{id:'v',name:'小',sort:0,enabled:true}]}],attributeGroups:[{id:'a',name:'味道',sort:0,enabled:true,minSelections:0,maxSelections:1,options:[{id:'o',name:'辣',sort:0,enabled:true}]}]};tree.skus[0].selections=[{groupRef:'g',valueRef:'v'}];
 assert.doesNotThrow(()=>validateConfiguration(tree,stored));
 for(const mutate of [(b:any)=>b.specGroups.pop(),(b:any)=>b.specGroups[0].values.pop(),(b:any)=>b.attributeGroups.pop(),(b:any)=>b.attributeGroups[0].options.pop(),(b:any)=>b.skus.pop(),(b:any)=>b.modifiers.pop(),(b:any)=>b.skus.push({...b.skus[0]}),(b:any)=>b.attributeGroups[0].options[0].id='foreign',(b:any)=>b.specGroups[0].values[0].id='foreign']){const b=structuredClone(tree);mutate(b);assert.throws(()=>validateConfiguration(b,stored),{code:'VALIDATION_ERROR'});}
});
test('configuration refs require declared group and own enabled value, unique client keys and one selection per group',()=>{
 const tree:any={...emptyTree(),specGroups:[{clientKey:'g',name:'尺寸',sort:0,enabled:true,values:[{clientKey:'v',name:'小',sort:0,enabled:true}]},{clientKey:'g2',name:'温度',sort:1,enabled:true,values:[{clientKey:'v2',name:'热',sort:0,enabled:true}]}]};tree.skus[0].selections=[{groupRef:'g',valueRef:'v'},{groupRef:'g2',valueRef:'v2'}];
 assert.doesNotThrow(()=>validateConfiguration(tree,emptyStored()));
 for(const mutate of [(b:any)=>b.specGroups[1].clientKey='g',(b:any)=>b.specGroups[0].clientKey='illegal key',(b:any)=>b.skus[0].selections[0].valueRef='v2',(b:any)=>b.skus[0].selections.pop(),(b:any)=>b.skus[0].selections.push(b.skus[0].selections[0]),(b:any)=>b.specGroups[0].values[0].enabled=false]){const b=structuredClone(tree);mutate(b);assert.throws(()=>validateConfiguration(b,emptyStored()),{code:'VALIDATION_ERROR'});}
});
test('configuration bounds preserve read-only oversized legacy trees and reject enabled duplicate combinations',()=>{
 for(const [field,count] of [['specGroups',4],['attributeGroups',6],['modifiers',21]] as const){const b:any=emptyTree();b[field]=Array.from({length:count},()=>({name:'项目',enabled:false,sort:0,values:[],options:[],minSelections:0,maxSelections:0,priceFen:0}));assert.throws(()=>validateConfiguration(b,emptyStored()));}
 const b:any=emptyTree();b.skus.push({name:'标准',enabled:true,priceFen:100,selections:[]});assert.throws(()=>validateConfiguration(b,emptyStored()));b.skus[1].enabled=false;assert.doesNotThrow(()=>validateConfiguration(b,emptyStored()));
 const group:any={clientKey:'g',name:'尺寸',sort:0,enabled:true,values:[{clientKey:'v',name:'小',sort:0,enabled:true},{clientKey:'w',name:'大',sort:1,enabled:true}]};b.specGroups=[group];b.skus[1].enabled=true;b.skus[1].name='另一名称';b.skus[0].selections=[{groupRef:'g',valueRef:'v'}];b.skus[1].selections=[{groupRef:'g',valueRef:'w'}];assert.doesNotThrow(()=>validateConfiguration(b,emptyStored()));
 group.enabled=false;b.skus[1].name='标准';assert.throws(()=>validateConfiguration(b,emptyStored()));
 const many:any=emptyTree();many.skus.push(...Array.from({length:20},(_,i)=>({name:'SKU'+i,enabled:true,priceFen:0,selections:[]})));assert.throws(()=>validateConfiguration(many,emptyStored()));
 const valueTree:any=emptyTree();valueTree.specGroups=[{name:'值',enabled:false,sort:0,values:Array.from({length:21},()=>({name:'值',sort:0,enabled:false}))}];assert.throws(()=>validateConfiguration(valueTree,emptyStored()));
 const optionTree:any=emptyTree();optionTree.attributeGroups=[{name:'组',enabled:false,sort:0,minSelections:0,maxSelections:0,options:Array.from({length:11},()=>({name:'选项',sort:0,enabled:false}))}];assert.throws(()=>validateConfiguration(optionTree,emptyStored()));

});
test('attribute rules validate bounds, active option counts, duplicates and omit optional selections as empty',()=>{
 const p={attributeGroups:[{id:'g',name:'辣度',enabled:true,minSelections:1,maxSelections:1,options:[{id:'one',name:'少辣',enabled:true},{id:'two',name:'辣',enabled:true},{id:'off',name:'关',enabled:false}]}]};
 for(const ids of [undefined,[],['one','one'],['one','two'],['alien'],['off']])assert.throws(()=>attributeSelection(p,ids));
 assert.deepEqual(attributeSelection(p,['one']),{attributeOptionIds:['one'],attributes:[{groupId:'g',groupName:'辣度',options:[{id:'one',name:'少辣'}]}]});
 p.attributeGroups[0].minSelections=0;assert.deepEqual(attributeSelection(p,undefined).attributeOptionIds,[]);
 const b:any=emptyTree();b.attributeGroups=[{name:'辣',sort:0,enabled:true,minSelections:2,maxSelections:1,options:[]}];assert.throws(()=>validateConfiguration(b,emptyStored()));b.attributeGroups[0].maxSelections=2;assert.throws(()=>validateConfiguration(b,emptyStored()));
});
test('module rejects unsafe schemas before connection',()=>{
 for(const schema of ['development','public',undefined]) {
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  if(schema)env.DATABASE_URL='postgresql://unused:unused@127.0.0.1:1/unused?schema='+schema;else delete env.DATABASE_URL;
  const r=spawnSync(process.execPath,['--import','tsx','--test','tests/product-options.test.ts'],{cwd:resolve(__dirname,'..'),env:{...env,TSX_TSCONFIG_PATH:resolve(__dirname,'../tsconfig.json')},encoding:'utf8',windowsHide:true});
  assert.equal(r.status,1);assert.match(r.stdout+r.stderr,/Product-options tests require an isolated/);assert.doesNotMatch(r.stdout+r.stderr,/ECONNREFUSED|PrismaClientInitializationError/);
 }
});

test('runner preserves existing schema and sentinel on collision',async()=>{
 const hex=randomBytes(6).toString('hex'),schema='test_product_options_'+hex;
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
 const dir=await mkdtemp(join(tmpdir(),'product-options-'));let created=false,identity:any;
 try {
  await client.query(`CREATE SCHEMA "${schema}"`);created=true;
  identity=(await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];
  await client.query(`CREATE TABLE "${schema}".sentinel (value integer); INSERT INTO "${schema}".sentinel VALUES (42)`);
  const preload=join(dir,'fixed.cjs');await writeFile(preload,`require('node:crypto').randomBytes=()=>Buffer.from('${hex}','hex');`);
  const r=spawnSync(process.execPath,['--require',preload,'.superpowers/sdd/product-options-runner.cjs'],{cwd:resolve(__dirname,'../../..'),env:{...process.env},encoding:'utf8',windowsHide:true});
  assert.equal(r.status,1);assert.equal((await client.query(`SELECT value FROM "${schema}".sentinel`)).rows[0].value,42);
 }finally {
  try{if(created){const current=(await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];assert.deepEqual(current,identity);await client.query(`DROP SCHEMA "${schema}" CASCADE`);}}finally{await client.end();await rm(dir,{recursive:true,force:true});}
 }
});

test('migration fixture preserves existing schema and sentinel on collision',async()=>{
 const hex=randomBytes(6).toString('hex'),schema='test_product_options_migration_'+hex;
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
 const dir=await mkdtemp(join(tmpdir(),'product-options-migration-'));let created=false,identity:any;
 try {
  await client.query(`CREATE SCHEMA "${schema}"`);created=true;
  identity=(await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];
  await client.query(`CREATE TABLE "${schema}".sentinel (value integer); INSERT INTO "${schema}".sentinel VALUES (42)`);
  const preload=join(dir,'fixed.cjs');await writeFile(preload,`require('node:crypto').randomBytes=()=>Buffer.from('${hex}','hex');`);
  const env={...process.env,TSX_TSCONFIG_PATH:resolve(__dirname,'../tsconfig.json')};delete env.NODE_TEST_CONTEXT;
  const r=spawnSync(process.execPath,['--require',preload,'--import','tsx','--test','--test-name-pattern','^incremental migration','tests/product-options.test.ts'],{cwd:resolve(__dirname,'..'),env,encoding:'utf8',windowsHide:true});
  assert.equal(r.status,1);assert.equal((await client.query(`SELECT value FROM "${schema}".sentinel`)).rows[0].value,42);
 }finally {
  try{if(created){const current=(await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];assert.deepEqual(current,identity);await client.query(`DROP SCHEMA "${schema}" CASCADE`);}}finally{await client.end();await rm(dir,{recursive:true,force:true});}
 }
});
test('incremental migration preserves legacy identities, inventory, orders, quotes and sessions',async()=>{
 const schema='test_product_options_migration_'+randomBytes(6).toString('hex');
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();let created=false,identity:any;
 try {
  await client.query(`CREATE SCHEMA "${schema}"`);created=true;identity=(await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];
  await client.query(`SET search_path TO "${schema}"`);
  const root=resolve(__dirname,'../prisma/migrations');
  for(const m of (await readdir(root)).filter(x=>/^20261020000[1-6]_/.test(x)).sort())await client.query(await readFile(join(root,m,'migration.sql'),'utf8'));
  await client.query(`INSERT INTO "Brand" (id,name) VALUES ('b','old');
   INSERT INTO "Store" (id,"brandId",name,address,phone) VALUES ('s','b','old','','');
   INSERT INTO "Category" (id,"brandId",name) VALUES ('c','b','old');
   INSERT INTO "User" (id,"brandId",name,role) VALUES ('u','b','old','CUSTOMER');
   INSERT INTO "Session" (id,"tokenHash","userId","expiresAt") VALUES ('session','hash','u',now()+interval '1 day');
   INSERT INTO "Product" (id,"storeId","categoryId",name) VALUES ('p','s','c','old');
   INSERT INTO "Sku" (id,"productId",name,"priceFen",stock,reserved) SELECT 'sku'||n,'p','same',100,12,3 FROM generate_series(1,22)n;
   INSERT INTO "Modifier" (id,"productId",name,"priceFen",stock,reserved) SELECT 'm'||n,'p','old',10,7,2 FROM generate_series(1,21)n;
   INSERT INTO "Quote" (id,"userId","storeId",snapshot,"expiresAt") VALUES ('q','u','s','{"lines":[{"skuId":"sku1","modifiers":[]}]}',now()+interval '1 day');
   INSERT INTO "Order" (id,number,"userId","storeId","quoteId","idempotencyKey","requestHash",mode,"subtotalFen","deliveryFeeFen","packagingFeeFen","discountFen","totalFen","storeName",lines) VALUES ('o','n','u','s','q','key','hash','PICKUP',100,0,0,0,100,'old','[{"skuId":"sku1","modifiers":[]}]');`);
  const snapshots=new Map<string,any>();for(const table of ['Product','Sku','Modifier','Order','Quote','Session'])snapshots.set(table,(await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows);
  await client.query(await readFile(join(root,'202610200007_product_options/migration.sql'),'utf8'));
  for(const table of ['Product','Sku','Modifier','Order','Quote','Session']) {
   const rows=(await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows;
   assert.deepEqual(rows.map(({configurationRevision,enabled,combinationKey,...row}:any)=>table==='Product'||table==='Sku'||table==='Modifier'?row:{...row,...(enabled===undefined?{}:{enabled})}),snapshots.get(table));
   if(table==='Product')assert.ok(rows.every((r:any)=>r.configurationRevision===0));
   if(table==='Sku'||table==='Modifier')assert.ok(rows.every((r:any)=>r.enabled===true));
   if(table==='Sku')assert.ok(rows.every((r:any)=>r.combinationKey===null));
  }
 }finally {
  try{await client.query('ROLLBACK');if(created){const current=(await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];assert.deepEqual(current,identity);await client.query(`DROP SCHEMA "${schema}" CASCADE`);}}finally{await client.end();}
 }
});

test('product options HTTP validates complete trees, revisions, permissions and inventory-backed ordering',async()=>{
 const db=new PrismaClient();await seed(db);const app=await createApp();await app.listen(0,'127.0.0.1');
 const base=await app.getUrl()+'/api/v1',storeId='experience-store-a';
 const req=async(path:string,token?:string,body?:any,method?:string,key?:string)=>{const r=await fetch(base+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json() as any};};
 try {
  const login=async(account:string)=>(await req('/auth/dev-login',undefined,{account})).body.data.token;
  const owner=await login('owner'),customer=await login('customer'),clerk=await login('clerk-a');
  assert.equal((await req('/merchant/cash-shifts',owner,{storeId:'experience-store-a',openingFen:0},'POST','options-fixture-shift')).status,201);
  const product=await db.product.findFirstOrThrow({where:{storeId},include:{skus:true,modifiers:true}}),skuId=product.skus[0].id;
  const path='/merchant/products/'+product.id+'/options';
  const get=async(token=owner)=>req(path+'?storeId='+storeId,token);
  const put=async(tree:any,token=owner)=>req(path,token,{storeId,...tree},'PUT');
  let read=await get();assert.equal(read.status,200,'missing product-options endpoint is the expected RED');
  assert.equal((await get(clerk)).status,403);assert.equal((await get(customer)).status,403);
  assert.equal(read.body.data.configurationRevision,0);
  const toTree=(view:any)=>({expectedRevision:view.configurationRevision,specGroups:view.specGroups,skus:view.skus.map(({id,name,enabled,priceFen,selections}:any)=>({id,name,enabled,priceFen,selections})),attributeGroups:view.attributeGroups,modifiers:view.modifiers.map(({id,name,enabled,priceFen}:any)=>({id,name,enabled,priceFen}))});
  let tree=toTree(read.body.data);
  const quote=async(options:any={},id=skuId,mods:string[]=[])=>req('/quotes',customer,{storeId,mode:'PICKUP',lines:[{skuId:id,quantity:1,modifierIds:mods,...options}]});
  const create=async(q:any,key:string)=>req('/orders',customer,{quoteId:q.body.data.id},undefined,key);
  const oldQuote=await quote({},skuId,product.modifiers.length?[product.modifiers[0].id]:[]);assert.equal(oldQuote.status,201);
  const legacySnapshot=(await db.quote.findUniqueOrThrow({where:{id:oldQuote.body.data.id}})).snapshot as any;
  for(const line of legacySnapshot.lines)delete line.configurationRevision;
  await db.quote.update({where:{id:oldQuote.body.data.id},data:{snapshot:legacySnapshot}});
  const held=await create(oldQuote,'legacy-before-options');assert.equal(held.status,201);
  const originalInventory=await db.sku.findUniqueOrThrow({where:{id:skuId}}),originalReserved=originalInventory.reserved;
  const originalModifier=product.modifiers.length?await db.modifier.findUniqueOrThrow({where:{id:product.modifiers[0].id}}):null;
  tree.specGroups=[{clientKey:'size',name:' 尺寸 ',sort:0,enabled:true,values:[{clientKey:'small',name:'小',sort:0,enabled:true},{clientKey:'large',name:'大',sort:1,enabled:true}]}];
  tree.skus=tree.skus.map((s:any,i:number)=>({...s,enabled:i===0,selections:i===0?[{groupRef:'size',valueRef:'small'}]:[]}));
  tree.skus.push({name:'大份',enabled:true,priceFen:1500,initialStock:8,selections:[{groupRef:'size',valueRef:'large'}]});
  tree.attributeGroups=[{name:'辣度',sort:0,enabled:true,minSelections:1,maxSelections:1,options:[{name:'微辣',sort:0,enabled:true},{name:'中辣',sort:1,enabled:true}]}];
  tree.modifiers.push({name:'蛋',enabled:true,priceFen:200,initialStock:2});
  const missing=structuredClone(tree);missing.skus=missing.skus.filter((s:any)=>s.id!==skuId);assert.equal((await put(missing)).status,400);
  const dup=structuredClone(tree);dup.skus[dup.skus.length-1].selections=dup.skus[0].selections;assert.equal((await put(dup)).status,400);
  const bad=structuredClone(tree);bad.skus[0].initialStock=20;assert.equal((await put(bad)).status,400);
  const foreign=await db.sku.findFirstOrThrow({where:{product:{storeId:'experience-store-b'}}});const foreignTree=structuredClone(tree);foreignTree.skus[0].id=foreign.id;assert.equal((await put(foreignTree)).status,400);
  const races=await Promise.all([put(tree),put(tree)]);assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
  read=await get();assert.equal(read.body.data.configurationRevision,1);assert.equal(read.body.data.specGroups[0].name,'尺寸');assert.ok(!JSON.stringify(read.body.data).includes('clientKey'));
  assert.equal((await db.sku.findUniqueOrThrow({where:{id:skuId}})).reserved,originalReserved);
  assert.equal((await db.sku.findUniqueOrThrow({where:{id:skuId}})).stock,originalInventory.stock);
  if(originalModifier){const actual=await db.modifier.findUniqueOrThrow({where:{id:originalModifier.id}});assert.equal(actual.stock,originalModifier.stock);assert.equal(actual.reserved,originalModifier.reserved);}
  const current=read.body.data,optionId=current.attributeGroups[0].options[0].id,otherOption=current.attributeGroups[0].options[1].id,modifierId=current.modifiers.find((m:any)=>m.name==='蛋').id;
  assert.equal((await quote()).status,400);assert.equal((await quote({attributeOptionIds:[optionId,optionId]})).status,400);assert.equal((await quote({attributeOptionIds:[optionId,otherOption]})).status,400);
  const otherProduct=await db.product.findFirstOrThrow({where:{storeId,id:{not:product.id}}});const alien=await db.productAttributeGroup.create({data:{productId:otherProduct.id,name:'alien',minSelections:0,maxSelections:1,options:{create:{name:'alien'}}},include:{options:true}});
  assert.equal((await quote({attributeOptionIds:[alien.options[0].id]})).status,400);
  const q=await quote({attributeOptionIds:[optionId]},skuId,[modifierId]);assert.equal(q.status,201);assert.equal(q.body.data.lines[0].configurationRevision,1);assert.equal(q.body.data.lines[0].attributes[0].options[0].name,'微辣');
  const stale=await quote({attributeOptionIds:[optionId]});tree=toTree(current);tree.attributeGroups[0].options[0].name='少辣';assert.equal((await put(tree)).status,200);
  assert.equal((await create(stale,'stale')).body.error.code,'PRODUCT_OPTIONS_CHANGED');
  assert.equal((await req('/orders/'+held.body.data.id+'/cancel',customer,{})).status,201);assert.equal((await db.sku.findUniqueOrThrow({where:{id:skuId}})).reserved,originalReserved-1);
  const opts={attributeOptionIds:[optionId]};
  const stockQuote=await quote(opts);let rev=(await get()).body.data.configurationRevision;
  assert.equal((await req('/merchant/skus/'+skuId,owner,{storeId,stock:12},'PATCH')).status,200);assert.equal((await get()).body.data.configurationRevision,rev);
  const stockOrder=await create(stockQuote,'stock-only');assert.equal(stockOrder.status,201);
  const priceQuote=await quote(opts);assert.equal((await req('/merchant/skus/'+skuId,owner,{storeId,priceFen:product.skus[0].priceFen+1},'PATCH')).status,200);assert.equal((await get()).body.data.configurationRevision,rev+1);assert.equal((await create(priceQuote,'price-change')).body.error.code,'PRODUCT_OPTIONS_CHANGED');
  const inventoryPath='/merchant/modifiers/'+modifierId+'/inventory';
  const beforeModifierInventoryQuote=await quote(opts,skuId,[modifierId]);
  const invRaces=await Promise.all([req(inventoryPath,owner,{storeId,expectedAvailable:2,available:1},'PATCH'),req(inventoryPath,owner,{storeId,expectedAvailable:2,available:1},'PATCH')]);assert.deepEqual(invRaces.map(r=>r.status).sort(),[200,409]);
  const modifierQuote1=beforeModifierInventoryQuote,modifierQuote2=await quote(opts,skuId,[modifierId]);
  const orderRaces=await Promise.all([create(modifierQuote1,'mod-one'),create(modifierQuote2,'mod-two')]);assert.deepEqual(orderRaces.map(r=>r.status).sort(),[201,409]);assert.equal((await db.modifier.findUniqueOrThrow({where:{id:modifierId}})).reserved,1);
  assert.equal((await req(inventoryPath,owner,{storeId,expectedAvailable:0,available:2_000_000_000},'PATCH')).status,400);
  const winner=orderRaces.find(r=>r.status===201)!.body.data;
  assert.equal((await req('/merchant/orders/'+winner.id+'/cash-payment',clerk,{tenderedFen:winner.totalFen})).status,201);
  const savedHistoricalLines=(await db.order.findUniqueOrThrow({where:{id:winner.id}})).lines;
  assert.equal((await req(inventoryPath,owner,{storeId,expectedAvailable:0,available:2},'PATCH')).status,200);
  const pendingModifierOrder=await create(await quote(opts,skuId,[modifierId]),'cancel-disabled-modifier');assert.equal(pendingModifierOrder.status,201);
  const disabledSkuQuote=await quote(opts),disabledModQuote=await quote(opts,skuId,[modifierId]);
  assert.equal(disabledModQuote.status,201);
  tree=toTree((await get()).body.data);tree.skus.find((s:any)=>s.id===skuId).enabled=false;tree.modifiers.find((m:any)=>m.id===modifierId).enabled=false;assert.equal((await put(tree)).status,200);
  assert.equal((await quote(opts)).status,400);
  const alternateSku=tree.skus.find((s:any)=>s.enabled).id;
  assert.equal((await quote(opts,alternateSku,[modifierId])).status,400);
  assert.equal((await create(disabledSkuQuote,'disabled-sku')).body.error.code,'PRODUCT_OPTIONS_CHANGED');assert.equal((await create(disabledModQuote,'disabled-mod')).body.error.code,'PRODUCT_OPTIONS_CHANGED');
  const menu=(await req('/stores/'+storeId+'/catalog')).body.data.products.find((p:any)=>p.id===product.id);assert.ok(!menu.skus.some((s:any)=>s.id===skuId));assert.ok(!menu.modifiers.some((m:any)=>m.id===modifierId));
  assert.equal((await req('/orders/'+pendingModifierOrder.body.data.id+'/cancel',customer,{})).status,201);
  assert.equal((await db.modifier.findUniqueOrThrow({where:{id:modifierId}})).reserved,0);
  assert.equal((await db.modifier.findUniqueOrThrow({where:{id:modifierId}})).stock,2);
  for(const action of ['ACCEPT','READY','COMPLETE'])assert.equal((await req('/merchant/orders/'+winner.id+'/transition',clerk,{action})).status,201);
  assert.deepEqual((await db.order.findUniqueOrThrow({where:{id:winner.id}})).lines,savedHistoricalLines);
  assert.equal((await req('/orders/'+stockOrder.body.data.id+'/cancel',customer,{})).status,201);
  tree=toTree((await get()).body.data);tree.skus.find((s:any)=>s.id===skuId).enabled=true;tree.modifiers.find((m:any)=>m.id===modifierId).enabled=true;assert.equal((await put(tree)).status,200);
  const expiryQuote=await quote(opts,skuId,[modifierId]),expiryOrder=await create(expiryQuote,'expiry-options');assert.equal(expiryOrder.status,201);
  const beforeExpiry=await db.modifier.findUniqueOrThrow({where:{id:modifierId}});
  await db.order.update({where:{id:expiryOrder.body.data.id},data:{paymentExpiresAt:new Date(0)}});
  assert.equal(await app.get(OrdersService).expireUnpaid(),1);
  const afterExpiry=await db.modifier.findUniqueOrThrow({where:{id:modifierId}});assert.equal(afterExpiry.stock,beforeExpiry.stock+1);assert.equal(afterExpiry.reserved,beforeExpiry.reserved-1);

  assert.equal((await req(path,owner,{storeId},'DELETE')).status,404);
  assert.equal((await req(path+'?storeId=experience-store-b',owner)).status,403);
  assert.equal((await put(toTree((await get()).body.data),clerk)).status,403);
  assert.equal((await req(inventoryPath,clerk,{storeId,expectedAvailable:2,available:3},'PATCH')).status,403);
  assert.equal((await req(inventoryPath,owner,{storeId,expectedAvailable:2,available:3,stock:3},'PATCH')).status,400);
  const audits=await db.audit.findMany({where:{entityId:product.id,action:'PRODUCT_OPTIONS_UPDATE'}});assert.ok(audits.length>=4);assert.ok(audits.every(a=>(a.before as any).productId===product.id&&(a.after as any).productId===product.id));

  const actor=await db.user.create({data:{brandId:'experience-brand',name:'Temporary owner',role:'OWNER',staff:{create:{storeId}}}}),token='T'.repeat(43);
  await db.session.create({data:{userId:actor.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+60000)}});
  assert.equal((await get(token)).status,200);await db.user.update({where:{id:actor.id},data:{enabled:false}});assert.equal((await get(token)).status,401);await db.user.update({where:{id:actor.id},data:{enabled:true}});await db.staffStore.delete({where:{userId_storeId:{userId:actor.id,storeId}}});assert.equal((await put(toTree((await get()).body.data),token)).status,403);
 } finally {await app.close();await db.$disconnect();}
});
