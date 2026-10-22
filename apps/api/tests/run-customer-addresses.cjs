const {spawnSync} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const pg = require('pg');
const {assertUrl, ownedSchema} = require('./customer-addresses-schema.cjs');
(async () => {
  const schema = 'test_customer_addresses_' + randomBytes(6).toString('hex');
  const url = new URL('postgresql://restaurant_dev:restaurant_dev_local_only@127.0.0.1:55432/restaurant_dev');
  url.searchParams.set('schema', schema); assertUrl(url.href);
  const db = new pg.Client({connectionString: url.href});
  const env = {...process.env, TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json', DATABASE_URL: url.href, NODE_ENV: 'test', DEV_AUTH_ENABLED: 'true', DEV_SEED_ENABLED: 'true', PUBLIC_BRAND_ID: 'experience-brand'};
  delete env.NODE_TEST_CONTEXT;
  try {
    await db.connect();
    await ownedSchema(db, schema, async () => {
      const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...process.argv.slice(2), 'apps/api/tests/customer-addresses.test.ts'], {env, stdio: 'inherit', windowsHide: true});
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error('Exit ' + result.status);
    });
  } finally {await db.end();}
})().catch(error => {console.error(error.message); process.exitCode = 1;});
