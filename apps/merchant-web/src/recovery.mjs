import { toFen } from "./domain.mjs";
import {
  selectionIds,
  selectionKey,
} from "../../../packages/mini-core/src/product-selection.mjs";
export const restoreSelectionCart = (cart = []) =>
  cart.map((line) => ({
    ...line,
    attributeOptionIds: selectionIds(line.attributeOptionIds),
    key: selectionKey(line),
  }));
export const createRecovery = (storage, userId, storeId) => {
  const key = `merchant-checkout:${encodeURIComponent(userId)}:${encodeURIComponent(storeId)}`;
  return {
    save(state) {
      storage.setItem(
        key,
        JSON.stringify({ version: 1, userId, storeId, state }),
      );
    },
    read() {
      try {
        const saved = JSON.parse(storage.getItem(key) || "null");
        return saved?.version === 1 &&
          saved.userId === userId &&
          saved.storeId === storeId
          ? saved.state
          : null;
      } catch {
        return null;
      }
    },
    clear() {
      storage.removeItem(key);
    },
  };
};
export const submittedCash = (previous, input, totalFen) => {
  const amount = previous ?? toFen(input);
  if (amount < totalFen) throw new Error("实收现金不能少于应收金额。");
  return amount;
};
export const confirmedCash = (order) => {
  const receipt = order.cashReceipt;
  if (
    !receipt ||
    !["amountFen", "tenderedFen", "changeFen"].every((key) =>
      Number.isSafeInteger(receipt[key]),
    ) ||
    receipt.tenderedFen - receipt.amountFen !== receipt.changeFen
  )
    throw new Error("收款凭证尚未读取，请重试查询确认结果。");
  return Object.freeze({ ...receipt });
};
export const closeCashDialog = () => ({ selected: undefined, cash: false });
