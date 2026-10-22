<script setup lang="ts">
import { computed, reactive, ref, watch, onUnmounted, onMounted } from "vue";
import {
  Search,
  Plus,
  Minus,
  ShoppingBag,
  CheckCircle2,
  Package,
  Trash2,
} from "lucide-vue-next";
import type {
  Store,
  Catalog,
  Product,
  Order,
  AttributeSnapshot,
} from "./types";
import { api } from "./api";
import { readActiveShift, requireActiveShift, requireSettledShift } from './cashShifts.mjs';
import { useResource, useMutation } from "./ui";
import { money, isUncertainWrite } from "./domain.mjs";
import {
  createRecovery,
  confirmedCash,
  restoreSelectionCart,
} from "./recovery.mjs";
import { transitionCheckout } from "./checkoutTransitions.mjs";
import { checkoutBlocked } from "./checkoutGuard";
import CashReceipt from "./CashReceipt.vue";
import CashierOrderDetails from './CashierOrderDetails.vue';
import StateBlock from "./StateBlock.vue";
import Feedback from "./Feedback.vue";
import Modal from "./Modal.vue";
import PickupSelection from "./PickupSelection.vue";
import {
  createPickupSelection,
  pickupWindowText,
  isPickupRejection,
} from "../../../packages/mini-core/src/pickup.mjs";
import ProductSelection from "./ProductSelection.vue";
import CashierDrafts from './CashierDrafts.vue';
import { createDraftController, draftSelection, hydrateDraft } from '../../../packages/mini-core/src/cashier-drafts.mjs';
import { webDraftRequest, webDraftStorage, cashierLocks, recoverDraftCheckout } from './cashierDrafts.mjs';
import {
  selectionKey,
  cartSelectionIssue,
  attributeSummary,
  isDefinitiveOrderRejection,
} from "../../../packages/mini-core/src/product-selection.mjs";
type Line = {
  key: string;
  productId?: string;
  skuId: string;
  quantity: number;
  modifierIds: string[];
  attributeOptionIds: string[];
  attributes?: AttributeSnapshot[];
  modifierNames?: string[];
  configurationRevision?: number;
  productName: string;
  skuName: string;
  unitPriceFen: number;
  available: number;
  issue?: string;
};
type Quote = {
  pickupWindow?: Order["pickupWindow"];
  id: string;
  totalFen: number;
  subtotalFen: number;
  packagingFeeFen: number;
  deliveryFeeFen: number;
  discountFen: number;
  expiresAt: string;
};
const props = defineProps<{ store: Store; userId: string; owner?: boolean }>();
const emit = defineEmits<{shifts:[]}>();
const cashShift = reactive<any>({current:null,loaded:false,error:null});
let alive = true;
async function loadCashShift(){
  try {const value=await readActiveShift(api,props.store.id);if(alive){cashShift.current=value;cashShift.loaded=true;cashShift.error=null;}}
  catch(e){if(alive)cashShift.error=e;}
}
const recovery = createRecovery(sessionStorage, props.userId, props.store.id);
const restored = recovery.read();
const catalog = reactive(
  useResource<Catalog>(`/stores/${props.store.id}/catalog`),
);
const tables = reactive(
  useResource<{ id: string; name: string; code: string; status: string }[]>(
    `/stores/${props.store.id}/tables`,
  ),
);
const mutation = reactive(useMutation());
const drafts = reactive<any>({});
const draftCtl = createDraftController({ state: drafts, request: webDraftRequest(api), storage: webDraftStorage(sessionStorage), userId: () => props.userId, storeId: () => props.store.id });
if (!drafts.pending && restored?.draftRemote) {
  drafts.remote = restored.draftRemote;
  drafts.edit.name = restored.draftName || restored.draftRemote.name;
}
const search = ref("");
const category = ref("");
const mode = ref<string>(
  restored?.mode ??
    (props.store.serviceModes.includes("PICKUP") ? "PICKUP" : "DINE_IN"),
);
const tableCode = ref<string>(restored?.tableCode ?? "");
const serviceIssue = computed(() =>
  !props.store.serviceModes.includes(mode.value) ? '原用餐方式已不可用，请明确重新选择。' :
  mode.value === 'DINE_IN' && tableCode.value && tables.data && !tables.data.some(t => t.code === tableCode.value) ? '原桌台已失效，已保留原选择，请重新选择桌台。' : '',
);
const note = ref<string>(restored?.note ?? "");
const cart = ref<Line[]>(restoreSelectionCart(restored?.cart));
const picker = ref<Product>();
const editingKey = ref<string>();
const needsMenuRefresh = ref(false);
const lineIssue = (line: Line) =>
  catalog.data
    ? cartSelectionIssue(line, catalog.data.products)
    : "请刷新菜单后核对搭配";
const invalidCart = computed(() => cart.value.some((line) => lineIssue(line)));
const linePricePending = (line: Line) => !!line.issue || !!lineIssue(line);
const cartPricePending = computed(() => cart.value.some(linePricePending));
const quote = ref<Quote | undefined>(restored?.quote);
if (drafts.remote?.id && restored?.quote?.cashierDraft?.id === drafts.remote.id) drafts.quote = restored.quote;
const order = ref<Order | undefined>(restored?.order);
const paid = ref<Order | undefined>(restored?.paid);
const receiptFresh = ref(false);
const tendered = ref<string>(restored?.tendered ?? "");
const submittedFen = ref<number | undefined>(restored?.submittedFen);
const receipt = ref<
  { amountFen: number; tenderedFen: number; changeFen: number } | undefined
>(restored?.paid?.cashReceipt ? confirmedCash(restored.paid) : undefined);
const orderKey = ref<string>(restored?.orderKey ?? crypto.randomUUID());
const products = computed(
  () =>
    catalog.data?.products.filter(
      (p) =>
        p.isAvailable &&
        p.name.includes(search.value.trim()) &&
        (!category.value || p.categoryId === category.value),
    ) || [],
);
const totalItems = computed(() =>
  cart.value.reduce((n, l) => n + l.quantity, 0),
);
const estimated = computed(() =>
  cart.value.reduce((n, l) => n + l.quantity * l.unitPriceFen, 0),
);
const uncertain = ref<boolean>(restored?.uncertain ?? false);
const terminal = ref<boolean>(restored?.terminal ?? false);
const locked = computed(
  () => cashierLocks(!!order.value, uncertain.value, mutation.busy, drafts.busy, drafts.blocked, drafts.remote && drafts.remote.state !== 'DRAFT'),
);
const pickup = reactive<any>({});
const pickupCtl = createPickupSelection({
  state: pickup,
  request: (path: string) => api(path),
  storeId: () => props.store.id,
  locked: () => locked.value,
  initial: restored?.pickup,
  onChange: () => {
    quote.value = undefined;
  },
});
function persist() {
  try {
    if (cart.value.length || order.value || uncertain.value || paid.value) {
      recovery.save({
        mode: mode.value,
        pickup: {
          date: pickup.date,
          slotId: pickup.slotId,
          selected: pickup.selected,
        },
        tableCode: tableCode.value,
        note: note.value,
        cart: cart.value,
        quote: quote.value,
        order: order.value,
        paid: paid.value,
        tendered: tendered.value,
        submittedFen: submittedFen.value,
        orderKey: orderKey.value,
        uncertain: uncertain.value,
        terminal: terminal.value,
        draftRemote: drafts.remote,
        draftName: drafts.edit.name,
      });
      if ((uncertain.value || order.value) && !paid.value && !terminal.value)
        sessionStorage.setItem(
          "merchant-active-checkout",
          JSON.stringify({ userId: props.userId, storeId: props.store.id }),
        );
      else sessionStorage.removeItem("merchant-active-checkout");
    } else {
      recovery.clear();
      sessionStorage.removeItem("merchant-active-checkout");
    }
  } catch {
    throw new Error("当前浏览器无法保存收银进度，请开启会话存储后重试。");
  }
}
watch(
  [
    mode,
    tableCode,
    note,
    cart,
    quote,
    order,
    paid,
    tendered,
    submittedFen,
    orderKey,
    uncertain,
    terminal,
    () => pickup.slotId,
    () => pickup.date,
    () => drafts.remote,
    () => drafts.edit.name,
  ],
  persist,
  { deep: true, flush: "sync" },
);
watch(
  [() => mutation.busy, uncertain, () => drafts.busy, () => drafts.blocked],
  () => {
    checkoutBlocked.value = cashierLocks(mutation.busy, uncertain.value, drafts.busy, drafts.blocked);
  },
  { immediate: true, flush: "sync" },
);
function beforeUnload(event: BeforeUnloadEvent) {
  if (checkoutBlocked.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
window.addEventListener("beforeunload", beforeUnload);
onUnmounted(() => {
  alive = false;
  window.removeEventListener("beforeunload", beforeUnload);
  pickupCtl.dispose();
  draftCtl.dispose();
  checkoutBlocked.value = false;
});
watch(
  [cart, mode, tableCode, note, () => pickup.slotId],
  () => {
    if (!order.value && !uncertain.value) {
      applyEvent({ type: "CART_CHANGED", key: crypto.randomUUID() });
    }
  },
  { deep: true },
);
function applyEvent(event: any) {
  const result = transitionCheckout(
    {
      quote: quote.value,
      order: order.value,
      paid: paid.value,
      receipt: receipt.value,
      submittedFen: submittedFen.value,
      tendered: tendered.value,
      uncertain: uncertain.value,
      terminal: terminal.value,
      orderKey: orderKey.value,
    },
    event,
  );
  quote.value = result.state.quote;
  order.value = result.state.order;
  paid.value = result.state.paid;
  receipt.value = result.state.receipt;
  submittedFen.value = result.state.submittedFen;
  tendered.value = result.state.tendered;
  uncertain.value = result.state.uncertain;
  terminal.value = result.state.terminal ?? false;
  orderKey.value = result.state.orderKey;
  persist();
  return result.error;
}
async function reconcile() {
  const identity = props.userId, storeId = props.store.id, orderId = order.value!.id;
  let current: Order;
  try {
    current = await api<Order>(`/orders/${orderId}`);
  } catch (error) {
    if(!alive || props.userId !== identity || props.store.id !== storeId || order.value?.id !== orderId)return;
    applyEvent({ type: "RECONCILE_FAILED" });
    throw error;
  }
  if(!alive || props.userId !== identity || props.store.id !== storeId || order.value?.id !== orderId)return;
  const error = applyEvent({ type: "RECONCILED", order: current });
  if (error) throw new Error(error);
  receiptFresh.value = true;
  if (paid.value) mutation.success = "现金收款成功";
  else if (terminal.value)
    mutation.success = "订单已关闭，可以安全开始下一单。";
}
onMounted(() => {
  loadCashShift();
  if (drafts.pending?.kind === 'convert' || (drafts.remote?.state === 'CONVERTED' && !order.value)) recoverDraft();
  else if (drafts.remote && !drafts.pending && !order.value && !uncertain.value) {
    const localName = drafts.edit.name, revision = drafts.remote.revision;
    quote.value = undefined;
    draftCtl.get(drafts.remote.id).then(ok => {
      if (ok) {
        drafts.edit.name = localName;
        drafts.review = drafts.remote.revision !== revision;
        if (drafts.order) recoverDraft();
      }
    });
  }
  if (order.value || paid.value)
    mutation.run(async () => {
      if (!order.value && paid.value) order.value = paid.value;
      await reconcile();
    }, "");
});
function choose(product: Product, line?: Line) {
  if (locked.value) return;
  picker.value = product;
  editingKey.value = line?.key;
  mutation.clear();
}
function reselect(line: Line) {
  const product = catalog.data?.products.find(
    (p) => p.id === line.productId || p.skus.some((s) => s.id === line.skuId),
  );
  if (product) choose(product, line);
  else mutation.error = new Error("商品已下架，请移除后选择其他商品。");
}
function add(line: Line) {
  if (locked.value) return;
  const issue = lineIssue(line);
  if (issue) {
    mutation.error = new Error(issue);
    return;
  }
  const key = selectionKey(line);
  const next = cart.value.filter((item) => item.key !== editingKey.value);
  const existing = next.find((item) => item.key === key);
  const count = line.quantity + (existing?.quantity || 0);
  if (count > line.available || count > 99) {
    mutation.error = new Error("数量超过当前可售库存，请减少数量。");
    return;
  }
  if (existing) Object.assign(existing, line, { quantity: count, key });
  else next.push({ ...line, key });
  cart.value = next;
  picker.value = undefined;
  editingKey.value = undefined;
  mutation.clear();
  mutation.success = "已加入账单";
}
function refreshMenu() {
  if (locked.value) return;
  mutation.run(async () => {
    const result = await api<Catalog>(`/stores/${props.store.id}/catalog`);
    catalog.data = result;
    needsMenuRefresh.value = false;
    quote.value = undefined;
  }, "菜单已刷新，请核对搭配并重新确认金额。");
}
watch(
  () => mutation.error,
  (error: any) => {
    if (isPickupRejection(error)) {
      quote.value = undefined;
      pickupCtl.invalidate(error);
    }
  },
);
function getQuote() {
  mutation.run(async () => {
    if (needsMenuRefresh.value || invalidCart.value || serviceIssue.value)
      throw new Error("请刷新菜单并重新选择失效搭配后核对金额。");
    if (drafts.remote) {
      syncDraft();
      if (!await draftCtl.quote()) throw drafts.error || new Error('请先核对挂单操作结果。');
      applyEvent({ type: 'QUOTE_RECEIVED', quote: drafts.quote });
      tendered.value = (drafts.quote.totalFen / 100).toFixed(2);
      return;
    }
    const result = await api<Quote>("/quotes", {
      method: "POST",
      body: {
        storeId: props.store.id,
        mode: mode.value,
        lines: cart.value.map(
          ({ skuId, quantity, modifierIds, attributeOptionIds = [] }) => ({
            skuId,
            quantity,
            modifierIds,
            attributeOptionIds,
          }),
        ),
        ...(mode.value === "DINE_IN" ? { tableCode: tableCode.value } : {}),
        ...(mode.value === "PICKUP" ? pickupCtl.quoteFields() : {}),
        note: note.value,
      },
    });
    applyEvent({ type: "QUOTE_RECEIVED", quote: result });
    tendered.value = (result.totalFen / 100).toFixed(2);
  }, "金额已核对，请确认实收现金。");
}
function checkout() {
  mutation.run(async () => {
    const identity = props.userId, storeId = props.store.id;
    const isCurrent = () => alive && props.userId === identity && props.store.id === storeId;
    if (drafts.busy || drafts.blocked) throw new Error('请先核对原挂单操作。');
    if (!uncertain.value) {
      requireSettledShift(sessionStorage, props.userId);
      const value = await requireActiveShift(api,props.store.id);
      if(!isCurrent())return;
      requireSettledShift(sessionStorage, props.userId);
      cashShift.current=value;cashShift.loaded=true;
    }
    const validation = applyEvent({
      type: "SUBMIT",
      tendered: tendered.value,
      now: Date.now(),
    });
    if (validation) throw new Error(validation);
    const amount = submittedFen.value!;
    tendered.value = (amount / 100).toFixed(2);
    persist();
    if (!order.value) {
      try {
        uncertain.value = true;
        persist();
        if (drafts.remote) {
          if (!await draftCtl.convert({ quoteId: quote.value!.id, orderKey: orderKey.value })) throw drafts.error || new Error('原下单结果待核对。');
          if(!isCurrent())return;
          order.value = drafts.order;
        } else {
          const created = await api<Order>("/orders", {
            method: "POST", body: { quoteId: quote.value!.id }, key: orderKey.value,
          });
          if(!isCurrent())return;
          order.value = created;
        }
        uncertain.value = false;
      } catch (e) {
        if(!isCurrent())return;
        if (drafts.remote && !drafts.blocked && ['DRAFT_CHANGED', 'DRAFT_ALREADY_CONVERTED'].includes((e as any)?.code)) {
          if (drafts.order) await recoverDraft();
          else applyEvent({ type: 'CREATE_REJECTED', key: crypto.randomUUID() });
        }
        if (isDefinitiveOrderRejection(e) || isPickupRejection(e)) {
          applyEvent({ type: "CREATE_REJECTED", key: crypto.randomUUID() });
          if (isPickupRejection(e)) pickupCtl.invalidate(e);
          else needsMenuRefresh.value = true;
        }

        throw e;
      }
    }
    const cashPreviouslyUnknown = uncertain.value;
    if (!cashPreviouslyUnknown) requireSettledShift(sessionStorage, props.userId);
    try {
      uncertain.value = true;
      persist();
      let result = await api<Order>(
        `/merchant/orders/${order.value!.id}/cash-payment`,
        { method: "POST", body: { tenderedFen: amount } },
      );
      if(!isCurrent())return;
      if (!result.cashReceipt)
        result = await api<Order>(`/orders/${order.value!.id}`);
      if(!isCurrent())return;
      const error = applyEvent({ type: "RECONCILED", order: result });
      if (error) throw new Error(error);
      receiptFresh.value = true;
      mutation.success = paid.value
        ? "现金收款成功"
        : terminal.value
          ? "订单已关闭，可以安全开始下一单。"
          : "";
    } catch (error) {
      if(!isCurrent())return;
      if (!cashPreviouslyUnknown && (error as any)?.code === 'SHIFT_REQUIRED' && (error as any)?.status === 409) {
        applyEvent({ type: 'CASH_SHIFT_REQUIRED_FIRST' });
        throw error;
      }
      if (!isUncertainWrite(error)) {
        await reconcile();
        if (paid.value || terminal.value) return;
      }
      throw error;
    }
    catalog.reload();
  }, "");
}
function reset() {
  if (drafts.busy || drafts.blocked || mutation.busy || uncertain.value) return;
  draftCtl.detach();
  receiptFresh.value = false;
  cart.value = [];
  quote.value = undefined;
  order.value = undefined;
  paid.value = undefined;
  uncertain.value = false;
  terminal.value = false;
  submittedFen.value = undefined;
  receipt.value = undefined;
  note.value = "";
  tendered.value = "";
  orderKey.value = crypto.randomUUID();
  mutation.clear();
  recovery.clear();
  sessionStorage.removeItem("merchant-active-checkout");
  catalog.reload();
  tables.reload();
}
function syncDraft() {
  drafts.edit = { name: drafts.edit.name, selection: draftSelection(cart.value, { mode: mode.value, tableCode: tableCode.value, pickupSlotId: pickup.slotId, note: note.value }) };
}
const unsavedDraft = computed(() => draftCtl.isDirty({ name: drafts.edit.name, selection: draftSelection(cart.value, { mode: mode.value, tableCode: tableCode.value, pickupSlotId: pickup.slotId, note: note.value }) }));
async function saveDraft() {
  if (locked.value || !cart.value.length) return;
  syncDraft();
  const saved = drafts.remote ? await draftCtl.update() : await draftCtl.create();
  if (saved) { quote.value = undefined; persist(); }
}
function takeDraft() {
  if (!drafts.remote) return;
  if (drafts.remote.state === 'CONVERTED') { recoverDraft(); return; }
  const value = hydrateDraft(drafts.remote, catalog.data);
  cart.value = value.cart;
  mode.value = value.mode;
  tableCode.value = value.tableCode || '';
  note.value = value.note;
  // Keep the original slot even if expired; the pickup controller requires a fresh lookup.
  pickup.slotId = value.pickupSlotId || '';
  pickup.selected = null;
  pickup.needsRefresh = !!value.pickupSlotId;
  pickup.error = value.pickupSlotId ? '原预约时间尚待核对，请重新查询；不会自动改成即时自取。' : '';
  quote.value = undefined;
  needsMenuRefresh.value = false;
  persist();
}
async function recoverDraft() {
  try {
    const current = await recoverDraftCheckout({ state: drafts, controller: draftCtl, applyEvent });
    if (current) {
      mutation.clear();
      receiptFresh.value = true;
    }
    // Recovered conversion only reads facts. Cash requires the customer's next explicit click.
  } catch (error) { mutation.error = error as Error; }
}
</script>
<template>
  <div v-if="cashShift.loaded && !cashShift.current || mutation.error && (mutation.error as any).code === 'SHIFT_REQUIRED'" class="notice-strip" role="status">
    尚未开班，请店主先开班，再返回原订单确认现金。
    <button v-if="owner" class="text-button" :disabled="checkoutBlocked" @click="emit('shifts')">前往现金交班</button>
  </div>
  <div class="cashier-layout">
    <section class="panel catalog-panel">
      <div class="toolbar">
        <div class="search-field">
          <Search :size="18" /><input
            v-model="search"
            aria-label="收银商品搜索"
            placeholder="搜索商品"
            :disabled="locked"
          />
        </div>
        <select v-model="category" aria-label="收银商品分类">
          <option value="">全部分类</option>
          <option
            v-for="c in catalog.data?.categories"
            :key="c.id"
            :value="c.id"
          >
            {{ c.name }}
          </option>
        </select>
      </div>
      <StateBlock
        :loading="catalog.loading"
        :error="catalog.error"
        :empty="products.length === 0"
        @retry="catalog.reload"
        ><template #empty>暂无可售商品，请先上架并补充库存。</template>
        <div class="catalog-grid">
          <button
            v-for="product in products"
            :key="product.id"
            class="catalog-card"
            :disabled="locked || product.skus.every((s) => s.available === 0)"
            @click="choose(product)"
          >
            <div class="catalog-image">
              <img
                v-if="product.imageUrl"
                :src="product.imageUrl"
                :alt="product.name"
              /><Package v-else :size="35" />
            </div>
            <div class="catalog-copy">
              <strong>{{ product.name }}</strong
              ><span class="muted">{{ product.skus.length }} 种规格</span>
              <div class="row between">
                <strong class="price"
                  >{{ money(Math.min(...product.skus.map((s) => s.priceFen)))
                  }}<span v-if="product.skus.length > 1" class="muted"
                    >起</span
                  ></strong
                ><span class="add-circle"><Plus :size="17" /></span>
              </div>
            </div>
          </button></div
      ></StateBlock>
    </section>
    <aside class="cart-panel panel">
      <CashierOrderDetails v-if="order" :order="order" />
      <template v-if="paid"
        ><div class="paid-receipt">
          <CheckCircle2 :size="44" />
          <h2>
            {{
              !receiptFresh
                ? "现金凭证待核对"
                : paid.refundStatus === "SUCCEEDED"
                  ? "已全额退款"
                  : paid.refundedFen
                    ? "已部分退款"
                    : "现金已收款"
            }}
          </h2>
          <p v-if="!receiptFresh" class="notice-strip">
            已保存原收款凭证，最新退款情况待查询。
          </p>
          <p class="muted">{{ paid.number }}</p>
          <p v-if="paid.mode === 'PICKUP'">
            取餐号 {{ paid.pickupNumber }} ·
            {{ paid.pickupServiceDate || "旧订单" }} ·
            {{ pickupWindowText(paid.pickupWindow) }}
          </p>
          <strong class="paid-amount">{{ money(paid.totalFen) }}</strong>
          <CashReceipt :order="paid" />
          <Feedback :error="mutation.error" />
          <button
            class="quiet"
            :disabled="mutation.busy"
            @click="mutation.run(reconcile, '')"
          >
            刷新现金凭证
          </button>
          <p class="muted">
            {{
              paid.status === "COMPLETED"
                ? "订单已完成"
                : paid.status === "CANCELLED"
                  ? "订单已关闭"
                  : "可前往订单页查看当前进度"
            }}
          </p>
          <button class="primary large" @click="reset">开始下一单</button>
        </div></template
      ><template v-else-if="terminal"
        ><div class="paid-receipt">
          <ShoppingBag :size="38" />
          <h2>订单已关闭</h2>
          <p class="muted">{{ order?.number }}</p>
          <p>此订单已取消或过期，未再收取现金。</p>
          <p class="muted">已重新查询并确认订单关闭，可以开始下一笔收银。</p>
          <button
            class="primary large"
            :disabled="mutation.busy"
            @click="reset"
          >
            开始下一单
          </button>
        </div></template
      ><template v-else
        ><template v-if="!order"><div class="panel-title">
          <h2><ShoppingBag :size="19" />当前账单</h2>
          <span class="muted">{{ totalItems }} 件</span>
        </div>
        <div v-if="!locked" class="cart-options">
          <label class="field"
            ><span>用餐方式</span
            ><select v-model="mode">
              <option
                v-if="store.serviceModes.includes('PICKUP')"
                value="PICKUP"
              >
                到店自取
              </option>
              <option
                v-if="store.serviceModes.includes('DINE_IN')"
                value="DINE_IN"
              >
                堂食
              </option>
            </select></label
          ><label v-if="mode === 'DINE_IN'" class="field"
            ><span>桌台</span
            ><select v-model="tableCode" required>
              <option value="">请选择桌台</option>
              <option
                v-for="table in tables.data"
                :key="table.id"
                :value="table.code"
              >
                {{ table.name }} ·
                {{ table.status === "FREE" ? "空闲" : "使用中" }}
              </option>
            </select></label
          ><StateBlock
            v-if="tables.error && mode === 'DINE_IN'"
            :error="tables.error"
            @retry="tables.reload"
          />
        </div>
        <PickupSelection
          v-if="mode === 'PICKUP' && !order && !uncertain"
          :state="pickup"
          :locked="locked"
          :load="pickupCtl.load"
          :select="pickupCtl.select"
        />
        <p v-if="serviceIssue" class="notice" role="alert">{{ serviceIssue }}</p>
        <div v-if="cart.length === 0" class="empty">
          <ShoppingBag :size="32" />
          <p>从左侧选择商品<br />开始一笔新订单</p>
        </div>
        <div v-else class="cart-lines">
          <div v-for="(line, index) in cart" :key="line.key" class="cart-line">
            <div class="row between">
              <strong>{{ line.productName }}</strong
              ><button
                v-if="!locked"
                class="icon-button"
                :aria-label="`移除${line.productName}`"
                @click="cart.splice(index, 1)"
              >
                <Trash2 :size="15" />
              </button>
            </div>
            <p class="muted">
              {{ line.skuName }} {{ line.modifierNames?.join("、") }}
            </p>
            <p v-if="attributeSummary(line)" class="muted">
              {{ attributeSummary(line) }}
            </p>
            <p v-else-if="(line as any).display?.attributeNames?.length" class="muted">{{ (line as any).display.attributeNames.join('、') }}（原选择）</p>
            <p v-if="lineIssue(line)" class="notice">{{ lineIssue(line) }}</p>
            <button
              v-if="!locked"
              class="text-button"
              :aria-label="`重新选择${line.productName} ${line.skuName} ${attributeSummary(line)}`"
              @click="reselect(line)"
            >
              重新选择搭配
            </button>
            <div class="row between">
              <strong>{{ linePricePending(line) ? '待重新核价' : money(line.unitPriceFen * line.quantity) }}</strong>
              <div class="quantity">
                <button
                  aria-label="减少数量"
                  :disabled="locked || line.quantity <= 1"
                  @click="line.quantity--"
                >
                  <Minus :size="14" /></button
                ><span>{{ line.quantity }}</span
                ><button
                  aria-label="增加数量"
                  :disabled="
                    locked ||
                    line.quantity >= line.available ||
                    line.quantity >= 99
                  "
                  @click="line.quantity++"
                >
                  <Plus :size="14" />
                </button>
              </div>
            </div>
          </div>
        </div>
        <label v-if="cart.length && !locked" class="field"
          ><span>订单备注</span
          ><input
            v-model="note"
            maxlength="500"
            placeholder="口味、打包等要求" /></label
        ></template><Feedback :error="mutation.error" :success="mutation.success" />
        <div v-if="cart.length && !order && !uncertain && (!drafts.remote || drafts.remote.state === 'DRAFT')" class="draft-save">
          <label class="field"><span>挂单名称</span><input v-model="drafts.edit.name" maxlength="60" :disabled="locked" placeholder="例如：张先生 / 2号桌" /></label>
          <button class="quiet" :disabled="locked || !drafts.edit.name.trim()" @click="saveDraft">{{ drafts.busy ? '保存中…' : '保存挂单' }}</button>
        </div>
        <button
          v-if="!locked"
          class="quiet"
          :disabled="mutation.busy"
          @click="refreshMenu"
        >
          刷新菜单
        </button>
        <p v-if="quote && !order && mode === 'PICKUP'" class="notice-strip">
          {{ pickupWindowText(quote.pickupWindow) }}
        </p>
        <div v-if="quote && !order" class="quote-totals">
          <div>
            <span>商品金额</span><span>{{ money(quote.subtotalFen) }}</span>
          </div>
          <div v-if="quote.packagingFeeFen">
            <span>打包费</span><span>{{ money(quote.packagingFeeFen) }}</span>
          </div>
          <div v-if="quote.deliveryFeeFen">
            <span>配送费</span><span>{{ money(quote.deliveryFeeFen) }}</span>
          </div>
          <div v-if="quote.discountFen">
            <span>优惠</span><span>-{{ money(quote.discountFen) }}</span>
          </div>
        </div>
        <div class="payment-total">
          <span>{{ quote || order ? "应收金额" : "商品合计（预估）" }}</span
          ><strong>{{ !order && !quote && cartPricePending ? '待重新核价' : money(order?.totalFen ?? quote?.totalFen ?? estimated) }}</strong>
        </div>
        <template v-if="quote || order"
          ><div v-if="uncertain" class="notice-strip">
            订单或收款结果尚未确认，请重试同一笔订单。当前进度已保存，刷新后可继续。
          </div>
          <button
            v-if="!locked"
            type="button"
            class="text-button"
            @click="getQuote"
          >
            重新核对金额
          </button>
          <p v-if="order" class="notice-strip">
            订单
            {{ order.number }} 已创建，完成现金收款后可继续处理。请勿重复开单。
          </p>
          <form @submit.prevent="checkout">
            <label class="field"
              ><span>实收现金（元）</span
              ><input
                v-model="tendered"
                :disabled="mutation.busy || submittedFen !== undefined"
                type="number"
                :min="((order?.totalFen ?? quote!.totalFen) / 100).toFixed(2)"
                step="0.01"
                required
            /></label>
            <p v-if="Number(tendered) * 100 >= (order?.totalFen ?? quote!.totalFen)">
              找零
              {{ money(Math.round(Number(tendered) * 100) - (order?.totalFen ?? quote!.totalFen)) }}
            </p>
            <button class="primary large" :disabled="mutation.busy || drafts.busy || drafts.blocked">
              {{
                mutation.busy
                  ? "处理中…"
                  : order
                    ? "确认现金收款"
                    : "下单并确认现金收款"
              }}
            </button>
          </form></template
        ><button
          v-else
          class="primary large"
          :disabled="
            !cart.length ||
            needsMenuRefresh ||
            invalidCart ||
            !!serviceIssue ||
            (mode === 'PICKUP' &&
              !!pickup.slotId &&
              (pickup.loading || pickup.needsRefresh)) ||
            catalog.loading ||
            mutation.busy ||
            drafts.busy || drafts.blocked || !!drafts.order ||
            (mode === 'DINE_IN' && !tableCode) ||
            !store.isOpen
          "
          @click="getQuote"
        >
          {{ mutation.busy ? "核对中…" : drafts.remote ? "保存并核价" : "核对金额" }}
        </button>
        <p v-if="!store.isOpen" class="muted">
          门店休息中，营业后可开单。
        </p></template
      >
      <CashierDrafts :state="drafts" :controller="draftCtl" :has-cart="!!cart.length" :has-unsaved-changes="unsavedDraft" :checkout-locked="!!order || uncertain || mutation.busy" @take="takeDraft" @reload="takeDraft" @recovered="recoverDraft" @next="reset" />
    </aside>
  </div>
  <Modal v-if="picker" :title="picker.name" @close="picker = undefined">
    <ProductSelection
      :key="picker.id"
      :product="picker"
      @add="add"
      @close="picker = undefined"
    />
    <Feedback :error="mutation.error" />
  </Modal>
</template>
