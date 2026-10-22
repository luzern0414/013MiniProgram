const pattern = /^test_cash_shifts_[a-z0-9_]+$/;
function assertSchema(schema) {
  if (process.env.NODE_ENV === 'production' || !pattern.test(schema || '')) throw new Error('Cash shifts tests require an isolated test_cash_shifts_* schema');
  return schema;
}
function assertUrl(value) {
  let url; try {url = new URL(value || '');} catch {}
  if (!url || url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/restaurant_dev' || url.username !== 'restaurant_dev') throw new Error('Cash shifts tests require the owned local project database');
  return assertSchema(url.searchParams.get('schema'));
}
async function ownedSchema(client, schema, run) {
  assertSchema(schema);
  const {assertProjectDatabase} = await import('../../../scripts/db.mjs');
  await assertProjectDatabase(client);
  let created = false, identity;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`); created = true;
    identity = (await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1', [schema])).rows[0];
    return await run(schema);
  } finally {
    if (created) {
      assertSchema(schema); await assertProjectDatabase(client);
      const current = (await client.query('SELECT oid,nspowner FROM pg_namespace WHERE nspname=$1', [schema])).rows[0];
      if (!identity || JSON.stringify(current) !== JSON.stringify(identity)) throw new Error('Cash shifts schema identity changed; preserved');
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
  }
}
module.exports = {assertSchema, assertUrl, ownedSchema};
