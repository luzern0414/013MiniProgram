const {spawnSync}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const pg=require('pg');
(async()=>{
 if(process.env.NODE_ENV==='production') throw new Error('Local pickup-capacity tests cannot run in production');
 const {assertProjectDatabase}=await import('../../../scripts/db.mjs');
 const schema='test_pickup_'+randomBytes(6).toString('hex');
 const url=new URL('postgresql://restaurant_dev:restaurant_dev_local_only@127.0.0.1:55432/restaurant_dev'); url.searchParams.set('schema',schema);
 const db=new pg.Client({connectionString:url.href});
 let created=false, identity;
 const env={...process.env,TSX_TSCONFIG_PATH:'apps/api/tsconfig.json',DATABASE_URL:url.href,NODE_ENV:'test',DEV_AUTH_ENABLED:'true',DEV_SEED_ENABLED:'true',PUBLIC_BRAND_ID:'experience-brand'};
 delete env.NODE_TEST_CONTEXT;
 const run=(args)=>{const r=spawnSync(process.execPath,args,{env,stdio:'inherit',windowsHide:true}); if(r.status!==0) throw new Error('Exit '+r.status);};
 try {
   await db.connect();await assertProjectDatabase(db);
   await db.query(`CREATE SCHEMA "${schema}"`);created=true;
   identity=(await db.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];
   run(['apps/api/node_modules/prisma/build/index.js','migrate','deploy','--schema','apps/api/prisma/schema.prisma']);
   run(['--import','tsx','--test','apps/api/tests/pickup-capacity.test.ts']);
 }
 catch(e){console.error(e.message);process.exitCode=1;}
 finally {
   try {
     if(created) {
       await assertProjectDatabase(db);
       const current=(await db.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];
       if(!identity || JSON.stringify(current)!==JSON.stringify(identity)) throw new Error('Pickup schema identity changed; preserved');
       await db.query(`DROP SCHEMA "${schema}" CASCADE`);
     }
   } finally {await db.end();}
 }
})();
