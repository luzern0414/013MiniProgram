import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/index.mjs";

test("staff credentials normalize only the account and use the configured public brand", () => {
  assert.equal(typeof core.staffLoginPayload, "function", "staff login payload is not implemented");
  const password = "  keep spaces  ";
  assert.deepEqual(core.staffLoginPayload({ brandId: "actual-brand" }, "  TEAM.A  ", password),
    { brandId: "actual-brand", account: "team.a", password });
  assert.throws(() => core.staffLoginPayload({}, "team.a", password), /门店配置/);
  assert.throws(() => core.staffLoginPayload({ brandId: "b" }, "坏账号", password), /账号/);
});

test("staff creation deduplicates grants, requires current store, and preserves exact password", () => {
  assert.equal(typeof core.staffCreatePayload, "function", "staff creation validation is not implemented");
  const form = { name: "  小林  ", account: " TEAM.A ", password: "  keep spaces  ", storeIds: ["a", "b", "a"] };
  assert.deepEqual(core.staffCreatePayload("a", form), { storeId: "a", name: "小林", account: "team.a", password: form.password, storeIds: ["a", "b"] });
  assert.throws(() => core.staffCreatePayload("c", form), /当前门店/);
});

test("staff edits retain revision and version conflicts require a fresh record before resubmit", () => {
  assert.equal(typeof core.staffEditPayload, "function", "staff revision editing is not implemented");
  assert.deepEqual(core.staffEditPayload("a", { revision: 7 }, { name: "新姓名", storeIds: ["b"] }),
    { storeId: "a", expectedRevision: 7, name: "新姓名", storeIds: ["b"] });
  assert.equal(core.staffConflict({ code: "VERSION_CONFLICT" }), true);
  assert.equal(core.staffConflict({ code: "ACCOUNT_CONFLICT" }), false);
  assert.match(core.staffErrorText({ code: "VERSION_CONFLICT", requestId: "trace-1" }), /重新加载.*trace-1/);
  assert.match(core.staffErrorText({ code: "RATE_LIMITED" }), /稍后/);
});

test("a stale editor cannot retry writes until explicitly reloading the latest staff revision", async () => {
  assert.equal(typeof core.createStaffController, "function", "staff controller is not implemented");
  const state = {};
  let calls = 0;
  const controller = core.createStaffController({ state, storeId: () => "a", request: async (path, options) => {
    if (!options) return [{ id: "one", role: "CLERK", name: "最新姓名", revision: 3, storeIds: ["a"] }];
    calls++;
    throw { code: "VERSION_CONFLICT", requestId: "trace" };
  } });
  controller.open({ id: "one", role: "CLERK", name: "旧姓名", revision: 2, storeIds: ["a"] });
  assert.equal(await controller.save(), false);
  assert.equal(state.conflict, true);
  assert.equal(await controller.save(), false);
  assert.equal(calls, 1);
  await controller.reloadEditor();
  assert.equal(state.conflict, false);
  assert.equal(state.target.revision, 3);
  assert.equal(state.form.name, "最新姓名");
});

test("an anonymous login 401 and a delayed old-token response cannot clear a newer session", async () => {
  let token = "", expired = 0, respond;
  const transport = core.createTransport({ baseUrl: "http://test", token: () => token, onUnauthorized: () => expired++, request: () => new Promise(resolve => { respond = resolve; }) });
  const reject = () => respond({ statusCode: 401, data: { error: { code: 'UNAUTHENTICATED', message: '账号或密码不正确' } } });
  let pending = transport('/auth/staff-login');
  reject();
  await assert.rejects(pending);
  assert.equal(expired, 0);
  token = 'old';
  pending = transport('/me');
  token = 'new';
  reject();
  await assert.rejects(pending);
  assert.equal(expired, 0);
});
