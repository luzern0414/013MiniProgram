<script setup lang="ts">
import { onMounted } from "vue";
import { pickupWindowText } from "../../../packages/mini-core/src/pickup.mjs";
const props = defineProps<{
  state: any;
  locked: boolean;
  load: (date?: string) => unknown;
  select: (slot: any) => unknown;
}>();
onMounted(() => props.load());
</script>
<template>
  <div class="pickup-selector">
    <strong>取餐时间</strong>
    <button
      type="button"
      class="quiet"
      :class="{ selected: !state.slotId }"
      :disabled="locked || state.loading"
      @click="select(null)"
    >
      尽快取餐
    </button>
    <label class="field"
      ><span>预约日期（北京时间）</span
      ><input
        type="date"
        :value="state.date"
        :disabled="locked || state.loading"
        @change="load(($event.target as HTMLInputElement).value)"
    /></label>
    <button
      type="button"
      class="quiet"
      :disabled="locked || state.loading"
      @click="load()"
    >
      {{ state.loading ? "查询中…" : "查询时段" }}
    </button>
    <p v-if="state.selected" class="notice-strip">
      已选：{{ pickupWindowText(state.selected) }}
    </p>
    <p v-if="state.error" class="error-box" role="alert">{{ state.error }}</p>
    <p
      v-if="
        state.slotId &&
        (state.needsRefresh ||
          !state.slots.some((s: any) => s.id === state.slotId))
      "
      class="notice"
    >
      原取餐时间暂不可选，请查询后重新选择；原选择仍为你保留。
    </p>
    <button
      v-for="slot in state.slots"
      :key="slot.id"
      type="button"
      class="quiet pickup-window"
      :class="{ selected: state.slotId === slot.id }"
      :disabled="locked || state.loading"
      @click="select(slot)"
    >
      <span>{{ pickupWindowText(slot) }}</span
      ><strong>剩余 {{ slot.remaining }} 单</strong>
    </button>
    <p
      v-if="!state.loading && !state.slots.length && !state.error"
      class="muted"
    >
      这一天暂无可预约时段，可查询其他日期或选择尽快取餐。
    </p>
    <p class="muted">名额以提交订单时为准。</p>
  </div>
</template>
<style scoped>
.pickup-selector {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 16px 0;
  font-size: 14px;
}
.pickup-window {
  align-items: flex-start;
  flex-direction: column;
  text-align: left;
  white-space: normal;
}
.selected {
  border-color: var(--primary, #35664a);
  background: #edf5ef;
}
</style>
