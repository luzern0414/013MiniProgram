<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  LayoutDashboard,
  ClipboardList,
  Package,
  Banknote,
  Armchair,
  Users,
  Settings,
  PanelsTopLeft,
  LogOut,
  RefreshCw,
  Store as StoreIcon,
  Menu,
  UtensilsCrossed,
} from "lucide-vue-next";
import { readRefundAttempt } from "../../../packages/mini-core/src/cash-refunds.mjs";
import { readDraftAttempt } from '../../../packages/mini-core/src/cashier-drafts.mjs';
import { readShiftAttempt } from '../../../packages/mini-core/src/cash-shifts.mjs';
import { webDraftStorage } from './cashierDrafts.mjs';
import { webRefundStorage } from "./refundRecovery.mjs";
import { api } from "./api";
import { canUseDevLogin } from "./domain.mjs";
import { checkoutBlocked } from "./checkoutGuard";
import { createRecovery } from './recovery.mjs';
import type { Store, User } from "./types";
import StateBlock from "./StateBlock.vue";
import Dashboard from "./Dashboard.vue";
import Products from "./Products.vue";
import Orders from "./Orders.vue";
import Cashier from "./Cashier.vue";
import CashShifts from './CashShifts.vue';
import People from "./People.vue";
import PickupSettings from "./PickupSettings.vue";
import StoreSettings from "./StoreSettings.vue";
import PageEditor from "./PageEditor.vue";
import Tables from "./Tables.vue";
import LoginForm from "./LoginForm.vue";
import { clearMerchantSession, logoutMerchant } from "./session.mjs";
const nav = [
  { id: 'shifts', label: '现金交班', icon: Banknote, sub: '开班、清点现金，核对每一班。' },
  {
    id: "pickup",
    label: "预约自提",
    icon: Armchair,
    sub: "按时段安排，让取餐有序。",
  },
  {
    id: "dashboard",
    label: "工作台",
    icon: LayoutDashboard,
    sub: "今天，心中有数。",
  },
  {
    id: "orders",
    label: "订单",
    icon: ClipboardList,
    sub: "每一单，都有条不紊。",
  },
  {
    id: "products",
    label: "商品与库存",
    icon: Package,
    sub: "好商品，从这里上架。",
  },
  {
    id: "cashier",
    label: "门店收银",
    icon: Banknote,
    sub: "选好商品，确认每笔收款。",
  },
  {
    id: "tables",
    label: "桌台",
    icon: Armchair,
    sub: "看清堂食桌台的当下状态。",
  },
  {
    id: "people",
    label: "会员与员工",
    icon: Users,
    sub: "认识顾客，也了解当班伙伴。",
  },
  {
    id: "settings",
    label: "门店设置",
    icon: Settings,
    sub: "让门店按你的节奏运转。",
  },
  {
    id: "page",
    label: "页面内容",
    icon: PanelsTopLeft,
    sub: "把门店的新消息，告诉顾客。",
  },
];
const page = ref("dashboard");
const active = computed(() => nav.find((n) => n.id === page.value)!);
const user = ref<User>();
const stores = ref<Store[]>([]);
const storeId = ref("");
const store = computed(() => stores.value.find((s) => s.id === storeId.value));
const environment = ref<string>();
const brandName = ref("店务");
const loading = ref(true);
const error = ref<Error>();
const busy = ref(false);
const productBusy = ref(false);
const pickupBusy = ref(false);
const shiftBusy = ref(false);
const shiftRecovery = ref<ReturnType<typeof readShiftAttempt>>({attempt:null,error:null});
const originalRecovery = ref<{page:string;storeId:string}|null>(null);
const otherRecovery = computed(() => !!originalRecovery.value);
const pendingShift = computed(() => !!(shiftRecovery.value.attempt || shiftRecovery.value.error));
const mountedOtherLocked = computed(() => checkoutBlocked.value || productBusy.value || pickupBusy.value);
const otherLocked = computed(() => mountedOtherLocked.value || otherRecovery.value);
const navigationLocked = computed(
  () => otherLocked.value || shiftBusy.value || pendingShift.value,
);
function syncShiftRecovery() {
  if (!user.value) return;
  const adapter = webDraftStorage(sessionStorage);
  shiftRecovery.value = readShiftAttempt(adapter, user.value.id);
  const draft = readDraftAttempt(adapter, user.value.id);
  const refund = readRefundAttempt(webRefundStorage(sessionStorage), user.value.id);
  const cashStore = stores.value.find(s => createRecovery(sessionStorage,user.value!.id,s.id).read()?.uncertain);
  originalRecovery.value = refund.error || refund.attempt
    ? {page:'orders',storeId:refund.attempt?.storeId || storeId.value}
    : draft.error || draft.attempt
      ? {page:'cashier',storeId:draft.attempt?.storeId || storeId.value}
      : cashStore ? {page:'cashier',storeId:cashStore.id} : null;
}
watch([checkoutBlocked, pickupBusy, shiftBusy], syncShiftRecovery, {flush:'sync'});
const brandId = ref("");
const loginNotice = ref("");
const mobileMenu = ref(false);
const generation = ref(0);
const devLogin = computed(() =>
  canUseDevLogin(import.meta.env.DEV, environment.value),
);
const owner = computed(() => user.value?.role === "OWNER");
async function load() {
  loading.value = true;
  error.value = undefined;
  try {
    const config = await api<{
      brandId: string;
      brandName: string;
      environment: string;
    }>("/public-config");
    environment.value = config.environment;
    brandId.value = config.brandId;
    brandName.value = config.brandName;
    if (sessionStorage.getItem("merchant-token")) {
      const me = await api<User>("/me");
      if (!["OWNER", "CLERK"].includes(me.role)) {
        sessionStorage.removeItem("merchant-token");
        throw new Error("此账户没有商户工作台权限。");
      }
      user.value = me;
      const all = await api<Store[]>("/stores");
      stores.value = all.filter((s) => me.storeIds.includes(s.id));
      const saved = sessionStorage.getItem("merchant-store");
      storeId.value = stores.value.some((s) => s.id === saved)
        ? saved!
        : stores.value[0]?.id || "";
      try {
        const pending = JSON.parse(
          sessionStorage.getItem("merchant-active-checkout") || "null",
        );
        if (
          pending?.userId === me.id &&
          stores.value.some((s) => s.id === pending.storeId)
        ) {
          storeId.value = pending.storeId;
          page.value = "cashier";
        }
      } catch {
        /* Ignore an invalid navigation hint; per-user recovery remains separately scoped. */
      }
      const draft = readDraftAttempt(webDraftStorage(sessionStorage), me.id);
      if (draft.error || draft.attempt) {
        if (draft.attempt && stores.value.some(s => s.id === draft.attempt.storeId)) storeId.value = draft.attempt.storeId;
        page.value = 'cashier';
      }
      const refund = readRefundAttempt(webRefundStorage(sessionStorage), me.id);
      if (refund.error || refund.attempt) {
        if (
          refund.attempt &&
          stores.value.some((s) => s.id === refund.attempt.storeId)
        )
          storeId.value = refund.attempt.storeId;
        page.value = "orders";
      }
      const shift = readShiftAttempt(webDraftStorage(sessionStorage), me.id);
      syncShiftRecovery();
      if (originalRecovery.value) {
        if (stores.value.some(s => s.id === originalRecovery.value!.storeId)) storeId.value = originalRecovery.value.storeId;
        page.value = originalRecovery.value.page;
      }
      // Existing unknown cash/refund/draft recovery keeps its route and lock.
      if ((shift.error || shift.attempt) && page.value === 'dashboard') {
        if (shift.attempt && stores.value.some(s => s.id === shift.attempt.storeId)) storeId.value = shift.attempt.storeId;
        page.value = 'shifts';
      }
    }
  } catch (e) {
    error.value = e as Error;
  } finally {
    loading.value = false;
  }
}
async function authenticated(token: string) {
  sessionStorage.setItem("merchant-token", token);
  loginNotice.value = "";
  await load();
}
function clearSession() {
  clearMerchantSession(sessionStorage);
  user.value = undefined;
  stores.value = [];
  storeId.value = "";
  error.value = undefined;
  page.value = "dashboard";
  checkoutBlocked.value = false;
  shiftBusy.value = false;
  shiftRecovery.value = {attempt:null,error:null};
  originalRecovery.value = null;
}
function sessionExpired() {
  clearSession();
  loginNotice.value = "登录已过期，请重新登录";
}
async function logout() {
  if (busy.value) return;
  busy.value = true;
  loginNotice.value = await logoutMerchant(api, clearSession);
  busy.value = false;
}
function changeStore() {
  sessionStorage.setItem("merchant-store", storeId.value);
  generation.value++;
}
async function refreshStores() {
  try {
    const all = await api<Store[]>("/stores");
    stores.value = all.filter((s) => user.value?.storeIds.includes(s.id));
  } catch (e) {
    error.value = e as Error;
  }
}
function navigate(id: string) {
  syncShiftRecovery();
  if (navigationLocked.value) return;
  page.value = id;
  mobileMenu.value = false;
}
function recoverShift() {
  syncShiftRecovery();
  if (!pendingShift.value || otherLocked.value || shiftBusy.value) return;
  const original = shiftRecovery.value.attempt?.storeId;
  if (original && !stores.value.some(s => s.id === original)) return;
  if (original) storeId.value = original;
  page.value = 'shifts';
  mobileMenu.value = false;
}
function recoverOriginal() {
  syncShiftRecovery();
  const original = originalRecovery.value;
  if (!original || mountedOtherLocked.value || shiftBusy.value || !stores.value.some(s => s.id === original.storeId)) return;
  storeId.value = original.storeId;
  page.value = original.page;
  mobileMenu.value = false;
}
function requestLogout() {
  syncShiftRecovery();
  if (!navigationLocked.value) logout();
}
function beforeUnload(event: BeforeUnloadEvent) {
  syncShiftRecovery();
  if (navigationLocked.value) { event.preventDefault(); event.returnValue = ''; }
}
onMounted(() => {
  load();
  window.addEventListener("merchant-unauthenticated", sessionExpired);
  window.addEventListener('beforeunload', beforeUnload);
});
onUnmounted(() => {
  window.removeEventListener("merchant-unauthenticated", sessionExpired);
  window.removeEventListener('beforeunload', beforeUnload);
});
const today = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "long",
  day: "numeric",
  weekday: "long",
}).format(new Date());
</script>
<template>
  <div v-if="!user" class="login-layout">
    <aside class="login-story">
      <div class="brand-mark">
        <UtensilsCrossed :size="25" /><strong>店务</strong
        ><span>商户工作台</span>
      </div>
      <div>
        <p class="eyebrow">把日常，经营好</p>
        <h1>忙而有序。<br />每一天，都有数。</h1>
        <p>订单、商品与门店，<br />在同一张工作台上井井有条。</p>
      </div>
      <span class="muted">门店经营 · 从容开始</span>
    </aside>
    <main class="login-form">
      <div class="login-box">
        <p class="eyebrow">欢迎回来</p>
        <h1>开始今天的营业</h1>
        <p class="muted">{{ brandName }} · 商户工作台</p>
        <p v-if="loginNotice" class="notice-strip" role="status">
          {{ loginNotice }}
        </p>
        <StateBlock :loading="loading" :error="error" @retry="load">
          <LoginForm
            :config="{ brandId, environment: environment || '' }"
            :dev-login="devLogin"
            :disabled="busy"
            @authenticated="authenticated"
          />
        </StateBlock>
      </div>
    </main>
  </div>
  <div v-else class="app-shell">
    <aside class="sidebar" :class="{ expanded: mobileMenu }">
      <div class="brand-mark">
        <UtensilsCrossed :size="23" /><strong>店务</strong
        ><span>商户工作台</span>
      </div>
      <p class="sidebar-label">日常经营</p>
      <nav aria-label="主导航">
        <button
          v-for="item in nav"
          :key="item.id"
          :class="{ active: page === item.id }"
          @click="navigate(item.id)"
          :disabled="navigationLocked"
        >
          <component :is="item.icon" :size="19" /><span>{{ item.label }}</span
          ><span v-if="page === item.id" class="nav-dot" />
        </button>
      </nav>
      <div class="sidebar-bottom">
        <span v-if="environment !== 'production'" class="environment-label">{{
          environment === "development" ? "开发体验环境" : "测试环境"
        }}</span>
        <div class="user-line">
          <div class="avatar">{{ user.name.slice(0, 1) }}</div>
          <div>
            <strong>{{ user.name }}</strong>
            <p>{{ owner ? "店主" : "店员" }}</p>
          </div>
          <button
            class="icon-button"
            aria-label="退出登录"
            :disabled="navigationLocked || busy"
            @click="requestLogout"
          >
            <LogOut :size="18" />
          </button>
        </div>
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar">
        <div class="row">
          <button
            class="icon-button mobile-menu"
            aria-label="展开导航"
            @click="mobileMenu = !mobileMenu"
          >
            <Menu /></button
          ><StoreIcon :size="18" /><select
            v-model="storeId"
            :disabled="navigationLocked"
            aria-label="当前门店"
            class="store-select"
            @change="changeStore"
          >
            <option v-for="s in stores" :key="s.id" :value="s.id">
              {{ s.name }}
            </option></select
          ><span
            v-if="store"
            class="badge"
            :class="store.isOpen ? 'green' : 'neutral'"
            >{{ store.isOpen ? "营业中" : "休息中" }}</span
          >
        </div>
        <span class="top-date">{{ today }}</span>
      </header>
      <main>
        <div class="page-heading">
          <div>
            <p class="eyebrow">{{ brandName }}</p>
            <h1>{{ active.label }}</h1>
            <p class="muted">{{ active.sub }}</p>
          </div>
          <button
            class="quiet"
            :disabled="navigationLocked"
            @click="generation++"
          >
            <RefreshCw :size="16" />刷新
          </button>
        </div>
        <div v-if="checkoutBlocked" class="notice-strip" role="status">
          收银正在处理或等待结果，请在当前账单中确认完成。刷新浏览器后会恢复同一笔账单。
        </div>
        <div v-if="productBusy" class="notice-strip" role="status">
          正在读取或保存商品配置，请稍候。
        </div>
        <div v-if="pendingShift && page !== 'shifts'" class="notice-strip" role="status">
          原交班操作待核对。请先完成当前收银、退款或挂单核对，再前往恢复交班。
          <button class="text-button" :disabled="otherLocked || shiftBusy" @click="recoverShift">前往恢复交班</button>
        </div>
        <div v-if="originalRecovery && (originalRecovery.page !== page || originalRecovery.storeId !== storeId)" class="notice-strip" role="status">
          还有原收银、退款或挂单操作待核对。
          <button class="text-button" :disabled="mountedOtherLocked || shiftBusy" @click="recoverOriginal">继续核对原操作</button>
        </div>
        <StateBlock
          v-if="loading || error"
          :loading="loading"
          :error="error"
          @retry="load"
        />
        <div v-else-if="!store" class="empty">
          当前账户暂无授权门店，请联系管理员。
        </div>
        <Transition v-else name="page" mode="out-in"
          ><div :key="`${storeId}-${page}-${generation}`">
            <Dashboard
              v-if="page === 'dashboard'"
              :store="store"
              @navigate="navigate"
            /><Products
              v-else-if="page === 'products'"
              :store="store"
              :owner="owner"
              @busy="productBusy = $event"
            /><Orders
              v-else-if="page === 'orders'"
              :store="store"
              :user-id="user.id"
              :owner="owner"
              @busy="pickupBusy = $event"
              @checkout="navigate('cashier')"
              @shifts="navigate('shifts')"
            /><Cashier
              v-else-if="page === 'cashier'"
              :store="store"
              :user-id="user.id"
              :owner="owner"
              @shifts="navigate('shifts')"
            /><CashShifts
              v-else-if="page === 'shifts'"
              :store="store"
              :user-id="user.id"
              :owner="owner"
              @busy="shiftBusy = $event"
            /><Tables v-else-if="page === 'tables'" :store="store" /><People
              v-else-if="page === 'people'"
              :store="store"
              :stores="stores"
              :owner="owner"
            /><StoreSettings
              v-else-if="page === 'settings'"
              :store="store"
              :owner="owner"
              @saved="refreshStores"
            /><PickupSettings
              v-else-if="page === 'pickup'"
              :store="store"
              :owner="owner"
              @busy="pickupBusy = $event"
            /><PageEditor
              v-else-if="page === 'page'"
              :store="store"
              :owner="owner"
            /></div
        ></Transition>
        <footer class="workspace-footer">
          <span>店务 · 每一份用心，都有回响</span><span>营业日按北京时间</span>
        </footer>
      </main>
    </div>
  </div>
</template>
