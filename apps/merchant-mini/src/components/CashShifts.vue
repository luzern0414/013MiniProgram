<script setup>
import { computed, onMounted, ref } from 'vue';
import { money, errorText, shiftAmount } from '@restaurant/mini-core';
import AccessibleInput from './AccessibleInput.vue';
const props = defineProps({ shifts: { type: Object, required: true }, owner: Boolean, locked: Boolean });
const state = computed(() => props.shifts.state);
const blocked = computed(() => props.locked || state.value.busy || state.value.blocked);
const confirming = ref(false), acknowledged = ref(false);
const difference = computed(() => { try { return shiftAmount(state.value.counted) - state.value.current.summary.expectedFen; } catch { return null; } });
const pages = computed(() => Math.max(1, Math.ceil(state.value.total / state.value.pageSize)));
const time = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
async function refresh() { if (!blocked.value && await props.shifts.current()) await props.shifts.load(); }
onMounted(refresh);
function previewClose() {
  if (blocked.value || !props.owner || !state.value.current) return;
  try {
    shiftAmount(state.value.counted);
    const reason = state.value.reason.trim();
    if (reason.length > 500 || (difference.value !== 0 && !reason)) throw Error('现金有差额，请填写差额原因，最多500字');
    state.value.error = null; confirming.value = true; acknowledged.value = false;
  } catch (e) { state.value.error = e; }
}
async function close() {
  if (blocked.value || !acknowledged.value) return;
  confirming.value = false;
  if (await props.shifts.close(true)) await refresh();
}
async function open() { if (!blocked.value && await props.shifts.open()) await refresh(); }
async function recover(action) { if (!props.locked && await props.shifts.recover(action) && !state.value.blocked) await refresh(); }
</script>
<template>
  <view class="cash-shifts">
    <text class="title">现金交班</text>
    <view v-if="state.error" class="error" role="alert">{{ errorText(state.error) }}</view>
    <view v-if="state.notice" class="notice" role="status">{{ state.notice }}</view>
    <view v-if="state.blocked" class="panel shift-content" role="status">
      <text class="sheet-title">原交班操作待核对</text>
      <text v-if="state.pending">原{{ state.pending.kind === 'open' ? '开班' : '关班' }}金额与操作已保留。读取失败时请稍后核对，不要重复新开班。</text>
      <template v-if="state.pending"><text>{{ state.pending.kind === 'open' ? '原期初现金' : '原实点现金' }} {{ money(state.pending.kind === 'open' ? state.pending.data.openingFen : state.pending.data.countedFen) }}</text><text v-if="state.pending.kind === 'close'">原差额原因：{{ state.pending.data.reason || '无差额原因' }}</text></template>
      <text v-else>恢复记录无法读取，请联系店主核对原操作。</text>
      <button v-if="state.pending" class="outline wide" :disabled="locked || state.busy" @click="recover('read')">读取最新班次</button>
      <button v-if="state.pending && owner" class="primary wide" :disabled="locked || state.busy" @click="recover('replay')">恢复原{{ state.pending.kind === 'open' ? '开班' : '关班' }}</button>
    </view>
    <view class="panel shift-content">
      <view class="row"><text class="sheet-title">当前现金班次</text><button class="link" :disabled="blocked" @click="refresh">重新读取</button></view>
      <template v-if="state.current">
        <text>{{ state.current.openedBy.name }} · {{ time(state.current.openedAt) }} 开班</text>
        <view class="row"><text>期初现金</text><text>{{ money(state.current.openingFen) }}</text></view>
        <view class="row"><text>现金收款（{{ state.current.summary.paymentCount }}笔）</text><text>{{ money(state.current.summary.paidFen) }}</text></view>
        <view class="row"><text>现金退款（{{ state.current.summary.refundCount }}笔）</text><text>{{ money(state.current.summary.refundFen) }}</text></view>
        <view class="row"><text>现金净额</text><text>{{ money(state.current.summary.netFen) }}</text></view>
        <view class="row expected"><text>应有现金</text><text>{{ money(state.current.summary.expectedFen) }}</text></view>
        <template v-if="owner && !state.blocked">
          <text v-if="state.review" class="notice">班次已变化，实点与原因已保留，请核对最新应有金额，再明确关班。</text>
          <AccessibleInput v-model="state.counted" input-id="shift-counted" label="实点现金（元）" :maxlength="12" :disabled="blocked || confirming" />
          <text v-if="difference !== null">差额预览 {{ money(difference) }} · 尚未关班</text>
          <AccessibleInput v-model="state.reason" input-id="shift-reason" :label="difference === 0 ? '差额原因（可选）' : '差额原因（必填）'" :maxlength="500" :disabled="blocked || confirming" />
          <button class="primary wide" :disabled="blocked || confirming" @click="previewClose">核对关班</button>
          <view v-if="confirming" class="review shift-content">
            <text class="sheet-title">明确关闭班次</text><text>应有 {{ money(state.current.summary.expectedFen) }} · 实点 {{ money(shiftAmount(state.counted)) }}</text>
            <text>差额 {{ money(difference) }} · {{ state.reason.trim() || '无差额' }}</text><text>关班后保存现金快照，新收退款须先开新班。</text>
            <button class="outline wide" :disabled="blocked" :aria-pressed="acknowledged" @click="acknowledged = !acknowledged">{{ acknowledged ? '已确认：已清点现金并核对差额' : '确认：已清点现金并核对差额' }}</button>
            <button class="primary wide" :disabled="blocked || !acknowledged" @click="close">明确关闭班次</button><button class="outline wide" :disabled="blocked" @click="confirming = false">返回核对</button>
          </view>
        </template>
      </template>
      <template v-else-if="state.currentLoaded">
        <text>当前没有活动现金班次。现金收款和退款前，请店主先开班。</text>
        <template v-if="owner && !state.blocked"><AccessibleInput v-model="state.opening" input-id="shift-opening" label="期初现金（元）" :maxlength="12" :disabled="blocked" /><button class="primary wide" :disabled="blocked" @click="open">确认开班</button></template>
      </template>
      <text v-else>请先重新读取活动班次，再开班或关班。</text>
      <text v-if="!owner" class="muted">店员可查看班次；开班和关班由店主操作。</text>
    </view>
    <view class="panel shift-content">
      <text class="sheet-title">班次记录</text>
      <view class="filters"><button v-for="option in [{ value: 'ALL', text: '全部班次' }, { value: 'OPEN', text: '活动班次' }, { value: 'CLOSED', text: '已关班' }]" :key="option.value" class="outline" :disabled="blocked" :aria-pressed="state.filter === option.value" @click="shifts.load({ page: 1, state: option.value })">{{ option.text }}</button></view>
      <text v-if="!state.items.length" class="muted">暂无班次记录。</text>
      <view v-for="item in state.items" :key="item.id" class="shift-entry shift-content">
        <text>{{ time(item.openedAt) }} · {{ item.openedBy.name }} · {{ item.state === 'OPEN' ? '进行中' : '已关班' }}</text>
        <text>期初 {{ money(item.openingFen) }} · 应有 {{ money(item.summary.expectedFen) }}</text>
        <template v-if="item.state === 'CLOSED'"><text>实点 {{ money(item.summary.countedFen) }} · 差额 {{ money(item.summary.differenceFen) }}</text><text>{{ item.summary.reason || '无差额原因' }}</text><text>{{ item.closedBy.name }} · {{ time(item.closedAt) }} 关班 · 已关班快照</text></template>
        <button class="outline wide" :disabled="blocked" @click="shifts.get(item.id)">查看班次明细</button>
      </view>
      <text>共 {{ state.total }} 班 · {{ state.page }} / {{ pages }}</text><view class="filters"><button class="outline" :disabled="blocked || state.page <= 1" @click="shifts.load({ page: state.page - 1 })">上一页</button><button class="outline" :disabled="blocked || state.page >= pages" @click="shifts.load({ page: state.page + 1 })">下一页</button></view>
    </view>
    <view v-if="state.remote" class="panel shift-content">
      <text class="sheet-title">班次明细 · {{ state.remote.state === 'CLOSED' ? '已关班快照' : '进行中' }}</text>
      <text>{{ state.remote.openedBy.name }} · {{ time(state.remote.openedAt) }} 开班</text>
      <text>期初 {{ money(state.remote.openingFen) }} · 收款 {{ money(state.remote.summary.paidFen) }}（{{ state.remote.summary.paymentCount }}笔） · 退款 {{ money(state.remote.summary.refundFen) }}（{{ state.remote.summary.refundCount }}笔）</text>
      <text>净额 {{ money(state.remote.summary.netFen) }} · 应有 {{ money(state.remote.summary.expectedFen) }}</text>
      <template v-if="state.remote.state === 'CLOSED'"><text>实点 {{ money(state.remote.summary.countedFen) }} · 差额 {{ money(state.remote.summary.differenceFen) }}</text><text>{{ state.remote.summary.reason || '无差额原因' }}</text><text>{{ state.remote.closedBy.name }} · {{ time(state.remote.closedAt) }} 关班</text></template>
    </view>
  </view>
</template>
<style scoped>
.cash-shifts{font-size:14px;min-width:0}.shift-content{display:flex;flex-direction:column;gap:16px;min-width:0;overflow-wrap:anywhere}.cash-shifts>.title{display:block;margin-bottom:20px}.cash-shifts button{font-size:14px;white-space:normal;min-height:44px;margin:0}.cash-shifts .row{gap:16px;flex-wrap:wrap}.expected{border-top:1px solid #dce5dd;padding-top:16px;font-weight:700}.review{background:#f4f6ee;padding:16px;border-radius:12px}.filters{display:flex;flex-wrap:wrap;gap:12px}.shift-entry{border-bottom:1px solid #dce5dd;padding-bottom:16px}@media(prefers-reduced-motion:reduce){.cash-shifts *{animation:none;transition:none}}
</style>
