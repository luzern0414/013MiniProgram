<script setup>
import CashReceipt from "../../components/CashReceipt.vue";
import CustomerAddresses from "../../components/CustomerAddresses.vue";
import { onMounted } from "vue";
import PickupSelection from "../../components/PickupSelection.vue";
import ProductSelection from "../../components/ProductSelection.vue";
import { useCustomer } from "../../customer.js";
import {
  modeNames,
  statusNames,
  paymentNames,
  fingerprint,
  attributeSummary,
  pickupWindowText,
} from "@restaurant/mini-core";
const {
  tab,
  config,
  stores,
  storeId,
  mode,
  catalog,
  categoryId,
  user,
  lines,
  orders,
  order,
  tables,
  tableCode,
  selectedAddressId,
  selectedAddressRevision,
  selectedAddress,
  note,
  quote,
  pickup,
  addresses,
  addressesState,
  addressLocked,
  loadAddresses,
  openAddresses,
  selectDeliveryAddress,
  syncSelectedAddress,
  loadPickup,
  selectPickup,
  product,
  sheet,
  error,
  busy,
  loading,
  pending,
  store,
  products,
  count,
  subtotal,
  lineIssue,
  invalidCart,
  needsMenuRefresh,
  reselect,
  init,
  selectStore,
  selectMode,
  login,
  wechatLogin,
  logout,
  openProduct,
  add,
  change,
  checkout,
  getQuote,
  submit,
  showOrders,
  detail,
  cancel,
  pay,
  reload,
  invalidateQuote,
  orderTotal,
  moreOrders,
  money,
} = useCustomer();
onMounted(init);
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
    <view v-if="busy" class="busy-mask">正在处理，请稍候…</view>
    <view class="top"
      ><view
        ><view class="brand">{{ config?.brandName || "点餐" }}</view
        ><text v-if="config?.environment === 'development'" class="muted"
          >体验门店</text
        ></view
      ><button class="small outline" @click="sheet = 'stores'">
        {{ store?.name || "选择门店" }}⌄
      </button></view
    >
    <view v-if="error" class="error" role="alert"
      >{{ error
      }}<button class="link" :disabled="busy || !!pending" @click="reload">
        刷新菜单</button
      ><button class="link" @click="error = ''">收起提示</button></view
    >
    <view v-if="loading" class="loading">正在为你准备菜单…</view>
    <view v-else-if="!config" class="empty"
      >暂时无法连接门店<button class="outline" @click="init">
        重新加载
      </button></view
    >
    <view v-if="pending" class="notice"
      ><text>上次订单结果尚未确认，请先恢复，避免重复下单。</text
      ><button class="small primary" :disabled="busy" @click="submit">
        恢复上次订单
      </button></view
    >
    <view
      v-if="user && (addressesState.pending || addressesState.corrupt)"
      class="notice address-recovery-entry"
      role="status"
    >
      <text>原地址操作待核对。读取最新地址不会自动再次提交。</text>
      <button class="small primary" @click="openAddresses">核对收货地址</button>
    </view>
    <template v-if="tab === 'home' && config">
      <view class="hero"
        ><text class="eyebrow"
          >{{ modeNames[mode] }} ·
          {{ store?.isOpen ? "营业中" : "休息中" }}</text
        ><text class="title">{{ config.home.bannerTitle }}</text
        ><text class="muted">{{ config.home.bannerSubtitle }}</text
        ><view class="hero-footer row"
          ><view
            ><text class="label">{{ store?.name }}</text
            ><text class="muted">{{ store?.address }}</text></view
          ><button class="primary" @click="tab = 'menu'">
            开始点餐 →
          </button></view
        ></view
      >
      <view v-if="config.home.notice || store?.notice" class="notice">{{
        config.home.notice || store?.notice
      }}</view>
      <text class="section-title">今天想吃点什么</text
      ><view class="chips"
        ><button
          v-for="category in catalog.categories"
          :key="category.id"
          class="chip"
          @click="
            categoryId = category.id;
            tab = 'menu';
          "
        >
          {{ category.name }} →
        </button></view
      >
      <view class="panel"
        ><view class="row"
          ><text class="label">按你的节奏用餐</text
          ><text class="muted">{{ store?.pickupMinutes }} 分钟备餐</text></view
        ><view class="chips"
          ><button
            v-for="item in store?.serviceModes"
            :key="item"
            class="chip"
            :class="{ chosen: mode === item }"
            @click="selectMode(item)"
          >
            {{ modeNames[item] }}
          </button></view
        ></view
      >
      <text class="section-title">门店精选</text
      ><view
        v-for="item in catalog.products.slice(0, 3)"
        :key="item.id"
        class="product-row"
        ><image
          v-if="item.imageUrl"
          class="product-image"
          :src="item.imageUrl"
          mode="aspectFill"
        /><view v-else class="food-mark">{{ item.name.slice(0, 1) }}</view
        ><view class="grow"
          ><text class="product-name">{{ item.name }}</text
          ><text class="product-description">{{ item.description }}</text
          ><view class="row"
            ><text class="price"
              >{{ money(Math.min(...item.skus.map((s) => s.priceFen)))
              }}<text class="muted"> 起</text></text
            ><button
              class="small primary"
              :disabled="!store?.isOpen"
              @click="openProduct(item)"
            >
              选规格
            </button></view
          ></view
        ></view
      >
      <view v-if="!catalog.products.length" class="empty"
        >菜单正在准备中，请稍后再来。</view
      >
    </template>
    <template v-if="tab === 'menu'">
      <view class="row"
        ><view
          ><text class="title">好好吃一餐</text
          ><text class="muted">{{
            store?.isOpen ? "新鲜制作，安心享用" : "门店休息中，暂时无法下单"
          }}</text></view
        ><button class="link" @click="reload">刷新菜单</button></view
      >
      <view class="chips"
        ><button
          v-for="item in store?.serviceModes"
          :key="item"
          class="chip"
          :class="{ chosen: mode === item }"
          @click="selectMode(item)"
        >
          {{ modeNames[item] }}
        </button></view
      >
      <view class="category-bar"
        ><button
          class="small"
          :class="{ primary: !categoryId }"
          @click="categoryId = ''"
        >
          全部</button
        ><button
          v-for="category in catalog.categories"
          :key="category.id"
          class="small"
          :class="{ primary: categoryId === category.id }"
          @click="categoryId = category.id"
        >
          {{ category.name }}
        </button></view
      >
      <view v-for="item in products" :key="item.id" class="product-row"
        ><image
          v-if="item.imageUrl"
          class="product-image"
          :src="item.imageUrl"
          mode="aspectFill"
        /><view v-else class="food-mark">{{ item.name.slice(0, 1) }}</view
        ><view class="grow"
          ><text class="product-name">{{ item.name }}</text
          ><text class="product-description">{{ item.description }}</text
          ><view class="row"
            ><text class="price"
              >{{ money(Math.min(...item.skus.map((s) => s.priceFen)))
              }}<text class="muted"> 起</text></text
            ><button
              class="small primary"
              :disabled="
                !store?.isOpen || !item.skus.some((s) => s.available > 0)
              "
              @click="openProduct(item)"
            >
              {{ item.skus.some((s) => s.available > 0) ? "选规格" : "已售罄" }}
            </button></view
          ></view
        ></view
      ><view v-if="!products.length" class="empty"
        >这个分类暂时没有在售商品。</view
      >
    </template>
    <template v-if="tab === 'orders'">
      <view class="row"
        ><text class="title">我的订单</text
        ><button class="link" :disabled="busy" @click="showOrders">
          刷新
        </button></view
      ><view v-if="!user" class="empty"
        >登录后查看你的订单<button class="primary" @click="tab = 'profile'">
          去登录
        </button></view
      >
      <template v-else
        ><view v-if="order" class="panel"
          ><view class="row"
            ><text class="sheet-title">{{ statusNames[order.status] }}</text
            ><button class="link" @click="order = null">返回列表</button></view
          ><text class="muted"
            >{{ order.storeName }} · {{ modeNames[order.mode] }}</text
          ><view class="space" /><text class="order-number">{{
            order.number
          }}</text
          ><text v-if="order.pickupNumber" class="title"
            >取餐号 {{ order.pickupNumber }}</text
          ><text v-if="order.mode === 'PICKUP'" class="label"
            >{{ order.pickupServiceDate || "旧订单" }} ·
            {{ pickupWindowText(order.pickupWindow) }}</text
          ><text v-if="order.tableName" class="label"
            >桌号：{{ order.tableName }}</text
          ><view
            v-for="(line, index) in order.lines"
            :key="index"
            class="list-item"
            ><view class="row"
              ><text
                >{{ line.productName }} · {{ line.skuName }} ×
                {{ line.quantity }}</text
              ><text>{{ money(line.lineTotalFen) }}</text></view
            ><text class="muted">{{
              [
                attributeSummary(line),
                line.modifiers.map((m) => m.name).join("、"),
              ]
                .filter(Boolean)
                .join(" · ")
            }}</text></view
          ><view class="total-row row"
            ><text>合计</text><text>{{ money(order.totalFen) }}</text></view
          ><text class="muted"
            >{{ paymentNames[order.paymentStatus] }} ·
            {{ time(order.createdAt) }}</text
          ><CashReceipt :order="order" /><text
            v-if="order.note"
            class="safe-note"
            >备注：{{ order.note }}</text
          ><view class="order-actions"
            ><button class="outline" :disabled="busy" @click="detail(order.id)">
              刷新进度</button
            ><button
              v-if="order.status === 'PENDING_PAYMENT'"
              class="outline"
              :disabled="busy"
              @click="cancel"
            >
              取消订单</button
            ><button
              v-if="order.status === 'PENDING_PAYMENT'"
              class="primary"
              :disabled="busy"
              @click="pay"
            >
              微信支付
            </button></view
          ><view class="divider" /><view
            v-for="event in order.events"
            :key="event.id"
            class="event"
            ><text>{{ event.label }}</text
            ><text class="muted">{{ time(event.createdAt) }}</text></view
          ></view
        >
        <view v-else
          ><view
            v-for="item in orders"
            :key="item.id"
            class="panel"
            @click="detail(item.id)"
            ><view class="row"
              ><text class="order-number">{{ item.storeName }}</text
              ><text class="status">{{ statusNames[item.status] }}</text></view
            ><text class="muted"
              >{{ item.number }} · {{ modeNames[item.mode] }}</text
            ><text v-if="item.mode === 'PICKUP'" class="label"
              >取餐号 {{ item.pickupNumber }} ·
              {{ item.pickupServiceDate || "旧订单" }} ·
              {{ pickupWindowText(item.pickupWindow) }}</text
            ><view class="list-item"
              ><text>{{
                item.lines
                  .map((l) => `${l.productName} ×${l.quantity}`)
                  .join("、")
              }}</text></view
            ><view class="row"
              ><text class="muted">{{ time(item.createdAt) }}</text
              ><text class="price">{{ money(item.totalFen) }} →</text></view
            ></view
          ><button
            v-if="orders.length < orderTotal"
            class="outline wide"
            :disabled="busy"
            @click="moreOrders"
          >
            查看更多订单</button
          ><view v-if="!orders.length" class="empty"
            >还没有订单，去选一餐喜欢的吧。<button
              class="primary"
              @click="tab = 'menu'"
            >
              去点餐
            </button></view
          ></view
        ></template
      >
    </template>
    <template v-if="tab === 'profile'"
      ><text class="title">我的</text
      ><view v-if="user" class="panel"
        ><text class="sheet-title">{{ user.name }}</text
        ><text class="muted">{{ user.levelName }}</text
        ><view class="metrics"
          ><view
            ><text class="muted">账户余额</text
            ><text class="metric-value">{{
              money(user.balanceFen)
            }}</text></view
          ><view
            ><text class="muted">积分</text
            ><text class="metric-value">{{ user.points }}</text></view
          ></view
        ><view class="space" /><button class="primary wide" @click="showOrders">
          查看我的订单</button
        ><button class="link" @click="logout">退出登录</button>
        <CustomerAddresses
          v-if="addresses"
          :controller="addresses"
          :embedded="true"
          @changed="syncSelectedAddress"
        /></view
      ><view v-else class="panel auth"
        ><text class="sheet-title">欢迎来吃饭</text
        ><text class="product-description"
          >登录后即可下单，并查看取餐进度。</text
        ><button class="primary wide" :disabled="busy" @click="wechatLogin">
          微信登录</button
        ><template v-if="config?.environment === 'development'"
          ><view class="divider" /><text class="safe-note"
            >当前为体验门店，可使用体验身份完成本地流程。</text
          ><button class="outline wide" :disabled="busy" @click="login">
            体验顾客登录
          </button></template
        ></view
      ></template
    >
    <view v-if="count && (tab === 'menu' || tab === 'home')" class="sticky-cart"
      ><view @click="sheet = 'cart'"
        ><text class="label">购物袋 · {{ count }} 份</text
        ><text
          >{{ money(subtotal)
          }}<text class="muted"> · 以确认金额为准</text></text
        ></view
      ><button class="small" :disabled="busy" @click="checkout">
        去结算
      </button></view
    >
    <view class="nav"
      ><button :class="{ selected: tab === 'home' }" @click="tab = 'home'">
        首页</button
      ><button :class="{ selected: tab === 'menu' }" @click="tab = 'menu'">
        点餐</button
      ><button :class="{ selected: tab === 'orders' }" @click="showOrders">
        订单</button
      ><button
        :class="{ selected: tab === 'profile' }"
        @click="tab = 'profile'"
      >
        我的
      </button></view
    >
    <view v-if="sheet" class="overlay" @click.self="sheet = ''"
      ><view class="sheet"
        ><view class="row"
          ><text class="sheet-title">{{
            sheet === "stores"
              ? "选择门店"
              : sheet === "product"
                ? product?.name
                : "确认这一餐"
          }}</text
          ><button class="small outline" @click="sheet = ''">关闭</button></view
        ><view v-if="error" class="error">{{ error }}</view>
        <template v-if="sheet === 'stores'"
          ><view v-for="item in stores" :key="item.id" class="store-line"
            ><view class="row"
              ><view class="grow"
                ><text class="label">{{ item.name }}</text
                ><text class="muted">{{ item.address }}</text
                ><view class="status">{{
                  item.isOpen ? "营业中" : "休息中"
                }}</view></view
              ><button
                class="small"
                :class="{ primary: item.id === storeId }"
                @click="selectStore(item.id)"
              >
                {{ item.id === storeId ? "当前门店" : "选择" }}
              </button></view
            ></view
          ><view v-if="!stores.length" class="empty"
            >暂时没有可选门店<button @click="init">重试</button></view
          ></template
        >
        <ProductSelection
          v-if="sheet === 'product' && product"
          :key="product.id"
          :product="product"
          :busy="busy"
          @add="add"
        />
        <template v-if="sheet === 'cart'"
          ><PickupSelection
            v-if="mode === 'PICKUP'"
            :state="pickup"
            :load="loadPickup"
            :select="selectPickup"
            :locked="busy || !!pending"
          />
          <text class="product-description"
            >{{ store?.name }} · {{ modeNames[mode] }}</text
          ><button
            class="small outline"
            :disabled="busy || !!pending"
            @click="reload"
          >
            刷新菜单</button
          ><view
            v-for="line in lines"
            :key="fingerprint(line)"
            class="list-item"
            ><text class="label">{{ line.name }} · {{ line.skuName }}</text
            ><text class="muted">{{
              [attributeSummary(line), line.modifierNames?.join("、")]
                .filter(Boolean)
                .join(" · ") || "原味搭配"
            }}</text
            ><text v-if="lineIssue(line)" class="error">{{
              lineIssue(line)
            }}</text>
            <button
              class="small outline"
              :aria-label="`重新选择${line.name} ${line.skuName} ${attributeSummary(line)}`"
              :disabled="!!pending || busy"
              @click="reselect(line)"
            >
              重新选择搭配
            </button>
            <view class="row"
              ><text>{{ money(line.unitPriceFen * line.quantity) }}</text
              ><view class="counter"
                ><button :disabled="!!pending" @click="change(line, -1)">
                  −</button
                ><text>{{ line.quantity }}</text
                ><button
                  :disabled="!!pending || line.quantity >= 99"
                  @click="change(line, 1)"
                >
                  +
                </button></view
              ></view
            ></view
          ><view v-if="!lines.length" class="empty"
            >购物袋还是空的，去选点喜欢的吧。</view
          >
          <template v-if="lines.length"
            ><view v-if="mode === 'DINE_IN'" class="field"
              ><text class="label">选择桌号</text
              ><picker
                :range="tables"
                range-key="name"
                @change="
                  tableCode = tables[$event.detail.value].code;
                  invalidateQuote();
                "
                ><view class="store-picker"
                  >{{
                    tables.find((t) => t.code === tableCode)?.name ||
                    "请选择桌号"
                  }}
                  ⌄</view
                ></picker
              ></view
            ><template v-if="mode === 'DELIVERY'">
              <view class="notice delivery-address-notice" role="status">
                <text>配送服务尚未开通。这里保留你选择的收货地址，暂不生成配送报价，也不会提交配送订单。</text>
              </view>
              <view v-if="addressLocked" class="notice">
                <text>原地址操作待核对，核对后才能选择新的配送地址。</text>
                <button class="link" @click="openAddresses">核对收货地址</button>
              </view>
              <view v-if="addressesState.items.length" class="delivery-address-list">
                <view v-for="item in addressesState.items" :key="item.id" class="delivery-address-option">
                  <view class="grow">
                    <text class="delivery-address-name">{{ item.name }} · {{ item.phone }}</text>
                    <text class="delivery-address-detail">{{ item.region }} {{ item.detail }}</text>
                    <text v-if="item.isDefault" class="status">默认地址</text>
                  </view>
                  <button
                    class="small"
                    :class="{ primary: selectedAddressId === item.id }"
                    :disabled="addressLocked"
                    @click="selectDeliveryAddress(item); invalidateQuote()"
                  >
                    {{ selectedAddressId === item.id ? "已选择" : "选择此地址" }}
                  </button>
                </view>
              </view>
              <view v-else class="delivery-address-empty">
                <text>还没有收货地址，请先新增。</text>
              </view>
              <button class="outline wide" @click="openAddresses">管理收货地址</button>
              <text v-if="selectedAddress" class="safe-note">
                已选择：{{ selectedAddress.name }}，{{ selectedAddress.region }} {{ selectedAddress.detail }}
              </text>
            </template>
            ><view class="field"
              ><text class="label">用餐备注</text
              ><textarea
                v-model="note"
                placeholder="口味、忌口等需求（选填）"
                :maxlength="300"
                @input="invalidateQuote"
              /></view
            ><view v-if="quote" class="price-breakdown panel"
              ><view class="row"
                ><text>餐品</text
                ><text>{{ money(quote.subtotalFen) }}</text></view
              ><view class="row"
                ><text>打包费</text
                ><text>{{ money(quote.packagingFeeFen) }}</text></view
              ><view class="row"
                ><text>配送费</text
                ><text>{{ money(quote.deliveryFeeFen) }}</text></view
              ><view class="row"
                ><text>优惠</text
                ><text>−{{ money(quote.discountFen) }}</text></view
              ><view class="row total-row"
                ><text>应付</text><text>{{ money(quote.totalFen) }}</text></view
              ><text class="safe-note"
                >确认金额后提交，支付结果以订单状态为准。</text
              ></view
            ><button
              v-if="pending"
              class="primary wide"
              :disabled="busy"
              @click="submit"
            >
              恢复上次订单</button
            ><button
              v-else-if="!quote"
              class="primary wide"
              :disabled="
                busy ||
                !store?.isOpen ||
                invalidCart ||
                needsMenuRefresh ||
                (mode === 'PICKUP' &&
                  !!pickup.slotId &&
                  (pickup.loading || pickup.needsRefresh))
              "
              @click="getQuote"
            >
              确认金额</button
            ><button
              v-else
              class="primary wide"
              :disabled="busy"
              @click="submit"
            >
              提交订单 · {{ money(quote.totalFen) }}
            </button></template
          ></template
        >
      </view></view
    >
  </view>
</template>

<style scoped>
.address-recovery-entry,
.delivery-address-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.delivery-address-list {
  border-top: 1px solid #d8dbd1;
  margin: 14px 0;
}
.delivery-address-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid #d8dbd1;
}
.delivery-address-name {
  display: block;
  color: #242820;
  font-size: 15px;
  font-weight: 650;
}
.delivery-address-detail {
  display: block;
  color: #242820;
  font-size: 16px;
  line-height: 1.55;
  overflow-wrap: anywhere;
  margin-top: 5px;
}
.delivery-address-empty {
  padding: 18px 0;
  color: #686e63;
  font-size: 14px;
}
.delivery-address-option button {
  min-height: 44px;
  flex-shrink: 0;
}
@media (max-width: 390px) {
  .app {
    padding-left: 20px;
    padding-right: 20px;
  }
  .delivery-address-option {
    align-items: flex-start;
    flex-direction: column;
  }
  .delivery-address-option button {
    width: 100%;
  }
}
</style>
