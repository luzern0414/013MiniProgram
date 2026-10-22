import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.mjs';

const clone = v => structuredClone(v);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const memory = () => { const map = new Map(); return { map, get: k => map.get(k), set: (k,v) => map.set(k, clone(v)), remove: k => map.delete(k) }; };
const shift = (extra = {}) => ({ id: 'sh1', storeId: 's1', state: 'OPEN', revision: 2, openingFen: 1000,
  openedBy: { id: 'u1', name: '店主' }, openedAt: '2026-10-21T00:00:00Z', closedBy: null, closedAt: null,
  summary: { paymentCount: 2, refundCount: 1, paidFen: 3000, refundFen: 100, netFen: 2900, expectedFen: 3900, countedFen: null, differenceFen: null, reason: null }, ...extra });
const closed = () => shift({ state: 'CLOSED', revision: 3, closedBy: { id:'u1', name:'店主' }, closedAt:'2026-10-21T01:00:00Z', summary: { ...shift().summary, countedFen: 3800, differenceFen: -100, reason: '找零差额' } });
function setup({ storage = memory(), request = async (path, o) => o ? shift() : path.includes('/current?') ? {shift: shift()} : path.includes('state=') ? {items:[closed()], total:1, page:1,pageSize:20} : shift(), context = {userId:'u1', storeId:'s1', owner:true}, state = {} } = {}) {
  assert.equal(typeof core.createCashShiftController, 'function', 'shared controller must be exported');
  const calls = [];
  const ctl = core.createCashShiftController({ state, storage, context: () => context, key: () => 'original-key', request: async (p,o) => { calls.push([p,clone(o)]); return request(p,o); } });
  return {state, storage, calls, ctl, context};
}

test('absent storage is empty; existing empty/null/damaged storage fails closed', () => {
  assert.equal(setup().state.blocked, false);
  for (const raw of ['',null,'{broken',{version:9}]) {
    const storage = memory(); storage.set('cash-shift:v1:u1',raw);
    const r = setup({storage}); assert.equal(r.state.blocked,true); assert.equal(r.state.corrupt,true);
  }
});
test('reads current and paged history with real immutable summary', async () => {
  const r = setup(); assert.equal(await r.ctl.current(),true); assert.equal(r.state.current.summary.expectedFen,3900);
  assert.equal(await r.ctl.load(),true); assert.equal(r.state.items[0].summary.differenceFen,-100);
  await r.ctl.load({page:0}); assert.equal(r.calls.length,2);
});
test('opening persists before send, keeps original body/key across reload, GET alone does not prove opening', async () => {
  const storage = memory();
  const r = setup({storage, request: async (p,o) => { if(o) {assert.ok(storage.get('cash-shift:v1:u1')); throw Error('lost');} return {shift:shift()}; }});
  r.state.opening = '10.00'; assert.equal(await r.ctl.open(),false); assert.equal(r.state.blocked,true);
  const original = clone(r.state.pending); r.ctl.dispose();
  const next = setup({storage}); next.state.opening='99'; await next.ctl.recover('read'); assert.equal(next.state.blocked,true);
  assert.equal(await next.ctl.recover('replay'),true); assert.equal(next.state.blocked,false);
  assert.deepEqual(next.calls.filter(c=>c[1])[0][1],{method:'POST',headers:{'Idempotency-Key':'original-key'},data:{storeId:'s1',openingFen:1000}});
  assert.equal(original.data.openingFen,1000); assert.equal(storage.get('cash-shift:v1:u1'),undefined);
});
for (const mode of ['set throws','silent set','readback throws']) test(`${mode} prevents any financial write`, async () => {
  const storage = memory();
  if(mode === 'set throws') storage.set=()=>{throw Error('quota');};
  if(mode === 'silent set') storage.set=()=>{};
  if(mode === 'readback throws') {const get=storage.get; storage.get=k=>{if(storage.map.size) throw Error('read');return get(k);};}
  const r=setup({storage});r.state.opening='1'; await r.ctl.open(); assert.equal(r.calls.length,0); assert.match(r.state.error.message,/保存/);
});
test('remove readback failure preserves pending lock even after confirmed receipt', async () => {
  const storage=memory();storage.remove=()=>{};
  const r=setup({storage});r.state.opening='10';await r.ctl.open();assert.equal(r.state.blocked,true);assert.ok(r.state.pending);assert.match(r.state.error.message,/清理/);
});
test('pending is unique across stores for one identity and discovered on refresh', async () => {
  const storage=memory(); const r=setup({storage,request:async()=>{throw Error('offline');}});r.state.opening='0';await r.ctl.open();
  const other=setup({storage,context:{userId:'u1',storeId:'s2',owner:true}}); await other.ctl.open();await other.ctl.recover('replay');assert.equal(other.calls.length,0);assert.equal(other.state.blocked,true);
  assert.equal(setup({storage,context:{userId:'u2',storeId:'s1',owner:true}}).state.blocked,false);
});
for(const kind of ['store','identity','dispose']) test(`late responses after ${kind} cannot publish or clear persisted attempt`, async () => {
  const wait=deferred(), r=setup({request:()=>wait.promise});r.state.opening='10';const sending=r.ctl.open();
  if(kind==='store')r.context.storeId='s2';if(kind==='identity')r.context.userId='u2';if(kind==='dispose')r.ctl.dispose();
  wait.resolve(shift());assert.equal(await sending,false);assert.ok(r.storage.get('cash-shift:v1:u1'));assert.equal(r.state.current,null);
});
for(const status of [401,403,0]) test(`unknown close retains exact revision/count/reason through ${status || 'offline'} recovery`, async () => {
  const r=setup({request:async(p,o)=>{if(o)throw Object.assign(Error('failure'),{status,code:'FORBIDDEN',requestId:'r-1'});throw Error('offline');}});
  r.state.current=shift();r.state.counted='38';r.state.reason=' 找零差额 ';await r.ctl.close(true);const original=clone(r.state.pending);
  await r.ctl.recover('read');await r.ctl.recover('replay');assert.equal(r.state.blocked,true);assert.deepEqual(r.state.pending,original);
  assert.deepEqual(original.data,{storeId:'s1',expectedRevision:2,countedFen:3800,reason:'找零差额'});
});
test('first close revision conflict reads fresh fact, keeps inputs and requires explicit reconfirmation', async () => {
  const r=setup({request:async(p,o)=>{if(o)throw Object.assign(Error('changed'),{status:409,code:'SHIFT_CHANGED',requestId:'r-2'});return shift({revision:4});}});
  r.state.current=shift();r.state.counted='38';r.state.reason='找零差额';await r.ctl.close(true);
  assert.equal(r.state.blocked,false);assert.equal(r.state.review,true);assert.equal(r.state.current.revision,4);assert.equal(r.state.counted,'38');assert.equal(r.state.reason,'找零差额');assert.equal(r.calls.filter(c=>c[1]).length,1);
});
test('prior unknown conflict cannot be cleared by fresh OPEN GET or automatically retry with new revision', async () => {
  let first=true;const r=setup({request:async(p,o)=>{if(o){if(first){first=false;throw Error('lost');}throw Object.assign(Error('changed'),{status:409,code:'SHIFT_CHANGED'});}return shift({revision:4});}});
  r.state.current=shift();r.state.counted='38';r.state.reason='找零差额';await r.ctl.close(true);await r.ctl.recover('replay');await r.ctl.recover('read');
  assert.equal(r.state.blocked,true);assert.equal(r.state.pending.data.expectedRevision,2);assert.equal(r.calls.filter(c=>c[1]).length,2);
});
test('nonzero difference requires reason; limits and owner/confirmation are enforced before writing', async () => {
  const r=setup();r.state.current=shift();r.state.counted='38';await r.ctl.close(true);assert.equal(r.calls.length,0);
  r.state.reason='原因';await r.ctl.close(false);assert.equal(r.calls.length,0);
  r.context.owner=false;await r.ctl.close(true);r.state.opening='0';await r.ctl.open();assert.equal(r.calls.length,0);
  r.context.owner=true;for(const opening of ['','-1','0.001','20000000.01']){r.state.opening=opening;await r.ctl.open();}assert.equal(r.calls.length,0);
});
test('closed successful response is followed by detail GET, all other locks remain ORed', async () => {
  const r=setup({request:async()=>closed()});r.state.current=shift();r.state.counted='38';r.state.reason='找零差额';assert.equal(await r.ctl.close(true),true);
  assert.equal(r.state.current,null);assert.equal(r.state.remote.state,'CLOSED');assert.equal(r.calls.length,2);
  assert.equal(core.shiftLocked(false,true,false),true);assert.equal(core.shiftLocked(true,false),true);assert.equal(core.shiftLocked(false,false),false);
});
test('two already mounted controllers cannot overwrite one identity pending record across stores',async()=>{
 const storage=memory(),first=setup({storage,request:async()=>{throw Error('lost');}}),second=setup({storage,context:{userId:'u1',storeId:'s2',owner:true}});
 first.state.opening='10';await first.ctl.open();const original=clone(storage.get('cash-shift:v1:u1'));second.state.opening='20';await second.ctl.open();
 assert.equal(second.calls.length,0);assert.equal(second.state.blocked,true);assert.deepEqual(storage.get('cash-shift:v1:u1'),original);
});
test('explicit recovery of a final CLOSED fact releases unknown close without attributing another operator closure',async()=>{
 const r=setup({request:async(p,o)=>{if(o)throw Error('lost');return closed();}});r.state.current=shift();r.state.counted='38';r.state.reason='找零差额';await r.ctl.close(true);
 assert.equal(await r.ctl.recover('read'),true);assert.equal(r.state.blocked,false);assert.equal(r.state.remote.state,'CLOSED');assert.match(r.state.notice,/已关闭.*快照/);
});
test('conflict followed by failed GET retains lock and original error request id',async()=>{
 const r=setup({request:async(p,o)=>{if(o)throw Object.assign(Error('班次变化'),{status:409,code:'SHIFT_CHANGED',requestId:'revision-r'});throw Error('offline');}});r.state.current=shift();r.state.counted='38';r.state.reason='原因';await r.ctl.close(true);assert.equal(r.state.blocked,true);assert.equal(r.state.error.requestId,'revision-r');
});
