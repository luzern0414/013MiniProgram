<script setup lang="ts">
import CashRefundRecovery from "./CashRefundRecovery.vue";
import CashRefund from "./CashRefund.vue";
import CashReceipt from "./CashReceipt.vue";
import {
  createCashRefund,
  refundLocked,
} from "../../../packages/mini-core/src/cash-refunds.mjs";
import { webRefundStorage } from "./refundRecovery.mjs";
import PickupRedemption from "./PickupRedemption.vue";
import PickupSearch from "./PickupSearch.vue";
import { pickupWindowText } from "../../../packages/mini-core/src/pickup.mjs";
import { attributeSummary } from "../../../packages/mini-core/src/product-selection.mjs";
import { computed, reactive, ref, watch, onUnmounted, onMounted } from "vue";
import { ChevronLeft, ChevronRight, ReceiptText } from "lucide-vue-next";
import { api } from "./api";
import type { Store, Order } from "./types";
import { useResource, useMutation } from "./ui";
import {
  money,
  toFen,
  statusLabels,
  modeLabels,
  localTime,
  orderActions,
  actionLabels,
} from "./domain.mjs";
import StateBlock from "./StateBlock.vue";
import Feedback from "./Feedback.vue";
import Modal from "./Modal.vue";
import { handoffCashOrder, requireActiveShift, requireSettledShift } from './cashShifts.mjs';
const props = defineProps<{ store: Store; userId: string; owner: boolean }>();
const emit = defineEmits<{ busy: [value: boolean]; checkout: []; shifts: [] }>();
const pickupBusy = ref(false);
const searchActive = ref(false);
let alive = true;

function guardClose(event: BeforeUnloadEvent) {
  if (operationBusy.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
window.addEventListener("beforeunload", guardClose);
onUnmounted(() => {
  saveRefundForm();
  alive = false;
  refundCtl.dispose();
  emit("busy", false);
  window.removeEventListener("beforeunload", guardClose);
});
const status = ref("");
const page = ref(1);
const orders = reactive(
  useResource<{ items: Order[]; total: number; pageSize: number }>(
    () =>
      `/orders?storeId=${props.store.id}&status=${status.value}&page=${page.value}&pageSize=20`,
  ),
);
const selected = ref<Order>();
const tendered = ref("");
const mutation = reactive(useMutation());
const detail = ref<Order>();
const detailLoading = ref(false);
const detailError = ref<Error>();
const cash = ref(false);
const refund = reactive<any>({});
const refundCtl = createCashRefund({
  state: refund,
  storage: webRefundStorage(sessionStorage),
  beforeNew: async () => {
    requireSettledShift(sessionStorage, props.userId);
    await requireActiveShift(api,props.store.id);
    requireSettledShift(sessionStorage, props.userId);
  },
  context: () => ({
    userId: props.userId,
    storeId: props.store.id,
    owner: props.owner,
    order: detail.value,
  }),
  request: (path: string, options?: any) =>
    api(
      path,
      options
        ? {
            method: options.method,
            body: options.data,
            key: options.headers?.["Idempotency-Key"],
          }
        : {},
    ),
  onOrder: (order: any) => {
    detail.value = order;
    selected.value = order;
    detailError.value = undefined;
    orders.reload();
  },
});
const refundBusy = computed(() => !!(refund.busy || refund.blocked));
const operationBusy = computed(() =>
  refundLocked(pickupBusy.value, refundBusy.value, mutation.busy),
);
watch(operationBusy, (value) => emit("busy", value), {
  flush: "sync",
  immediate: true,
});
if (refund.attempt) {
  selected.value = { id: refund.attempt.orderId } as Order;
  refundCtl.load();
}

const pages = computed(() =>
  Math.ceil((orders.data?.total || 0) / (orders.data?.pageSize || 20)),
);
function cashOpen(order: Order) {
  mutation.clear();
  selected.value = order;
  tendered.value = (order.totalFen / 100).toFixed(2);
  cash.value = true;
}
function receive() {
  if(operationBusy.value)return;
  let handedOff = false;
  mutation.run(async () => {
    const amount=toFen(tendered.value), id=selected.value!.id, userId=props.userId, storeId=props.store.id;
    const original=await api<Order>(`/orders/${encodeURIComponent(id)}`);
    if(!alive || props.userId !== userId || props.store.id !== storeId || selected.value?.id !== id)return;
    if(amount<original.totalFen)throw Error('实收现金不能少于应收金额。');
    handoffCashOrder({storage:sessionStorage,userId:props.userId,storeId:props.store.id,order:original,tendered:tendered.value,key:crypto.randomUUID()});
    handedOff=true;
  }, '').then(()=>{if(alive && handedOff && !mutation.error)emit('checkout');});
}
function transition(order: Order, action: string) {
  mutation.run(async () => {
    await api(`/merchant/orders/${order.id}/transition`, {
      method: "POST",
      body: { action },
    });
    orders.reload();
  }, "订单状态已更新");
}
function cancel(order: Order) {
  mutation.run(async () => {
    await api(`/orders/${order.id}/cancel`, {
      method: "POST",
      body: { reason: "门店取消未付款订单" },
    });
    orders.reload();
  }, "订单已取消");
}
async function show(order: Order) {
  if (operationBusy.value) return;
  Object.assign(refund, {
    amount: "",
    reason: "",
    review: false,
    expanded: false,
    error: "",
    notice: "",
  });
  selected.value = order;
  detail.value = undefined;
  detailLoading.value = true;
  detailError.value = undefined;
  cash.value = false;
  try {
    const result = await api<Order>(`/orders/${order.id}`);
    if(!alive || selected.value?.id !== order.id)return;
    detail.value = result;
  } catch (e) {
    detailError.value = e as Error;
  } finally {
    detailLoading.value = false;
  }
}
const refundFormKey = `merchant-refund-form:${encodeURIComponent(props.userId)}:${encodeURIComponent(props.store.id)}`;
function saveRefundForm(){
  if(refund.blocked || refund.busy)return;
  try{
    if(detail.value && (refund.amount || refund.reason))sessionStorage.setItem(refundFormKey,JSON.stringify({orderId:detail.value.id,amount:refund.amount,reason:refund.reason,expanded:refund.expanded}));
    else sessionStorage.removeItem(refundFormKey);
  }catch{ /* This is editable input only; durable financial attempts have their own checked storage. */ }
}
function goShifts(){if(!operationBusy.value){saveRefundForm();emit('shifts');}}
onMounted(async()=>{
  if(refund.blocked)return;
  try{
    const saved=JSON.parse(sessionStorage.getItem(refundFormKey)||'null');
    if(!saved || typeof saved.orderId!=='string' || typeof saved.amount!=='string' || typeof saved.reason!=='string')return;
    await show({id:saved.orderId} as Order);
    if(alive && detail.value?.id === saved.orderId)Object.assign(refund,{amount:saved.amount,reason:saved.reason,expanded:!!saved.expanded,review:false});
  }catch{ /* An invalid input hint is not a pending financial operation. */ }
});
</script>
<template>
  <Feedback :error="mutation.error" :success="mutation.success" />
  <CashRefundRecovery
    v-if="!selected"
    :state="refund"
    :controller="refundCtl"
    :owner="owner"
    :locked="pickupBusy || mutation.busy"
  />
  <PickupSearch
    :store-id="store.id"
    :locked="operationBusy"
    @open="show"
    @active="searchActive = $event"
  />
  <section v-if="!searchActive" class="panel">
    <div class="toolbar">
      <div class="filter-tabs">
        <button
          :class="{ selected: status === '' }"
          @click="
            status = '';
            page = 1;
          "
        >
          全部订单</button
        ><button
          v-for="s in [
            'PENDING_PAYMENT',
            'AWAITING_ACCEPTANCE',
            'PREPARING',
            'READY',
            'COMPLETED',
          ]"
          :key="s"
          :class="{ selected: status === s }"
          @click="
            status = s;
            page = 1;
          "
        >
          {{ statusLabels[s as keyof typeof statusLabels] }}
        </button>
      </div>
      <select v-model="status" aria-label="全部订单状态" @change="page = 1">
        <option value="">全部状态</option>
        <option v-for="(name, key) in statusLabels" :key="key" :value="key">
          {{ name }}
        </option>
      </select>
    </div>
    <StateBlock
      :loading="orders.loading"
      :error="orders.error"
      :empty="orders.data?.items.length === 0"
      @retry="orders.reload"
      ><template #empty>暂无此状态的订单。</template>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>订单 / 时间</th>
              <th>用餐方式</th>
              <th>金额</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="order in orders.data?.items" :key="order.id">
              <td>
                <button class="text-button order-number" @click="show(order)">
                  {{ order.number }}
                </button>
                <p class="muted">{{ localTime(order.createdAt) }}</p>
              </td>
              <td>
                {{ modeLabels[order.mode as keyof typeof modeLabels] }}
                <p class="muted">
                  {{ order.tableName || order.pickupNumber || "—" }}
                  <span v-if="order.pickupServiceDate">
                    · {{ order.pickupServiceDate }}</span
                  >
                </p>
              </td>
              <td>
                <strong class="amount">{{ money(order.totalFen) }}</strong>
                <p class="muted">
                  {{
                    order.paymentStatus === "PAID"
                      ? "已收款"
                      : order.paymentStatus === "CLOSED"
                        ? "已关闭"
                        : "未收款"
                  }}
                </p>
              </td>
              <td>
                <span
                  class="badge"
                  :class="
                    order.status === 'COMPLETED'
                      ? 'green'
                      : order.status === 'CANCELLED'
                        ? 'neutral'
                        : 'orange'
                  "
                  >{{
                    statusLabels[order.status as keyof typeof statusLabels]
                  }}</span
                >
                <p v-if="order.refundStatus !== 'NONE'" class="muted">
                  {{
                    order.refundStatus === "SUCCEEDED"
                      ? "已全额退款"
                      : "已部分退款"
                  }}
                </p>
              </td>
              <td>
                <div class="row wrap">
                  <button
                    v-if="
                      order.status === 'PENDING_PAYMENT' &&
                      order.paymentStatus === 'UNPAID'
                    "
                    class="primary compact"
                    :disabled="operationBusy"
                    @click="cashOpen(order)"
                  >
                    现金收款</button
                  ><button
                    v-if="
                      order.status === 'PENDING_PAYMENT' &&
                      order.paymentStatus === 'UNPAID'
                    "
                    class="quiet compact"
                    :disabled="operationBusy"
                    @click="cancel(order)"
                  >
                    取消订单</button
                  ><button
                    v-for="action in orderActions(order)"
                    :key="action"
                    class="primary compact"
                    :disabled="operationBusy"
                    @click="
                      action === 'COMPLETE' && order.mode === 'PICKUP'
                        ? show(order)
                        : transition(order, action)
                    "
                  >
                    {{
                      action === "COMPLETE" && order.mode === "PICKUP"
                        ? "核销取餐"
                        : actionLabels[action as keyof typeof actionLabels]
                    }}</button
                  ><button class="text-button" @click="show(order)">
                    详情
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="table-footer">
        <span>共 {{ orders.data?.total }} 单</span>
        <div class="row">
          <button
            class="icon-button"
            aria-label="上一页"
            :disabled="page <= 1"
            @click="page--"
          >
            <ChevronLeft :size="18" /></button
          ><span>{{ page }} / {{ pages || 1 }}</span
          ><button
            class="icon-button"
            aria-label="下一页"
            :disabled="page >= pages"
            @click="page++"
          >
            <ChevronRight :size="18" />
          </button>
        </div></div
    ></StateBlock>
  </section>
  <Modal
    v-if="selected && cash"
    title="核对现金收款"
    @close="!mutation.busy && (selected = undefined)"
    ><form @submit.prevent="receive">
      <p class="muted">订单 {{ selected.number }}</p>
      <div class="payment-total">
        <span>应收金额</span><strong>{{ money(selected.totalFen) }}</strong>
      </div>
      <label class="field"
        ><span>实收现金（元）</span
        ><input
          v-model="tendered"
          type="number"
          :min="(selected.totalFen / 100).toFixed(2)"
          step="0.01"
          required
      /></label>
      <p v-if="Number(tendered) * 100 >= selected.totalFen">
        找零
        <strong>{{
          money(Math.round(Number(tendered) * 100) - selected.totalFen)
        }}</strong>
      </p>
      <Feedback :error="mutation.error" />
      <div class="form-actions">
        <button
          type="button"
          class="quiet"
          :disabled="operationBusy"
          @click="selected = undefined"
        >
          取消</button
        ><button class="primary" :disabled="operationBusy">
          {{ mutation.busy ? "读取中…" : "前往门店收银确认" }}
        </button>
      </div>
    </form></Modal
  >
  <Modal
    v-if="selected && !cash"
    title="订单详情"
    @close="!operationBusy && (selected = undefined)"
    ><CashRefundRecovery
      :state="refund"
      :controller="refundCtl"
      :owner="owner"
      :locked="pickupBusy || mutation.busy"
    />
    <StateBlock
      :loading="detailLoading"
      :error="detailError"
      @retry="show(selected!)"
      ><template v-if="detail"
        ><div class="row between">
          <div>
            <h3>{{ detail.number }}</h3>
            <p class="muted">
              {{ statusLabels[detail.status as keyof typeof statusLabels] }} ·
              {{ localTime(detail.createdAt) }} ·
              {{ modeLabels[detail.mode as keyof typeof modeLabels] }}
            </p>
          </div>
          <ReceiptText :size="28" />
        </div>
        <p v-if="detail.mode === 'PICKUP'" class="notice-strip">
          取餐号 {{ detail.pickupNumber }} ·
          {{ detail.pickupServiceDate || "旧订单" }} ·
          {{ pickupWindowText(detail.pickupWindow) }}
        </p>
        <PickupRedemption
          v-if="
            detail.mode === 'PICKUP' &&
            ((detail.status === 'READY' && detail.paymentStatus === 'PAID') ||
              pickupBusy)
          "
          :key="detail.id"
          :order="detail"
          :store-id="store.id"
          :locked="mutation.busy || refundBusy"
          @busy="pickupBusy = $event"
          @changed="
            detail = $event;
            orders.reload();
          "
        />
        <div
          v-for="(line, index) in detail.lines"
          :key="index"
          class="receipt-line"
        >
          <div>
            <strong>{{ line.productName }}</strong>
            <p class="muted">
              {{ line.skuName
              }}<span v-for="m in line.modifiers" :key="m.id">
                · {{ m.name }}</span
              >
              × {{ line.quantity }}
              <span v-if="attributeSummary(line)">
                · {{ attributeSummary(line) }}</span
              >
            </p>
          </div>
          <strong>{{ money(line.lineTotalFen) }}</strong>
        </div>
        <div class="payment-total">
          <span>订单金额</span><strong>{{ money(detail.totalFen) }}</strong>
        </div>
        <p v-if="detail.note">备注：{{ detail.note }}</p>
        <CashReceipt :order="detail" />
        <CashRefund
          :order="detail"
          :state="refund"
          :controller="refundCtl"
          :owner="owner"
          :locked="pickupBusy || mutation.busy"
          @shifts="goShifts"
        />
        <div class="timeline">
          <div v-for="event in detail.events" :key="event.id">
            <i /><strong>{{ event.label }}</strong
            ><span class="muted">{{ localTime(event.createdAt) }}</span>
          </div>
        </div></template
      ></StateBlock
    ></Modal
  >
</template>
