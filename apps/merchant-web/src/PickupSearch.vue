<script setup lang="ts">
import { onUnmounted, reactive, ref } from "vue";
import { api } from "./api";
import type { Order } from "./types";
import {
  createPickupSearch,
  pickupDate,
  pickupWindowText,
} from "../../../packages/mini-core/src/pickup.mjs";
const props = defineProps<{ storeId: string; locked?: boolean }>();
const emit = defineEmits<{ open: [order: Order]; active: [value: boolean] }>();
const state = reactive<any>({});
const ctl = createPickupSearch({
  state,
  storeId: () => props.storeId,
  request: (path: string) => api(path),
});
function search() {
  emit("active", true);
  ctl.search();
}
function clear() {
  ctl.clear();
  emit("active", false);
}
onUnmounted(ctl.dispose);
</script>
<template>
  <div class="pickup-search panel">
    <form class="row wrap" @submit.prevent="search">
      <label class="field"
        ><span>取餐号</span
        ><input
          v-model="state.number"
          placeholder="输入完整取餐号"
          :disabled="locked || state.loading"
          required /></label
      ><label class="field"
        ><span>取餐日期（旧单按下单日）</span
        ><input
          v-model="state.date"
          type="date"
          :disabled="locked || state.loading"
          required /></label
      ><button class="quiet" :disabled="locked || state.loading">
        {{ state.loading ? "正在查询…" : "按取餐号查询" }}</button
      ><button
        v-if="state.active"
        class="text-button"
        type="button"
        :disabled="locked"
        @click="clear"
      >
        返回订单列表
      </button>
    </form>
    <p v-if="state.loading" class="muted">
      正在查询本店该日期与号码，已读取 {{ state.readPages }} 页匹配订单…
    </p>
    <p v-if="state.error" class="error-box" role="alert">
      {{ state.error }}，可重新查询。
    </p>
    <p v-if="state.complete && !state.items.length" class="muted">
      本店该日期没有匹配的取餐号，请核对日期和号码。
    </p>
    <div v-for="order in state.items" :key="order.id" class="search-result">
      <strong
        >{{ order.pickupNumber }} ·
        {{
          order.pickupServiceDate ||
          "旧订单 · 下单日 " + pickupDate(order.createdAt)
        }}</strong
      >
      <p>{{ order.number }} · {{ pickupWindowText(order.pickupWindow) }}</p>
      <button class="quiet" :disabled="locked" @click="emit('open', order)">
        查看订单
      </button>
    </div>
  </div>
</template>
<style scoped>
.pickup-search {
  margin-bottom: 18px;
  font-size: 14px;
}
.search-result {
  padding: 16px 0;
  border-top: 1px solid #dce5dd;
}
.field {
  margin: 0;
}
.row {
  align-items: end;
}
</style>
