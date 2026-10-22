<script setup>
import { onMounted } from "vue";
import { pickupWindowText } from "@restaurant/mini-core";
const props = defineProps({
  state: Object,
  locked: Boolean,
  load: Function,
  select: Function,
});
onMounted(() => props.load());
</script>
<template>
  <view class="pickup-selector">
    <text class="label">取餐时间</text>
    <button
      class="chip"
      :class="{ chosen: !state.slotId }"
      :disabled="locked || state.loading"
      @click="select(null)"
    >
      尽快取餐
    </button>
    <view class="row">
      <picker
        mode="date"
        :value="state.date"
        :disabled="locked || state.loading"
        @change="load($event.detail.value)"
        ><view class="store-picker">预约日期：{{ state.date }}⌄</view></picker
      >
      <button class="link" :disabled="locked || state.loading" @click="load()">
        {{ state.loading ? "查询中…" : "查询时段" }}
      </button>
    </view>
    <text v-if="state.selected" class="safe-note"
      >已选：{{ pickupWindowText(state.selected) }}</text
    >
    <text v-if="state.error" class="error" role="alert">{{ state.error }}</text>
    <text
      v-if="
        state.slotId &&
        (state.needsRefresh || !state.slots.some((s) => s.id === state.slotId))
      "
      class="notice"
      >原取餐时间暂不可选，请查询后重新选择；原选择仍为你保留。</text
    >
    <view class="pickup-windows">
      <button
        v-for="slot in state.slots"
        :key="slot.id"
        class="chip"
        :class="{ chosen: state.slotId === slot.id }"
        :disabled="locked || state.loading"
        @click="select(slot)"
      >
        <text>{{ pickupWindowText(slot) }}</text
        ><text>剩余 {{ slot.remaining }} 单</text>
      </button>
    </view>
    <text
      v-if="!state.loading && !state.slots.length && !state.error"
      class="safe-note"
      >这一天暂无可预约时段，可查询其他日期或选择尽快取餐。</text
    >
    <text class="safe-note">名额以提交订单时为准。</text>
  </view>
</template>
<style scoped>
.pickup-selector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 16px 0;
  font-size: 14px;
}
.pickup-windows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pickup-windows button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  white-space: normal;
  text-align: left;
  font-size: 14px;
}
</style>
