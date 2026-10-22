import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/index.mjs";
const order = () => ({
  id: "o",
  storeId: "s",
  paymentStatus: "PAID",
  cashReceipt: {
    amountFen: 3100,
    tenderedFen: 4100,
    changeFen: 1000,
    refundedFen: 100,
  },
  refundedFen: 100,
  netPaidFen: 3000,
  cashRefunds: [],
});
const memory = () => {
  const map = new Map();
  return {
    get: (k) => map.get(k),
    set: (k, v) => map.set(k, structuredClone(v)),
    remove: (k) => map.delete(k),
    map,
  };
};
function setup({
  storage = memory(),
  request = async () => order(),
  identity = { userId: "u", storeId: "s" },
  beforeNew,
} = {}) {
  const state = {};
  let value = order();
  const changes = [];
  const ctl = core.createCashRefund({
    state,
    storage,
    request,
    context: () => ({ owner: true, ...identity, order: value }),
    onOrder: (o) => {
      value = o;
      changes.push(o);
    },
    key: () => "original-key",
    beforeNew,
  });
  return { state, ctl, storage, identity, changes };
}
test("refund accepts one fen and uses original amount minus refunds, not cash tendered", () => {
  assert.equal(core.refundAmount("0.01", order()), 1);
  assert.equal(core.refundAmount("30", order()), 3000);
  for (const amount of ["", "0", "-1", "0.001", "30.01", "40"])
    assert.throws(() => core.refundAmount(amount, order()));
});
test("unknown result persists before send, freezes normalized payload and key through reload and GET", async () => {
  const calls = [];
  const storage = memory();
  let fail = true;
  const request = async (path, options) => {
    calls.push({ path, options });
    if (options) {
      assert.ok(storage.get("cash-refund:v1:u"));
      if (fail) throw Error("offline");
    }
    return {
      ...order(),
      cashRefunds: [{ id: "other", amountFen: 1, reason: "原因" }],
    };
  };
  const a = setup({ storage, request });
  a.state.amount = "0.01";
  a.state.reason = " 原因 ";
  await a.ctl.submit(true);
  assert.equal(a.state.blocked, true);
  assert.equal(a.state.attempt.reason, "原因");
  await a.ctl.load();
  assert.equal(a.state.blocked, true, "same amount and reason is not proof");
  a.ctl.dispose();
  const b = setup({ storage, request });
  assert.equal(b.state.blocked, true);
  b.state.amount = "20";
  b.state.reason = "changed";
  fail = false;
  await b.ctl.submit(true);
  assert.deepEqual(
    calls.filter((c) => c.options).map((c) => c.options),
    [0, 1].map(() => ({
      method: "POST",
      headers: { "Idempotency-Key": "original-key" },
      data: { storeId: "s", amountFen: 1, reason: "原因" },
    })),
  );
  assert.equal(b.state.blocked, false);
  assert.equal(storage.get("cash-refund:v1:u"), undefined);
});
test("storage failure prevents request; corrupt and unsupported records fail closed", async () => {
  let count = 0;
  const bad = {
    get: () => undefined,
    set: () => {
      throw Error("quota");
    },
    remove: () => {},
  };
  const a = setup({
    storage: bad,
    request: async () => {
      count++;
      return order();
    },
  });
  a.state.amount = "1";
  a.state.reason = "原因";
  await a.ctl.submit(true);
  assert.equal(count, 0);
  assert.match(a.state.error, /保存/);
  for (const value of [
    { version: 9 },
    "{broken",
    { version: 1, userId: "other" },
  ]) {
    const storage = memory();
    storage.set("cash-refund:v1:u", value);
    const b = setup({ storage });
    assert.equal(b.state.blocked, true);
    assert.match(b.state.error, /核对/);
  }
});
test("failed GET and later authentication rejection cannot unlock unknown write", async () => {
  let status = 0;
  const a = setup({
    request: async () => {
      throw Object.assign(Error("failure"), {
        status,
        code: "FORBIDDEN",
        requestId: "req",
      });
    },
  });
  a.state.amount = "1";
  a.state.reason = "原因";
  await a.ctl.submit(true);
  await a.ctl.load();
  assert.equal(a.state.blocked, true);
  status = 403;
  await a.ctl.submit(true);
  assert.equal(a.state.blocked, true);
  assert.match(a.state.error, /FORBIDDEN.*req/);
});
test("successful GET clears a previous network error while preserving the unknown attempt and original key", async () => {
  let offline = true;
  let writes = 0;
  const latest = { ...order(), refundedFen: 200, netPaidFen: 2900 };
  const a = setup({
    request: async (path, options) => {
      if (options) writes++;
      if (options || offline)
        throw Object.assign(Error("network unavailable"), {
          code: "NETWORK",
          requestId: "network-request",
        });
      return latest;
    },
  });
  a.state.amount = "0.01";
  a.state.reason = " 原原因 ";
  await a.ctl.submit(true);
  const original = structuredClone(a.state.attempt);
  assert.equal(original.phase, "unknown");
  assert.equal(original.key, "original-key");
  assert.equal(await a.ctl.load(), false);
  assert.match(a.state.error, /NETWORK.*network-request/);
  assert.equal(a.state.blocked, true);
  assert.deepEqual(a.state.attempt, original);
  assert.deepEqual(a.storage.get("cash-refund:v1:u"), original);

  offline = false;
  assert.equal(await a.ctl.load(), true);
  assert.equal(a.state.error, "");
  assert.equal(a.changes.at(-1), latest);
  assert.match(a.state.notice, /结果尚未确认.*恢复原退款核对/);
  assert.equal(a.state.blocked, true);
  assert.deepEqual(a.state.attempt, original);
  assert.deepEqual(a.storage.get("cash-refund:v1:u"), original);
  assert.equal(writes, 1, "GET recovery must not replay the refund");
});
test("definitive rejection requires actual fresh order before clearing; failed read stays blocked", async () => {
  let readFail = true;
  const a = setup({
    request: async (p, o) => {
      if (o)
        throw Object.assign(Error("too much"), {
          status: 409,
          code: "REFUND_EXCEEDS_REMAINING",
          requestId: "req",
        });
      if (readFail) throw Error("offline");
      return { ...order(), refundedFen: 200 };
    },
  });
  a.state.amount = "1";
  a.state.reason = "原因";
  await a.ctl.submit(true);
  assert.equal(a.state.blocked, true);
  assert.match(a.state.error, /REFUND_EXCEEDS_REMAINING/);
  readFail = false;
  await a.ctl.load();
  assert.equal(a.state.blocked, false);
  assert.equal(a.state.amount, "1");
  assert.equal(a.changes.at(-1).refundedFen, 200);
});
test("ownership isolation and disposed or changed context cannot publish async responses", async () => {
  const storage = memory();
  let resolve;
  const a = setup({
    storage,
    request: () => new Promise((r) => (resolve = r)),
  });
  a.state.amount = "1";
  a.state.reason = "原因";
  const pending = a.ctl.submit(true);
  const b = setup({ storage, identity: { userId: "new", storeId: "s" } });
  assert.equal(b.state.attempt, null);
  a.identity.storeId = "other";
  a.ctl.dispose();
  resolve(order());
  await pending;
  assert.equal(a.changes.length, 0);
  assert.ok(storage.get("cash-refund:v1:u"));
  const wrong = setup({ storage, identity: { userId: "u", storeId: "other" } });
  assert.equal(wrong.state.blocked, true);
  await wrong.ctl.submit(true);
  assert.match(wrong.state.error, /门店/);
});
test("confirmation required and combined locks remain until every operation settles", async () => {
  let count = 0;
  const a = setup({
    request: async () => {
      count++;
      return order();
    },
  });
  a.state.amount = "1";
  a.state.reason = "原因";
  await a.ctl.submit(false);
  assert.equal(count, 0);
  assert.equal(core.refundLocked(false, true), true);
  assert.equal(core.refundLocked(true, false), true);
  assert.equal(core.refundLocked(false, false), false);
});
test("an existing empty recovery value is corrupt rather than permission to issue a new refund", () => {
  const storage = memory();
  storage.set("cash-refund:v1:u", "");
  const a = setup({ storage });
  assert.equal(a.state.blocked, true);
  assert.match(a.state.error, /核对/);
});
test("an existing null mini storage record cannot bypass pending refund validation", () => {
  const storage = memory();
  storage.set("cash-refund:v1:u", null);
  const a = setup({ storage });
  assert.equal(a.state.blocked, true);
});
test("a late refund response cannot replace another order even in the same store", async () => {
  const storage = memory(),
    state = {};
  let value = order(),
    resolve;
  const changes = [];
  const ctl = core.createCashRefund({
    storage,
    state,
    context: () => ({ owner: true, userId: "u", storeId: "s", order: value }),
    request: (p, o) =>
      o ? new Promise((r) => (resolve = r)) : Promise.resolve(order()),
    onOrder: (o) => changes.push(o),
  });
  state.amount = "1";
  state.reason = "原因";
  const pending = ctl.submit(true);
  value = { ...order(), id: "new-order" };
  resolve(order());
  await pending;
  assert.equal(changes.length, 0);
  assert.equal(storage.get("cash-refund:v1:u").phase, "unknown");
});
test("malformed success response remains unknown and cannot be cleared by GET", async () => {
  const a = setup({ request: async (p, o) => (o ? {} : order()) });
  a.state.amount = "1";
  a.state.reason = "原因";
  await a.ctl.submit(true);
  assert.equal(a.state.blocked, true);
  assert.equal(a.state.attempt.phase, "unknown");
  await a.ctl.load();
  assert.equal(a.state.blocked, true);
});
test("confirmed write waits for readable receipt and recovery announces success without writing again", async () => {
  let failRead = true,
    writes = 0;
  const a = setup({
    request: async (p, o) => {
      if (o) {
        writes++;
        return order();
      }
      if (failRead) throw Error("read offline");
      return order();
    },
  });
  a.state.amount = "1";
  a.state.reason = "原因";
  await a.ctl.submit(true);
  assert.equal(a.state.blocked, true);
  assert.equal(a.state.attempt.phase, "confirmed");
  failRead = false;
  await a.ctl.load();
  assert.equal(writes, 1);
  assert.equal(a.state.blocked, false);
  assert.match(a.state.notice, /已登记/);
  assert.equal(a.state.error, "");
  assert.equal(a.state.amount, "");
});
test("silent storage failure cannot send and duplicate clicks do not issue a second write", async () => {
  let calls = 0;
  const a = setup({
    storage: { get: () => undefined, set: () => {}, remove: () => {} },
    request: async () => {
      calls++;
      return order();
    },
  });
  a.state.amount = "1";
  a.state.reason = "原因";
  await a.ctl.submit(true);
  assert.equal(calls, 0);
  let resolve;
  const b = setup({
    request: (p, o) => {
      if (o) {
        calls++;
        return new Promise((r) => (resolve = r));
      }
      return Promise.resolve(order());
    },
  });
  b.state.amount = "1";
  b.state.reason = "原因";
  const first = b.ctl.submit(true);
  await b.ctl.submit(true);
  assert.equal(calls, 1);
  resolve(order());
  await first;
});
test("read-only staff can read receipts but cannot create or replay refund writes", async () => {
  let calls = 0;
  const a = setup({
    identity: { userId: "u", storeId: "s", owner: false },
    request: async (p, o) => {
      if (o) calls++;
      return order();
    },
  });
  a.state.amount = "1";
  a.state.reason = "原因";
  await a.ctl.submit(true);
  assert.equal(calls, 0);
  assert.match(a.state.error, /店主/);
  await a.ctl.load();
  assert.equal(a.changes.length, 1);
});

test('first definitive SHIFT_REQUIRED releases unsent refund without GET and preserves inputs; prior unknown stays locked', async () => {
  let reject = true;
  const request = async (p,o) => { if(o) throw reject ? Object.assign(Error('请先开班'),{status:409,code:'SHIFT_REQUIRED',requestId:'shift-r'}) : Error('lost'); throw Error('GET offline'); };
  const first=setup({request});first.state.amount='1.23';first.state.reason='原原因';await first.ctl.submit(true);
  assert.equal(first.state.blocked,false);assert.equal(first.state.attempt,null);assert.equal(first.state.amount,'1.23');assert.equal(first.state.reason,'原原因');assert.match(first.state.error,/SHIFT_REQUIRED.*shift-r/);
  reject=false;const unknown=setup({request});unknown.state.amount='1.23';unknown.state.reason='原原因';await unknown.ctl.submit(true);const original=structuredClone(unknown.state.attempt);
  reject=true;await unknown.ctl.submit(true);assert.equal(unknown.state.blocked,true);assert.deepEqual(unknown.state.attempt,original);
});
test('new refund checks active shift before persisting or writing; recovery never preflights a new shift', async () => {
  let checks=0;const r=setup({beforeNew:async()=>{checks++;throw Object.assign(Error('先开班'),{code:'SHIFT_REQUIRED',status:409});}});
  r.state.amount='1';r.state.reason='原因';await r.ctl.submit(true);assert.equal(checks,1);assert.equal(r.state.attempt,null);assert.equal(r.state.blocked,false);assert.equal(r.changes.length,0);
});
test('refund review preflight shows missing shift before asking owner to hand back cash',async()=>{
 const r=setup({beforeNew:async()=>{throw Object.assign(Error('先开班'),{code:'SHIFT_REQUIRED',status:409});}});
 assert.equal(typeof r.ctl.checkNew,'function');assert.equal(await r.ctl.checkNew(),false);assert.equal(r.state.blocked,false);assert.match(r.state.error,/SHIFT_REQUIRED/);assert.equal(r.state.busy,false);
});
test('first missing shift with failed removal retains definitive rejection for later read-only cleanup',async()=>{
 const storage=memory(),remove=storage.remove;storage.remove=()=>{};const r=setup({storage,request:async(p,o)=>{if(o)throw Object.assign(Error('先开班'),{code:'SHIFT_REQUIRED',status:409});return order();}});r.state.amount='1';r.state.reason='原因';await r.ctl.submit(true);assert.equal(r.state.blocked,true);assert.equal(r.state.attempt.phase,'rejected');storage.remove=remove;await r.ctl.load();assert.equal(r.state.blocked,false);
});
