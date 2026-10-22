<script setup lang="ts">
import { onUnmounted, reactive, watch } from "vue";
import { api } from "./api";
import type { Order } from "./types";
import {
  createPickupRedemption,
  pickupWindowText,
} from "../../../packages/mini-core/src/pickup.mjs";
const props = defineProps<{
  order: Order;
  storeId: string;
  locked?: boolean;
}>();
const emit = defineEmits<{ busy: [value: boolean]; changed: [order: Order] }>();
const state = reactive<any>({});
const ctl = createPickupRedemption({
  state,
  storeId: () => props.storeId,
  orderId: () => props.order.id,
  request: (path: string, options?: any) =>
    api(path, options ? { method: options.method, body: options.data } : {}),
  onChanged: async (order: any) => {
    emit("changed", order);
  },
});
watch(
  () => [state.busy, state.blocked],
  () => emit("busy", !!(state.busy || state.blocked)),
  { flush: "sync" },
);
onUnmounted(() => {
  ctl.dispose();
  emit("busy", false);
});
</script>
<template>
  <form class="pickup-redemption" @submit.prevent="ctl.submit">
    <h3>核销取餐</h3>
    <p>{{ pickupWindowText(order.pickupWindow) }}</p>
    <p class="muted">请当面核对顾客出示的号码，确认后完成本单。</p>
    <label class="field"
      ><span>顾客出示的取餐号</span
      ><input
        v-model="state.number"
        autocomplete="off"
        maxlength="100"
        required
        :disabled="state.busy || state.blocked || locked"
        placeholder="请输入取餐号"
    /></label>
    <p v-if="state.error" class="error-box" role="alert">{{ state.error }}</p>
    <p v-if="state.notice" class="success">{{ state.notice }}</p>
    <button
      v-if="!state.blocked"
      class="primary"
      :disabled="
        state.busy ||
        locked ||
        order.status !== 'READY' ||
        order.paymentStatus !== 'PAID'
      "
    >
      {{ state.busy ? "核销中…" : "核销取餐" }}
    </button>
    <button
      v-if="state.blocked"
      type="button"
      class="quiet"
      :disabled="state.busy || locked"
      @click="ctl.load"
    >
      读取订单并核对结果
    </button>
  </form>
</template>
<style scoped>
.pickup-redemption {
  font-size: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-top: 1px solid #dce5dd;
  padding-top: 20px;
  margin-top: 20px;
}
</style>
