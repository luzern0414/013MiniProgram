import test from "node:test";
import assert from "node:assert/strict";
import {
  money,
  toFen,
  canUseDevLogin,
  errorMessage,
  orderActions,
  isUncertainWrite,
  samePageContent,
} from "./domain.mjs";

test("uses exact integer cents and rejects fractional cents", () => {
  assert.equal(money(1099), "¥10.99");
  assert.equal(toFen("10.99"), 1099);
  assert.throws(() => toFen("1.001"), /两位/);
  assert.throws(() => toFen("-1"), /金额/);
});
test("development login requires both development build and server environment", () => {
  assert.equal(canUseDevLogin(true, "development"), true);
  assert.equal(canUseDevLogin(false, "development"), false);
  assert.equal(canUseDevLogin(true, "production"), false);
  assert.equal(canUseDevLogin(true, undefined), false);
});
test("rejects unknown errors without leaking backend internals", () => {
  assert.equal(
    errorMessage({ code: "FORBIDDEN", message: "not safe SQL" }),
    "你没有此门店的操作权限，请切换门店或联系管理员。",
  );
  assert.equal(
    errorMessage({ code: "VERSION_CONFLICT" }),
    "页面已被修改，请重新加载并核对后发布。",
  );
  assert.equal(
    errorMessage({ message: "prisma stack" }),
    "暂时无法完成操作，请稍后重试。",
  );
});
test("catalog changes explain how to recover an invalid quote", () => {
  assert.equal(
    errorMessage({ code: "CATALOG_CHANGED" }),
    "分类已调整，请刷新商品后重新确认。",
  );
  assert.equal(
    errorMessage({ code: "PRODUCT_OPTIONS_CHANGED" }),
    "商品规格或口味已调整，请刷新菜单后重新选择并确认金额。",
  );
});
test("only legal paid order actions are offered", () => {
  assert.deepEqual(
    orderActions({ status: "PENDING_PAYMENT", paymentStatus: "UNPAID" }),
    [],
  );
  assert.deepEqual(
    orderActions({ status: "AWAITING_ACCEPTANCE", paymentStatus: "PAID" }),
    ["ACCEPT"],
  );
  assert.deepEqual(
    orderActions({ status: "COMPLETED", paymentStatus: "PAID" }),
    [],
  );
});
test("keeps the original order request after an ambiguous network result", () => {
  assert.equal(isUncertainWrite({ code: "NETWORK" }), true);
  assert.equal(isUncertainWrite({ code: "TIMEOUT" }), true);
  assert.equal(isUncertainWrite({ code: "UNKNOWN" }), true);
  assert.equal(isUncertainWrite({ code: "PRICE_CHANGED" }), false);
  assert.equal(isUncertainWrite({ code: "OUT_OF_STOCK" }), false);
});
test("page edit state compares values regardless of database JSON key order", () => {
  const draft = {
    notice: "营业中",
    bannerTitle: "好好吃饭",
    bannerSubtitle: "今日新鲜",
    primaryColor: "#aa5500",
  };
  const published = {
    primaryColor: "#aa5500",
    bannerSubtitle: "今日新鲜",
    notice: "营业中",
    bannerTitle: "好好吃饭",
  };
  assert.equal(samePageContent(draft, published), true);
  assert.equal(
    samePageContent(draft, { ...published, notice: "明日营业" }),
    false,
  );
});
