<script setup lang="ts">
import { reactive, ref } from "vue";
import { ChevronLeft, ChevronRight } from "lucide-vue-next";
import { api } from "./api";
import { useMutation, useResource } from "./ui";
import type { Store } from "./types";
import { toFen, localTime } from "./domain.mjs";
import Feedback from "./Feedback.vue";
import StateBlock from "./StateBlock.vue";
const props = defineProps<{ store: Store; owner: boolean }>();
const emit = defineEmits<{ saved: [] }>();
const draft = reactive({
  ...props.store,
  deliveryFee: (props.store.deliveryFeeFen / 100).toFixed(2),
  minOrder: (props.store.minOrderFen / 100).toFixed(2),
});
const mutation = reactive(useMutation());
const page = ref(1);
const audit = props.owner
  ? reactive(
      useResource<{
        items: {
          id: string;
          action: string;
          entityId: string;
          createdAt: string;
        }[];
        total: number;
        pageSize: number;
      }>(() => `/merchant/audit?storeId=${props.store.id}&page=${page.value}`),
    )
  : undefined;
const labels: Record<string, string> = {
  STORE_UPDATE: "更新门店设置",
  PRODUCT_CREATE: "新增商品",
  PRODUCT_UPDATE: "编辑商品",
  SKU_UPDATE: "调整价格与库存",
  CATEGORY_CREATE: "新增分类",
  PAGE_DRAFT: "保存页面草稿",
  PAGE_PUBLISH: "发布页面",
  ACCEPT: "接单",
  START: "开始制作",
  READY: "标记出餐",
  DISPATCH: "开始配送",
  COMPLETE: "完成订单",
  REJECT: "拒绝订单",
  CASH_PAYMENT: "现金收款",
};
function save() {
  mutation.run(async () => {
    await api(`/merchant/stores/${props.store.id}`, {
      method: "PATCH",
      body: props.owner
        ? {
            name: draft.name.trim(),
            address: draft.address.trim(),
            phone: draft.phone.trim(),
            notice: draft.notice.trim(),
            isOpen: draft.isOpen,
            pickupMinutes: Number(draft.pickupMinutes),
            deliveryFeeFen: toFen(draft.deliveryFee),
            minOrderFen: toFen(draft.minOrder),
            themeColor: draft.themeColor,
          }
        : { isOpen: draft.isOpen },
    });
    audit?.reload();
    emit("saved");
  }, "门店设置已保存");
}
</script>
<template>
  <div class="settings-layout">
    <section class="panel">
      <div class="panel-title"><h2>营业与门店资料</h2></div>
      <form class="settings-form" @submit.prevent="save">
        <label class="check-field opening-switch"
          ><input v-model="draft.isOpen" type="checkbox" />
          <div>
            <strong>门店营业</strong>
            <p class="muted">
              {{ draft.isOpen ? "顾客可正常下单" : "休息中，暂不接受新订单" }}
            </p>
          </div></label
        ><template v-if="owner"
          ><div class="form-grid">
            <label class="field"
              ><span>门店名称</span
              ><input v-model="draft.name" required maxlength="300" /></label
            ><label class="field"
              ><span>联系电话</span
              ><input v-model="draft.phone" required maxlength="300"
            /></label>
          </div>
          <label class="field"
            ><span>门店地址</span
            ><input v-model="draft.address" required maxlength="300" /></label
          ><label class="field"
            ><span>门店公告</span
            ><textarea v-model="draft.notice" rows="3" maxlength="1000" />
          </label>
          <div class="form-grid">
            <label class="field"
              ><span>预计备餐（分钟）</span
              ><input
                v-model.number="draft.pickupMinutes"
                type="number"
                min="0"
                max="2000000000"
                step="1"
                required /></label
            ><label class="field"
              ><span>起送金额（元）</span
              ><input
                v-model="draft.minOrder"
                type="number"
                min="0"
                max="20000000"
                step="0.01"
                required /></label
            ><label class="field"
              ><span>配送费（元）</span
              ><input
                v-model="draft.deliveryFee"
                type="number"
                min="0"
                max="20000000"
                step="0.01"
                required /></label
            ><label class="field"
              ><span>门店主题色</span>
              <div class="row">
                <input v-model="draft.themeColor" type="color" /><span>{{
                  draft.themeColor
                }}</span>
              </div></label
            >
          </div>
          <p class="muted">外送服务尚未开放，配送规则可先保存。</p></template
        >
        <p v-else class="muted">当前身份可调整营业状态，其他资料由店主管理。</p>
        <Feedback :error="mutation.error" :success="mutation.success" />
        <div class="form-actions">
          <button class="primary" :disabled="mutation.busy">
            {{ mutation.busy ? "保存中…" : "保存门店设置" }}
          </button>
        </div>
      </form>
    </section>
    <section v-if="audit" class="panel audit-panel">
      <div class="panel-title"><h2>操作记录</h2></div>
      <StateBlock
        :loading="audit.loading"
        :error="audit.error"
        :empty="audit.data?.items.length === 0"
        @retry="audit.reload"
        ><template #empty>暂无操作记录。</template>
        <div class="audit-list">
          <article v-for="item in audit.data?.items" :key="item.id">
            <i class="status-dot" />
            <div>
              <strong>{{ labels[item.action] || "门店业务操作" }}</strong>
              <p class="muted">{{ localTime(item.createdAt) }}</p>
            </div>
          </article>
        </div>
        <div class="table-footer">
          <span>共 {{ audit.data?.total }} 条</span>
          <div class="row">
            <button
              class="icon-button"
              aria-label="上一页操作记录"
              :disabled="page <= 1"
              @click="page--"
            >
              <ChevronLeft :size="17" /></button
            ><span>{{ page }}</span
            ><button
              class="icon-button"
              aria-label="下一页操作记录"
              :disabled="
                page * (audit.data?.pageSize || 20) >= (audit.data?.total || 0)
              "
              @click="page++"
            >
              <ChevronRight :size="17" />
            </button>
          </div></div
      ></StateBlock>
    </section>
  </div>
</template>
