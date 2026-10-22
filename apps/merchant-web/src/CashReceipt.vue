<script setup lang="ts">
import type { Order } from "./types";
import { money, localTime } from "./domain.mjs";
defineProps<{ order: Order }>();
</script>
<template>
  <section v-if="order.cashReceipt" class="cash-receipt" aria-label="现金凭证">
    <h3>
      现金凭证
      <span v-if="order.refundStatus === 'SUCCEEDED'" class="badge orange"
        >已全额退款</span
      ><span v-else-if="order.refundedFen" class="badge orange"
        >已部分退款</span
      >
    </h3>
    <p class="muted">{{ order.cashReceipt.shiftId ? `收款班次：${order.cashReceipt.shiftId}` : '历史收款未归班' }}</p>
    <dl>
      <div>
        <dt>原入账</dt>
        <dd>{{ money(order.cashReceipt.amountFen) }}</dd>
      </div>
      <div>
        <dt>实收现金</dt>
        <dd>{{ money(order.cashReceipt.tenderedFen) }}</dd>
      </div>
      <div>
        <dt>找零</dt>
        <dd>{{ money(order.cashReceipt.changeFen) }}</dd>
      </div>
      <div>
        <dt>累计已退</dt>
        <dd>{{ money(order.refundedFen ?? 0) }}</dd>
      </div>
      <div class="net">
        <dt>净实收</dt>
        <dd>{{ money(order.netPaidFen ?? order.cashReceipt.amountFen) }}</dd>
      </div>
    </dl>
    <div
      v-for="refund in order.cashRefunds"
      :key="refund.id"
      class="refund-entry"
    >
      <strong>退还现金 {{ money(refund.amountFen) }}</strong>
      <p>{{ refund.reason }}</p>
      <p class="muted">{{ localTime(refund.createdAt) }}</p>
      <p class="muted">{{ refund.shiftId ? `退款班次：${refund.shiftId}` : '历史退款未归班' }}</p>
    </div>
  </section>
</template>
<style scoped>
.cash-receipt {
  font-size: 14px;
  padding: 20px 0;
  border-top: 1px solid #dce5dd;
  margin-top: 16px;
}
.cash-receipt h3 {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
dl {
  margin: 12px 0;
}
dl div {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  margin: 9px 0;
}
dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.net {
  color: #28533e;
  font-weight: 700;
  border-top: 1px solid #dce5dd;
  padding-top: 12px;
}
.refund-entry {
  border-left: 3px solid #bd682d;
  padding: 8px 14px;
  margin-top: 16px;
  overflow-wrap: anywhere;
}
</style>
