<script setup>
import AccessibleInput from "./AccessibleInput.vue";
import { onUnmounted, reactive } from "vue";
import {
  createClient,
  createPickupSearch,
  pickupDate,
  pickupWindowText,
} from "@restaurant/mini-core";
const props = defineProps({ storeId: String, locked: Boolean });
const emit = defineEmits(["open", "active"]);
const state = reactive({});
const ctl = createPickupSearch({
  state,
  storeId: () => props.storeId,
  request: createClient("merchant").api,
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
  <view class="panel pickup-search">
    <AccessibleInput
      :input-id="'pickup-search-' + storeId"
      v-model="state.number"
      label="取餐号"
      :maxlength="100"
      :disabled="locked || state.loading"
      placeholder="输入完整取餐号"
    />
    <text class="safe-note">取餐日期（旧单按下单日）</text
    ><picker
      mode="date"
      :value="state.date"
      :disabled="locked || state.loading"
      @change="state.date = $event.detail.value"
      ><view class="store-picker">{{ state.date }}⌄</view></picker
    >
    <button
      class="outline wide"
      :disabled="locked || state.loading"
      @click="search"
    >
      {{ state.loading ? "正在查询…" : "按取餐号查询" }}</button
    ><button v-if="state.active" class="link" :disabled="locked" @click="clear">
      返回订单列表
    </button>
    <text v-if="state.loading" class="safe-note"
      >正在查询本店该日期与号码，已读取 {{ state.readPages }} 页匹配订单…</text
    ><text v-if="state.error" class="error" role="alert"
      >{{ state.error }}，可重新查询。</text
    >
    <text v-if="state.complete && !state.items.length" class="safe-note"
      >本店该日期没有匹配的取餐号，请核对日期和号码。</text
    >
    <view v-for="order in state.items" :key="order.id" class="list-item"
      ><text class="label"
        >{{ order.pickupNumber }} ·
        {{
          order.pickupServiceDate ||
          "旧订单 · 下单日 " + pickupDate(order.createdAt)
        }}</text
      ><text
        >{{ order.number }} · {{ pickupWindowText(order.pickupWindow) }}</text
      ><button class="link" :disabled="locked" @click="emit('open', order)">
        查看订单
      </button></view
    >
  </view>
</template>
<style scoped>
.pickup-search {
  font-size: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
input {
  font-size: 16px;
}
label {
  font-size: 14px;
}
</style>
