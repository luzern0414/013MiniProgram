<script setup lang="ts">
import { reactive, ref, onUnmounted } from 'vue';
import type { CashierDraft } from './types';
import { localTime } from './domain.mjs';
import { createDraftTakeover } from './cashierDrafts.mjs';
import Modal from './Modal.vue';
const props = defineProps<{ state: any; controller: any; hasCart: boolean; hasUnsavedChanges: boolean; checkoutLocked: boolean }>();
const emit = defineEmits<{ take: []; recovered: []; next: []; reload: [] }>();
const expanded = ref(!!props.state.pending || !!props.state.corrupt);
const replacement = reactive<any>({});
const takeover = createDraftTakeover({ state: replacement, hasCart: () => props.hasCart, load: (id: string, accept: () => boolean) => props.controller.get(id, { accept }), apply: () => emit('take') });
onUnmounted(() => takeover.cancel());
const cancelling = ref(false);
const startingNext = ref(false);
function next() { if (props.hasCart && props.hasUnsavedChanges) startingNext.value = true; else emit('next'); }
function open() { expanded.value = !expanded.value; if (expanded.value && !props.state.blocked && !props.checkoutLocked) props.controller.load(); }
async function recover(action = 'read') { if (await props.controller.recover(action)) { if (props.state.order) emit('recovered'); if (action === 'reload') emit('reload'); } }
function choose(item: CashierDraft) { if (!props.checkoutLocked && !props.state.busy && !props.state.blocked) takeover.choose(item.id); }
</script>
<template>
  <section class="drafts-section">
    <div class="row between"><h2>挂单与取单</h2><button class="quiet" :disabled="state.busy" @click="open">{{ expanded ? '收起列表' : '查看挂单' }}</button></div>
    <p v-if="state.remote" class="notice-strip">{{ state.remote.name }} · 第 {{ state.remote.revision }} 版 · {{ localTime(state.remote.updatedAt) }}<br />{{ state.remote.state === 'CONVERTED' ? '已生成正式订单' : state.remote.state === 'CANCELLED' ? '已取消' : '已取出，可继续编辑' }}</p>
    <p v-if="state.error" class="notice" role="alert">{{ state.error.message }}{{ state.error.requestId ? `（编号 ${state.error.requestId}）` : '' }}</p>
    <p v-if="state.notice" class="notice-strip" role="status">{{ state.notice }}</p>
    <div v-if="state.pending" class="recovery-actions">
      <p>有一笔挂单操作待核对，请保留当前输入。核对完成前无法切换门店或继续开单。</p>
      <button class="quiet" :disabled="state.busy" @click="recover()">读取原操作结果</button>
      <button v-if="['create','convert'].includes(state.pending.kind)" class="primary" :disabled="state.busy" @click="recover('replay')">{{ state.pending.kind === 'convert' ? '恢复原下单' : '恢复原挂单' }}</button>
      <template v-if="state.review && !['create','convert'].includes(state.pending.kind)">
        <button class="quiet" :disabled="state.busy" @click="recover('reload')">重新载入远端挂单</button>
        <button class="quiet" :disabled="state.busy" @click="recover('keep')">保留输入，按最新版本保存</button>
      </template>
    </div>
    <div v-else-if="state.review && state.remote?.state === 'DRAFT'" class="recovery-actions">
      <p>挂单已被修改。当前输入已保留，请核对远端版本，再选择保留输入保存或重新载入。</p>
      <p>远端名称：{{ state.remote.name }} · 备注：{{ state.remote.selection.note || '无' }}</p>
      <ul><li v-for="(line, i) in state.remote.display.lines" :key="i">{{ line.productName }} · {{ line.skuName }} · {{ line.modifierNames.join('、') }} {{ line.attributeNames.join('、') }} × {{ state.remote.selection.lines[i]?.quantity }}</li></ul>
      <button class="quiet" :disabled="state.busy || checkoutLocked" @click="controller.get(state.remote.id).then((ok: boolean) => ok && emit('reload'))">重新载入远端挂单</button>
      <p>也可以继续修改当前购物袋，点击“保存挂单”按此版本保存。</p>
    </div>
    <div v-if="state.order" class="notice-strip">正式订单 {{ state.order.number }} · {{ state.order.paymentStatus === 'PAID' ? '已付款' : '请核对订单状态' }}<button class="text-button" :disabled="state.busy" @click="emit('recovered')">查看原订单收银凭证</button></div>
    <Transition name="draft-expand"><div v-if="expanded" class="draft-list">
      <label class="field"><span>挂单状态</span><select :value="state.filter" :disabled="state.busy || state.blocked || checkoutLocked" @change="controller.load({page:1,state:($event.target as HTMLSelectElement).value})"><option value="DRAFT">待取单</option><option value="CONVERTED">已转订单</option><option value="CANCELLED">已取消</option></select></label>
      <p v-if="state.busy" role="status">正在核对挂单…</p>
      <p v-else-if="!state.items.length" class="muted">当前没有此状态的挂单。</p>
      <button v-for="item in state.items" :key="item.id" class="draft-row quiet" :disabled="state.busy || state.blocked || checkoutLocked" @click="choose(item)"><strong>{{ item.name }}</strong><span>{{ item.selection.mode === 'DINE_IN' ? '堂食' : '自取' }} · {{ item.selection.lines.length }} 行 · {{ localTime(item.updatedAt) }}</span><span>{{ item.state === 'DRAFT' ? '取单' : item.state === 'CONVERTED' ? '查看原订单' : '查看已取消挂单' }} · 第 {{ item.revision }} 版</span></button>
      <div class="row between"><button class="quiet" :disabled="state.busy || state.blocked || checkoutLocked || state.page <= 1" @click="controller.load({page:state.page-1})">上一页</button><span>{{ state.page }} 页 · 共 {{ state.total }} 条</span><button class="quiet" :disabled="state.busy || state.blocked || checkoutLocked || state.page*state.pageSize >= state.total" @click="controller.load({page:state.page+1})">下一页</button></div>
    </div></Transition>
    <div v-if="state.remote?.state === 'DRAFT' && !state.blocked" class="row">
      <button class="text-button" :disabled="state.busy || checkoutLocked" @click="cancelling=true">取消此挂单</button>
      <button class="text-button" :disabled="state.busy || checkoutLocked" @click="next">开始下一单</button>
    </div>
    <button v-if="state.remote?.state === 'CANCELLED' && !state.blocked" class="quiet" :disabled="state.busy || checkoutLocked" @click="next">开始下一单</button>
  </section>
  <Modal v-if="replacement.candidate" title="替换当前购物袋？" @close="takeover.cancel()"><p>当前购物袋还有商品。可取消并先保存当前袋；替换后会载入所选挂单。</p><div class="form-actions"><button class="quiet" @click="takeover.cancel()">取消</button><button class="primary" :disabled="state.busy" @click="takeover.accept()">替换当前购物袋</button></div></Modal>
  <Modal v-if="cancelling" title="取消此挂单？" :locked="state.busy" @close="cancelling=false"><p>取消后无法继续取单，当前购物袋仍保留。</p><div class="form-actions"><button class="quiet" :disabled="state.busy" @click="cancelling=false">返回</button><button class="primary" :disabled="state.busy" @click="controller.cancel().then((ok:boolean)=>{if(ok)cancelling=false})">确认取消挂单</button></div></Modal>
  <Modal v-if="startingNext" title="当前修改尚未保存" @close="startingNext=false"><p>可返回并保存当前购物袋。继续开始下一单会清除当前未保存的修改。</p><div class="form-actions"><button class="quiet" @click="startingNext=false">返回并保留输入</button><button class="primary" @click="startingNext=false;emit('next')">清除修改，开始下一单</button></div></Modal>
</template>
<style scoped>
.drafts-section{font-size:14px;border-top:1px solid #e4e4d9;padding-top:20px;margin-top:20px}.drafts-section h2{font-size:18px}.draft-list,.recovery-actions{display:grid;gap:12px;margin:16px 0}.draft-row{display:grid;text-align:left;gap:6px;white-space:normal}.draft-row span{font-size:14px}.draft-expand-enter-active,.draft-expand-leave-active{transition:opacity .18s ease,transform .18s ease}.draft-expand-enter-from,.draft-expand-leave-to{opacity:0;transform:translateY(-5px)}@media(prefers-reduced-motion:reduce){.draft-expand-enter-active,.draft-expand-leave-active{transition:none}}
</style>
