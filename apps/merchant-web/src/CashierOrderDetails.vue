<script setup lang="ts">
import { computed } from 'vue';
import type { Order } from './types';
import { money } from './domain.mjs';
import { attributeSummary } from '../../../packages/mini-core/src/product-selection.mjs';
import { pickupWindowText } from '../../../packages/mini-core/src/pickup.mjs';
const props = defineProps<{ order: Order }>();
const totalItems = computed(() => (props.order.lines ?? []).reduce((total, line) => total + line.quantity, 0));
</script>
<template>
  <section aria-label="正式订单明细">
    <div class="panel-title"><h2>订单明细</h2><span class="muted">{{ totalItems }} 件</span></div>
    <p class="notice-strip">
      {{ order.number }} · {{ order.mode === 'DINE_IN' ? '堂食' : order.mode === 'PICKUP' ? '到店自取' : '配送' }}
      <span v-if="order.mode === 'DINE_IN'"> · {{ order.tableName || '未记录桌台' }}</span>
    </p>
    <p v-if="order.mode === 'PICKUP'" class="notice-strip">
      取餐号 {{ order.pickupNumber }} · {{ order.pickupServiceDate || '旧订单' }} · {{ pickupWindowText(order.pickupWindow) }}
    </p>
    <div class="cart-lines">
      <div v-for="(line, index) in order.lines" :key="index" class="cart-line">
        <strong>{{ line.productName }}</strong>
        <p class="muted">{{ line.skuName }}<span v-for="(modifier, i) in line.modifiers" :key="i"> · {{ modifier.name }}（{{ money(modifier.priceFen) }}）</span></p>
        <p v-if="attributeSummary(line)" class="muted">{{ attributeSummary(line) }}</p>
        <div class="row between"><strong>{{ money(line.lineTotalFen) }}</strong><span>× {{ line.quantity }}</span></div>
      </div>
    </div>
    <p v-if="order.note">备注：{{ order.note }}</p>
  </section>
</template>
