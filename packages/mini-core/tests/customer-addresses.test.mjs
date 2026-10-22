import test from "node:test";
import assert from "node:assert/strict";
import {
  addressStorageKey,
  createCustomerAddresses,
  readAddressAttempt,
  validAddress,
} from "../src/customer-addresses.mjs";

const fields = {
  name: "收货人",
  phone: "13800000000",
  region: "上海市浦东新区",
  detail: "梧桐路 88 号 1 室",
  point: null,
  isDefault: true,
};
const address = (overrides = {}) => ({
  id: "address-1",
  name: "收货人",
  phone: "13800000000",
  region: "上海市浦东新区",
  detail: "梧桐路 88 号 1 室",
  point: null,
  isDefault: false,
  revision: 0,
  deletedAt: null,
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
  ...overrides,
});
const listResult = (items = [], bookRevision = 0) => ({
  items,
  bookRevision,
  limit: 20,
});
const writeResult = ({
  kind,
  value,
  addressRevision = value.revision,
  bookRevision = 1,
  replayed = false,
}) => ({
  operation: {
    kind,
    addressId: value.id,
    addressRevision,
    bookRevision,
    succeededAt: "2026-10-21T00:01:00.000Z",
  },
  address: value,
  bookRevision,
  replayed,
});
const apiError = (code, status = 409, requestId = "request-red") =>
  Object.assign(Error(code), { code, status, requestId });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

class MemoryStorage {
  constructor(values = new Map()) {
    this.values = values;
    this.mode = "";
  }
  get(key) {
    if (this.mode === "read-throw") throw Error("read failed");
    return this.values.get(key);
  }
  set(key, value) {
    if (this.mode === "set-throw") throw Error("quota");
    if (this.mode !== "silent-set")
      this.values.set(key, structuredClone(value));
  }
  remove(key) {
    if (this.mode !== "silent-remove") this.values.delete(key);
  }
}
const make = (options = {}) => {
  const storage = options.storage || new MemoryStorage();
  const context = { userId: "customer-1", identity: "session-generation-1" };
  const calls = [];
  const ctl = createCustomerAddresses({
    state: options.state || {},
    storage,
    context: () => (options.context ? options.context(context) : context),
    request: async (path, requestOptions) => {
      calls.push({ path, options: structuredClone(requestOptions || {}) });
      return options.request(path, requestOptions);
    },
    key: () => "address-original-key",
    locked: options.locked || (() => false),
  });
  return { ctl, storage, context, calls, state: ctl.state };
};

test("address recovery distinguishes missing storage from empty, null and damaged records", async () => {
  const missing = new MemoryStorage();
  assert.deepEqual(readAddressAttempt(missing, "customer-1"), {
    attempt: null,
    error: "",
  });
  for (const value of ["", null, "{damaged", { schemaVersion: 1 }]) {
    const storage = new MemoryStorage(new Map([[addressStorageKey("customer-1"), value]]));
    const found = readAddressAttempt(storage, "customer-1");
    assert.equal(found.attempt, null);
    assert.match(found.error, /恢复记录无法读取/);
    const env = make({
      storage,
      request: async () => {
        throw Error("must not read");
      },
    });
    assert.equal(env.state.blocked, true);
    assert.equal(env.state.corrupt, true);
    assert.match(env.state.error, /恢复记录无法读取/);
  }
});

test("storage set/readback failure locks before POST and keeps the exact raw attempt", async () => {
  for (const mode of ["set-throw", "silent-set", "read-throw"]) {
    const storage = new MemoryStorage();
    if (mode === "read-throw") {
      const originalGet = storage.get.bind(storage);
      storage.get = (key) => {
        if (storage.writes) throw Error("readback failed");
        return originalGet(key);
      };
      const originalSet = storage.set.bind(storage);
      storage.set = (key, value) => {
        storage.writes = true;
        return originalSet(key, value);
      };
    }
    storage.mode = mode === "read-throw" ? "" : mode;
    const env = make({
      storage,
      request: async () => {
        throw Error("POST was sent");
      },
    });
    const accepted = await env.ctl.create(fields);
    assert.equal(accepted, false, mode);
    assert.equal(env.calls.length, 0, mode);
    assert.equal(env.state.blocked, true, mode);
    assert.match(env.state.error, /储存|保存/, mode);
  }
});

test("unknown write retains original key and body across reload and same-identity relogin until explicit replay", async () => {
  let mode = "network";
  const replayValue = address({ revision: 0 });
  const request = async (path, options = {}) => {
    if (mode === "network")
      throw Object.assign(Error("offline"), { code: "NETWORK_ERROR" });
    if (mode === "read-403") throw apiError("FORBIDDEN", 403, "read-denied");
    if (path === "/customer/addresses" && options.method === undefined)
      return listResult();
    if (mode === "replay-409") throw apiError("ADDRESS_CHANGED", 409, "replay-changed");
    return writeResult({ kind: "CREATE", value: replayValue });
  };
  const env = make({ request });
  env.state.bookRevision = 0;
  assert.equal(await env.ctl.create(fields), false);
  const savedRaw = structuredClone(env.storage.values.get(addressStorageKey("customer-1")));
  assert.deepEqual(savedRaw, {
    schemaVersion: 1,
    userId: "customer-1",
    kind: "CREATE",
    addressId: null,
    key: "address-original-key",
    method: "POST",
    path: "/customer/addresses",
    body: { expectedBookRevision: 0, ...fields },
  });
  assert.equal(env.calls[0].options.headers["Idempotency-Key"], "address-original-key");
  assert.deepEqual(env.calls[0].options.data, savedRaw.body);

  mode = "read-403";
  assert.equal(await env.ctl.recover("read"), false);
  assert.equal(env.state.blocked, true);
  assert.deepEqual(env.storage.values.get(addressStorageKey("customer-1")), savedRaw);

  mode = "replay-409";
  assert.equal(await env.ctl.recover("replay"), false);
  assert.equal(env.state.blocked, true);
  assert.deepEqual(env.storage.values.get(addressStorageKey("customer-1")), savedRaw);

  const relogged = make({ storage: env.storage, request });
  assert.deepEqual(relogged.state.pending, savedRaw);
  mode = "success";
  const before = relogged.calls.length;
  assert.equal(await relogged.ctl.recover("replay"), true);
  assert.equal(relogged.calls.length, before + 2);
  const replayCall = relogged.calls.at(-2);
  assert.equal(replayCall.path, savedRaw.path);
  assert.equal(replayCall.options.method, savedRaw.method);
  assert.equal(replayCall.options.headers["Idempotency-Key"], savedRaw.key);
  assert.deepEqual(replayCall.options.data, savedRaw.body);
  assert.equal(relogged.calls.at(-1).path, "/customer/addresses");
  assert.equal(relogged.storage.values.has(addressStorageKey("customer-1")), false);
});

test("same-account new session, another account and dispose cannot publish late write results", async () => {
  const pending = deferred();
  const env = make({ request: () => pending.promise });
  const writing = env.ctl.create(fields);
  env.context.identity = "session-generation-2";
  pending.resolve(writeResult({ kind: "CREATE", value: address() }));
  assert.equal(await writing, false);
  assert.equal(env.state.items.length, 0);
  assert.ok(env.storage.values.has(addressStorageKey("customer-1")));

  const untouched = env.storage.values.get(addressStorageKey("customer-1"));
  const other = make({
    storage: env.storage,
    context: () => ({ userId: "customer-2", identity: "session-other" }),
    request: async () => listResult(),
  });
  assert.equal(other.state.pending, null);
  assert.equal(other.state.blocked, false);
  assert.equal(other.storage.values.get(addressStorageKey("customer-1")), untouched);

  const disposal = deferred();
  const disposable = make({ request: () => disposal.promise });
  const late = disposable.ctl.create(fields);
  disposable.ctl.dispose();
  disposal.resolve(writeResult({ kind: "CREATE", value: address() }));
  assert.equal(await late, false);
  assert.equal(disposable.state.items.length, 0);
  assert.equal(disposable.state.form.name, "");
  assert.equal(disposable.state.pending, null);
  assert.ok(disposable.storage.values.has(addressStorageKey("customer-1")));
});

test("explicit first CAS conflict clears only that attempt, preserves the form and waits for explicit reread", async () => {
  const current3 = address({ id: "address-1", revision: 2, name: "服务器最新姓名" });
  let updateCount = 0;
  const request = async (path, options = {}) => {
    if (path === "/customer/addresses") return listResult([address({ revision: 1 })], 2);
    if (path === "/customer/addresses/address-1" && !options.method)
      return { address: current3, bookRevision: 3 };
    if (path === "/customer/addresses/address-1" && options.method === "PUT") {
      updateCount++;
      if (updateCount === 1) throw apiError("ADDRESS_CHANGED", 409, "address-cas");
      return writeResult({
        kind: "UPDATE",
        value: address({ ...current3, revision: 3, name: "本地保留姓名" }),
        addressRevision: 3,
        bookRevision: 4,
      });
    }
    throw Error(path);
  };
  const env = make({ request });
  await env.ctl.load();
  env.ctl.beginEdit(env.state.items[0]);
  env.state.form.name = "本地保留姓名";
  assert.equal(await env.ctl.update(), false);
  assert.equal(env.storage.values.has(addressStorageKey("customer-1")), false);
  assert.equal(env.state.form.name, "本地保留姓名");
  assert.equal(env.state.review, true);
  assert.equal(env.state.blocked, false);
  assert.match(env.state.error, /address-cas/);

  assert.equal(await env.ctl.reloadForReview(), true);
  assert.equal(env.state.form.name, "本地保留姓名");
  assert.equal(env.state.reviewReady, true);
  assert.equal(env.state.reviewAddress.revision, 2);
  assert.equal(env.state.form.expectedRevision, 1, "reread must not overwrite the draft revision without confirmation");

  env.ctl.acceptReview();
  assert.equal(env.state.form.expectedBookRevision, 3);
  assert.equal(env.state.form.expectedRevision, 2);
  assert.equal(await env.ctl.update(), true);
  assert.equal(updateCount, 2);
  const body = env.calls.find((call) => call.path === "/customer/addresses/address-1" && call.options.method === "PUT" && call.options.data.expectedRevision === 2).options.data;
  assert.deepEqual(body, {
    expectedBookRevision: 3,
    expectedRevision: 2,
    name: "本地保留姓名",
    phone: fields.phone,
    region: fields.region,
    detail: fields.detail,
    point: null,
    isDefault: false,
  });
});

test("first validation, capacity and deleted rejections remove only the uncommitted attempt and retain input", async () => {
  for (const [code, status, review] of [
    ["VALIDATION_ERROR", 400, false],
    ["ADDRESS_LIMIT", 409, false],
    ["ADDRESS_DELETED", 409, true],
  ]) {
    const env = make({
      request: async () => {
        throw apiError(code, status, code + "-request");
      },
    });
    env.state.form = { ...fields, name: "保留输入" };
    assert.equal(await env.ctl.create(), false, code);
    assert.equal(env.storage.values.has(addressStorageKey("customer-1")), false, code);
    assert.equal(env.state.form.name, "保留输入", code);
    assert.equal(env.state.blocked, false, code);
    assert.equal(env.state.review, review, code);
    assert.match(env.state.error, new RegExp(code + "-request"), code);
  }
});

test("delete success with failed storage removal readback remains locked instead of pretending recovery is complete", async () => {
  const deleted = address({
    revision: 1,
    deletedAt: "2026-10-21T00:01:00.000Z",
    isDefault: false,
  });
  const env = make({
    request: async (path, options) => {
      if (path === "/customer/addresses/address-1/delete")
        return writeResult({ kind: "DELETE", value: deleted, bookRevision: 1 });
      if (path === "/customer/addresses") return listResult([], 1);
      throw Error(path);
    },
  });
  env.state.bookRevision = 0;
  env.storage.mode = "silent-remove";
  assert.equal(await env.ctl.remove(address({ revision: 0 })), false);
  assert.equal(env.state.blocked, true);
  assert.ok(env.state.pending);
  assert.ok(env.storage.values.has(addressStorageKey("customer-1")));
  assert.match(env.state.error, /清理|恢复记录/);
});

test("valid address rejects GCJ labels, non-integer/string microdegrees, extensions and malformed timestamps", async () => {
  const goodPoint = {
    system: "WGS84",
    latitudeE6: 31230000,
    longitudeE6: 121470000,
    source: "DEVICE",
    confirmedAt: "2026-10-21T00:00:00.000Z",
  };
  assert.equal(validAddress(address({ point: goodPoint })), true);
  for (const point of [
    { ...goodPoint, system: "GCJ-02" },
    { ...goodPoint, latitudeE6: "31" },
    { ...goodPoint, latitudeE6: 1.5 },
    { ...goodPoint, longitudeE6: Infinity },
    { ...goodPoint, confirmedAt: "2026-10-21T00:00:00Z" },
    { ...goodPoint, extra: true },
  ])
    assert.equal(validAddress(address({ point })), false);
  assert.equal(validAddress({ ...address(), userId: "private" }), false);
});

test("validated success rereads the server; malformed responses stay recoverable and unpublished", async () => {
  const value = address({ revision: 0 });
  const requests = [];
  const env = make({
    request: async (path, options) => {
      requests.push(path);
      if (path === "/customer/addresses" && options.method === undefined)
        return listResult([value], 1);
      return writeResult({ kind: "CREATE", value, bookRevision: 1 });
    },
  });
  assert.equal(await env.ctl.create(fields), true);
  assert.deepEqual(env.state.items, [value]);
  assert.equal(env.state.bookRevision, 1);
  assert.equal(requests.at(-1), "/customer/addresses");

  const malformed = make({
    request: async () => ({
      operation: { kind: "CREATE" },
      address: value,
      bookRevision: 1,
      replayed: false,
    }),
  });
  assert.equal(await malformed.ctl.create(fields), false);
  assert.equal(malformed.state.blocked, true);
  assert.equal(malformed.state.items.length, 0);
  assert.ok(malformed.storage.values.has(addressStorageKey("customer-1")));
});

test("replayed prior operation publishes current deleted facts and states that later changes occurred", async () => {
  const deleted = address({
    revision: 2,
    deletedAt: "2026-10-21T01:00:00.000Z",
  });
  let replay = false;
  const request = async (path, options = {}) => {
    if (path === "/customer/addresses" && options.method === undefined)
      return listResult([]);
    if (!replay) {
      replay = true;
      throw Object.assign(Error("offline"), { code: "NETWORK_ERROR" });
    }
    return writeResult({
      kind: "UPDATE",
      value: deleted,
      addressRevision: 1,
      bookRevision: 2,
      replayed: true,
    });
  };
  const env = make({ request });
  env.state.bookRevision = 1;
  env.state.form = { ...fields, expectedBookRevision: 1, expectedRevision: 0 };
  assert.equal(await env.ctl.update("address-1", env.state.form, { id: "address-1", revision: 0 }), false);
  assert.equal(await env.ctl.recover("replay"), true);
  assert.equal(env.state.pending, null);
  assert.equal(env.state.blocked, false);
  assert.match(env.state.notice, /原操作已完成.*之后有变更/);
  assert.doesNotMatch(env.state.notice, /刚刚保存|已保存成功/);
  assert.equal(env.state.latestAddress.deletedAt, deleted.deletedAt);
  assert.equal(env.state.latestAddress.revision, 2);
});


test("replay rejects forged operation versions that are not bound to the original expected revisions", async () => {
  for (const scenario of [
    {
      kind: "CREATE",
      body: { expectedBookRevision: 3, ...fields },
      response: {
        operation: {
          kind: "CREATE",
          addressId: "address-1",
          addressRevision: 0,
          bookRevision: 5,
          succeededAt: "2026-10-21T00:01:00.000Z",
        },
        address: address({ revision: 0 }),
        bookRevision: 5,
        replayed: true,
      },
    },
    {
      kind: "UPDATE",
      body: { expectedBookRevision: 3, expectedRevision: 2, ...fields },
      response: {
        operation: {
          kind: "UPDATE",
          addressId: "address-1",
          addressRevision: 4,
          bookRevision: 4,
          succeededAt: "2026-10-21T00:01:00.000Z",
        },
        address: address({ revision: 4 }),
        bookRevision: 4,
        replayed: true,
      },
    },
  ]) {
    let count = 0;
    const env = make({
      request: async () => {
        count++;
        if (count === 1) throw Object.assign(Error("offline"), { code: "NETWORK_ERROR" });
        return structuredClone(scenario.response);
      },
    });
    if (scenario.kind === "CREATE") {
      env.state.bookRevision = 3;
      assert.equal(await env.ctl.create(fields), false);
    } else {
      env.state.bookRevision = 3;
      assert.equal(
        await env.ctl.update(
          "address-1",
          { ...fields, expectedBookRevision: 3, expectedRevision: 2 },
          { id: "address-1", revision: 2 },
        ),
        false,
      );
    }
    const pending = structuredClone(env.storage.values.get(addressStorageKey("customer-1")));
    assert.equal(await env.ctl.recover("replay"), false, scenario.kind);
    assert.equal(env.state.blocked, true, scenario.kind);
    assert.ok(env.state.pending, scenario.kind);
    assert.deepEqual(env.storage.values.get(addressStorageKey("customer-1")), pending, scenario.kind);
    assert.doesNotMatch(env.state.notice, /已完成|已保存/, scenario.kind);
  }
});
