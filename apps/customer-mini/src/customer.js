import { ref, computed, reactive } from "vue";
import {
  createClient,
  createCart,
  createPendingOrder,
  confirm,
  errorText,
  fingerprint,
  money,
  cartSelectionIssue,
  isDefinitiveOrderRejection,
  createPickupSelection,
  isPickupRejection,
  addressLocked,
} from "@restaurant/mini-core";
import { createMiniCustomerAddresses } from "./addresses.js";
export function useCustomer() {
  const client = createClient("customer"),
    api = client.api,
    cart = createCart(client.storage),
    pendingOrders = createPendingOrder(client.storage);
  const tab = ref("home"),
    config = ref(null),
    stores = ref([]),
    storeId = ref(client.storage.get("customer:store") || ""),
    mode = ref(client.storage.get("customer:mode") || "PICKUP"),
    catalog = ref({ categories: [], products: [] }),
    categoryId = ref(""),
    user = ref(null),
    lines = ref([]),
    orders = ref([]),
    order = ref(null),
    tables = ref([]),
    tableCode = ref(""),
    selectedAddressId = ref(""),
    selectedAddressRevision = ref(0),
    note = ref(""),
    quote = ref(null),
    product = ref(null),
    editingKey = ref(null),
    needsMenuRefresh = ref(false),
    sheet = ref(""),
    error = ref(""),
    busy = ref(false),
    loading = ref(true),
    pending = ref(null);
  const orderPage = ref(1),
    orderTotal = ref(0);
  const pickup = reactive({});
  const addressesState = reactive({});
  const addresses = ref(null);
  const sessionGeneration = ref(0);
  let pickupController;
  function resetPickup() {
    pickupController?.dispose();
    pickupController = createPickupSelection({
      state: pickup,
      request: api,
      storeId: () => storeId.value,
      initial: client.storage.get(`customer:pickup:${storeId.value}`),
      locked: () => busy.value || !!pending.value,
      onChange: (selection) => {
        quote.value = null;
        client.storage.set(`customer:pickup:${storeId.value}`, selection);
      },
    });
  }
  resetPickup();
  const store = computed(() =>
    stores.value.find((s) => s.id === storeId.value),
  );
  const products = computed(() =>
    catalog.value.products.filter(
      (p) => !categoryId.value || p.categoryId === categoryId.value,
    ),
  );
  const count = computed(() =>
    lines.value.reduce((sum, l) => sum + l.quantity, 0),
  );
  const subtotal = computed(() =>
    lines.value.reduce((sum, l) => sum + l.unitPriceFen * l.quantity, 0),
  );
  const lineIssue = (line) => cartSelectionIssue(line, catalog.value.products);
  const invalidCart = computed(() =>
    lines.value.some((line) => lineIssue(line)),
  );
  const addressLockedState = computed(() =>
    addressLocked(
      addressesState.loading,
      addressesState.busy,
      addressesState.blocked,
      addressesState.corrupt,
      !!addressesState.pending,
    ),
  );
  const selectedAddress = computed(
    () =>
      addressesState.items.find(
        (item) => item.id === selectedAddressId.value && item.deletedAt === null,
      ) || null,
  );
  function disposeAddresses() {
    addresses.value?.dispose();
    addresses.value = null;
    selectedAddressId.value = "";
    selectedAddressRevision.value = 0;
  }
  function setupAddresses() {
    disposeAddresses();
    if (!user.value) return;
    const identityGeneration = sessionGeneration.value;
    addresses.value = createMiniCustomerAddresses({
      state: addressesState,
      request: api,
      context: () => ({
        userId: user.value?.id,
        identity: identityGeneration,
      }),
      locked: () => busy.value || !!pending.value,
    });
  }
  function syncSelectedAddress() {
    const current = addressesState.items.find(
      (item) => item.id === selectedAddressId.value && item.deletedAt === null,
    );
    if (!current) {
      if (selectedAddressId.value) quote.value = null;
      selectedAddressId.value = "";
      selectedAddressRevision.value = 0;
      return false;
    }
    if (current.revision !== selectedAddressRevision.value) {
      selectedAddressRevision.value = current.revision;
      quote.value = null;
    }
    return true;
  }
  function selectDeliveryAddress(value) {
    const actual =
      typeof value === "string"
        ? addressesState.items.find((item) => item.id === value)
        : value;
    if (!actual || actual.deletedAt !== null) return false;
    selectedAddressId.value = actual.id;
    selectedAddressRevision.value = actual.revision;
    quote.value = null;
    return true;
  }
  const sync = () => {
    lines.value = cart.get(storeId.value, mode.value);
    quote.value = null;
    pending.value = user.value ? pendingOrders.get(user.value.id) || null : null;
  };
  async function run(action) {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    try {
      return await action();
    } catch (e) {
      if (e.code === "PRODUCT_OPTIONS_CHANGED") needsMenuRefresh.value = true;
      if (isPickupRejection(e)) {
        quote.value = null;
        pickupController.invalidate(e);
      }
      error.value = errorText(e);
    } finally {
      busy.value = false;
    }
  }
  async function loadCatalog() {
    if (!storeId.value) return;
    const id = storeId.value;
    const [data, configuration, tableList] = await Promise.all([
      api(`/stores/${id}/catalog`),
      api(`/public-config?storeId=${id}`),
      api(`/stores/${id}/tables`),
    ]);
    if (id !== storeId.value) return;
    catalog.value = data;
    config.value = configuration;
    tables.value = tableList;
    categoryId.value = "";
    tableCode.value = "";
    sync();
    needsMenuRefresh.value = false;
  }
  async function init() {
    loading.value = true;
    await run(async () => {
      const [configuration, list] = await Promise.all([
        api("/public-config"),
        api("/stores"),
      ]);
      config.value = configuration;
      stores.value = list;
      if (!list.some((s) => s.id === storeId.value))
        storeId.value = list[0]?.id || "";
      resetPickup();
      if (!store.value?.serviceModes.includes(mode.value))
        mode.value = store.value?.serviceModes[0] || "PICKUP";
      const sessionToken = client.session()?.token;
      const identityGeneration = sessionGeneration.value;
      if (sessionToken) {
        const restored = await api("/me");
        if (
          sessionToken === client.session()?.token &&
          identityGeneration === sessionGeneration.value
        ) {
          user.value = restored;
          setupAddresses();
        }
      }
      await loadCatalog();
      if (user.value) await loadOrders();
    });
    loading.value = false;
  }
  async function selectStore(id) {
    if (busy.value) return;
    if (id === storeId.value) return;
    if (pending.value) {
      error.value = "请先恢复上次订单，再切换门店";
      return;
    }
    if (addressLockedState.value) {
      error.value = "请先核对原收货地址操作，再切换门店";
      return;
    }
    if (
      lines.value.length &&
      !(await confirm("切换门店", "当前购物袋会保留在原门店。确定切换吗？"))
    )
      return;
    await run(async () => {
      storeId.value = id;
      resetPickup();
      client.storage.set("customer:store", id);
      mode.value =
        stores.value.find((s) => s.id === id)?.serviceModes[0] || "PICKUP";
      client.storage.set("customer:mode", mode.value);
      catalog.value = { categories: [], products: [] };
      tables.value = [];
      sync();
      sheet.value = "";
      await loadCatalog();
    });
  }
  async function selectMode(next) {
    if (busy.value) return;
    if (next === mode.value) return;
    if (pending.value) {
      error.value = "请先恢复上次订单";
      return;
    }
    if (addressLockedState.value && next !== mode.value) {
      error.value = "请先核对原收货地址操作，再切换用餐方式";
      return;
    }
    if (
      lines.value.length &&
      !(await confirm(
        "切换用餐方式",
        "当前购物袋会按原用餐方式保留，确定切换吗？",
      ))
    )
      return;
    mode.value = next;
    client.storage.set("customer:mode", next);
    sync();
  }
  async function login() {
    await run(async () => {
      if (config.value?.environment !== "development")
        throw new Error("请使用微信登录");
      const result = await api("/auth/dev-login", {
        method: "POST",
        data: { account: "customer" },
      });
      client.saveSession(result);
      resetPrivate();
      user.value = result.user;
      setupAddresses();
      sync();
      await loadOrders();
    });
  }
  async function wechatLogin() {
    await run(async () => {
      const credentials = await new Promise((resolve, reject) =>
        uni.login({ provider: "weixin", success: resolve, fail: reject }),
      );
      const result = await api("/auth/wechat", {
        method: "POST",
        data: { code: credentials.code, client: "customer" },
      });
      client.saveSession(result);
      resetPrivate();
      user.value = result.user;
      setupAddresses();
      sync();
      await loadOrders();
    });
  }
  function resetPrivate() {
    disposeAddresses();
    sessionGeneration.value++;
    user.value = null;
    orders.value = [];
    order.value = null;
    quote.value = null;
    sheet.value = "";
    pending.value = null;
    selectedAddressId.value = "";
    selectedAddressRevision.value = 0;
    note.value = "";
    orderPage.value = 1;
    orderTotal.value = 0;
  }
  async function logout() {
    client.logout();
    resetPrivate();
  }
  function openProduct(value, line = null) {
    if (pending.value) {
      error.value = "请先恢复上次订单，再修改购物袋";
      return;
    }
    product.value = value;
    editingKey.value = line ? fingerprint(line) : null;
    error.value = "";
    sheet.value = "product";
  }
  function reselect(line) {
    const value = catalog.value.products.find(
      (p) => p.id === line.productId || p.skus.some((s) => s.id === line.skuId),
    );
    if (value) openProduct(value, line);
    else error.value = "商品已下架，请移除后选择其他商品";
  }
  function add(line) {
    try {
      if (pending.value) throw new Error("请先恢复上次订单，再修改购物袋");
      if (!store.value?.isOpen) throw new Error("门店休息中，暂时不能下单");
      const issue = lineIssue(line);
      if (issue) throw new Error(issue);
      cart.add(storeId.value, mode.value, line, editingKey.value);
      sync();
      sheet.value = editingKey.value ? "cart" : "";
      editingKey.value = null;
      uni.showToast({ title: "已加入购物袋", icon: "success" });
    } catch (e) {
      error.value = errorText(e);
    }
  }
  function change(line, delta) {
    if (pending.value) {
      error.value = "请先恢复上次订单";
      return;
    }
    cart.change(storeId.value, mode.value, fingerprint(line), delta);
    sync();
  }
  async function checkout() {
    if (!user.value) {
      sheet.value = "";
      tab.value = "profile";
      error.value = "请先登录，再确认订单";
      return;
    }
    sheet.value = "cart";
    quote.value = null;
  }
  async function getQuote() {
    await run(async () => {
      if (pending.value) throw new Error("请先恢复上次订单");
      if (addressLockedState.value)
        throw new Error("请先核对原收货地址操作，再确认订单金额");
      if (mode.value === "DELIVERY")
        throw new Error(
          "配送服务尚未开通；已保留所选收货地址，不会生成报价或提交配送订单",
        );
      if (needsMenuRefresh.value || invalidCart.value)
        throw new Error("购物袋中的搭配已失效，请重新选择后确认金额");
      const quoteInput = () => ({
        storeId: storeId.value,
        mode: mode.value,
        lines: lines.value.map(
          ({ skuId, quantity, modifierIds, attributeOptionIds = [] }) => ({
            skuId,
            quantity,
            modifierIds,
            attributeOptionIds,
          }),
        ),
        ...(mode.value === "DINE_IN" ? { tableCode: tableCode.value } : {}),
        ...(mode.value === "PICKUP" ? pickupController.quoteFields() : {}),
        note: note.value,
      });
      const identity = user.value?.id;
      const snapshot = JSON.stringify(quoteInput());
      const result = await api("/quotes", {
        method: "POST",
        data: JSON.parse(snapshot),
      });
      if (
        snapshot !== JSON.stringify(quoteInput()) ||
        identity !== user.value?.id
      ) {
        quote.value = null;
        throw new Error("购物袋或用餐信息已变化，请重新确认金额");
      }
      quote.value = result;
    });
  }
  async function submit() {
    await run(async () => {
      const identity = user.value;
      if (!identity) throw new Error("请先登录");
      let attempt = pendingOrders.get(identity.id);
      if (!attempt && addressLockedState.value)
        throw new Error("请先核对原收货地址操作，再提交订单");
      if (!attempt) {
        if (!quote.value) throw new Error("请先确认金额");
        attempt = pendingOrders.begin(identity.id, quote.value.id);
      }
      pending.value = attempt;
      try {
        const created = await api("/orders", {
          method: "POST",
          data: { quoteId: attempt.quoteId },
          headers: { "Idempotency-Key": attempt.key },
        });
        pendingOrders.clear(identity.id);
        pending.value = null;
        cart.clear(created.storeId, created.mode);
        sync();
        order.value = created;
        sheet.value = "";
        tab.value = "orders";
        await loadOrders();
      } catch (e) {
        if (isDefinitiveOrderRejection(e) || isPickupRejection(e)) {
          pendingOrders.clear(identity.id);
          pending.value = null;
          quote.value = null;
        }
        throw e;
      }
    });
  }
  async function loadAddresses() {
    if (!addresses.value) return false;
    const result = await addresses.value.load();
    syncSelectedAddress();
    return result;
  }
  function openAddresses() {
    tab.value = "profile";
    sheet.value = "";
  }
  async function loadOrders() {
    if (user.value) {
      const result = await api("/orders?page=1&pageSize=20");
      orders.value = result.items;
      orderPage.value = 1;
      orderTotal.value = result.total;
    }
  }
  async function moreOrders() {
    await run(async () => {
      const result = await api(
        `/orders?page=${orderPage.value + 1}&pageSize=20`,
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
  async function showOrders() {
    tab.value = "orders";
    await run(loadOrders);
  }
  async function detail(id) {
    await run(async () => {
      order.value = await api(`/orders/${id}`);
    });
  }
  async function cancel() {
    if (!(await confirm("取消订单", "确定取消这笔订单吗？"))) return;
    await run(async () => {
      order.value = await api(`/orders/${order.value.id}/cancel`, {
        method: "POST",
        data: { reason: "顾客取消" },
      });
      await loadOrders();
    });
  }
  async function pay() {
    await run(async () => {
      const params = await api(`/orders/${order.value.id}/payment`, {
        method: "POST",
        data: { provider: "WECHAT" },
      });
      await new Promise((resolve, reject) =>
        uni.requestPayment({ ...params, success: resolve, fail: reject }),
      );
      order.value = await api(`/orders/${order.value.id}`);
      await loadOrders();
    });
  }
  uni.$on("session-expired", () => {
    resetPrivate();
    error.value = "登录已过期，请重新登录";
  });
  return {
    tab,
    config,
    stores,
    storeId,
    mode,
    catalog,
    categoryId,
    user,
    lines,
    orders,
    order,
    tables,
    tableCode,
    selectedAddressId,
    selectedAddressRevision,
    selectedAddress,
    note,
    quote,
    pickup,
    addresses,
    addressesState,
    addressLocked: addressLockedState,
    loadAddresses,
    openAddresses,
    selectDeliveryAddress,
    syncSelectedAddress,
    loadPickup: (date) => pickupController.load(date),
    selectPickup: (slot) => pickupController.select(slot),
    product,
    sheet,
    error,
    busy,
    loading,
    pending,
    store,
    products,
    count,
    subtotal,
    lineIssue,
    invalidCart,
    needsMenuRefresh,
    reselect,
    init,
    selectStore,
    selectMode,
    login,
    wechatLogin,
    logout,
    openProduct,
    add,
    change,
    checkout,
    getQuote,
    submit,
    showOrders,
    detail,
    cancel,
    pay,
    orderTotal,
    moreOrders,
    reload: () => run(loadCatalog),
    invalidateQuote: () => {
      quote.value = null;
    },
    money,
  };
}
