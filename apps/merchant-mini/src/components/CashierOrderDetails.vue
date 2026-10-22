<script setup>
import { computed } from 'vue';
import { attributeSummary, money, modeNames, pickupWindowText, statusNames, paymentNames } from '@restaurant/mini-core';
const props = defineProps({ order: { type: Object, required: true } });
const totalItems = computed(() => (props.order.lines || []).reduce((total, line) => total + line.quantity, 0));
</script>
<template>
  <view class="cashier-order-details" aria-label="正式订单明细">
    <text class="sheet-title">正式订单 {{ order.number || order.id }}</text>
    <text class="label">{{ statusNames[order.status] }} · {{ paymentNames[order.paymentStatus] }}</text>
    <view class="row"><text class="sheet-title">订单明细</text><text>{{ totalItems }}份</text></view>
    <text class="context">{{ modeNames[order.mode] }}<text v-if="order.mode === 'DINE_IN'"> · {{ order.tableName || '未记录桌台' }}</text></text>
    <text v-if="order.mode === 'PICKUP'" class="context">取餐号 {{ order.pickupNumber }} · {{ order.pickupServiceDate || '旧订单' }} · {{ pickupWindowText(order.pickupWindow) }}</text>
    <view v-for="(line, index) in order.lines" :key="index" class="list-item">
      <text class="label">{{ line.productName }}</text>
      <text class="muted">{{ line.skuName }}<text v-for="(modifier, i) in line.modifiers" :key="i"> · {{ modifier.name }}（{{ money(modifier.priceFen) }}）</text></text>
      <text v-if="attributeSummary(line)" class="muted">{{ attributeSummary(line) }}</text>
      <view class="row"><text>{{ money(line.lineTotalFen) }}</text><text>×{{ line.quantity }}</text></view>
    </view>
    <text v-if="order.note" class="context">备注：{{ order.note }}</text>
    <view class="total-row row"><text>订单应收</text><text>{{ money(order.totalFen) }}</text></view>
  </view>
</template>
<style scoped>
.cashier-order-details{font-size:14px;word-break:break-all;overflow-wrap:break-word}.cashier-order-details>.sheet-title,.cashier-order-details>.label,.context,.muted{display:block}.context,.cashier-order-details>.row{margin:12px 0}.muted{margin:6px 0}
</style>
