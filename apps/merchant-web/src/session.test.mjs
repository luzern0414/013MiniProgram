import test from "node:test";
import assert from "node:assert/strict";

test("local invalidation removes session data but retains original-user uncertain cash records", async () => {
  const module = await import("./session.mjs").catch(() => ({}));
  assert.equal(typeof module.clearMerchantSession, "function", "local session cleanup is not implemented");
  const data = new Map([["merchant-token", "t"], ["merchant-store", "a"], ["merchant-active-checkout", "hint"], ["merchant-checkout:user-a:a", "pending"]]);
  module.clearMerchantSession({ removeItem: (key) => data.delete(key) });
  assert.deepEqual([...data], [["merchant-active-checkout", "hint"], ["merchant-checkout:user-a:a", "pending"]]);
});

test("logout submits token revocation before clearing locally and reports uncertain server result", async () => {
  const module = await import("./session.mjs").catch(() => ({}));
  assert.equal(typeof module.logoutMerchant, "function", "server logout is not implemented");
  const steps = [];
  const message = await module.logoutMerchant(async (path, options) => {
    steps.push([path, options]);
    throw new Error("network");
  }, () => steps.push("local-clear"));
  assert.equal(steps[0][0], "/auth/logout");
  assert.equal(steps[1], "local-clear");
  assert.match(message, /本机已退出.*未能确认/);
});

test("bad credentials and a delayed prior-session 401 cannot invalidate the current session", async () => {
  const module = await import("./session.mjs");
  assert.equal(typeof module.shouldExpireSession, "function", "session identity guard is not implemented");
  assert.equal(module.shouldExpireSession(null, null, "UNAUTHENTICATED"), false);
  assert.equal(module.shouldExpireSession("old", "new", "UNAUTHENTICATED"), false);
  assert.equal(module.shouldExpireSession("same", "same", "UNAUTHENTICATED"), true);
});
