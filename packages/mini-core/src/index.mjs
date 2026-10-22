export {
  pickupDate,
  pickupWindowText,
  pickupPreview,
  pickupErrorText,
  isPickupRejection,
  createPickupSelection,
  createPickupManager,
  createPickupRedemption,
  createPickupSearch,
} from "./pickup.mjs";
export {
  normalizeStaffAccount,
  staffLoginPayload,
  staffCreatePayload,
  staffEditPayload,
  staffConflict,
  staffErrorText,
  createStaffController,
} from "./staff.mjs";
export {
  catalogPayload,
  catalogErrorText,
  createCatalogController,
  createProductController,
  productPayload,
  selectableCategories,
  selectableUnits,
} from "./catalog-settings.mjs";
export {
  optionsRef,
  optionsDraft,
  optionsPayload,
  newOptionsValue,
  newOptionsGroup,
  newOptionsSku,
  previewCombinations,
  selectOptionsValue,
  removeNewOptionsGroup,
  attributeRule,
} from "./product-options.mjs";
export { createOptionsController } from "./options-editor.mjs";
export {
  enabledNodes,
  selectionIds,
  selectionKey,
  attributeSummary,
  optionsChangedText,
  resolveSelectionSku,
  initialSelection,
  selectionLine,
  cartSelectionIssue,
  isDefinitiveOrderRejection,
  toggleAttribute,
} from "./product-selection.mjs";
import {
  selectionKey,
  selectionIds,
  optionsChangedText,
} from "./product-selection.mjs";
import { isPickupRejection, pickupErrorText } from "./pickup.mjs";
export const money = (fen) => `¥${(Number(fen || 0) / 100).toFixed(2)}`;
export const modeNames = {
  PICKUP: "到店自取",
  DINE_IN: "堂食",
  DELIVERY: "外送",
};
export const statusNames = {
  PENDING_PAYMENT: "待付款",
  AWAITING_ACCEPTANCE: "待接单",
  PREPARING: "制作中",
  READY: "待取餐",
  DELIVERING: "配送中",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};
export const paymentNames = {
  UNPAID: "未付款",
  PAID: "已付款",
  CLOSED: "已关闭",
};
const clone = (value) => JSON.parse(JSON.stringify(value));
export const fingerprint = selectionKey;
const cartKey = (storeId, mode) => `cart:v1:${storeId}:${mode}`;
export function createCart(storage) {
  const get = (storeId, mode) => {
    const value = storage.get(cartKey(storeId, mode));
    return Array.isArray(value)
      ? clone(value).map((line) => ({
          ...line,
          attributeOptionIds: selectionIds(line.attributeOptionIds),
        }))
      : [];
  };
  return {
    get,
    add(storeId, mode, line, replaceKey) {
      const lines = get(storeId, mode).filter(
          (item) => fingerprint(item) !== replaceKey,
        ),
        key = fingerprint(line),
        current = lines.find((v) => fingerprint(v) === key);
      const quantity = (current?.quantity || 0) + line.quantity;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99)
        throw new Error("每种搭配最多99份");
      if (line.available !== undefined && quantity > line.available)
        throw new Error("数量超过当前可售库存，请减少数量");
      if (current)
        Object.assign(current, line, {
          quantity,
          modifierIds: selectionIds(line.modifierIds),
          attributeOptionIds: selectionIds(line.attributeOptionIds),
        });
      else
        lines.push({
          ...line,
          modifierIds: [...new Set(line.modifierIds || [])].sort(),
          attributeOptionIds: selectionIds(line.attributeOptionIds),
        });
      storage.set(cartKey(storeId, mode), lines);
      return lines;
    },
    change(storeId, mode, key, delta) {
      const lines = get(storeId, mode);
      const line = lines.find((v) => fingerprint(v) === key);
      if (!line) return lines;
      line.quantity = Math.min(99, line.quantity + delta);
      const result = lines.filter((v) => v.quantity > 0);
      storage.set(cartKey(storeId, mode), result);
      return result;
    },
    clear(storeId, mode) {
      storage.remove(cartKey(storeId, mode));
    },
  };
}
export const uniqueKey = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
export function createPendingOrder(storage) {
  const key = (userId) => `pending-order:v1:${userId}`;
  return {
    get: (userId) => storage.get(key(userId)),
    begin(userId, quoteId) {
      let pending = storage.get(key(userId));
      if (!pending) {
        pending = { quoteId, key: uniqueKey() };
        storage.set(key(userId), pending);
      }
      return pending;
    },
    clear(userId) {
      storage.remove(key(userId));
    },
  };
}
export function createCashAttempt(storage) {
  const key = (userId) => `cash-attempt:v1:${userId}`;
  return {
    get: (userId) => storage.get(key(userId)),
    begin(userId, details) {
      let attempt = storage.get(key(userId));
      if (!attempt) {
        attempt = { ...details, key: uniqueKey() };
        storage.set(key(userId), attempt);
      }
      return attempt;
    },
    clear: (userId) => storage.remove(key(userId)),
  };
}
export class ApiError extends Error {
  constructor(message, code, requestId, status) {
    super(message);
    this.code = code;
    this.requestId = requestId;
    this.status = status;
  }
}
export function createTransport({
  baseUrl,
  request,
  token = () => "",
  onUnauthorized = () => {},
}) {
  return async (path, { method = "GET", data, headers = {} } = {}) => {
    const requestId = uniqueKey();
    const sessionToken = token();
    let response;
    try {
      response = await request({
        url: baseUrl.replace(/\/$/, "") + path,
        method,
        data,
        timeout: 12000,
        header: {
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
          ...headers,
        },
      });
    } catch (error) {
      const timeout = /timeout/i.test(error?.errMsg || error?.message || "");
      throw new ApiError(
        timeout ? "请求超时，请重试" : "网络连接失败，请检查网络后重试",
        timeout ? "TIMEOUT" : "NETWORK_ERROR",
        requestId,
      );
    }
    const body = response.data;
    if (response.statusCode === 401 && sessionToken && token() === sessionToken)
      onUnauthorized();
    if (response.statusCode < 200 || response.statusCode >= 300 || body?.error)
      throw new ApiError(
        body?.error?.message || "服务暂不可用，请稍后重试",
        body?.error?.code || "SERVER_ERROR",
        body?.requestId || requestId,
        response.statusCode,
      );
    if (!body || !Object.hasOwn(body, "data"))
      throw new ApiError(
        "服务返回异常，请重试",
        "INVALID_RESPONSE",
        body?.requestId || requestId,
      );
    return body.data;
  };
}
export const uniStorage = {
  get: (key) => uni.getStorageSync(key),
  set: (key, value) => uni.setStorageSync(key, value),
  remove: (key) => uni.removeStorageSync(key),
};
export function createClient(client) {
  const sessionKey = `session:${client}`;
  return {
    storage: uniStorage,
    session: () => uniStorage.get(sessionKey),
    saveSession: (value) => uniStorage.set(sessionKey, value),
    logout: () => uniStorage.remove(sessionKey),
    api: createTransport({
      baseUrl:
        import.meta.env?.VITE_API_BASE_URL || "http://127.0.0.1:3000/api/v1",
      token: () => uniStorage.get(sessionKey)?.token,
      onUnauthorized: () => {
        uniStorage.remove(sessionKey);
        uni.$emit("session-expired");
      },
      request: (options) =>
        new Promise((resolve, reject) =>
          uni.request({ ...options, success: resolve, fail: reject }),
        ),
    }),
  };
}
export const confirm = (title, content) =>
  new Promise((resolve) =>
    uni.showModal({
      title,
      content,
      success: (r) => resolve(r.confirm),
      fail: () => resolve(false),
    }),
  );
export const errorText = (error) =>
  isPickupRejection(error) || error.code === "PICKUP_CONFIGURATION_MISSING"
    ? pickupErrorText(error)
    : `${error.code === "PRODUCT_OPTIONS_CHANGED" ? optionsChangedText : error.message || "操作失败，请重试"}${error.requestId ? `（编号 ${error.requestId}）` : ""}`;
export { refundAmount, refundLocked, refundStorageKey, readRefundAttempt, createCashRefund } from './cash-refunds.mjs';
export { draftSelection, hydrateDraft, draftStorageKey, draftLocked, readDraftAttempt, createDraftController } from './cashier-drafts.mjs';
export { shiftAmount, validShift, shiftStorageKey, shiftLocked, readShiftAttempt, createCashShiftController } from './cash-shifts.mjs';

export { addressStorageKey, readAddressAttempt, validAddress, addressLocked, addressErrorText, createCustomerAddresses } from './customer-addresses.mjs';
