<script setup>
import { computed, watch } from 'vue';
import { money, pickupWindowText } from '@restaurant/mini-core';
import AccessibleInput from './AccessibleInput.vue';
import CashierSelection from './CashierSelection.vue';
import CashierDrafts from './CashierDrafts.vue';
import CashierOrderDetails from './CashierOrderDetails.vue';
const props = defineProps({ cashier: { type: Object, required: true }, store: Object, active: Boolean, locked: Boolean });
const state = computed(() => props.cashier.state);
const editingLocked = computed(() => props.locked || props.cashier.editingLocked());
const drafts = computed(() => state.value.drafts);
const tables = computed(() => state.value.tables.filter(t => t.enabled !== false));
const selectedTable = computed(() => tables.value.findIndex(t => t.code === state.value.tableCode));
watch([() => props.active, () => props.locked], () => { if (props.active && !props.locked && !state.value.catalog.products.length) props.cashier.loadMenu(); }, { immediate: true });
const field = (name, value) => props.cashier.editField(name, value);
</script>
<template>
  <view class="cashier-panel">
    <text class="title">收银</text><text class="muted">选菜、挂单、核价后生成订单；现金由订单详情明确确认收款。</text>
    <CashierDrafts :cashier="cashier" :locked="locked" />
    <view v-if="drafts.order" class="panel">
      <CashierOrderDetails :order="drafts.order" />
      <text class="safe-note">已读取真实订单。请查看订单状态，再明确确认实收现金。</text><button class="primary wide" :disabled="locked || cashier.navigationLocked()" @click="cashier.showOrder()">查看订单与收款</button>
    </view>
    <template v-else>
    <CashierSelection :cashier="cashier" :locked="locked" />
    <view class="panel">
      <AccessibleInput :model-value="state.name" label="挂单名称" input-id="cashier-draft-name" :maxlength="60" placeholder="便于取单识别，例如姓名或桌号" :disabled="editingLocked" @update:model-value="field('name',$event)" />
      <text class="label">用餐方式</text><view class="chips"><button v-for="mode in ['PICKUP','DINE_IN']" :key="mode" class="chip" :class="{chosen:state.mode === mode}" :disabled="editingLocked || !store.serviceModes?.includes(mode)" @click="field('mode',mode)">{{ mode === 'DINE_IN' ? '堂食' : '到店自取' }}</button></view>
      <view v-if="state.mode === 'DINE_IN'" class="field"><text class="label">桌台</text><picker :range="tables" range-key="name" :value="Math.max(selectedTable,0)" :disabled="editingLocked" @change="field('tableCode',tables[Number($event.detail.value)]?.code || '')"><view class="store-picker">{{ selectedTable >= 0 ? tables[selectedTable].name : state.tableCode ? '原桌码 ' + state.tableCode + ' 暂不可用，请重新选择' : '请选择桌台' }}⌄</view></picker><text v-if="selectedTable < 0 && state.tableCode" class="error">原桌码已保留，核价前须重新核对。</text></view>
      <view v-if="state.mode === 'PICKUP'" class="pickup-selector">
        <text class="label">取餐时间</text><button class="chip" :class="{chosen:!state.pickup.slotId}" :disabled="editingLocked" @click="cashier.pickup.select(null)">尽快取餐</button>
        <view class="row"><picker mode="date" :value="state.pickup.date" :disabled="editingLocked" @change="cashier.pickup.load($event.detail.value)"><view class="store-picker">预约日期：{{ state.pickup.date }}⌄</view></picker><button class="link" :disabled="locked || state.pickup.loading || drafts.busy" @click="cashier.pickup.load()">查询时段</button></view>
        <text v-if="state.pickup.slotId" class="safe-note">原预约 {{ state.pickup.slotId }}{{ state.pickup.selected ? ' · ' + pickupWindowText(state.pickup.selected) : ' · 请查询核对' }}</text><text v-if="state.pickup.error" class="error">{{ state.pickup.error }}</text>
        <text v-if="state.pickup.slotId && (state.pickup.needsRefresh || !state.pickup.slots.some(s => s.id === state.pickup.slotId))" class="notice">原预约尚未确认，已保留原选择，请查询后重新核对。</text>
        <view class="pickup-windows"><button v-for="slot in state.pickup.slots" :key="slot.id" class="chip" :class="{chosen:state.pickup.slotId === slot.id}" :disabled="editingLocked" @click="cashier.pickup.select(slot)">{{ pickupWindowText(slot) }} · 剩余{{ slot.remaining }}单</button></view>
        <text v-if="!state.pickup.loading && !state.pickup.slots.length" class="safe-note">暂无可预约时段，可查询其他日期；取餐名额以提交时为准。</text>
      </view>
      <view class="field"><text class="label">备注</text><textarea :value="state.note" :maxlength="500" :disabled="editingLocked" placeholder="例如少盐、餐具数量" @input="field('note',$event.detail.value)" /></view>
      <view v-if="state.error" class="error" role="alert">{{ state.error }}</view>
      <view class="order-actions"><button class="outline" :disabled="editingLocked || !state.cart.length" @click="cashier.save()">{{ drafts.remote ? '保存挂单' : '挂单' }}</button><button class="primary" :disabled="editingLocked || !state.cart.length" @click="cashier.quote()">保存并核价</button></view>
      <view v-if="drafts.quote" class="notice"><view class="total-row row"><text>核价应收</text><text>{{ money(drafts.quote.totalFen) }}</text></view><text>确认商品与金额后生成正式订单，再进入订单明确收现金。</text><button class="primary wide" :disabled="editingLocked" @click="cashier.convert()">生成正式订单</button></view>
    </view>
    </template>
  </view>
</template>
<style scoped>
.cashier-panel{font-size:14px}.cashier-panel>.muted{display:block;margin:10px 0 20px}.pickup-selector,.pickup-windows{display:flex;flex-direction:column;gap:12px;margin:16px 0}.pickup-windows button{font-size:14px;text-align:left;white-space:normal}.panel .wide{margin-top:16px}textarea{box-sizing:border-box;width:100%;font-size:16px;padding:12px;border:1px solid #d9ddce;border-radius:12px;min-height:90px}
</style>
