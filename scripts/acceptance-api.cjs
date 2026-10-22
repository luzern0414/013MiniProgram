// The parent receives the port only from its own bound server over IPC.
if (process.env.NODE_ENV !== 'test' || !/[?&]schema=test_acceptance_[a-f0-9]+(?:&|$)/.test(process.env.DATABASE_URL || '') || !process.send) {
  throw new Error('Acceptance API requires an isolated test schema and parent IPC.');
}
const { createApp } = require('../apps/api/dist/src/main.js');
let app;
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (app) await app.close();
  if (process.connected) process.disconnect();
}
process.on('message', message => { if (message?.type === 'shutdown') void shutdown(); });
process.on('disconnect', () => void shutdown());
createApp().then(async value => {
  app = value;
  if (stopping) { await app.close(); return; }
  await app.listen(0, '127.0.0.1');
  if (process.connected) process.send({ type: 'ready', port: app.getHttpServer().address().port });
}).catch(error => { console.error(error.message); process.exitCode = 1; if (process.connected) process.disconnect(); });
