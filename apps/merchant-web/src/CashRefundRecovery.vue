<script setup lang="ts">
import { money } from "./domain.mjs";
defineProps<{ state: any; controller: any; owner: boolean; locked: boolean }>();
</script>
<template>
  <section
    v-if="state.blocked || state.error || state.notice"
    class="refund-recovery"
    aria-live="polite"
  >
    <h3 v-if="state.blocked">现金退款待核对</h3>
    <p v-if="state.attempt">
      原订单 {{ state.attempt.orderId }} · 本次
      {{ money(state.attempt.amountFen) }} · {{ state.attempt.reason }}
    </p>
    <p v-if="state.error" role="alert">{{ state.error }}</p>
    <p v-if="state.notice">{{ state.notice }}</p>
    <div v-if="state.attempt" class="row wrap">
      <button
        class="quiet"
        :disabled="state.busy || locked"
        @click="controller.load"
      >
        读取原订单与明细</button
      ><button
        v-if="owner && state.attempt.phase === 'unknown'"
        class="primary"
        :disabled="state.busy || locked"
        @click="controller.submit(true)"
      >
        恢复原退款并核对结果
      </button>
    </div>
  </section>
</template>
<style scoped>
.refund-recovery {
  font-size: 14px;
  padding: 18px;
  background: #fff4e6;
  border: 1px solid #e8d2b9;
  border-radius: 12px;
  margin: 16px 0;
  display: grid;
  gap: 12px;
  overflow-wrap: anywhere;
}
</style>
