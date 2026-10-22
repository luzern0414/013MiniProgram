<script setup>
import { computed, ref, watch } from "vue";
import { money, refundAmount } from "@restaurant/mini-core";
import AccessibleInput from "./AccessibleInput.vue";
const props = defineProps({
  order: Object,
  state: Object,
  controller: Object,
  owner: Boolean,
  locked: Boolean,
});
const acknowledged = ref(false);
watch(
  () => [props.order.id, props.state.attempt],
  () => (acknowledged.value = false),
);
const available = computed(
  () => props.order.cashReceipt.amountFen - (props.order.refundedFen ?? 0),
);
const amount = computed(() => {
  try {
    return refundAmount(props.state.amount, props.order);
  } catch {
    return undefined;
  }
});
async function review() {
  try {
    refundAmount(props.state.amount, props.order);
    if (!props.state.reason.trim()) throw Error("请填写退款原因");
    if (!await props.controller.checkNew()) return;
    props.state.error = "";
    props.state.review = true;
    acknowledged.value = false;
  } catch (e) {
    props.state.error = e.message;
  }
}
</script>
<template>
  <view
    v-if="
      owner &&
      order.cashReceipt &&
      !state.attempt &&
      !state.corrupt &&
      available > 0
    "
    class="cash-refund"
  >
    <button
      v-if="!state.expanded"
      class="outline wide"
      :disabled="locked"
      @click="state.expanded = true"
    >
      登记现金退款
    </button>
    <view v-else class="refund-form"
      ><text class="sheet-title">登记现金退款</text
      ><text>当前可退 {{ money(available) }}</text>
      <template v-if="!state.review"
        ><AccessibleInput
          input-id="cash-refund-amount"
          v-model="state.amount"
          label="本次退款金额（元）"
          :maxlength="12"
          :disabled="state.busy || locked"
          placeholder="输入本次退还金额" /><AccessibleInput
          input-id="cash-refund-reason"
          v-model="state.reason"
          label="退款原因"
          :maxlength="500"
          :disabled="state.busy || locked"
      /></template>
      <view v-else class="refund-review"
        ><text>本次退还 {{ money(amount) }}</text
        ><text>退后剩余 {{ money(available - (amount || 0)) }}</text
        ><text>{{ state.reason.trim() }}</text
        ><text>退款不增加商品库存</text><text>预约已确认产能保留</text
        ><button
          class="outline wide"
          :aria-pressed="acknowledged"
          :disabled="state.busy || locked"
          @click="acknowledged = !acknowledged"
        >
          {{
            acknowledged ? "已确认：已向顾客退还现金" : "确认：已向顾客退还现金"
          }}
        </button></view
      >
      <button
        class="primary wide"
        :disabled="state.busy || locked || (state.review && !acknowledged)"
        @click="state.review ? controller.submit(acknowledged) : review()"
      >
        {{
          state.busy
            ? "登记中…"
            : state.review
              ? "确认登记现金退款"
              : "核对退款"
        }}</button
      ><button
        class="outline wide"
        :disabled="state.busy || locked"
        @click="
          state.review ? (state.review = false) : (state.expanded = false)
        "
      >
        {{ state.review ? "返回修改" : "收起" }}
      </button>
    </view>
  </view>
</template>
<style scoped>
.cash-refund {
  font-size: 14px;
  margin-top: 18px;
}
.refund-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  animation: refund-expand 0.18s ease-out;
}
.refund-review {
  background: #f4f6ee;
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-wrap: anywhere;
}
@keyframes refund-expand {
  from {
    opacity: 0.4;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .refund-form {
    animation: none;
  }
}
</style>
