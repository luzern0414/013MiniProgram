import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createRenderer, createSSRApp, ssrContextKey } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createRecovery } from './recovery.mjs';

let server;
before(async()=>{ server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true,hmr:false,ws:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'}); });
after(async()=>{await server?.close();});
const renderer=createRenderer({createComment:()=>({}),insert(){},remove(){},parentNode:()=>null,nextSibling:()=>null});
const settle=()=>new Promise(r=>setImmediate(r));
const shift={id:'sh1',storeId:'s1',state:'OPEN',revision:3,openingFen:1000,openedBy:{id:'u1',name:'店主'},openedAt:'2026-10-21T00:00:00Z',closedBy:null,closedAt:null,
 summary:{paymentCount:2,refundCount:1,paidFen:3000,refundFen:100,netFen:2900,expectedFen:3900,countedFen:null,differenceFen:null,reason:null}};
const store={id:'s1',name:'店一',serviceModes:['DINE_IN'],isOpen:true};
async function mount(t,file,{owner=true,respond=()=>undefined,storage:provided}={}){
 const component=(await server.ssrLoadModule(`/src/${file}.vue`)).default;
 const map=new Map(),calls=[],events=[];const storage=provided||{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const old=new Map();for(const [k,v] of Object.entries({sessionStorage:storage,window:{addEventListener:(...a)=>events.push(a),removeEventListener(){}}})) {old.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:v});}
 t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push([url,options]);const response=await respond(url,options);if(response?.error)return {ok:false,status:response.status||409,json:async()=>({error:{code:response.error},requestId:'req-shift'})};return {ok:true,json:async()=>({data:response??(url.includes('/cash-shifts/current')?{shift}:url.includes('/cash-shifts?')?{items:[shift],total:1,page:1,pageSize:20}:url.includes('/orders?')?{items:[],total:0,pageSize:20}:[])})};});
 const app=renderer.createApp({...component,render:()=>null},{store,userId:'u1',owner});app.provide(ssrContextKey,{modules:new Set()});const instance=app.mount({});
 let disposed=false;const dispose=async()=>{if(disposed)return;disposed=true;app.unmount();await settle();for(const[k,d]of old)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];};t.after(dispose);
 return {state:instance.$.setupState,calls,map,events,storage,dispose,render:async()=>{const context={};const html=await renderToString(createSSRApp({...component,setup:()=>instance.$.setupState},{store,userId:'u1',owner}),context);return html+(context.teleports?.body||'');}};
}
test('actual shift page reads summary, previews counted difference, requires reason and explicit close',async t=>{
 const r=await mount(t,'CashShifts');await settle();assert.equal(r.state.shifts.current.summary.expectedFen,3900);
 r.state.shifts.counted='38';r.state.previewClose();assert.equal(r.state.confirming,false);assert.equal(r.calls.filter(c=>c[1].method==='POST').length,0);
 r.state.shifts.reason='找零差额';r.state.previewClose();assert.equal(r.state.confirming,true);
 const html=await r.render();for(const v of ['期初现金','现金收款','现金退款','应有现金','¥39.00','实点现金','-¥1.00','明确关闭班次'])assert.ok(html.includes(v),v);
 assert.match(html,/差额原因/);
});
test('actual shift page only sends close after explicit acknowledgement and displays server snapshot',async t=>{
 const closed={...shift,state:'CLOSED',revision:4,closedBy:{id:'u1',name:'店主'},closedAt:'2026-10-21T01:00:00Z',summary:{...shift.summary,countedFen:3800,differenceFen:-100,reason:'找零差额'}};
 const r=await mount(t,'CashShifts',{respond:(url,o)=>url.includes('/cash-shifts/sh1')?closed:undefined});await settle();r.state.shifts.counted='38';r.state.shifts.reason='找零差额';r.state.previewClose();await r.state.confirmClose();assert.equal(r.calls.filter(c=>c[1].method==='POST').length,0);
 r.state.acknowledged=true;await r.state.confirmClose();const sent=r.calls.filter(c=>c[1].method==='POST');assert.equal(sent.length,1);assert.deepEqual(JSON.parse(sent[0][1].body),{storeId:'s1',expectedRevision:3,countedFen:3800,reason:'找零差额'});assert.equal(r.state.shifts.current,null);assert.equal(r.state.shifts.remote.summary.countedFen,3800);
});
test('failed current GET never displays a false no-shift fact or enables opening',async t=>{
 const r=await mount(t,'CashShifts',{respond:url=>url.includes('/cash-shifts/current')?{error:'FORBIDDEN',status:403}:undefined});await settle();const html=await r.render();assert.ok(!html.includes('确认开班'));assert.ok(!html.includes('当前没有活动现金班次'));assert.ok(html.includes('req-shift'));
});
test('actual shift page keeps clerk read-only and exposes history pagination and immutable closed snapshot',async t=>{
 const closed={...shift,state:'CLOSED',closedBy:{id:'u1',name:'店主'},closedAt:'2026-10-21T01:00:00Z',summary:{...shift.summary,countedFen:3800,differenceFen:-100,reason:'找零差额'}};
 const r=await mount(t,'CashShifts',{owner:false,respond:url=>url.includes('/cash-shifts?')?{items:[closed],total:21,page:1,pageSize:20}:undefined});await settle();
 const html=await r.render();assert.ok(!html.includes('确认开班'));assert.ok(!html.includes('核对关班'));assert.ok(html.includes('下一页'));assert.ok(html.includes('已关班'));
 r.state.shifts.counted='38';r.state.shifts.reason='原因';await r.state.controller.close(true);assert.equal(r.calls.filter(c=>c[1].method==='POST').length,0);
});
test('actual shift page discovers pending original open after refresh, blocks unload, and offers explicit recovery only',async t=>{
 const r=await mount(t,'CashShifts',{respond:(url,o)=>o.method==='POST'?{error:'NETWORK',status:503}:undefined});await settle();r.state.shifts.opening='10';await r.state.controller.open();assert.equal(r.state.shifts.blocked,true);
 const html=await r.render();assert.ok(html.includes('恢复原开班'));assert.ok(html.includes('读取最新班次'));assert.equal(r.calls.filter(c=>c[1].method==='POST').length,1);
 const before=r.events.find(e=>e[0]==='beforeunload')[1];let prevented=false;before({preventDefault(){prevented=true;}});assert.equal(prevented,true);
 const saved=JSON.parse(r.map.get('cash-shift:v1:u1'));assert.equal(saved.data.openingFen,1000);
});
test('Orders handoff retains original order/tender, reads fresh order, and never auto confirms cash',async t=>{
 const order={id:'o1',number:'O1',storeId:'s1',totalFen:1000,status:'PENDING_PAYMENT',paymentStatus:'UNPAID',cashReceipt:null};
 const r=await mount(t,'Orders',{respond:url=>url.endsWith('/orders/o1')?order:undefined});await settle();await r.state.cashOpen(order);r.state.tendered='20.00';await r.state.receive();await settle();
 assert.equal(r.calls.filter(c=>c[1].method==='POST').length,0);
 const restored=createRecovery(r.storage,'u1','s1').read();assert.equal(restored.order.id,'o1');assert.equal(restored.tendered,'20.00');assert.equal(restored.uncertain,false);
});
test('Orders handoff cannot overwrite existing unknown cash recovery',async t=>{
 const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const original={order:{id:'old-order'},tendered:'99',submittedFen:9900,uncertain:true,orderKey:'old-key'};createRecovery(storage,'u1','s1').save(original);
 const order={id:'o1',storeId:'s1',totalFen:1000,status:'PENDING_PAYMENT',paymentStatus:'UNPAID'};
 const r=await mount(t,'Orders',{storage,respond:url=>url.endsWith('/orders/o1')?order:undefined});await settle();await r.state.cashOpen(order);r.state.tendered='20';await r.state.receive();await settle();
 assert.deepEqual(createRecovery(storage,'u1','s1').read(),original);assert.equal(r.calls.filter(c=>c[1].method==='POST').length,0);
});
test('new Cashier payment reads active shift first and preserves order and tender when none exists',async t=>{
 const original={id:'o1',storeId:'s1',totalFen:1000,status:'PENDING_PAYMENT',paymentStatus:'UNPAID'};
 const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};createRecovery(storage,'u1','s1').save({order:original,tendered:'20.00',orderKey:'original-key',uncertain:false});
 const r=await mount(t,'Cashier',{storage,respond:url=>url.includes('/cash-shifts/current')?{shift:null}:url.endsWith('/orders/o1')?original:url.endsWith('/catalog')?{products:[]}:undefined});await settle();r.state.checkout();await settle();await settle();
 assert.equal(r.calls.filter(c=>c[1].method==='POST').length,0);assert.equal(r.state.uncertain,false);assert.equal(r.state.order.id,'o1');assert.equal(r.state.tendered,'20.00');assert.equal(r.state.mutation.error.code,'SHIFT_REQUIRED');
});
test('refund input and original order survive navigation to shifts and returning',async t=>{
 const order={id:'o1',number:'O1',storeId:'s1',totalFen:1000,status:'COMPLETED',paymentStatus:'PAID',cashReceipt:{amountFen:1000,tenderedFen:1000,changeFen:0},refundedFen:0,cashRefunds:[]};
 const r=await mount(t,'Orders',{respond:url=>url.endsWith('/orders/o1')?order:undefined});await settle();await r.state.show(order);r.state.refund.amount='1.23';r.state.refund.reason='原原因';r.state.refund.expanded=true;
 r.state.saveRefundForm();assert.ok(r.storage.getItem('merchant-refund-form:u1:s1'));
 await r.dispose();
 const next=await mount(t,'Orders',{storage:r.storage,respond:url=>url.endsWith('/orders/o1')?order:undefined});await settle();await settle();assert.equal(next.state.detail.id,'o1');assert.equal(next.state.refund.amount,'1.23');assert.equal(next.state.refund.reason,'原原因');assert.equal(next.calls.filter(c=>c[1].method==='POST').length,0);
});
test('App discovers pending shift on login and ORs shift lock with all existing financial/navigation locks',async t=>{
 const map=new Map([['merchant-token','test-token'],['cash-shift:v1:u1',JSON.stringify({version:1,userId:'u1',storeId:'s1',kind:'open',key:'original',data:{storeId:'s1',openingFen:0}})]]),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const r=await mount(t,'App',{storage,respond:url=>url.endsWith('/public-config')?{brandId:'b1',brandName:'门店',environment:'development'}:url.endsWith('/me')?{id:'u1',role:'OWNER',name:'店主',storeIds:['s1']}:url.endsWith('/stores')?[store]:undefined});await settle();await settle();
 assert.equal(r.state.page,'shifts');assert.equal(r.state.navigationLocked,true);r.state.navigate('cashier');assert.equal(r.state.page,'shifts');
 map.delete('cash-shift:v1:u1');r.state.syncShiftRecovery();
 r.state.pickupBusy=true;r.state.shiftBusy=false;assert.equal(r.state.navigationLocked,true);r.state.pickupBusy=false;r.state.productBusy=true;assert.equal(r.state.navigationLocked,true);r.state.productBusy=false;assert.equal(r.state.navigationLocked,false);
 const guard=(await server.ssrLoadModule('/src/checkoutGuard.ts')).checkoutBlocked;guard.value=true;r.state.shiftBusy=true;r.state.shiftBusy=false;assert.equal(r.state.navigationLocked,true);r.state.navigate('cashier');assert.equal(r.state.page,'shifts');guard.value=false;
});

const pendingShift=(storeId='s1')=>({version:1,userId:'u1',storeId,kind:'open',key:'original-shift-key',data:{storeId,openingFen:1000}});
const unpaid={id:'o-combined',storeId:'s1',totalFen:1000,status:'PENDING_PAYMENT',paymentStatus:'UNPAID',cashReceipt:null};
const paidOrder={...unpaid,paymentStatus:'PAID',status:'COMPLETED',cashReceipt:{amountFen:1000,tenderedFen:2000,changeFen:1000},refundedFen:0,cashRefunds:[]};
function combinedStorage(shiftValue=JSON.stringify(pendingShift()),cashUnknown=false){
 const map=new Map([['merchant-token','isolated-token'],['merchant-store','s1'],['merchant-active-checkout',JSON.stringify({userId:'u1',storeId:'s1'})],['cash-shift:v1:u1',shiftValue]]);
 const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 createRecovery(storage,'u1','s1').save({order:unpaid,tendered:'20.00',submittedFen:2000,orderKey:'original-cash-key',uncertain:cashUnknown});return {map,storage};
}
const appResponse=url=>url.endsWith('/public-config')?{brandId:'b1',brandName:'门店',environment:'development'}:url.endsWith('/me')?{id:'u1',role:'OWNER',name:'店主',storeIds:['s1','s2']}:url.endsWith('/stores')?[store,{...store,id:'s2',name:'店二'}]:undefined;
for(const [name,value] of [['pending',JSON.stringify(pendingShift('s2'))],['corrupt','{broken']])test(`actual App refresh keeps ${name} shift locked beside retained unpaid checkout`,async t=>{
 const {storage}=combinedStorage(value);const r=await mount(t,'App',{storage,respond:appResponse});await settle();await settle();
 assert.equal(r.state.page,'cashier');assert.equal(r.state.storeId,'s1');assert.equal(r.state.navigationLocked,true);
 r.state.loading=true;const html=await r.render();r.state.loading=false;
 assert.match(html.match(/<select[^>]*aria-label="当前门店"[^>]*>/)?.[0]||'',/disabled/);
 assert.match(html.match(/<button[^>]*aria-label="退出登录"[^>]*>/)?.[0]||'',/disabled/);
 assert.ok(html.includes('前往恢复交班'));
 r.state.navigate('dashboard');r.state.requestLogout();assert.equal(r.state.page,'cashier');assert.equal(r.storage.getItem('merchant-token'),'isolated-token');
 const guard=r.events.find(e=>e[0]==='beforeunload')[1];let prevented=false;guard({preventDefault(){prevented=true;}});assert.equal(prevented,true);
 r.state.recoverShift();assert.equal(r.state.page,'shifts');assert.equal(r.state.storeId,name==='pending'?'s2':'s1');assert.equal(r.state.navigationLocked,true);
 assert.equal(r.calls.filter(c=>c[1].method==='POST').length,0);
});
test('actual Cashier blocks new cash for a persistent shift even without a mounted shift page',async t=>{
 const {storage}=combinedStorage();const r=await mount(t,'Cashier',{storage,respond:url=>url.endsWith('/orders/o-combined')?unpaid:url.endsWith('/catalog')?{products:[]}:undefined});await settle();r.state.checkout();await settle();await settle();
 assert.equal(r.calls.filter(c=>c[1].method==='POST').length,0);assert.equal(r.state.order.id,unpaid.id);assert.equal(r.state.tendered,'20.00');assert.equal(r.state.uncertain,false);assert.equal(r.state.mutation.error.code,'SHIFT_RECOVERY');
});
test('actual Orders blocks new refund for persistent shift without mounting the shift page',async t=>{
 const {storage}=combinedStorage();const r=await mount(t,'Orders',{storage,respond:url=>url.endsWith('/orders/o-combined')?paidOrder:undefined});await settle();await r.state.show(paidOrder);r.state.refund.amount='1.00';r.state.refund.reason='原退款原因';
 assert.equal(await r.state.refundCtl.checkNew(),false);assert.equal(await r.state.refundCtl.submit(true),false);assert.equal(r.calls.filter(c=>c[1].method==='POST').length,0);assert.equal(r.state.refund.amount,'1.00');assert.equal(r.state.refund.reason,'原退款原因');
});
test('actual cash unknown plus shift unknown retains original recovery then explicitly transfers to original shift store',async t=>{
 const {storage}=combinedStorage(JSON.stringify(pendingShift('s2')),true);const app=await mount(t,'App',{storage,respond:appResponse});await settle();await settle();
 assert.equal(app.state.page,'cashier');assert.equal(app.state.navigationLocked,true);app.state.recoverShift();assert.equal(app.state.page,'cashier');
 const cash=await mount(t,'Cashier',{storage,respond:url=>url.endsWith('/orders/o-combined')?unpaid:url.endsWith('/cash-payment')?paidOrder:url.endsWith('/catalog')?{products:[]}:undefined});try{await settle();assert.equal(cash.state.uncertain,true);assert.equal(cash.calls.filter(c=>c[1].method==='POST').length,0);
 cash.state.checkout();await settle();await settle();assert.equal(cash.state.uncertain,false);assert.equal(cash.calls.filter(c=>c[1].method==='POST').length,1);assert.equal(cash.state.orderKey,'original-cash-key');
 assert.equal(app.state.navigationLocked,true);app.state.recoverShift();assert.equal(app.state.page,'shifts');assert.equal(app.state.storeId,'s2');assert.equal(app.state.navigationLocked,true);
 }finally{await cash.dispose();}
});
test('actual refund unknown plus shift unknown preserves refund identity and keeps shift lock after refund recovery',async t=>{
 const {storage,map}=combinedStorage();map.delete('merchant-active-checkout');map.set('cash-refund:v1:u1',JSON.stringify({version:1,userId:'u1',storeId:'s1',orderId:unpaid.id,key:'original-refund-key',amountFen:100,reason:'原原因',phase:'unknown'}));
 const app=await mount(t,'App',{storage,respond:appResponse});await settle();await settle();assert.equal(app.state.page,'orders');assert.equal(app.state.navigationLocked,true);app.state.recoverShift();assert.equal(app.state.page,'orders');
 const orders=await mount(t,'Orders',{storage,respond:url=>url.endsWith('/orders/o-combined')||url.endsWith('/cash-refunds')?paidOrder:undefined});try{await settle();assert.equal(orders.calls.filter(c=>c[1].method==='POST').length,0);assert.equal(await orders.state.refundCtl.submit(true),true);
 const post=orders.calls.find(c=>c[1].method==='POST');assert.equal(post[1].headers['Idempotency-Key'],'original-refund-key');assert.deepEqual(JSON.parse(post[1].body),{storeId:'s1',amountFen:100,reason:'原原因'});
 assert.equal(app.state.navigationLocked,true);app.state.recoverShift();assert.equal(app.state.page,'shifts');assert.equal(app.state.navigationLocked,true);}finally{await orders.dispose();}
});
test('clearing shift alone never releases actual restored cash unknown lock',async t=>{
 const {storage,map}=combinedStorage(undefined,true);const app=await mount(t,'App',{storage,respond:appResponse});await settle();await settle();const cash=await mount(t,'Cashier',{storage,respond:url=>url.endsWith('/orders/o-combined')?unpaid:url.endsWith('/catalog')?{products:[]}:undefined});await settle();
 try{map.delete('cash-shift:v1:u1');app.state.syncShiftRecovery();assert.equal(app.state.navigationLocked,true);app.state.navigate('dashboard');assert.equal(app.state.page,'cashier');assert.equal(cash.state.uncertain,true);}finally{await cash.dispose();}
});
test('actual App preserves draft conversion recovery before explicit shift recovery without automatic financial POST',async t=>{
 const {storage,map}=combinedStorage();map.delete('merchant-active-checkout');
 const selection={mode:'DINE_IN',note:'原备注',lines:[{skuId:'sku1',quantity:1,modifierIds:[],attributeOptionIds:[]}]};
 const draft={id:'d1',storeId:'s1',name:'原挂单',revision:2,state:'CONVERTED',orderId:unpaid.id,selection,display:{lines:[]},createdAt:'2026-10-21T00:00:00Z',updatedAt:'2026-10-21T01:00:00Z'};
 map.set('cashier-draft:v1:u1',JSON.stringify({version:1,userId:'u1',storeId:'s1',kind:'convert',draftId:'d1',expectedRevision:1,quoteId:'original-quote',key:'original-draft-key',method:'POST',path:'/orders',data:{quoteId:'original-quote'},edit:{name:'原挂单',selection}}));
 createRecovery(storage,'u1','s1').save({tendered:'20.00',submittedFen:2000,orderKey:'original-draft-key',uncertain:true});
 const app=await mount(t,'App',{storage,respond:appResponse});await settle();await settle();assert.equal(app.state.page,'cashier');assert.equal(app.state.navigationLocked,true);app.state.recoverShift();assert.equal(app.state.page,'cashier');
 const cash=await mount(t,'Cashier',{storage,respond:url=>url.includes('/cashier-drafts/d1?')?draft:url.endsWith('/orders/o-combined')?unpaid:url.endsWith('/catalog')?{products:[]}:undefined});
 try{await settle();await settle();assert.equal(cash.state.order.id,unpaid.id);assert.equal(cash.state.uncertain,false);assert.equal(cash.state.orderKey,'original-draft-key');assert.equal(cash.calls.filter(c=>c[1].method==='POST').length,0);assert.equal(map.has('cashier-draft:v1:u1'),false);assert.equal(app.state.navigationLocked,true);app.state.recoverShift();assert.equal(app.state.page,'shifts');}
 finally{await cash.dispose();}
});
test('actual App restores durable cash unknown without navigation hint before shift recovery',async t=>{
 const {storage,map}=combinedStorage(undefined,true);map.delete('merchant-active-checkout');const r=await mount(t,'App',{storage,respond:appResponse});await settle();await settle();assert.equal(r.state.page,'cashier');assert.equal(r.state.navigationLocked,true);assert.equal(r.calls.filter(c=>c[1].method==='POST').length,0);
});
test('resolved refund can explicitly return to remaining original cash recovery before shift',async t=>{
 const {storage,map}=combinedStorage(undefined,true);map.set('cash-refund:v1:u1',JSON.stringify({version:1,userId:'u1',storeId:'s1',orderId:unpaid.id,key:'original-refund-key',amountFen:100,reason:'原原因',phase:'unknown'}));
 const app=await mount(t,'App',{storage,respond:appResponse});await settle();await settle();assert.equal(app.state.page,'orders');
 const orders=await mount(t,'Orders',{storage,respond:url=>url.endsWith('/orders/o-combined')||url.endsWith('/cash-refunds')?paidOrder:undefined});try{await settle();assert.equal(await orders.state.refundCtl.submit(true),true);app.state.recoverShift();assert.equal(app.state.page,'orders');app.state.recoverOriginal();assert.equal(app.state.page,'cashier');assert.equal(app.state.navigationLocked,true);assert.equal(createRecovery(storage,'u1','s1').read().uncertain,true);}finally{await orders.dispose();}
});
test('pending shift recovery takes focus on mount and never writes automatically',async t=>{
 const map=new Map([['cash-shift:v1:u1',JSON.stringify({version:1,userId:'u1',storeId:'s1',kind:'open',key:'original',data:{storeId:'s1',openingFen:0}})]]),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const r=await mount(t,'CashShifts',{storage});let focused=0;r.state.recoveryBox={focus(){focused++;}};await settle();assert.equal(focused,1);assert.equal(r.calls.length,0);
});
test('actual confirmation modal traps keyboard focus, blocks Escape when locked, and restores focus',async t=>{
 const Modal=(await server.ssrLoadModule('/src/Modal.vue')).default;
 let firstFocus=0,lastFocus=0,restored=0,prevented=0;const first={focus(){firstFocus++;}},last={focus(){lastFocus++;}},trigger={focus(){restored++;}};
 const old=Object.getOwnPropertyDescriptor(globalThis,'document');const doc={activeElement:trigger,addEventListener(){},removeEventListener(){}};Object.defineProperty(globalThis,'document',{configurable:true,value:doc});
 let closes=0;const app=renderer.createApp({...Modal,render:()=>null},{title:'明确关闭班次',locked:true,onClose:()=>{closes++;}});app.provide(ssrContextKey,{modules:new Set()});const instance=app.mount({}),state=instance.$.setupState;state.box={querySelectorAll:()=>[first,last]};
 try{doc.activeElement=first;state.key({key:'Tab',shiftKey:true,preventDefault(){prevented++;}});assert.equal(lastFocus,1);doc.activeElement=last;state.key({key:'Tab',shiftKey:false,preventDefault(){prevented++;}});assert.equal(firstFocus,1);assert.equal(prevented,2);state.key({key:'Escape'});assert.equal(closes,0);instance.$.props.locked=false;state.key({key:'Escape'});assert.equal(closes,1);}
 finally{app.unmount();if(old)Object.defineProperty(globalThis,'document',old);else delete globalThis.document;}
 assert.equal(restored,1);
});
test('disposed Cashier cannot erase the persisted unknown attempt with a late cash response',async t=>{
 const original={id:'o1',storeId:'s1',totalFen:1000,status:'PENDING_PAYMENT',paymentStatus:'UNPAID'},map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};createRecovery(storage,'u1','s1').save({order:original,tendered:'20.00',orderKey:'original-key',uncertain:false});
 let resolve;const late=new Promise(r=>{resolve=r;});const r=await mount(t,'Cashier',{storage,respond:url=>url.endsWith('/cash-payment')?late:url.endsWith('/orders/o1')?original:url.endsWith('/catalog')?{products:[]}:undefined});await settle();r.state.checkout();await settle();assert.equal(r.calls.filter(c=>c[1].method==='POST').length,1);assert.equal(createRecovery(storage,'u1','s1').read().uncertain,true);await r.dispose();resolve({...original,paymentStatus:'PAID',cashReceipt:{amountFen:1000,tenderedFen:2000,changeFen:1000}});await settle();await settle();assert.equal(createRecovery(storage,'u1','s1').read().uncertain,true);assert.equal(r.state.order.paymentStatus,'UNPAID');
});
