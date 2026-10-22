<script setup>
import AccessibleInput from "./AccessibleInput.vue";
import { onUnmounted, reactive, watch } from "vue";
import {
  createClient,
  createPickupRedemption,
  pickupWindowText,
} from "@restaurant/mini-core";
const props = defineProps({ order: Object, storeId: String, locked: Boolean });
const emit = defineEmits(["busy", "changed"]);
const state = reactive({});
const ctl = createPickupRedemption({
  state,
  storeId: () => props.storeId,
  orderId: () => props.order.id,
  request: createClient("merchant").api,
  onChanged: async (order) => {
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
  <view class="pickup-redemption">
    <text class="sheet-title">核销取餐</text
    ><text>{{ pickupWindowText(order.pickupWindow) }}</text
    ><text class="safe-note">请当面核对顾客出示的号码，确认后完成本单。</text>
    <AccessibleInput
      :input-id="'pickup-number-' + order.id"
      v-model="state.number"
      label="顾客出示的取餐号"
      :maxlength="100"
      :disabled="state.busy || state.blocked || locked"
      placeholder="输入完整取餐号"
    />
    <text v-if="state.error" class="error" role="alert">{{ state.error }}</text
    ><text v-if="state.notice" class="notice">{{ state.notice }}</text>
    <button
      v-if="!state.blocked"
      class="primary wide"
      :disabled="
        state.busy ||
        locked ||
        order.status !== 'READY' ||
        order.paymentStatus !== 'PAID'
      "
      @click="ctl.submit"
    >
      {{ state.busy ? "核销中…" : "核销取餐" }}
    </button>
    <button
      v-if="state.blocked"
      class="outline wide"
      :disabled="state.busy || locked"
      @click="ctl.load"
    >
      读取订单并核对结果
    </button>
  </view>
</template>
<style scoped>
.pickup-redemption {
  font-size: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-top: 1px solid #dce5dd;
  padding-top: 18px;
  margin-top: 18px;
}
input {
  font-size: 16px;
}
label {
  font-size: 14px;
}
</style>
