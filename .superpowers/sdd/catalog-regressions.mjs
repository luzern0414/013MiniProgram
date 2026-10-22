import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import pg from 'pg';
import {assertProjectDatabase} from '../../scripts/db.mjs';

if(process.env.NODE_ENV==='production') throw new Error('Local catalog regressions cannot run in production');
const name='test_catalog_regression_'+randomBytes(8).toString('hex');
const root=resolve('.'), url=new URL('postgresql://restaurant_dev:restaurant_dev_local_only@127.0.0.1:55432/restaurant_dev');
const control=new pg.Client({connectionString:url.href}); await control.connect();
let created=false, identity;
try {
  await assertProjectDatabase(control);
  if((await control.query('SELECT oid FROM pg_database WHERE datname=$1',[name])).rowCount) throw new Error('Database name collision; preserved');
  await control.query(`CREATE DATABASE "${name}"`); created=true;
  identity=(await control.query('SELECT oid,datdba FROM pg_database WHERE datname=$1',[name])).rows[0];
  console.log('Created owned regression database',name,'identity',JSON.stringify(identity));
  for(const [schema,file] of [['test_staff_access','staff-access.test.ts'],['test_bootstrap_owner','bootstrap-owner.test.ts'],['test_catalog_source','integration.test.ts']]) {
    if(process.argv.length>2 && !process.argv.slice(2).includes(file)) continue;
    const childUrl=new URL(url.href);childUrl.pathname='/'+name;childUrl.searchParams.set('schema',schema);
    const env={...process.env,DATABASE_URL:childUrl.href,NODE_ENV:'test',DEV_AUTH_ENABLED:'true',DEV_SEED_ENABLED:file==='bootstrap-owner.test.ts'?'false':'true',TSX_TSCONFIG_PATH:resolve('apps/api/tsconfig.json')};delete env.NODE_TEST_CONTEXT;delete env.PUBLIC_BRAND_ID;
    for(const args of [[resolve('apps/api/node_modules/prisma/build/index.js'),'migrate','deploy','--schema',resolve('apps/api/prisma/schema.prisma')],['--import','tsx','--test','tests/'+file]]) {
      const result=spawnSync(process.execPath,args,{cwd:resolve('apps/api'),env,stdio:'inherit',windowsHide:true});if(result.status!==0) throw new Error(file+' exited '+result.status);
    }
  }
} finally {
  if(created) {
    await assertProjectDatabase(control);
    const current=(await control.query('SELECT oid,datdba FROM pg_database WHERE datname=$1',[name])).rows[0];
    if(!identity || JSON.stringify(current)!==JSON.stringify(identity)) throw new Error('Database identity changed; preserved');
    const connections=await control.query('SELECT pid FROM pg_stat_activity WHERE datname=$1',[name]);
    if(connections.rowCount) throw new Error('Regression database still has connections; preserved');
    await control.query(`DROP DATABASE "${name}"`);console.log('Removed owned regression database',name);
  }
  await control.end();
}
