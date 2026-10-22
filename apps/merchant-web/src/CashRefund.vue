<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Order } from "./types";
import { money } from "./domain.mjs";
import { refundAmount } from "../../../packages/mini-core/src/cash-refunds.mjs";
const props = defineProps<{
  order: Order;
  state: any;
  controller: any;
  owner: boolean;
  locked: boolean;
}>();
const emit = defineEmits<{shifts:[]}>();
const acknowledged = ref(false);
watch(
  () => [props.order.id, props.state.attempt],
  () => {
    acknowledged.value = false;
  },
);
const available = computed(
  () => props.order.cashReceipt!.amountFen - (props.order.refundedFen ?? 0),
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
    if (props.controller.checkNew && !await props.controller.checkNew()) return;
    props.state.error = "";
    props.state.review = true;
    acknowledged.value = false;
  } catch (e) {
    props.state.error = (e as Error).message;
  }
}
</script>
<template>
  <section
    v-if="
      owner &&
      order.cashReceipt &&
      !state.attempt &&
      !state.corrupt &&
      available > 0
    "
    class="cash-refund"
  >
    <p v-if="state.error && state.error.includes('SHIFT_REQUIRED')" class="notice-strip" role="status">
      请先开班，原订单、退款金额和原因会保留。
      <button type="button" class="text-button" :disabled="state.busy || locked" @click="emit('shifts')">前往现金交班</button>
    </p>
    <button
      v-if="!state.expanded"
      type="button"
      class="quiet"
      :disabled="locked"
      @click="state.expanded = true"
    >
      登记现金退款
    </button>
    <form
      v-else
      @submit.prevent="
        state.review ? controller.submit(acknowledged) : review()
      "
    >
      <h3>登记现金退款</h3>
      <p>
        当前可退 <strong>{{ money(available) }}</strong>
      </p>
      <template v-if="!state.review"
        ><label class="field"
          ><span>本次退款金额（元）</span
          ><input
            v-model="state.amount"
            inputmode="decimal"
            autocomplete="off"
            maxlength="12"
            :disabled="state.busy || locked"
            required
            placeholder="输入本次退还金额" /></label
        ><label class="field"
          ><span>退款原因</span
          ><textarea
            v-model="state.reason"
            maxlength="500"
            :disabled="state.busy || locked"
            required
          /></label
      ></template>
      <div v-else class="refund-review">
        <p>
          本次退还 <strong>{{ money(amount) }}</strong>
        </p>
        <p>
          退后剩余 <strong>{{ money(available - (amount || 0)) }}</strong>
        </p>
        <p>{{ state.reason.trim() }}</p>
        <p>退款不增加商品库存</p>
        <p>预约已确认产能保留</p>
        <label class="acknowledge"
          ><input
            v-model="acknowledged"
            type="checkbox"
            :disabled="state.busy || locked"
          />已向顾客退还现金</label
        >
      </div>
      <div class="form-actions">
        <button
          type="button"
          class="quiet"
          :disabled="state.busy || locked"
          @click="
            state.review ? (state.review = false) : (state.expanded = false)
          "
        >
          {{ state.review ? "返回修改" : "收起" }}</button
        ><button
          class="primary"
          :disabled="state.busy || locked || (state.review && !acknowledged)"
        >
          {{
            state.busy
              ? "登记中…"
              : state.review
                ? "确认登记现金退款"
                : "核对退款"
          }}
        </button>
      </div>
    </form>
  </section>
</template>
<style scoped>
.cash-refund {
  font-size: 14px;
  margin-top: 20px;
}
.cash-refund form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  animation: refund-expand 0.18s ease-out;
}
.refund-review {
  background: #f4f6ee;
  border-radius: 12px;
  padding: 18px;
  display: grid;
  gap: 12px;
  overflow-wrap: anywhere;
}
.acknowledge {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
}
.acknowledge input {
  width: 20px;
  height: 20px;
  min-height: 20px;
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
  .cash-refund form {
    animation: none;
  }
}
</style>
