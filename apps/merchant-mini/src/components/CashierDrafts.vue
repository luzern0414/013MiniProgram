<script setup>
import { computed, ref } from 'vue';
import { confirm, errorText, modeNames } from '@restaurant/mini-core';
const props = defineProps({ cashier: { type: Object, required: true }, locked: Boolean });
const state = computed(() => props.cashier.state.drafts);
const expanded = ref(!!state.value.pending || !!state.value.corrupt);
const blocked = computed(() => props.locked || props.cashier.navigationLocked());
const names = { DRAFT: '待取单', CONVERTED: '已转订单', CANCELLED: '已取消' };
const time = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
async function list(options = {}) { if (!blocked.value) await props.cashier.controller.load(options); }
function open() { expanded.value = !expanded.value; if (expanded.value) list(); }
async function take(item) {
  if (blocked.value || props.cashier.editingLocked()) return;
  if (props.cashier.state.cart.length && !await confirm('替换当前购物袋？', '当前购物袋还有商品。可取消并先保存当前袋；替换后会载入所选挂单。')) return;
  await props.cashier.take(item.id, { replace: true });
}
async function cancel() { if (!blocked.value && await confirm('取消此挂单？', '取消后无法继续取单，当前购物袋仍保留。')) await props.cashier.cancel(); }
async function next() {
  if (blocked.value) return;
  if (props.cashier.state.cart.length && !await confirm('开始下一单？', '当前购物袋会被清除，未保存的修改将丢失。可返回并先保存挂单。')) return;
  props.cashier.newBag();
}
</script>
<template>
  <view class="panel drafts">
    <view class="row"><text class="sheet-title">挂单与取单</text><button class="link" :disabled="state.busy || locked" @click="open">{{ expanded ? '收起列表' : '查看挂单' }}</button></view>
    <view v-if="state.remote" class="notice"><text class="label">{{ state.remote.name }} · 第 {{ state.remote.revision }} 版</text><text>{{ names[state.remote.state] }} · {{ time(state.remote.updatedAt) }}</text></view>
    <view v-if="state.error" class="error" role="alert">{{ errorText(state.error) }}</view><view v-if="state.notice" class="notice" role="status">{{ state.notice }}</view>
    <view v-if="state.corrupt" class="error">挂单恢复记录无法读取，请联系店主核对原操作；核对前不能继续开单。</view>
    <view v-if="state.pending" class="recovery">
      <text class="label">挂单操作待核对</text><text>原门店与当前输入已保留。核对完成前无法切店或继续开单。</text>
      <button class="outline" :disabled="locked || state.busy" @click="cashier.recover()">读取原操作结果</button>
      <button v-if="['create','convert'].includes(state.pending.kind)" class="primary" :disabled="locked || state.busy" @click="cashier.recover('replay')">{{ state.pending.kind === 'convert' ? '恢复原下单' : '恢复原挂单' }}</button>
      <template v-if="state.review && !['create','convert'].includes(state.pending.kind)"><button class="outline" :disabled="locked || state.busy" @click="cashier.recover('reload')">重新载入远端挂单</button><button class="outline" :disabled="locked || state.busy" @click="cashier.recover('keep')">保留输入，按最新版本保存</button></template>
    </view>
    <view v-if="state.review && state.remote?.state === 'DRAFT'" class="notice">
      <text class="label">请核对远端版本，当前输入已保留</text><text>远端名称：{{ state.remote.name }} · 备注：{{ state.remote.selection.note || '无' }}</text>
      <text>{{ modeNames[state.remote.selection.mode] }} · {{ state.remote.selection.tableCode || state.remote.selection.pickupSlotId || '尽快取餐' }}</text>
      <view v-for="(line,index) in state.remote.display.lines" :key="index"><text>{{ line.productName }} · {{ line.skuName }} · {{ line.modifierNames.join('、') }} · {{ line.attributeNames.join('、') }} ×{{ state.remote.selection.lines[index]?.quantity }}</text></view>
      <button v-if="!state.pending" class="outline" :disabled="blocked" @click="cashier.reloadRemote()">重新载入远端挂单</button><text>也可继续修改当前购物袋，再点击保存挂单。</text>
    </view>
    <view v-if="expanded" class="draft-list">
      <view class="chips"><button v-for="(label,value) in names" :key="value" class="chip" :class="{chosen: state.filter === value}" :disabled="blocked" @click="list({page:1,state:value})">{{ label }}</button></view>
      <text v-if="state.busy" class="loading">正在核对挂单…</text><text v-else-if="!state.items.length" class="empty">当前没有此状态的挂单。</text>
      <button v-for="item in state.items" :key="item.id" class="outline draft-row" :disabled="blocked || cashier.editingLocked()" @click="take(item)"><text class="label">{{ item.name }} · 第 {{ item.revision }} 版</text><text>{{ modeNames[item.selection.mode] }} · {{ item.selection.lines.length }}行 · {{ time(item.updatedAt) }}</text><text>{{ item.state === 'DRAFT' ? '取单' : item.state === 'CONVERTED' ? '查看原订单' : '查看已取消挂单' }}</text></button>
      <view class="row"><button class="small outline" :disabled="blocked || state.page <= 1" @click="list({page:state.page-1})">上一页</button><text>{{ state.page }}页 · 共{{ state.total }}条</text><button class="small outline" :disabled="blocked || state.page * state.pageSize >= state.total" @click="list({page:state.page+1})">下一页</button></view>
    </view>
    <view class="order-actions"><button v-if="state.remote?.state === 'DRAFT'" class="outline" :disabled="blocked" @click="cancel">取消此挂单</button><button class="outline" :disabled="blocked" @click="next">开始下一单</button></view>
  </view>
</template>
<style scoped>
.drafts{font-size:14px}.draft-list,.recovery{display:flex;flex-direction:column;gap:12px;margin:16px 0}.draft-row{display:flex;flex-direction:column;align-items:flex-start;text-align:left;white-space:normal;font-size:14px}.draft-list{animation:appear .18s ease}@keyframes appear{from{opacity:0}to{opacity:1}}@media(prefers-reduced-motion:reduce){.draft-list{animation:none}}
</style>
