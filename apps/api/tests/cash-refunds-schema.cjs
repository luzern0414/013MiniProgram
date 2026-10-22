// Every schema creation and cleanup, including nested fixtures, shares this guard.
const pattern = /^test_cash_refunds_[a-z0-9_]+$/;
function assertSchema(schema) {
  if (process.env.NODE_ENV === 'production' || !pattern.test(schema || '')) throw new Error('Cash refunds tests require an isolated test_cash_refunds_* schema');
  return schema;
}
function assertUrl(url) {
  let schema;
  try { schema = new URL(url || '').searchParams.get('schema'); } catch {}
  return assertSchema(schema);
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
      if (!identity || JSON.stringify(current) !== JSON.stringify(identity)) throw new Error('Cash refunds schema identity changed; preserved');
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
  }
}
module.exports = {assertSchema, assertUrl, ownedSchema};
