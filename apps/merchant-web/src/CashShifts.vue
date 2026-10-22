<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { createCashShiftController, shiftAmount } from '../../../packages/mini-core/src/cash-shifts.mjs';
import { webDraftRequest, webDraftStorage } from './cashierDrafts.mjs';
import { api } from './api';
import { money, localTime } from './domain.mjs';
import type { Store } from './types';
import Feedback from './Feedback.vue';
import Modal from './Modal.vue';

const props = defineProps<{store:Store;userId:string;owner:boolean}>();
const emit = defineEmits<{busy:[value:boolean]}>();
const shifts = reactive<any>({});
const controller = createCashShiftController({state:shifts,storage:webDraftStorage(sessionStorage),request:webDraftRequest(api),context:()=>({userId:props.userId,storeId:props.store.id,owner:props.owner})});
const confirming = ref(false), acknowledged = ref(false), recoveryBox = ref<HTMLElement>();
const locked = computed(()=>!!(shifts.busy || shifts.blocked));
const difference = computed(()=>{try{return shiftAmount(shifts.counted)-(shifts.current?.summary.expectedFen ?? 0);}catch{return null;}});
const pages = computed(()=>Math.max(1,Math.ceil(shifts.total/shifts.pageSize)));
watch(locked,v=>emit('busy',v),{immediate:true,flush:'sync'});
watch(()=>shifts.blocked,async v=>{if(v){await nextTick();recoveryBox.value?.focus();}});
function guardClose(e:BeforeUnloadEvent){if(locked.value){e.preventDefault();e.returnValue='';}}
onMounted(async()=>{
  window.addEventListener('beforeunload',guardClose);
  if(shifts.blocked){await nextTick();recoveryBox.value?.focus();return;}
  if(await controller.current())await controller.load();
});
onUnmounted(()=>{controller.dispose();emit('busy',false);window.removeEventListener('beforeunload',guardClose);});
function previewClose(){
  if(locked.value || !props.owner || !shifts.current)return;
  try{
    shiftAmount(shifts.counted);
    if(shifts.reason.trim().length>500 || (difference.value!==0 && !shifts.reason.trim()))throw Error('现金有差额，请填写差额原因，最多500字。');
    shifts.error=null;confirming.value=true;acknowledged.value=false;
  }catch(e){shifts.error=e;}
}
async function confirmClose(){
  if(!acknowledged.value)return;
  confirming.value=false;
  if(await controller.close(true))await controller.load();
}
async function open(){if(await controller.open())await controller.load();}
async function recover(action:string){if(await controller.recover(action) && !shifts.blocked){await controller.current();await controller.load();}}
</script>
<template>
  <div class="cash-shifts">
    <Feedback :error="shifts.error" :success="shifts.notice" />
    <section v-if="shifts.blocked" ref="recoveryBox" tabindex="-1" class="panel shift-content shift-recovery" aria-label="交班恢复" role="status">
      <h2>原交班操作待核对</h2>
      <p v-if="shifts.pending">{{ shifts.pending.kind === 'open' ? '开班' : '关班' }}结果尚待确认。请保留原金额，读取或恢复原操作。</p>
      <p v-else>恢复记录无法读取，请联系店主核对原操作后再继续。</p>
      <div v-if="shifts.pending" class="row wrap">
        <button class="quiet" :disabled="shifts.busy" @click="recover('read')">读取最新班次</button>
        <button v-if="owner" class="primary" :disabled="shifts.busy" @click="recover('replay')">恢复原{{ shifts.pending.kind === 'open' ? '开班' : '关班' }}</button>
      </div>
    </section>
    <section class="panel">
      <div class="panel-title"><h2>当前现金班次</h2><button class="quiet" :disabled="locked" @click="controller.current()">重新读取</button></div>
      <div class="shift-content">
      <template v-if="shifts.current">
        <p>{{ shifts.current.openedBy.name }} · {{ localTime(shifts.current.openedAt) }} 开班</p>
        <dl class="shift-totals">
          <div><dt>期初现金</dt><dd>{{ money(shifts.current.openingFen) }}</dd></div>
          <div><dt>现金收款（{{ shifts.current.summary.paymentCount }}笔）</dt><dd>{{ money(shifts.current.summary.paidFen) }}</dd></div>
          <div><dt>现金退款（{{ shifts.current.summary.refundCount }}笔）</dt><dd>{{ money(shifts.current.summary.refundFen) }}</dd></div>
          <div><dt>现金净额</dt><dd>{{ money(shifts.current.summary.netFen) }}</dd></div>
          <div class="expected"><dt>应有现金</dt><dd>{{ money(shifts.current.summary.expectedFen) }}</dd></div>
        </dl>
        <form v-if="owner && !shifts.blocked" @submit.prevent="previewClose">
          <p v-if="shifts.review" role="status" class="notice-strip">班次已变化，实点和原因已保留。请核对最新应有金额，再明确关班。</p>
          <label class="field"><span>实点现金（元）</span><input v-model="shifts.counted" inputmode="decimal" autocomplete="off" maxlength="12" :disabled="locked" required /></label>
          <p v-if="difference !== null">差额 <strong>{{ money(difference) }}</strong></p>
          <label class="field"><span>差额原因{{ difference === 0 ? '（可选）' : '（必填）' }}</span><textarea v-model="shifts.reason" maxlength="500" :disabled="locked" :required="difference !== 0" /></label>
          <button class="primary" :disabled="locked">核对关班</button>
        </form>
      </template>
      <template v-else-if="shifts.currentLoaded">
        <p>当前没有活动现金班次。现金收款和退款前，请店主先开班。</p>
        <form v-if="owner && !shifts.blocked" @submit.prevent="open">
          <label class="field"><span>期初现金（元）</span><input v-model="shifts.opening" inputmode="decimal" autocomplete="off" maxlength="12" :disabled="locked" required /></label>
          <button class="primary" :disabled="locked">确认开班</button>
        </form>
      </template>
      <p v-else>请先重新读取活动班次，再开班或关班。</p>
      <p v-if="!owner" class="muted">店员可查看班次；开班和关班由店主操作。</p>
      </div>
    </section>
    <section class="panel">
      <div class="panel-title"><h2>班次记录</h2><select aria-label="班次状态" :value="shifts.filter" :disabled="locked" @change="controller.load({page:1,state:($event.target as HTMLSelectElement).value})"><option value="ALL">全部班次</option><option value="OPEN">活动班次</option><option value="CLOSED">已关班</option></select></div>
      <div class="shift-content">
      <p v-if="!shifts.items.length">暂无班次记录。</p>
      <div v-for="item in shifts.items" :key="item.id" class="shift-entry">
        <div class="row between wrap"><strong>{{ localTime(item.openedAt) }} · {{ item.openedBy.name }}</strong><span class="badge" :class="item.state === 'OPEN' ? 'green' : 'neutral'">{{ item.state === 'OPEN' ? '进行中' : '已关班' }}</span></div>
        <p>期初 {{ money(item.openingFen) }} · 应有 {{ money(item.summary.expectedFen) }}</p>
        <template v-if="item.state === 'CLOSED'"><p>实点 {{ money(item.summary.countedFen) }} · 差额 {{ money(item.summary.differenceFen) }}</p><p v-if="item.summary.reason">差额原因：{{ item.summary.reason }}</p><p class="muted">{{ item.closedBy.name }} · {{ localTime(item.closedAt) }} 关班 · 已保存关班快照</p></template>
        <button class="text-button" :disabled="locked" @click="controller.get(item.id)">查看班次明细</button>
      </div>
      </div>
      <div class="table-footer"><span>共 {{ shifts.total }} 班</span><div class="row"><button class="quiet" :disabled="locked || shifts.page <= 1" @click="controller.load({page:shifts.page-1})">上一页</button><span>{{ shifts.page }} / {{ pages }}</span><button class="quiet" :disabled="locked || shifts.page >= pages" @click="controller.load({page:shifts.page+1})">下一页</button></div></div>
    </section>
    <section v-if="shifts.remote" class="panel shift-content" aria-label="班次明细">
      <h2>班次明细 · {{ shifts.remote.state === 'CLOSED' ? '已关班快照' : '进行中' }}</h2>
      <p>期初 {{ money(shifts.remote.openingFen) }} · 收款 {{ money(shifts.remote.summary.paidFen) }}（{{ shifts.remote.summary.paymentCount }}笔） · 退款 {{ money(shifts.remote.summary.refundFen) }}（{{ shifts.remote.summary.refundCount }}笔）</p>
      <p>净额 {{ money(shifts.remote.summary.netFen) }} · 应有 {{ money(shifts.remote.summary.expectedFen) }}</p>
      <template v-if="shifts.remote.state === 'CLOSED'"><p>实点 {{ money(shifts.remote.summary.countedFen) }} · 差额 {{ money(shifts.remote.summary.differenceFen) }}</p><p>{{ shifts.remote.summary.reason || '无差额原因' }}</p></template>
    </section>
    <Modal v-if="confirming" title="明确关闭班次" @close="confirming=false">
      <p>应有 {{ money(shifts.current.summary.expectedFen) }} · 实点 {{ money(shiftAmount(shifts.counted)) }}</p>
      <p>差额 {{ money(difference) }} · {{ shifts.reason.trim() || '无差额' }}</p>
      <p>关班后保存本次现金快照，新收退款须先开新班次。</p>
      <label class="row"><input v-model="acknowledged" type="checkbox" />已清点现金并核对差额</label>
      <div class="form-actions"><button class="quiet" @click="confirming=false">返回核对</button><button class="primary" :disabled="!acknowledged" @click="confirmClose">明确关闭班次</button></div>
    </Modal>
  </div>
</template>
<style scoped>
.cash-shifts{display:grid;gap:20px;font-size:14px;min-width:0}
.cash-shifts .panel + .panel{margin-top:0}
.shift-content{padding:24px 25px;min-width:0;overflow-wrap:anywhere}
.shift-content > p,.shift-content > h2{margin:0 0 16px}
.shift-content > :last-child{margin-bottom:0}
.cash-shifts form{display:grid;gap:16px;max-width:560px;margin-top:20px}
.shift-totals{display:grid;gap:12px;margin:24px 0;max-width:560px}
.shift-totals div{display:flex;justify-content:space-between;gap:18px}
.shift-totals dd{margin:0;font-variant-numeric:tabular-nums}
.expected{border-top:1px solid #dce5dd;padding-top:16px;font-weight:700}
.shift-entry{padding:20px 0;border-bottom:1px solid #dce5dd;overflow-wrap:anywhere}
.shift-entry:first-child{padding-top:0}
.shift-entry:last-child{padding-bottom:0;border-bottom:0}
.shift-entry p{margin:10px 0}
.shift-recovery:focus{outline:2px solid #28533e;outline-offset:3px}
.cash-shifts input[type=checkbox]{width:20px;min-height:20px;flex-shrink:0}
.cash-shifts .table-footer{gap:14px;flex-wrap:wrap}
@media(max-width:1000px){.shift-content{padding:20px}}
@media(max-width:600px){.cash-shifts .panel-title{gap:14px;flex-wrap:wrap}.cash-shifts .table-footer .row{flex-wrap:wrap}}
@media(prefers-reduced-motion:reduce){.cash-shifts *{transition:none;animation:none}}
</style>
