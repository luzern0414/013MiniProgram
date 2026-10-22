const {spawnSync} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const pg = require('pg');
const {assertUrl, ownedSchema} = require('./cash-refunds-schema.cjs');
(async () => {
  const args = process.argv.slice(2), regression = args[0] === '--regression';
  const schema = 'test_cash_refunds_' + (regression ? 'regression_' : '') + randomBytes(6).toString('hex');
  const url = new URL('postgresql://restaurant_dev:restaurant_dev_local_only@127.0.0.1:55432/restaurant_dev');
  url.searchParams.set('schema', schema); assertUrl(url.href);
  const db = new pg.Client({connectionString: url.href});
  const env = {...process.env, TSX_TSCONFIG_PATH: 'apps/api/tsconfig.json', DATABASE_URL: url.href, NODE_ENV: 'test', DEV_AUTH_ENABLED: 'true', DEV_SEED_ENABLED: 'true', PUBLIC_BRAND_ID: 'experience-brand'};
  // The original integration suite deliberately tests ambiguous public-brand selection.
  if (regression) delete env.PUBLIC_BRAND_ID;
  delete env.NODE_TEST_CONTEXT;
  const run = args => {
    const result = spawnSync(process.execPath, args, {env, stdio: 'inherit', windowsHide: true});
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Exit ' + result.status);
  };
  try {
    await db.connect();
    await ownedSchema(db, schema, async () => {
      run(['apps/api/node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma']);
      run(['--import', 'tsx', '--test', ...(regression ? args.slice(1) : args), ...(regression ? ['apps/api/tests/domain.test.ts', 'apps/api/tests/integration.test.ts'] : ['apps/api/tests/cash-refunds.test.ts'])]);
    });
  } finally { await db.end(); }
})().catch(error => {console.error(error.message); process.exitCode = 1;});
