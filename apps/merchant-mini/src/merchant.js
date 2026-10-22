import { ref, computed, reactive, shallowRef } from "vue";
import { createMiniCashier, uniDraftStorage } from './cashier.js';
import { createMiniCashShifts, uniShiftStorage } from './cash-shifts.js';
import {
  createClient,
  createCashRefund,
  readRefundAttempt,
  createCashAttempt,
  confirm,
  errorText,
  money,
  statusNames,
  paymentNames,
  staffLoginPayload,
  staffErrorText,
  readDraftAttempt,
  readShiftAttempt,
  validShift,
} from "@restaurant/mini-core";
export function useMerchant() {
  const client = createClient("merchant"),
    api = client.api,
    cashAttempts = createCashAttempt(client.storage);
  const user = ref(null),
    config = ref(null),
    allStores = ref([]),
    storeId = ref(client.storage.get("merchant:store") || ""),
    tab = ref("overview"),
    overview = ref(null),
    orders = ref([]),
    catalog = ref({ categories: [], products: [] }),
    filter = ref(""),
    order = ref(null),
    cashOrder = ref(null),
    tendered = ref(""),
    pendingCash = ref(null),
    error = ref(""),
    notice = ref(""),
    busy = ref(false),
    loading = ref(true),
    sheet = ref("");
  const loggingOut = ref(false);
  const shifts = shallowRef(null);
  const shiftBusy = computed(() => !!(shifts.value?.state.busy || shifts.value?.state.blocked));
  const refund = reactive({ blocked: false, busy: false, attempt: null });
  const refundCtl = shallowRef(null);
  const refundBusy = computed(() => !!(refund.busy || refund.blocked));
  const cashier = shallowRef(null);
  const auxiliaryBusy = ref(false);
  const cashierBusy = computed(() => !!(cashier.value?.state.drafts.busy || cashier.value?.state.drafts.blocked || cashier.value?.state.loading || cashier.value?.state.pickup.loading));
  const otherBusy = () => { shifts.value?.discover(); return shiftBusy.value || refundBusy.value || cashierBusy.value || auxiliaryBusy.value; };
  const originalBusy = () => !!(pendingCash.value || refundBusy.value || cashierBusy.value || auxiliaryBusy.value || busy.value || loggingOut.value);
  function initializeShifts() {
    shifts.value?.dispose();
    if (!user.value || !storeId.value) { shifts.value = null; return; }
    shifts.value = createMiniCashShifts({ state: reactive({}), request: api, storage: uniShiftStorage(),
      context: () => ({ userId: user.value?.id, storeId: storeId.value, owner: owner.value }), locked: originalBusy });
  }
  async function requireActiveShift(c) {
    shifts.value?.discover();
    if (shiftBusy.value) throw Error('请先核对原交班操作，再进行新的现金收款或退款');
    const result = await api(`/merchant/cash-shifts/current?storeId=${encodeURIComponent(c.storeId)}`);
    if (user.value?.id !== c.userId || storeId.value !== c.storeId) throw Error('账号或门店已变化，请重新核对');
    if (!result || !Object.hasOwn(result, 'shift') || (result.shift !== null && (!validShift(result.shift, c.storeId) || result.shift.state !== 'OPEN'))) throw Error('活动班次读取不完整，请重新读取');
    if (!result.shift) throw Error('当前没有活动现金班次，请店主先进入现金交班开班；原金额已保留');
  }
  async function showShifts() {
    shifts.value?.discover();
    if (!user.value || originalBusy()) return false;
    const identity = user.value.id;
    const target = shifts.value?.state.pending?.storeId || storeId.value;
    if (!user.value.storeIds.includes(target)) { error.value = '原交班门店已无权限，请联系店主核对原操作'; return false; }
    if (target !== storeId.value) {
      resetScope(); storeId.value = target; initializeCashier(); initializeShifts();
      await run(load);
    }
    if (user.value?.id !== identity || storeId.value !== target) return false;
    tab.value = 'shifts'; sheet.value = ''; return true;
  }
  async function resumeFinancialInput(kind) {
    if (otherBusy() || originalBusy()) return false;
    const selected = kind === 'cash' ? cashOrder.value : order.value;
    if (!selected || selected.storeId !== storeId.value) return false;
    const identity = user.value?.id, targetStore = storeId.value;
    return !!await run(async () => {
      const actual = await api(`/orders/${encodeURIComponent(selected.id)}`);
      if (user.value?.id !== identity || storeId.value !== targetStore) return false;
      if (actual?.id !== selected.id || actual.storeId !== targetStore) throw Error('原订单读取不完整，请重新核对');
      order.value = actual; tab.value = 'orders';
      if (kind === 'cash') { cashOrder.value = actual; sheet.value = 'cash'; }
      return true;
    });
  }
  function initializeCashier() {
    cashier.value?.dispose();
    if (!user.value || !storeId.value) { cashier.value = null; return; }
    cashier.value = createMiniCashier({
      state: reactive({}), request: api, storage: uniDraftStorage(),
      userId: () => user.value?.id, storeId: () => storeId.value,
      modes: store.value?.serviceModes,
      locked: () => busy.value || refundBusy.value || auxiliaryBusy.value || !!pendingCash.value || loggingOut.value || !!shifts.value?.state.busy || (shiftBusy.value && !cashier.value?.state.drafts.blocked),
      onOrder: value => {
        // Cash still goes through openCash() with a new explicit tendered amount.
        order.value = value; cashOrder.value = null; tendered.value = ''; sheet.value = ''; tab.value = 'orders';
      },
    });
    if (cashier.value.state.drafts.blocked && !pendingCash.value && !refundBusy.value) tab.value = 'cashier';
  }
  const refundStorage = {
    get: (key) =>
      typeof uni.getStorageInfoSync === "function"
        ? uni.getStorageInfoSync().keys.includes(key)
          ? uni.getStorageSync(key)
          : undefined
        : uni.getStorageSync(key),
    set: (key, value) => uni.setStorageSync(key, value),
    remove: (key) => uni.removeStorageSync(key),
  };
  function initializeRefund(identity) {
    refundCtl.value?.dispose();
    const restored = readRefundAttempt(refundStorage, identity.id);
    if (
      !pendingCash.value && restored.attempt &&
      identity.storeIds.includes(restored.attempt.storeId)
    )
      storeId.value = restored.attempt.storeId;
    refundCtl.value = createCashRefund({
      state: refund,
      storage: refundStorage,
      request: api,
      beforeNew: requireActiveShift,
      context: () => ({
        userId: user.value?.id,
        storeId: storeId.value,
        owner: user.value?.role === "OWNER",
        // A restored refund owns its original order even when cash recovery has
        // just displayed a different order at this same store.
        order: refund.attempt && order.value?.id !== refund.attempt.orderId ? null : order.value,
      }),
      onOrder: (value) => {
        order.value = value;
        tab.value = "orders";
        orders.value = orders.value.map((item) =>
          item.id === value.id ? value : item,
        );
      },
    });
    if (restored.attempt || restored.error) tab.value = "orders";
  }

  const orderPage = ref(1),
    orderTotal = ref(0);
  const stores = computed(() =>
    allStores.value.filter((s) => user.value?.storeIds.includes(s.id)),
  );
  const store = computed(() =>
    stores.value.find((s) => s.id === storeId.value),
  );
  const owner = computed(() => user.value?.role === "OWNER");
  const visibleOrders = computed(() => orders.value);
  async function run(fn) {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    notice.value = "";
    try {
      return await fn();
    } catch (e) {
      error.value = errorText(e);
    } finally {
      busy.value = false;
    }
  }
  async function load() {
    if (!user.value || !storeId.value) return;
    const id = storeId.value;
    const identity = user.value.id;
    const [stats, list, products, configuration, storeList] = await Promise.all(
      [
        api(`/merchant/overview?storeId=${id}`),
        api(
          `/orders?storeId=${id}&page=1&pageSize=20${filter.value ? "&status=" + filter.value : ""}`,
        ),
        api(`/merchant/products?storeId=${id}`),
        api(`/public-config?storeId=${id}`),
        api("/stores"),
      ],
    );
    if (storeId.value !== id || user.value?.id !== identity) return;
    overview.value = stats;
    orders.value = list.items;
    orderPage.value = 1;
    orderTotal.value = list.total;
    catalog.value = products;
    config.value = configuration;
    allStores.value = storeList;
  }
  async function setFilter(value) {
    if (otherBusy()) return;
    await run(async () => {
      filter.value = value;
      orders.value = [];
      const result = await api(
        `/orders?storeId=${storeId.value}&page=1&pageSize=20${value ? "&status=" + value : ""}`,
      );
      orders.value = result.items;
      orderTotal.value = result.total;
      orderPage.value = 1;
    });
  }
  async function moreOrders() {
    if (otherBusy()) return;
    await run(async () => {
      const result = await api(
        `/orders?storeId=${storeId.value}&page=${orderPage.value + 1}&pageSize=20${filter.value ? "&status=" + filter.value : ""}`,
      );
      orders.value.push(
        ...result.items.filter(
          (item) => !orders.value.some((current) => current.id === item.id),
        ),
      );
      orderPage.value = result.page;
      orderTotal.value = result.total;
    });
  }
  async function initializeUser(identity) {
    resetScope();
    user.value = null;
    pendingCash.value = null;
    if (identity.role === "CUSTOMER") throw new Error("此账号没有门店管理权限");
    user.value = identity;
    pendingCash.value = cashAttempts.get(identity.id) || null;
    const authorized = allStores.value.filter((s) =>
      identity.storeIds.includes(s.id),
    );
    if (
      pendingCash.value &&
      authorized.some((s) => s.id === pendingCash.value.storeId)
    )
      storeId.value = pendingCash.value.storeId;
    else if (!authorized.some((s) => s.id === storeId.value))
      storeId.value = authorized[0]?.id || "";
    initializeRefund(identity);
    const draftRecovery = readDraftAttempt(uniDraftStorage(), identity.id);
    if (!pendingCash.value && !refundBusy.value && draftRecovery.attempt && identity.storeIds.includes(draftRecovery.attempt.storeId)) storeId.value = draftRecovery.attempt.storeId;
    initializeCashier();
    const shiftRecovery = readShiftAttempt(uniShiftStorage(), identity.id);
    if (!pendingCash.value && !refundBusy.value && !cashierBusy.value && shiftRecovery.attempt && identity.storeIds.includes(shiftRecovery.attempt.storeId)) {
      storeId.value = shiftRecovery.attempt.storeId;
      initializeCashier();
    }
    initializeShifts();
    await load();
  }
  async function init() {
    loading.value = true;
    await run(async () => {
      const [configuration, list] = await Promise.all([
        api("/public-config"),
        api("/stores"),
      ]);
      config.value = configuration;
      allStores.value = list;
      if (client.session()?.token) await initializeUser(await api("/me"));
    });
    loading.value = false;
  }
  async function login(account) {
    await run(async () => {
      if (config.value?.environment !== "development")
        throw new Error("请使用微信登录");
      const result = await api("/auth/dev-login", {
        method: "POST",
        data: { account },
      });
      client.saveSession(result);
      await initializeUser(result.user);
    });
  }
  async function staffLogin(account, password) {
    await run(async () => {
      try {
        const result = await api("/auth/staff-login", {
          method: "POST",
          data: staffLoginPayload(config.value, account, password),
        });
        client.saveSession({
          token: result.token,
          user: result.user,
          environment: result.environment,
        });
        await initializeUser(result.user);
      } catch (e) {
        throw new Error(staffErrorText(e, true));
      }
    });
  }
  async function wechatLogin() {
    await run(async () => {
      const credentials = await new Promise((resolve, reject) =>
        uni.login({ provider: "weixin", success: resolve, fail: reject }),
      );
      const result = await api("/auth/wechat", {
        method: "POST",
        data: { code: credentials.code, client: "merchant" },
      });
      client.saveSession(result);
      await initializeUser(result.user);
    });
  }
  function resetScope() {
    shifts.value?.dispose(); shifts.value = null;
    cashier.value?.dispose();
    cashier.value = null;
    orders.value = [];
    overview.value = null;
    catalog.value = { categories: [], products: [] };
    sheet.value = "";
    order.value = null;
    cashOrder.value = null;
    tendered.value = "";
    filter.value = "";
    orderPage.value = 1;
    orderTotal.value = 0;
  }
  function clearSession() {
    refundCtl.value?.dispose();
    Object.assign(refund, {
      blocked: false,
      busy: false,
      attempt: null,
      error: "",
      notice: "",
    });
    client.logout();
    client.storage.remove("merchant:store");
    user.value = null;
    pendingCash.value = null;
    resetScope();
    storeId.value = "";
    tab.value = "overview";
  }
  async function logout() {
    if (otherBusy() || pendingCash.value) return;
    if (busy.value || loggingOut.value) return;
    loggingOut.value = true;
    const result = api("/auth/logout", { method: "POST", data: {} });
    clearSession();
    error.value = "";
    try {
      await result;
      if (!user.value) notice.value = "已退出登录";
    } catch (e) {
      if (!user.value)
        notice.value = `本机已退出，未能确认服务器会话已撤销，请稍后重新登录并退出${e.requestId ? `（编号 ${e.requestId}）` : ""}`;
    } finally {
      loggingOut.value = false;
    }
  }
  async function selectStore(id) {
    if (otherBusy()) return;
    if (busy.value || id === storeId.value) return;
    if (pendingCash.value) {
      error.value = "请先恢复现金收款，再切换门店";
      return;
    }
    await run(async () => {
      cashier.value?.dispose(); cashier.value = null;
      storeId.value = id;
      client.storage.set("merchant:store", id);
      order.value = null;
      orders.value = [];
      overview.value = null;
      catalog.value = { categories: [], products: [] };
      filter.value = "";
      sheet.value = "";
      initializeCashier();
      initializeShifts();
      await load();
    });
  }
  async function returnToDraftStore() {
    const target = cashier.value?.pendingStore() || storeId.value;
    if (!target || !user.value?.storeIds.includes(target) || busy.value || refundBusy.value || auxiliaryBusy.value || pendingCash.value || cashier.value?.state.drafts.busy || shifts.value?.state.busy) return;
    await run(async () => {
      resetScope(); storeId.value = target; initializeCashier(); initializeShifts(); tab.value = 'cashier'; await load();
    });
  }
  async function returnToRefundStore() {
    const target = refund.attempt?.storeId;
    if (!target || !user.value?.storeIds.includes(target) || busy.value || refund.busy || auxiliaryBusy.value || pendingCash.value || cashier.value?.state.drafts.busy || shifts.value?.state.busy) return false;
    const identity = user.value.id;
    if (target !== storeId.value) {
      resetScope(); storeId.value = target; initializeCashier(); initializeShifts(); await run(load);
    } else order.value = null;
    if (user.value?.id !== identity || storeId.value !== target) return false;
    tab.value = 'orders'; return true;
  }
  function navigate(next) {
    if (otherBusy() || pendingCash.value) return;
    if (busy.value) return;
    tab.value = next;
    order.value = null;
    sheet.value = "";
  }
  async function detail(id) {
    if (otherBusy()) return;
    Object.assign(refund, {
      amount: "",
      reason: "",
      review: false,
      expanded: false,
      error: "",
      notice: "",
    });
    await run(async () => {
      order.value = await api(`/orders/${id}`);
      tab.value = "orders";
    });
  }
  async function toggleOpen() {
    if (otherBusy()) return;
    if (pendingCash.value) {
      error.value = "请先恢复现金收款";
      return;
    }
    if (
      !(await confirm(
        store.value.isOpen ? "暂停接单" : "开始营业",
        store.value.isOpen
          ? "暂停后顾客将无法提交新订单，已接订单仍需处理。"
          : "确认门店已准备好接单了吗？",
      ))
    )
      return;
    await run(async () => {
      await api(`/merchant/stores/${storeId.value}`, {
        method: "PATCH",
        data: { isOpen: !store.value.isOpen },
      });
      await load();
      notice.value = store.value.isOpen ? "门店已开始营业" : "门店已暂停接单";
    });
  }
  async function toggleProduct(product) {
    if (otherBusy()) return;
    if (pendingCash.value) {
      error.value = "请先恢复现金收款";
      return;
    }
    if (!owner.value) return;
    if (
      !(await confirm(
        product.isAvailable ? "标记售罄" : "恢复销售",
        `确认${product.isAvailable ? "停售" : "恢复销售"}「${product.name}」？`,
      ))
    )
      return;
    await run(async () => {
      await api(`/merchant/products/${product.id}`, {
        method: "PATCH",
        data: { storeId: storeId.value, isAvailable: !product.isAvailable },
      });
      await load();
      notice.value = "商品状态已更新";
    });
  }
  function openCash(value) {
    if (otherBusy()) return;
    if (busy.value) return;
    if (pendingCash.value) {
      error.value = "请先恢复上次现金收款";
      return;
    }
    cashOrder.value = value;
    tendered.value = "";
    sheet.value = "cash";
  }
  async function cash(recover = false) {
    shifts.value?.discover();
    if (auxiliaryBusy.value || refund.busy || shifts.value?.state.busy || (refundBusy.value && !(recover && pendingCash.value)) || (shiftBusy.value && !pendingCash.value) || (cashierBusy.value && !(recover && pendingCash.value && !cashier.value?.state.drafts.busy))) return;
    if (busy.value) return;
    let attempt = pendingCash.value;
    const restoring = !!attempt;
    const identity = user.value;
    if (!identity) return;
    if (!attempt) {
      if (!cashOrder.value) return;
      const selectedOrder = cashOrder.value;
      const value = tendered.value.trim();
      if (!/^\d{1,8}(\.\d{1,2})?$/.test(value)) {
        error.value = "请输入正确的实收金额，最多两位小数";
        return;
      }
      const [whole, decimal = ""] = value.split(".");
      const tenderedFen = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
      if (tenderedFen < cashOrder.value.totalFen) {
        error.value = "实收金额不能少于应收金额";
        return;
      }
      let active = false;
      const targetStore = storeId.value;
      await run(async () => { await requireActiveShift({ userId: identity.id, storeId: targetStore }); active = true; });
      if (!active || user.value?.id !== identity.id || storeId.value !== targetStore || cashOrder.value?.id !== selectedOrder.id || sheet.value !== 'cash') return;
      if (
        !(await confirm(
          "确认现金收款",
          `确认已收到现金 ${money(tenderedFen)}？确认后将记录收款。`,
        ))
      )
        return;
      if (user.value?.id !== identity.id || storeId.value !== targetStore || cashOrder.value?.id !== selectedOrder.id || sheet.value !== 'cash' || otherBusy() || busy.value || loggingOut.value) return;
      attempt = cashAttempts.begin(identity.id, {
        orderId: selectedOrder.id,
        storeId: selectedOrder.storeId,
        tenderedFen,
      });
      pendingCash.value = attempt;
    }
    const submitted = attempt;
    await run(async () => {
      try {
        const result = await api(
          `/merchant/orders/${submitted.orderId}/cash-payment`,
          {
            method: "POST",
            data: { tenderedFen: submitted.tenderedFen },
            headers: { "Idempotency-Key": submitted.key },
          },
        );
        if (user.value?.id !== identity.id || storeId.value !== submitted.storeId) return;
        if (!result.cashReceipt)
          throw new Error("已收到订单状态，收款凭证尚未返回，请恢复核对");
        cashAttempts.clear(identity.id);
        pendingCash.value = null;
        order.value = result;
        cashOrder.value = null;
        sheet.value = "";
        tab.value = "orders";
        await load();
        notice.value = `现金收款已确认，找零 ${money(result.cashReceipt.changeFen)}`;
      } catch (e) {
        if (user.value?.id !== identity.id || storeId.value !== submitted.storeId) return;
        if (e.code === 'SHIFT_REQUIRED' && e.status === 409) {
          if (!restoring) {
            cashAttempts.clear(identity.id); pendingCash.value = null;
            throw Object.assign(Error('当前没有活动现金班次，请店主先进入现金交班开班；原金额已保留'), { requestId: e.requestId });
          }
          const actual = await api(`/orders/${submitted.orderId}`);
          if (user.value?.id !== identity.id || storeId.value !== submitted.storeId) return;
          if (actual?.id === submitted.orderId && actual.storeId === submitted.storeId && actual.cashReceipt) {
            cashAttempts.clear(identity.id); pendingCash.value = null; order.value = actual; sheet.value = ''; tab.value = 'orders';
            notice.value = '原收款凭证已读取，请核对原现金'; return;
          }
          throw Object.assign(Error('原收款结果仍待确认，请保留原实收并恢复核对，不能据此新增收款'), { requestId: e.requestId });
        }
        if (e.code === "STATE_CONFLICT") {
          const actual = await api(`/orders/${submitted.orderId}`);
          if (user.value !== identity || storeId.value !== submitted.storeId) return;
          const receipt = actual?.cashReceipt;
          if (
            actual?.id !== submitted.orderId || actual.storeId !== submitted.storeId ||
            !Object.hasOwn(statusNames, actual.status) || !Object.hasOwn(paymentNames, actual.paymentStatus) ||
            !Object.hasOwn(actual, 'cashReceipt') ||
            (receipt !== null && (!receipt ||
              ![receipt.amountFen, receipt.tenderedFen, receipt.changeFen].every(value => Number.isSafeInteger(value) && value >= 0) ||
              receipt.tenderedFen - receipt.changeFen !== receipt.amountFen))
          ) throw Object.assign(Error('原订单读取不完整，请保留原实收并恢复核对'), { requestId: e.requestId });
          order.value = actual;
          sheet.value = "";
          tab.value = "orders";
          if (actual.cashReceipt) {
            cashAttempts.clear(identity.id);
            pendingCash.value = null;
            notice.value = `原收款已确认，找零 ${money(actual.cashReceipt.changeFen)}`;
            await load();
            return;
          }
          if (
            actual.status !== "PENDING_PAYMENT" ||
            actual.paymentStatus !== "UNPAID"
          ) {
            cashAttempts.clear(identity.id);
            pendingCash.value = null;
            await load();
            throw new Error("订单已关闭或状态已更新，未新增收款，请核对现金");
          }
          cashAttempts.clear(identity.id);
          pendingCash.value = null;
        } else if (!restoring && ["VALIDATION_ERROR", "FORBIDDEN", "NOT_FOUND"].includes(e.code)) {
          cashAttempts.clear(identity.id);
          pendingCash.value = null;
        }
        throw e;
      }
    });
  }
  async function transition(value, action, label) {
    if (otherBusy()) return;
    if (action === "PICKUP") {
      await detail(value.id);
      return;
    }
    if (busy.value) return;
    if (pendingCash.value) {
      error.value = "请先恢复现金收款";
      return;
    }
    if (
      !(await confirm(label, `确认对订单 ${value.number} 执行「${label}」？`))
    )
      return;
    await run(async () => {
      const result = await api(`/merchant/orders/${value.id}/transition`, {
        method: "POST",
        data: {
          action,
          ...(action === "REJECT" ? { reason: "门店拒绝订单" } : {}),
        },
      });
      if (order.value?.id === result.id) order.value = result;
      await load();
      notice.value = `已${label}`;
    });
  }
  function actions(value) {
    if (value.status === "PENDING_PAYMENT")
      return [{ action: "REJECT", label: "拒绝订单" }];
    if (value.status === "AWAITING_ACCEPTANCE")
      return [{ action: "ACCEPT", label: "接单制作" }];
    if (value.status === "PREPARING")
      return [{ action: "READY", label: "标记备好" }];
    if (value.status === "READY" && value.mode === "PICKUP")
      return value.paymentStatus === "PAID"
        ? [{ action: "PICKUP", label: "核销取餐" }]
        : [];
    if (value.status === "READY")
      return value.mode === "DELIVERY"
        ? [{ action: "DISPATCH", label: "开始配送" }]
        : [{ action: "COMPLETE", label: "完成订单" }];
    if (value.status === "DELIVERING")
      return [{ action: "COMPLETE", label: "完成订单" }];
    return [];
  }
  uni.$on("session-expired", () => {
    clearSession();
    error.value = "登录已过期，请重新登录";
  });
  return {
    user,
    config,
    stores,
    storeId,
    store,
    owner,
    tab,
    overview,
    orders,
    catalog,
    filter,
    visibleOrders,
    order,
    cashOrder,
    tendered,
    pendingCash,
    shifts,
    shiftBusy,
    showShifts,
    resumeCash: () => resumeFinancialInput('cash'),
    resumeRefund: () => resumeFinancialInput('refund'),
    refund,
    refundCtl,
    refundBusy,
    cashier,
    cashierBusy,
    auxiliaryBusy,
    returnToDraftStore,
    returnToRefundStore,
    error,
    notice,
    busy,
    loggingOut,
    loading,
    sheet,
    init,
    login,
    staffLogin,
    wechatLogin,
    logout,
    selectStore,
    navigate,
    detail,
    toggleOpen,
    toggleProduct,
    openCash,
    cash,
    transition,
    actions,
    orderTotal,
    setFilter,
    moreOrders,
    refresh: () => otherBusy() ? undefined : run(load),
    money,
  };
}
