<script setup>
import { onMounted, onUnmounted, computed, ref, watch } from "vue";
import { onBackPress } from "@dcloudio/uni-app";
import CashRefund from "../../components/CashRefund.vue";
import CashReceipt from "../../components/CashReceipt.vue";
import PickupSettings from "../../components/PickupSettings.vue";
import PickupRedemption from "../../components/PickupRedemption.vue";
import PickupSearch from "../../components/PickupSearch.vue";
import MerchantLogin from "../../components/MerchantLogin.vue";
import StaffPanel from "../../components/StaffPanel.vue";
import ProductsPanel from "../../components/ProductsPanel.vue";
import CashierPanel from "../../components/CashierPanel.vue";
import CashShifts from "../../components/CashShifts.vue";
import { useMerchant } from "../../merchant.js";
import {
  modeNames,
  statusNames,
  paymentNames,
  createClient,
  attributeSummary,
  pickupWindowText,
} from "@restaurant/mini-core";
const {
  user,
  config,
  stores,
  storeId,
  store,
  owner,
  tab,
  overview,
  orders,
  catalog,
  filter,
  visibleOrders,
  order,
  cashOrder,
  tendered,
  pendingCash,
  shifts,
  shiftBusy,
  showShifts,
  resumeCash,
  resumeRefund,
  refund,
  refundCtl,
  refundBusy,
  cashier,
  cashierBusy,
  auxiliaryBusy,
  returnToDraftStore,
  returnToRefundStore,
  error,
  notice,
  busy,
  loading,
  sheet,
  init,
  login,
  staffLogin,
  loggingOut,
  wechatLogin,
  logout,
  selectStore,
  navigate,
  detail,
  toggleOpen,
  toggleProduct,
  openCash,
  cash,
  transition,
  actions,
  orderTotal,
  setFilter,
  moreOrders,
  refresh,
  money,
} = useMerchant();
const staffBusy = ref(false);
const catalogBusy = ref(false);
const pickupOperationBusy = ref(false);
const pickupBusy = computed(
  () => pickupOperationBusy.value || refundBusy.value || cashierBusy.value || shiftBusy.value,
);
watch([staffBusy, catalogBusy, pickupOperationBusy], () => {
  auxiliaryBusy.value = staffBusy.value || catalogBusy.value || pickupOperationBusy.value;
}, { flush: 'sync', immediate: true });
const financialRecoveryBusy = computed(() => busy.value || auxiliaryBusy.value || refundBusy.value || cashierBusy.value || !!pendingCash.value || loggingOut.value);
const navigationBusy = computed(() => financialRecoveryBusy.value || shiftBusy.value);
const searchActive = ref(false);
watch([storeId, tab], () => {
  searchActive.value = false;
});
onBackPress(() => navigationBusy.value);
// #ifdef H5
function guardRefundUnload(event) {
  if (navigationBusy.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
onMounted(() => window.addEventListener("beforeunload", guardRefundUnload));
onUnmounted(() =>
  window.removeEventListener("beforeunload", guardRefundUnload),
);
// #endif

async function reloadProductCatalog() {
  const scope = storeId.value;
  const result = await createClient("merchant").api(
    `/merchant/products?storeId=${encodeURIComponent(scope)}`,
  );
  if (scope === storeId.value) catalog.value = result;
}
onMounted(init);
onUnmounted(() => { refundCtl.value?.dispose(); cashier.value?.dispose(); shifts.value?.dispose(); });
const time = (value) =>
  new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
</script>
<template>
  <view
    class="app"
    :style="{ '--primary': config?.theme?.primaryColor || '#35664a' }"
  >
    <view v-if="busy || staffBusy || catalogBusy" class="busy-mask"
      >正在处理，请稍候…</view
    ><view class="top"
      ><view
        ><view class="brand">{{ config?.brandName || "门店工作台" }}</view
        ><text class="muted"
          >{{
            config?.environment === "development" ? "体验门店 · " : ""
          }}商户工作台</text
        ></view
      ><button
        v-if="user"
        class="small outline"
        :disabled="navigationBusy"
        @click="sheet = 'stores'"
      >
        {{ store?.name || "选择门店" }}⌄
      </button></view
    >
    <view v-if="error" class="error" role="alert"
      >{{ error
      }}<button class="link" @click="error = ''">收起提示</button></view
    ><view v-if="notice" class="notice">{{ notice }}</view
    ><view v-if="loading" class="loading">正在连接门店…</view>
    <view v-if="!config && !loading" class="empty"
      >暂时无法连接门店<button class="outline" @click="init">
        重新加载
      </button></view
    >
    <MerchantLogin
      v-if="!user && config"
      :config="config"
      :busy="busy || loggingOut"
      :login="login"
      :staff-login="staffLogin"
      :wechat-login="wechatLogin"
    />
    <template v-if="user"
      ><view v-if="!stores.length" class="empty"
        >当前账号没有已授权门店，请联系店主。<button
          class="outline"
          @click="logout"
        >
          退出登录
        </button></view
      ><view v-if="shifts?.state.blocked && tab !== 'shifts'" class="notice">
        <text class="label">原交班操作待核对</text><text>原账号与原门店的操作已保留，请先完成原收款、退款或挂单核对，再进入现金交班。</text>
        <button class="outline wide" :disabled="financialRecoveryBusy || shifts.state.busy" @click="showShifts">进入现金交班</button>
      </view><view
        v-if="cashier?.state.drafts.blocked && tab !== 'cashier'"
        class="notice"
      >
        <text class="label">挂单操作待核对</text><text>原账号与原门店的操作已保留，请完成原收款或退款核对后返回收银。</text>
        <button class="outline wide" :disabled="busy || auxiliaryBusy || refundBusy || !!pendingCash || loggingOut || cashier.state.drafts.busy || shifts?.state.busy" @click="returnToDraftStore">返回原门店核对挂单</button>
      </view><view
        v-if="refund.blocked || refund.error || refund.notice"
        class="notice"
      >
        <text v-if="refund.blocked" class="label">现金退款待核对</text
        ><text v-if="refund.attempt"
          >原订单 {{ refund.attempt.orderId }} · 本次
          {{ money(refund.attempt.amountFen) }} ·
          {{ refund.attempt.reason }}</text
        ><text v-if="refund.error" role="alert">{{ refund.error }}</text
        ><text v-if="refund.notice">{{ refund.notice }}</text>
        <button v-if="refund.attempt && refund.attempt.storeId !== storeId" class="outline wide" :disabled="busy || auxiliaryBusy || !!pendingCash || refund.busy || cashier?.state.drafts.busy || shifts?.state.busy" @click="returnToRefundStore">返回原门店核对退款</button>
        <button
          v-if="refund.attempt"
          class="outline wide"
          :disabled="refund.busy || pickupOperationBusy || busy || !!pendingCash || cashier?.state.drafts.busy || shifts?.state.busy"
          @click="refundCtl.load()"
        >
          读取原订单与明细</button
        ><button
          v-if="owner && refund.attempt?.phase === 'unknown'"
          class="primary wide"
          :disabled="refund.busy || pickupOperationBusy || busy || !!pendingCash || cashier?.state.drafts.busy || shifts?.state.busy"
          @click="refundCtl.submit(true)"
        >
          恢复原退款并核对结果
        </button> </view
      ><view v-if="pendingCash" class="notice"
        ><text class="label">现金收款结果尚未确认</text
        ><text
          >原订单与实收
          {{ money(pendingCash.tenderedFen) }} 已保留，请恢复核对。</text
        ><button
          class="primary wide"
          :disabled="
            busy || staffBusy || catalogBusy || pickupOperationBusy || refund.busy || cashier?.state.drafts.busy || shifts?.state.busy || loggingOut
          "
          @click="cash(true)"
        >
          恢复现金收款
        </button></view
      >
      <template v-if="store">
        <view v-if="!shifts?.state.blocked && tab !== 'shifts'" class="panel"><button class="outline wide" :disabled="navigationBusy" @click="showShifts">现金交班</button></view>
        <template v-if="tab === 'shifts' && shifts">
          <view v-if="cashOrder || (order?.cashReceipt && refund.expanded)" class="panel">
            <text>原订单与输入已保留，返回后请核对最新订单，再明确确认现金。</text>
            <button v-if="cashOrder" class="outline wide" :disabled="navigationBusy" @click="resumeCash">返回原收款</button>
            <button v-else class="outline wide" :disabled="navigationBusy" @click="resumeRefund">返回原退款</button>
          </view>
          <CashShifts :key="`${user.id}:${store.id}`" :shifts="shifts" :owner="owner" :locked="financialRecoveryBusy" />
        </template>
        <template v-if="tab === 'overview'"
          ><view class="hero"
            ><text class="eyebrow">{{
              store.isOpen ? "正在营业" : "已暂停接单"
            }}</text
            ><text class="title">{{ store.name }}</text
            ><text class="muted">{{ store.address }}</text
            ><view class="hero-footer row"
              ><view
                ><text class="label">{{ user.name }}</text
                ><text class="muted"
                  >{{ owner ? "店主" : "门店伙伴" }} ·
                  {{ store.pickupMinutes }} 分钟备餐</text
                ></view
              ><button
                :class="store.isOpen ? 'outline' : 'primary'"
                :disabled="
                  busy ||
                  staffBusy ||
                  catalogBusy ||
                  pickupBusy ||
                  !!pendingCash
                "
                @click="toggleOpen"
              >
                {{ store.isOpen ? "暂停接单" : "开始营业" }}
              </button></view
            ></view
          ><view class="row"
            ><text class="section-title">今日经营</text
            ><button
              class="link"
              :disabled="
                busy || staffBusy || catalogBusy || pickupBusy || loggingOut
              "
              @click="refresh"
            >
              刷新
            </button></view
          >
          <view v-if="overview" class="metrics"
            ><view class="metric"
              ><text class="muted">实收金额</text
              ><text class="metric-value">{{
                money(overview.paidRevenueFen)
              }}</text></view
            ><view class="metric"
              ><text class="muted">今日订单</text
              ><text class="metric-value">{{ overview.orderCount }}</text></view
            ><view class="metric"
              ><text class="muted">退款金额</text
              ><text class="metric-value">{{
                money(overview.refundFen)
              }}</text></view
            ><view class="metric"
              ><text class="muted">净收入</text
              ><text class="metric-value">{{
                money(overview.netRevenueFen)
              }}</text></view
            ></view
          ><text class="section-title">厨房节奏</text
          ><view v-if="overview" class="panel"
            ><view class="list-item row"
              ><text>待处理</text
              ><text class="price">{{ overview.pendingCount }}</text></view
            ><view class="list-item row"
              ><text>制作中</text
              ><text class="price">{{ overview.preparingCount }}</text></view
            ><view class="list-item row"
              ><text>待取餐</text
              ><text class="price">{{ overview.readyCount }}</text></view
            ><button class="primary wide" @click="navigate('orders')">
              查看订单 →
            </button></view
          ><view v-if="overview?.lowStockCount" class="notice"
            >{{ overview.lowStockCount }} 个规格库存偏低，请及时检查。<button
              class="link"
              @click="navigate('products')"
            >
              查看商品
            </button></view
          >
        </template>
        <template v-if="tab === 'orders'"
          ><view class="row"
            ><text class="title">订单工作台</text
            ><button
              class="link"
              :disabled="
                busy || staffBusy || catalogBusy || pickupBusy || loggingOut
              "
              @click="refresh"
            >
              刷新
            </button></view
          ><PickupSearch
            :key="store.id"
            :store-id="store.id"
            :locked="busy || pickupBusy || !!pendingCash"
            @open="detail($event.id)"
            @active="searchActive = $event"
          /><template v-if="order"
            ><view class="panel"
              ><view class="row"
                ><text class="sheet-title">{{ statusNames[order.status] }}</text
                ><button
                  class="link"
                  :disabled="
                    busy || staffBusy || catalogBusy || pickupBusy || loggingOut
                  "
                  @click="order = null"
                >
                  返回列表
                </button></view
              ><text class="muted">{{ order.number }}</text
              ><view class="space" /><view class="row"
                ><text class="label">{{ modeNames[order.mode] }}</text
                ><text>{{ paymentNames[order.paymentStatus] }}</text></view
              ><text v-if="order.tableName" class="label"
                >桌号：{{ order.tableName }}</text
              ><text v-if="order.mode === 'PICKUP'" class="label"
                >{{ order.pickupServiceDate || "旧订单" }} ·
                {{ pickupWindowText(order.pickupWindow) }}</text
              ><text v-if="order.pickupNumber" class="title"
                >取餐号 {{ order.pickupNumber }}</text
              ><view
                v-for="(line, index) in order.lines"
                :key="index"
                class="list-item"
                ><view class="row"
                  ><text class="label"
                    >{{ line.productName }} · {{ line.skuName }} ×{{
                      line.quantity
                    }}</text
                  ><text>{{ money(line.lineTotalFen) }}</text></view
                ><text class="muted">{{
                  [
                    attributeSummary(line),
                    line.modifiers.map((m) => m.name).join("、"),
                  ]
                    .filter(Boolean)
                    .join(" · ")
                }}</text></view
              ><text v-if="order.note" class="notice"
                >顾客备注：{{ order.note }}</text
              ><view class="total-row row"
                ><text>应收</text><text>{{ money(order.totalFen) }}</text></view
              ><CashReceipt :order="order" /><view class="order-actions"
                ><button
                  class="outline"
                  :disabled="
                    busy || staffBusy || catalogBusy || pickupBusy || loggingOut
                  "
                  @click="detail(order.id)"
                >
                  刷新状态</button
                ><button
                  v-if="
                    order.status === 'PENDING_PAYMENT' &&
                    order.paymentStatus === 'UNPAID'
                  "
                  class="primary"
                  :disabled="
                    busy ||
                    staffBusy ||
                    catalogBusy ||
                    pickupBusy ||
                    !!pendingCash
                  "
                  @click="openCash(order)"
                >
                  现金收款</button
                ><button
                  v-for="action in actions(order)"
                  :key="action.action"
                  class="primary"
                  :disabled="
                    busy ||
                    staffBusy ||
                    catalogBusy ||
                    pickupBusy ||
                    !!pendingCash
                  "
                  @click="transition(order, action.action, action.label)"
                >
                  {{ action.label }}
                </button></view
              ><CashRefund
                :order="order"
                :state="refund"
                :controller="refundCtl"
                :owner="owner"
                :locked="busy || shiftBusy || pickupOperationBusy || cashierBusy || !!pendingCash"
              />
              <PickupRedemption
                v-if="
                  order.mode === 'PICKUP' &&
                  ((order.status === 'READY' &&
                    order.paymentStatus === 'PAID') ||
                    pickupOperationBusy)
                "
                :key="order.id"
                :order="order"
                :store-id="store.id"
                :locked="busy || shiftBusy || refundBusy || cashierBusy || !!pendingCash || loggingOut"
                @busy="pickupOperationBusy = $event"
                @changed="
                  order = $event;
                  refresh();
                "
              /><view class="divider" /><view
                v-for="event in order.events"
                :key="event.id"
                class="event"
                ><text>{{ event.label }}</text
                ><text class="muted">{{ time(event.createdAt) }}</text></view
              ></view
            ></template
          >
          <template v-else-if="!searchActive"
            ><view class="tabs"
              ><button
                :class="{ selected: !filter }"
                :disabled="
                  busy || staffBusy || catalogBusy || pickupBusy || loggingOut
                "
                @click="setFilter('')"
              >
                全部</button
              ><button
                v-for="status in [
                  'PENDING_PAYMENT',
                  'AWAITING_ACCEPTANCE',
                  'PREPARING',
                  'READY',
                  'DELIVERING',
                  'COMPLETED',
                  'CANCELLED',
                ]"
                :key="status"
                :class="{ selected: filter === status }"
                :disabled="
                  busy || staffBusy || catalogBusy || pickupBusy || loggingOut
                "
                @click="setFilter(status)"
              >
                {{ statusNames[status] }}
              </button></view
            ><view v-for="item in visibleOrders" :key="item.id" class="panel"
              ><view class="row"
                ><text class="order-number">{{
                  item.pickupNumber
                    ? "取餐号 " + item.pickupNumber
                    : item.number
                }}</text
                ><text class="status">{{
                  statusNames[item.status]
                }}</text></view
              ><text class="muted"
                >{{ modeNames[item.mode] }}
                {{ item.tableName ? " · " + item.tableName : "" }} ·
                {{ time(item.createdAt) }}</text
              ><text v-if="item.mode === 'PICKUP'" class="label"
                >{{ item.pickupServiceDate || "旧订单" }} ·
                {{ pickupWindowText(item.pickupWindow) }}</text
              ><view
                v-for="(line, index) in item.lines"
                :key="index"
                class="list-item"
                ><text class="label"
                  >{{ line.productName }} · {{ line.skuName }} ×{{
                    line.quantity
                  }}</text
                ><text class="muted">{{
                  [
                    attributeSummary(line),
                    line.modifiers.map((m) => m.name).join("、"),
                  ]
                    .filter(Boolean)
                    .join(" · ")
                }}</text></view
              ><text v-if="item.note" class="notice">备注：{{ item.note }}</text
              ><view class="row"
                ><text class="price">{{ money(item.totalFen) }}</text
                ><button
                  class="link"
                  :disabled="
                    busy || staffBusy || catalogBusy || pickupBusy || loggingOut
                  "
                  @click="detail(item.id)"
                >
                  查看详情 →
                </button></view
              ><view class="order-actions"
                ><button
                  v-if="
                    item.status === 'PENDING_PAYMENT' &&
                    item.paymentStatus === 'UNPAID'
                  "
                  class="primary"
                  :disabled="
                    busy ||
                    staffBusy ||
                    catalogBusy ||
                    pickupBusy ||
                    !!pendingCash
                  "
                  @click="openCash(item)"
                >
                  现金收款</button
                ><button
                  v-for="action in actions(item)"
                  :key="action.action"
                  class="outline"
                  :disabled="
                    busy ||
                    staffBusy ||
                    catalogBusy ||
                    pickupBusy ||
                    !!pendingCash
                  "
                  @click="transition(item, action.action, action.label)"
                >
                  {{ action.label }}
                </button></view
              ></view
            ><button
              v-if="orders.length < orderTotal"
              class="outline wide"
              :disabled="
                busy || staffBusy || catalogBusy || pickupBusy || loggingOut
              "
              @click="moreOrders"
            >
              查看更多订单</button
            ><view v-if="!visibleOrders.length" class="empty"
              >这里暂时没有订单，稍后刷新看看。</view
            ></template
          >
        </template>
        <CashierPanel v-if="cashier" v-show="tab === 'cashier'" :key="`${user.id}:${store.id}`" :cashier="cashier" :store="store" :active="tab === 'cashier'" :locked="busy || auxiliaryBusy || refundBusy || !!pendingCash || loggingOut || shifts?.state.busy || (shiftBusy && !cashier.state.drafts.blocked)" />
        <ProductsPanel
          v-if="tab === 'products'"
          :key="store.id"
          :store="store"
          :catalog="catalog"
          :refresh="reloadProductCatalog"
          :owner="owner"
          :locked="busy || shiftBusy || refundBusy || cashierBusy || !!pendingCash || loggingOut"
          @busy="catalogBusy = $event"
          @refresh="refresh"
          @toggle="toggleProduct"
        />
        <template v-if="tab === 'store'"
          ><text class="title">门店与账号</text
          ><PickupSettings
            :key="store.id"
            :store="store"
            :owner="owner"
            :locked="busy || shiftBusy || refundBusy || cashierBusy || !!pendingCash || loggingOut"
            @busy="pickupOperationBusy = $event"
          />
          <view class="panel"
            ><text class="sheet-title">{{ store.name }}</text
            ><view class="list-item"
              ><text class="label">地址</text
              ><text>{{ store.address }}</text></view
            ><view class="list-item"
              ><text class="label">联系电话</text
              ><text>{{ store.phone }}</text></view
            ><view class="list-item"
              ><text class="label">门店公告</text
              ><text>{{ store.notice || "暂无公告" }}</text></view
            ><view class="list-item"
              ><text class="label">提供服务</text
              ><text>{{
                store.serviceModes.map((m) => modeNames[m]).join("、")
              }}</text></view
            ><view class="row"
              ><text class="status">{{
                store.isOpen ? "营业中" : "已暂停接单"
              }}</text
              ><button
                class="outline"
                :disabled="
                  busy ||
                  staffBusy ||
                  catalogBusy ||
                  pickupBusy ||
                  !!pendingCash
                "
                @click="toggleOpen"
              >
                {{ store.isOpen ? "暂停接单" : "开始营业" }}
              </button></view
            ></view
          ><StaffPanel
            v-if="owner"
            :key="store.id"
            :store="store"
            :stores="stores"
            :locked="busy || shiftBusy || refundBusy || cashierBusy || pickupOperationBusy || !!pendingCash"
            @busy="staffBusy = $event"
          />
          <view class="panel"
            ><text class="label"
              >{{ user.name }} · {{ owner ? "店主" : "门店伙伴" }}</text
            ><text class="muted">已授权 {{ stores.length }} 家门店</text
            ><view class="space" /><button
              class="outline wide"
              :disabled="navigationBusy"
              @click="logout"
            >
              退出登录
            </button></view
          ></template
        > </template
      ><view class="nav"
        ><button
          :class="{ selected: tab === 'overview' }"
          :disabled="navigationBusy"
          @click="navigate('overview')"
        >
          工作台</button
        ><button :class="{selected:tab === 'cashier'}" :disabled="navigationBusy" @click="navigate('cashier')">收银</button><button
          :class="{ selected: tab === 'orders' }"
          :disabled="navigationBusy"
          @click="navigate('orders')"
        >
          订单</button
        ><button
          :class="{ selected: tab === 'products' }"
          :disabled="navigationBusy"
          @click="navigate('products')"
        >
          商品</button
        ><button
          :class="{ selected: tab === 'store' }"
          :disabled="navigationBusy"
          @click="navigate('store')"
        >
          门店
        </button></view
      ></template
    >
    <view v-if="sheet" class="overlay"
      ><view class="sheet"
        ><view class="row"
          ><text class="sheet-title">{{
            sheet === "cash" ? "确认现金收款" : "选择已授权门店"
          }}</text
          ><button
            class="small outline"
            :disabled="
              busy || staffBusy || catalogBusy || pickupBusy || loggingOut
            "
            @click="sheet = ''"
          >
            关闭
          </button></view
        ><view v-if="error" class="error">{{ error }}</view
        ><template v-if="sheet === 'stores'"
          ><view v-for="item in stores" :key="item.id" class="store-line row"
            ><view class="grow"
              ><text class="label">{{ item.name }}</text
              ><text class="muted">{{ item.address }}</text></view
            ><button
              class="small"
              :class="{ primary: storeId === item.id }"
              :disabled="
                busy || staffBusy || catalogBusy || pickupBusy || !!pendingCash
              "
              @click="selectStore(item.id)"
            >
              {{ storeId === item.id ? "当前门店" : "进入" }}
            </button></view
          ></template
        ><template v-if="sheet === 'cash' && cashOrder"
          ><text class="product-description">订单 {{ cashOrder.number }}</text
          ><view class="total-row row"
            ><text>应收</text><text>{{ money(cashOrder.totalFen) }}</text></view
          ><view class="field"
            ><text class="label">实际收到现金（元）</text
            ><input
              v-model="tendered"
              type="digit"
              :disabled="
                busy || staffBusy || catalogBusy || pickupBusy || !!pendingCash
              "
              placeholder="输入实收现金金额" /></view
          ><text class="safe-note"
            >请确认现金已到账。找零金额将在收款成功后显示。</text
          ><view class="space" /><button
            class="primary wide"
            :disabled="
              busy || staffBusy || catalogBusy || pickupBusy || loggingOut
            "
            @click="cash()"
          >
            {{ pendingCash ? "恢复原收款" : "确认已收到现金" }}
          </button></template
        ></view
      ></view
    >
  </view>
</template>
