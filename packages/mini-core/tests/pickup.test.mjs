import test from "node:test";
import assert from "node:assert/strict";
const p = await import("../src/pickup.mjs").catch(() => ({}));
const slot = {
  id: "s",
  startsAt: "2026-10-21T04:00:00.000Z",
  endsAt: "2026-10-21T04:30:00.000Z",
  timezone: "Asia/Shanghai",
  remaining: 2,
};
const error = (code) =>
  Object.assign(new Error("failure"), { code, requestId: "rid" });
test("changing slot clears quote but a missing old slot remains selected", async () => {
  assert.equal(typeof p.createPickupSelection, "function");
  let clears = 0;
  const state = {};
  const ctl = p.createPickupSelection({
    state,
    storeId: () => "store",
    request: async () => [],
    onChange: () => clears++,
  });
  ctl.select(slot);
  assert.equal(clears, 1);
  assert.equal(state.slotId, "s");
  await ctl.load();
  assert.equal(state.slotId, "s");
  assert.deepEqual(state.selected, slot);
  assert.throws(() => ctl.quoteFields(), /重新选择/);
  ctl.select(null);
  assert.deepEqual(ctl.quoteFields(), {});
  assert.equal(clears, 3);
});
test("frozen checkout cannot silently change selection", () => {
  assert.equal(typeof p.createPickupSelection, "function");
  const state = {};
  let locked = false;
  const ctl = p.createPickupSelection({
    state,
    storeId: () => "store",
    request: async () => [slot],
    locked: () => locked,
  });
  ctl.select(slot);
  locked = true;
  ctl.select(null);
  assert.equal(state.slotId, "s");
});
test("slot preview enforces Shanghai dates, duration, count and complete intervals", () => {
  assert.equal(typeof p.pickupPreview, "function");
  assert.deepEqual(
    p.pickupPreview({
      date: "2026-10-21",
      start: "12:00",
      end: "13:00",
      interval: "30",
      capacity: "2",
    }),
    [
      {
        startsAt: "2026-10-21T12:00:00+08:00",
        endsAt: "2026-10-21T12:30:00+08:00",
        capacity: 2,
      },
      {
        startsAt: "2026-10-21T12:30:00+08:00",
        endsAt: "2026-10-21T13:00:00+08:00",
        capacity: 2,
      },
    ],
  );
  for (const values of [
    { date: "2026-02-30" },
    { interval: 4 },
    { interval: 241 },
    { end: "12:45" },
    { capacity: 0 },
    { capacity: 1001 },
    { end: "11:00" },
  ])
    assert.throws(() =>
      p.pickupPreview({
        date: "2026-10-21",
        start: "12:00",
        end: "13:00",
        interval: 30,
        capacity: 2,
        ...values,
      }),
    );
  assert.throws(
    () =>
      p.pickupPreview({
        date: "2026-10-21",
        start: "00:00",
        end: "23:55",
        interval: 5,
        capacity: 1,
      }),
    /96/,
  );
  assert.match(p.pickupWindowText(slot), /2026-10-21.*12:00.*12:30/);
  assert.equal(p.pickupWindowText(null), "尽快取餐");
});
function management(fail) {
  const state = {},
    calls = [];
  let failure = fail;
  const request = async (path, options) => {
    calls.push({ path, options });
    if (options) throw error(failure);
    if (failure === "READ_FAIL") throw error("NETWORK_ERROR");
    return path.includes("policy")
      ? { revision: 0, enabled: false, leadMinutes: 15, maxAdvanceDays: 14 }
      : [];
  };
  const ctl = p.createPickupManager({ state, storeId: () => "store", request });
  return { state, calls, ctl, setFailure: (value) => (failure = value) };
}
test("configuration conflict requires successful reread before another write", async () => {
  assert.equal(typeof p.createPickupManager, "function");
  const { state, calls, ctl, setFailure } = management("STATE_CONFLICT");
  await ctl.load();
  state.policy.enabled = true;
  await ctl.savePolicy();
  assert.equal(state.blocked, true);
  await ctl.savePolicy();
  assert.equal(calls.filter((c) => c.options).length, 1);
  setFailure("READ_FAIL");
  await ctl.load();
  assert.equal(state.blocked, true);
  assert.equal(state.policy.enabled, true);
  setFailure("");
  await ctl.load();
  assert.equal(state.blocked, false);
  assert.equal(state.previousDraft.policy.enabled, true);
});
test("unknown batch creation retains exact preview and cannot resend", async () => {
  assert.equal(typeof p.createPickupManager, "function");
  const { state, calls, ctl } = management("TIMEOUT");
  await ctl.load();
  state.preview = [
    {
      startsAt: "2026-10-21T12:00:00+08:00",
      endsAt: "2026-10-21T12:30:00+08:00",
      capacity: 2,
    },
  ];
  const sent = structuredClone(state.preview);
  await ctl.createSlots();
  await ctl.createSlots();
  assert.equal(calls.filter((c) => c.options).length, 1);
  assert.deepEqual(state.preview, sent);
  assert.equal(state.blocked, true);
  assert.match(state.error, /rid/);
  assert.match(state.error, /核对/);
});
test("read-only and disposed controllers never write or apply late results", async () => {
  assert.equal(typeof p.createPickupManager, "function");
  let resolve;
  const state = {};
  const ctl = p.createPickupManager({
    state,
    storeId: () => "s",
    canEdit: () => false,
    request: () => new Promise((r) => (resolve = r)),
  });
  const task = ctl.load();
  ctl.dispose();
  resolve({});
  await task;
  assert.equal(state.policy, null);
  assert.equal(await ctl.savePolicy(), false);
});
test("booking rejections are definitive, transport and permissions preserve pending recovery", () => {
  assert.equal(typeof p.isPickupRejection, "function");
  for (const code of [
    "PICKUP_SLOT_FULL",
    "PICKUP_RULES_CHANGED",
    "PICKUP_TIME_UNAVAILABLE",
  ])
    assert.equal(p.isPickupRejection({ code }), true);
  for (const code of ["TIMEOUT", "FORBIDDEN", "STATE_CONFLICT"])
    assert.equal(p.isPickupRejection({ code }), false);
  assert.match(p.pickupErrorText(error("PICKUP_SLOT_FULL")), /名额.*rid/);
});
test("redemption submits entered number once then rereads actual order", async () => {
  assert.equal(typeof p.createPickupRedemption, "function");
  const state = {},
    calls = [];
  let unlock;
  const actual = { id: "o", status: "COMPLETED" };
  const ctl = p.createPickupRedemption({
    state,
    storeId: () => "s",
    orderId: () => "o",
    request: async (path, opt) => {
      calls.push({ path, opt });
      if (opt) await new Promise((r) => (unlock = r));
      return actual;
    },
  });
  state.number = "AABBCC1234";
  const saving = ctl.submit();
  await ctl.submit();
  assert.equal(calls.length, 1);
  unlock();
  await saving;
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, "/merchant/orders/o/pickup");
  assert.deepEqual(calls[0].opt.data, {
    storeId: "s",
    pickupNumber: "AABBCC1234",
  });
  assert.equal(state.order, actual);
});
test("unknown redemption cannot resend before a successful read", async () => {
  assert.equal(typeof p.createPickupRedemption, "function");
  const state = {};
  let posts = 0;
  const ctl = p.createPickupRedemption({
    state,
    storeId: () => "s",
    orderId: () => "o",
    request: async (path, opt) => {
      if (opt) {
        posts++;
        throw error("TIMEOUT");
      }
      return { id: "o", status: "COMPLETED" };
    },
  });
  state.number = "Q0001";
  await ctl.submit();
  await ctl.submit();
  assert.equal(posts, 1);
  assert.equal(state.blocked, true);
  await ctl.load();
  assert.equal(state.order.status, "COMPLETED");
  assert.equal(state.blocked, false);
});

test("recovered unknown batch keeps comparison draft and requires a new preview", async () => {
  const { state, ctl, setFailure } = management("TIMEOUT");
  await ctl.load();
  state.preview = [
    {
      startsAt: "2026-10-21T12:00:00+08:00",
      endsAt: "2026-10-21T12:30:00+08:00",
      capacity: 2,
    },
  ];
  await ctl.createSlots();
  setFailure("");
  await ctl.load();
  assert.deepEqual(state.preview, []);
  assert.equal(state.previousDraft.preview.length, 1);
});

test("pickup search requests exact authorized match pages and ignores results after scope disposal", async () => {
  assert.equal(typeof p.createPickupSearch, "function");
  const state = {},
    calls = [];
  const ctl = p.createPickupSearch({
    state,
    storeId: () => "store",
    request: async (path) => {
      calls.push(path);
      const query = new URL(path, "http://local").searchParams;
      assert.equal(query.get("storeId"), "store");
      assert.equal(query.get("pickupNumber"), "Q0001");
      assert.equal(query.get("pickupServiceDate"), "2026-10-21");
      return path.includes("page=1&")
        ? { items: Array.from({ length: 100 }, (_, i) => ({ id: `match-${i}`, pickupNumber: "Q0001" })), total: 101, page: 1, pageSize: 100 }
        : {
            items: [
              {
                id: "wanted",
                pickupNumber: "Q0001",
                pickupServiceDate: "2026-10-21",
              },
            ],
            total: 101, page: 2, pageSize: 100,
          };
    },
  });
  state.number = " q0001 ";
  state.date = "2026-10-21";
  await ctl.search();
  assert.equal(calls.length, 2);
  assert.deepEqual(
    state.items.map((x) => x.id),
    [...Array.from({ length: 100 }, (_, i) => `match-${i}`), "wanted"],
  );
  assert.equal(state.complete, true);
  let finish;
  const late = {};
  const abandoned = p.createPickupSearch({
    state: late,
    storeId: () => "s",
    request: () => new Promise((r) => (finish = r)),
  });
  late.number = "Q0001";
  const task = abandoned.search();
  abandoned.dispose();
  finish({ items: [{ pickupNumber: "Q0001" }], total: 1 });
  await task;
  assert.deepEqual(late.items, []);
});
test("pickup search failure never labels partial results complete", async () => {
  assert.equal(typeof p.createPickupSearch, "function");
  const state = {};
  let reads = 0;
  const ctl = p.createPickupSearch({
    state,
    storeId: () => "s",
    request: async () => {
      if (++reads === 2) throw error("TIMEOUT");
      return {
        items: Array.from({ length: 100 }, (_, i) => ({ id: `o${i}`, pickupNumber: "Q0001" })),
        total: 101, page: 1, pageSize: 100,
      };
    },
  });
  state.date = "2026-10-21";
  state.number = "Q0001";
  await ctl.search();
  assert.equal(state.complete, false);
  assert.equal(state.items.length, 0);
  assert.match(state.error, /rid/);
});

test("read-only manager reads records but sends no configuration writes", async () => {
  const state = {},
    writes = [];
  const ctl = p.createPickupManager({
    state,
    storeId: () => "s",
    canEdit: () => false,
    request: async (path, opt) => {
      if (opt) writes.push(opt);
      return path.includes("policy")
        ? { revision: 1, enabled: true, leadMinutes: 15, maxAdvanceDays: 14 }
        : [];
    },
  });
  await ctl.load();
  await ctl.savePolicy();
  state.preview = [{}];
  await ctl.createSlots();
  assert.equal(writes.length, 0);
});
test("successful configuration write whose confirmation read fails stays blocked with original draft", async () => {
  const state = {};
  let wrote = false,
    failed = true;
  const ctl = p.createPickupManager({
    state,
    storeId: () => "s",
    request: async (path, opt) => {
      if (opt) {
        wrote = true;
        return {};
      }
      if (wrote && failed) throw error("NETWORK_ERROR");
      return path.includes("policy")
        ? {
            revision: wrote ? 2 : 1,
            enabled: wrote,
            leadMinutes: 15,
            maxAdvanceDays: 14,
          }
        : [];
    },
  });
  await ctl.load();
  state.policy.enabled = true;
  await ctl.savePolicy();
  assert.equal(state.blocked, true);
  assert.equal(state.policy.enabled, true);
  assert.equal(state.previousDraft.policy.enabled, true);
  failed = false;
  await ctl.load();
  assert.equal(state.blocked, false);
  assert.equal(state.policy.revision, 2);
});
test("search ignores more than 2000 unrelated historical orders through the exact predicate", async () => {
  const state = {};
  let calls = 0;
  const ctl = p.createPickupSearch({
    state,
    storeId: () => "s",
    request: async (path) => {
      calls++;
      const query = new URL(path, "http://local").searchParams;
      return query.get("pickupNumber") === "Q10000"
        ? { total: 1, items: [{ id: "target", pickupNumber: "Q10000" }], page: 1, pageSize: 100 }
        : { total: 2001, items: [] };
    },
  });
  state.number = "Q10000";
  await ctl.search();
  assert.equal(calls, 1);
  assert.equal(state.complete, true);
  assert.deepEqual(state.items.map(x => x.id), ["target"]);
});

test("search rejects incomplete matches, incomplete numbers and late responses after clear or store change", async () => {
  for (const result of [{ total: 2, items: [{ id: "partial" }], page: 1, pageSize: 100 }, { total: 0, items: [] }]) {
    const state = {};
    const ctl = p.createPickupSearch({ state, storeId: () => "s", request: async () => result });
    state.number = "ABCDEF1234";
    assert.equal(await ctl.search(), false);
    assert.equal(state.complete, false);
    assert.deepEqual(state.items, []);
    assert.match(state.error, /不完整/);
  }
  for (const number of ["Q001", "AB12", "Q1234 OR 1=1"]) {
    const state = {};
    let calls = 0;
    const ctl = p.createPickupSearch({ state, storeId: () => "s", request: async () => { calls++; } });
    state.number = number;
    assert.equal(await ctl.search(), false);
    assert.equal(calls, 0);
  }
  for (const kind of ["clear", "store"]) {
    const state = {};
    let store = "a", finish;
    const ctl = p.createPickupSearch({ state, storeId: () => store, request: () => new Promise(r => { finish = r; }) });
    state.number = "Q0001";
    const pending = ctl.search();
    if (kind === "clear") ctl.clear(); else store = "b";
    finish({ total: 1, items: [{ id: "late" }], page: 1, pageSize: 100 });
    assert.equal(await pending, false);
    assert.deepEqual(state.items, []);
    assert.equal(state.complete, false);
  }
});

test("availability reread clears a stale quote without replacing its selected reservation", async () => {
  const state = {};
  let live = [
      {
        id: "s",
        startsAt: "2026-10-21T04:00:00Z",
        endsAt: "2026-10-21T04:30:00Z",
      },
    ],
    quote = "q";
  const ctl = p.createPickupSelection({
    state,
    storeId: () => "s",
    request: async () => live,
    onChange: () => {
      quote = null;
    },
  });
  await ctl.load();
  ctl.select(live[0]);
  quote = "q";
  live = [];
  await ctl.load();
  assert.equal(quote, null);
  assert.equal(state.slotId, "s");
});

test("unrecognized server write error conservatively blocks batch resubmission", async () => {
  const { state, ctl, calls } = management("NEW_SERVER_FAILURE");
  await ctl.load();
  state.preview = [
    {
      startsAt: "2026-10-21T12:00:00+08:00",
      endsAt: "2026-10-21T12:30:00+08:00",
      capacity: 2,
    },
  ];
  await ctl.createSlots();
  await ctl.createSlots();
  assert.equal(state.blocked, true);
  assert.equal(calls.filter((c) => c.options).length, 1);
});
