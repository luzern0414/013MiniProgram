<script setup lang="ts">
import { reactive } from "vue";
import {
  ArrowUpRight,
  ClipboardList,
  Package,
  Banknote,
  CircleAlert,
} from "lucide-vue-next";
import type { Store, Order } from "./types";
import { useResource } from "./ui";
import { money, statusLabels, modeLabels, localTime } from "./domain.mjs";
import StateBlock from "./StateBlock.vue";
const props = defineProps<{ store: Store }>();
defineEmits<{ navigate: [page: string] }>();
const overview = reactive(
  useResource<Record<string, number>>(
    `/merchant/overview?storeId=${props.store.id}`,
  ),
);
const orders = reactive(
  useResource<{ items: Order[]; total: number }>(
    `/orders?storeId=${props.store.id}&pageSize=5`,
  ),
);
</script>
<template>
  <StateBlock
    :loading="overview.loading"
    :error="overview.error"
    @retry="overview.reload"
    ><template v-if="overview.data"
      ><section class="day-sheet">
        <div class="day-lead">
          <span class="eyebrow">今日经营 · 实收</span>
          <h2>{{ money(overview.data.netRevenueFen) }}</h2>
          <div class="row muted">
            <span>收款 {{ money(overview.data.paidRevenueFen) }}</span
            ><span class="separator">/</span
            ><span>退款 {{ money(overview.data.refundFen) }}</span>
          </div>
          <div class="receipt-edge" />
        </div>
        <div class="day-stat">
          <span>今日订单</span
          ><strong>{{ overview.data.orderCount }}<small>单</small></strong
          ><span class="muted">门店实时汇总</span>
        </div>
        <div class="day-status">
          <button @click="$emit('navigate', 'orders')">
            <span><i class="status-dot orange" />待处理</span
            ><strong>{{ overview.data.pendingCount }}</strong
            ><ArrowUpRight :size="17" /></button
          ><button @click="$emit('navigate', 'orders')">
            <span><i class="status-dot" />制作中</span
            ><strong>{{ overview.data.preparingCount }}</strong
            ><ArrowUpRight :size="17" /></button
          ><button @click="$emit('navigate', 'orders')">
            <span><i class="status-dot green" />待取餐</span
            ><strong>{{ overview.data.readyCount }}</strong
            ><ArrowUpRight :size="17" />
          </button>
        </div>
      </section>
      <div class="quick-actions">
        <button @click="$emit('navigate', 'cashier')">
          <span class="quick-icon"><Banknote /></span
          ><span
            ><strong>开始收银</strong
            ><span class="muted">选商品、开单、收现金</span></span
          ><ArrowUpRight /></button
        ><button @click="$emit('navigate', 'products')">
          <span class="quick-icon"><Package /></span
          ><span
            ><strong>商品与库存</strong
            ><span class="muted"
              >{{ overview.data.lowStockCount }} 种规格库存偏低</span
            ></span
          ><ArrowUpRight /></button
        ><button @click="$emit('navigate', 'orders')">
          <span class="quick-icon"><ClipboardList /></span
          ><span
            ><strong>处理订单</strong
            ><span class="muted">查看订单与制作进度</span></span
          ><ArrowUpRight />
        </button>
      </div>
      <div v-if="overview.data.lowStockCount > 0" class="notice-strip">
        <CircleAlert :size="18" /><span
          >{{ overview.data.lowStockCount }} 种规格可售库存不高于 5
          份，及时补货以免影响接单。</span
        ><button class="text-button" @click="$emit('navigate', 'products')">
          查看库存 →
        </button>
      </div></template
    ></StateBlock
  >
  <section class="panel">
    <div class="panel-title">
      <h2>最近订单</h2>
      <button class="text-button" @click="$emit('navigate', 'orders')">
        全部订单 <ArrowUpRight :size="16" />
      </button>
    </div>
    <StateBlock
      :loading="orders.loading"
      :error="orders.error"
      :empty="orders.data?.items.length === 0"
      @retry="orders.reload"
      ><template #empty>还没有订单，前往收银开启第一单。</template>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>订单</th>
              <th>下单时间</th>
              <th>用餐方式</th>
              <th>订单金额</th>
              <th>当前状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="order in orders.data?.items.slice(0, 5)" :key="order.id">
              <td class="order-number">{{ order.number }}</td>
              <td>{{ localTime(order.createdAt) }}</td>
              <td>{{ modeLabels[order.mode as keyof typeof modeLabels] }}</td>
              <td class="amount">{{ money(order.totalFen) }}</td>
              <td>
                <span
                  class="badge"
                  :class="order.status === 'COMPLETED' ? 'green' : 'neutral'"
                  >{{
                    statusLabels[order.status as keyof typeof statusLabels]
                  }}</span
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div></StateBlock
    >
  </section>
</template>
