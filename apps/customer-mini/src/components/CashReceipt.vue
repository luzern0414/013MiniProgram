<script setup>
import { money } from "@restaurant/mini-core";
defineProps({ order: Object });
const time = (value) =>
  new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
</script>
<template>
  <view v-if="order.cashReceipt" class="cash-receipt">
    <text class="receipt-heading">现金凭证</text
    ><text v-if="order.refundStatus === 'SUCCEEDED'" class="refund-mark"
      >已全额退款</text
    ><text v-else-if="order.refundedFen" class="refund-mark">已部分退款</text>
    <view class="receipt-row"
      ><text>原入账</text
      ><text>{{ money(order.cashReceipt.amountFen) }}</text></view
    ><view class="receipt-row"
      ><text>实收现金</text
      ><text>{{ money(order.cashReceipt.tenderedFen) }}</text></view
    ><view class="receipt-row"
      ><text>找零</text
      ><text>{{ money(order.cashReceipt.changeFen) }}</text></view
    ><view class="receipt-row"
      ><text>累计已退</text
      ><text>{{ money(order.refundedFen ?? 0) }}</text></view
    ><view class="receipt-row receipt-net"
      ><text>净实收</text
      ><text>{{
        money(order.netPaidFen ?? order.cashReceipt.amountFen)
      }}</text></view
    >
    <view
      v-for="refund in order.cashRefunds"
      :key="refund.id"
      class="refund-entry"
      ><text class="receipt-heading"
        >退还现金 {{ money(refund.amountFen) }}</text
      ><text>{{ refund.reason }}</text
      ><text>{{ time(refund.createdAt) }}</text></view
    >
  </view>
</template>
<style scoped>
.cash-receipt {
  font-size: 14px;
  border-top: 1px solid #dce5dd;
  padding-top: 18px;
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.receipt-heading {
  font-size: 16px;
  font-weight: 600;
}
.receipt-row {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  font-variant-numeric: tabular-nums;
}
.receipt-net {
  font-weight: 700;
  color: #28533e;
  border-top: 1px solid #dce5dd;
  padding-top: 12px;
}
.refund-mark {
  color: #9a4b1e;
  font-weight: 600;
}
.refund-entry {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-left: 3px solid #bd682d;
  padding: 8px 12px;
  overflow-wrap: anywhere;
}
</style>
