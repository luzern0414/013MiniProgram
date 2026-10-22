import {
  isPickupRejection,
  pickupErrorText,
} from "../../../packages/mini-core/src/pickup.mjs";
export const money = (fen) => {
  if (!Number.isSafeInteger(fen)) throw new Error("金额必须为整数分");
  return `${fen < 0 ? "-" : ""}¥${(Math.abs(fen) / 100).toFixed(2)}`;
};
export const toFen = (value) => {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw new Error("金额需为非负数，最多两位小数");
  const [whole, decimal = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 2_000_000_000)
    throw new Error("金额超出允许范围");
  return result;
};
export const canUseDevLogin = (devBuild, environment) =>
  devBuild === true && environment === "development";
export const errorMessage = (error) =>
  isPickupRejection(error) || error?.code === "PICKUP_CONFIGURATION_MISSING"
    ? pickupErrorText(error)
    : {
        FORBIDDEN: "你没有此门店的操作权限，请切换门店或联系管理员。",
        UNAUTHENTICATED: "登录已过期，请重新登录。",
        VERSION_CONFLICT: "页面已被修改，请重新加载并核对后发布。",
        DRAFT_CHANGED: '挂单已被修改，请核对最新版本；当前输入已保留。',
        SHIFT_REQUIRED: '尚未开班，请店主先到现金交班开班，再返回原订单确认现金。',
        SHIFT_ALREADY_OPEN: '门店已有活动班次，请重新读取并核对。',
        SHIFT_CHANGED: '班次收退款或状态已变化，请核对最新金额后重新确认关班。',
        SHIFT_TOTAL_TOO_LARGE: '本班现金汇总超出允许范围，请联系店主核对。',
        DRAFT_ALREADY_CONVERTED: '此挂单已生成正式订单，请查看原订单。',
        IDEMPOTENCY_CONFLICT: '原操作内容不一致，请保留原记录并联系店主核对。',
        STORE_CLOSED: "门店已休息，请营业后再下单。",
        OUT_OF_STOCK: "商品库存不足，请刷新商品后调整数量。",
        PRICE_CHANGED: "商品价格已变动，请重新确认金额。",
        CATALOG_CHANGED: "分类已调整，请刷新商品后重新确认。",
        PRODUCT_OPTIONS_CHANGED:
          "商品规格或口味已调整，请刷新菜单后重新选择并确认金额。",
        STATE_CONFLICT: "订单状态已变化，请刷新后重试。",
        INTEGRATION_UNAVAILABLE: "此服务尚未接通，当前无法完成操作。",
        VALIDATION_ERROR: "填写内容不符合要求，请核对金额、数量和必填项。",
        NOT_FOUND: "内容不存在或已移除，请刷新后重试。",
        NETWORK: "连接失败，请检查网络并重试。",
        TIMEOUT: "连接超时，请稍后重试。",
      }[error?.code] || "暂时无法完成操作，请稍后重试。";
export const orderActions = (order) => {
  if (order.paymentStatus !== "PAID") return [];
  return (
    {
      AWAITING_ACCEPTANCE: ["ACCEPT"],
      PREPARING: ["READY"],
      READY: order.mode === "DELIVERY" ? ["DISPATCH"] : ["COMPLETE"],
      DELIVERING: ["COMPLETE"],
    }[order.status] || []
  );
};
export const statusLabels = {
  PENDING_PAYMENT: "待付款",
  AWAITING_ACCEPTANCE: "待接单",
  PREPARING: "制作中",
  READY: "待取餐",
  DELIVERING: "配送中",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};
export const actionLabels = {
  ACCEPT: "接单并制作",
  START: "开始制作",
  READY: "标记出餐",
  DISPATCH: "开始配送",
  COMPLETE: "完成订单",
};
export const modeLabels = { DINE_IN: "堂食", PICKUP: "自取", DELIVERY: "外送" };
export const localTime = (value) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
export const isUncertainWrite = (error) =>
  ["NETWORK", "TIMEOUT", "UNKNOWN"].includes(error?.code);
export const samePageContent = (a, b) =>
  ["notice", "bannerTitle", "bannerSubtitle", "primaryColor"].every(
    (key) => a?.[key] === b?.[key],
  );
