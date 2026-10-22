import test from "node:test";
import assert from "node:assert/strict";
import { useMerchant } from "../../../apps/merchant-mini/src/merchant.js";
function runtime() {
  const storage = new Map(), listeners = new Map(), requests = [];
  const user = { id: "staff-one", role: "CLERK", name: "小林", storeIds: ["a"] };
  globalThis.uni = {
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
    $on: (name, fn) => listeners.set(name, fn), $emit: name => listeners.get(name)?.(),
    request(options) {
      const path = new URL(options.url).pathname.replace('/api/v1', '');
      requests.push({ path, data: options.data, header: options.header });
      const success = data => queueMicrotask(() => options.success({ statusCode: 200, data: { data } }));
      if (path === '/public-config') return success({ brandId: 'real-brand', environment: 'development' });
      if (path === '/stores') return success([{ id: 'a', name: '甲店' }]);
      if (path === '/auth/staff-login') return success({ token: 'test-session', user });
      if (path === '/merchant/overview') return success({});
      if (path === '/merchant/products') return success({ categories: [], products: [] });
      if (path === '/orders') return success({ items: [], total: 0 });
      if (path === '/auth/logout') return queueMicrotask(() => options.fail({ errMsg: 'network' }));
      throw new Error(path);
    },
  };
  return { storage, requests };
}
test('merchant staff login uses public brand and never stores password; expiration keeps original cash attempt', async () => {
  const { storage, requests } = runtime(), merchant = useMerchant();
  await merchant.init();
  assert.equal(typeof merchant.staffLogin, 'function', 'staff credential login is not implemented');
  await merchant.staffLogin(' TEAM.A ', '  keep spaces  ');
  assert.deepEqual(requests.find(r => r.path === '/auth/staff-login').data, { brandId: 'real-brand', account: 'team.a', password: '  keep spaces  ' });
  assert.equal(JSON.stringify([...storage.values()]).includes('keep spaces'), false);
  storage.set('cash-attempt:v1:staff-one', { orderId: 'uncertain' });
  merchant.order.value = { id: 'private' };
  uni.$emit('session-expired');
  assert.equal(merchant.user.value, null);
  assert.equal(merchant.order.value, null);
  assert.equal(storage.has('cash-attempt:v1:staff-one'), true);
  assert.equal(requests.some(r => r.path === '/auth/logout'), false);
});
test('merchant logout revokes token then clears immediately, retaining uncertainty and reporting unknown revocation', async () => {
  const { storage, requests } = runtime(), merchant = useMerchant();
  await merchant.init();
  storage.set('session:merchant', { token: 'test-token' });
  storage.set('cash-attempt:v1:staff-one', { orderId: 'uncertain' });
  merchant.user.value = { id: 'staff-one' };
  await merchant.logout();
  const request = requests.find(r => r.path === '/auth/logout');
  assert.ok(request, 'logout must call the server');
  assert.equal(request.header.Authorization, 'Bearer test-token');
  assert.equal(storage.has('session:merchant'), false);
  assert.equal(storage.has('cash-attempt:v1:staff-one'), true);
  assert.match(merchant.notice.value, /本机已退出.*未能确认/);
});
