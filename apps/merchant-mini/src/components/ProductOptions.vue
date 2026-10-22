<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import {
  createClient,
  createOptionsController,
  removeNewOptionsGroup,
} from "@restaurant/mini-core";
import AccessibleInput from "./AccessibleInput.vue";
import ProductOptionsGroups from "./ProductOptionsGroups.vue";
import ProductOptionsSkus from "./ProductOptionsSkus.vue";
const props = defineProps({
  store: Object,
  product: Object,
  owner: Boolean,
  locked: Boolean,
  refresh: Function,
});
const emit = defineEmits(["close", "busy"]);
const state = reactive({});
const previous = ref(false);
const ctl = createOptionsController({
  state,
  request: createClient("merchant").api,
  storeId: () => props.store.id,
  productId: () => props.product.id,
  canEdit: () => props.owner,
  onChanged: async () => {
    await props.refresh();
  },
});
const draft = computed(() =>
  previous.value ? state.previousDraft : state.draft,
);
const inventory = computed(() =>
  previous.value ? state.previousInventory : state.inventory,
);
const disabled = computed(
  () =>
    props.locked ||
    state.busy ||
    state.loading ||
    state.blocked ||
    state.readOnly ||
    previous.value,
);
watch(
  () => state.busy || state.loading,
  (v) => emit("busy", v),
  { flush: "sync" },
);
watch(
  () => state.draft,
  () => (previous.value = false),
);
watch(
  () => props.owner,
  (value) => {
    if (!value) state.readOnly = true;
  },
);
// #ifdef H5
function preventLeave(event) {
  if (state.busy) {
    event.preventDefault();
    event.returnValue = "";
  }
}
onMounted(() => window.addEventListener("beforeunload", preventLeave));
onUnmounted(() => window.removeEventListener("beforeunload", preventLeave));
// #endif
onMounted(ctl.load);
onUnmounted(() => {
  ctl.dispose();
  emit("busy", false);
});
</script>
<template>
  <view class="overlay product-options"
    ><view class="sheet">
      <view class="row"
        ><text class="sheet-title">规格与口味</text
        ><button
          class="small outline"
          :disabled="state.busy || state.loading"
          @click="emit('close')"
        >
          关闭
        </button></view
      >
      <text class="safe-note"
        >{{ product.name }} · 已有记录可停用，随时恢复。</text
      >
      <view v-if="state.loading" class="loading">正在读取规格与口味…</view>
      <view v-if="state.readOnly" class="notice"
        >当前无维护权限，仅可查看已读取的信息。</view
      >
      <view v-if="state.error" class="error" role="alert">{{
        state.error
      }}</view
      ><view v-if="state.notice" class="notice" role="status">{{
        state.notice
      }}</view>
      <button
        class="outline wide"
        :disabled="state.busy || state.loading || locked"
        @click="ctl.load"
      >
        重新读取并核对
      </button>
      <button
        v-if="state.previousDraft"
        class="link wide"
        :disabled="state.busy || state.loading"
        @click="previous = !previous"
      >
        {{ previous ? "返回当前配置" : "查看读取前草稿" }}
      </button>
      <view v-if="state.blocked" class="notice"
        >已保留草稿。请先重新读取，核对最新结果后再编辑。</view
      >
      <view v-if="previous" class="notice"
        >读取前草稿，仅供核对。返回当前配置后可继续编辑。</view
      >
      <form v-if="draft" @submit="ctl.save()">
        <ProductOptionsGroups
          :groups="draft.specGroups"
          kind="spec"
          :disabled="disabled"
          @remove-group="removeNewOptionsGroup(draft, 'spec', $event)"
        />
        <ProductOptionsSkus :draft="draft" :disabled="disabled" />
        <ProductOptionsGroups
          :groups="draft.attributeGroups"
          kind="attribute"
          :disabled="disabled"
          @remove-group="removeNewOptionsGroup(draft, 'attribute', $event)"
        />
        <view class="options-section"
          ><view class="row"
            ><text class="options-heading">加料</text
            ><button
              class="small outline"
              :disabled="disabled || draft.modifiers.length >= 20"
              @click="
                draft.modifiers.push({
                  name: '',
                  enabled: true,
                  price: '',
                  initialStock: '0',
                })
              "
            >
              添加加料
            </button></view
          ><text class="safe-note"
            >加料另计价格并扣除自己的库存，库存调整立即生效。</text
          >
          <view
            v-for="(item, mi) in draft.modifiers"
            :key="item.id || 'new-' + mi"
            class="option-card"
          >
            <view class="row"
              ><text class="label">加料 {{ mi + 1 }}</text
              ><text class="status">{{
                item.enabled ? "已启用" : "已停用"
              }}</text></view
            >
            <AccessibleInput
              v-model="item.name"
              :input-id="'option-mod-name-' + mi"
              :label="'加料' + (mi + 1) + '名称'"
              :disabled="disabled"
              maxlength="80"
            />
            <AccessibleInput
              v-model="item.price"
              :input-id="'option-mod-price-' + mi"
              :label="'加料' + (mi + 1) + '价格（元）'"
              :disabled="disabled"
              maxlength="12"
            />
            <button
              class="small outline"
              :disabled="disabled"
              @click="item.enabled = !item.enabled"
            >
              {{ item.enabled ? "停用" : "恢复" }}加料{{ mi + 1 }}
            </button>
            <template v-if="item.id"
              ><text class="safe-note"
                >可售 {{ item.available }} · 预占 {{ item.reserved }}</text
              ><AccessibleInput
                v-model="inventory[item.id]"
                :input-id="'option-mod-stock-' + mi"
                :label="'加料' + (mi + 1) + '可售库存'"
                :disabled="disabled"
                maxlength="10"
              /><button
                class="outline wide"
                :disabled="disabled"
                @click="ctl.saveInventory(item.id)"
              >
                保存加料{{ mi + 1 }}库存
              </button></template
            >
            <template v-else
              ><AccessibleInput
                v-model="item.initialStock"
                :input-id="'option-mod-initial-' + mi"
                :label="'加料' + (mi + 1) + '初始库存'"
                :disabled="disabled"
                maxlength="10"
              /><button
                class="small link"
                :disabled="disabled"
                @click="draft.modifiers.splice(mi, 1)"
              >
                移除未保存加料
              </button></template
            >
          </view>
        </view>
        <view class="space" /><button
          class="primary wide"
          form-type="submit"
          :disabled="disabled"
        >
          {{ state.busy ? "保存中…" : "保存规格与口味" }}
        </button>
      </form>
    </view></view
  >
</template>
<style>
.product-options text,
.product-options button,
.product-options input,
.product-options .options-picker {
  font-size: 14px;
}
.product-options .sheet-title {
  font-size: 24px;
}
.product-options .options-heading {
  font-size: 18px;
  font-weight: 600;
}
.product-options .options-section {
  border-top: 1px solid #e9eade;
  padding-top: 22px;
  margin-top: 22px;
}
.product-options .option-card {
  border: 1px solid #dce1d9;
  border-radius: 12px;
  padding: 16px;
  margin: 18px 0;
}
.product-options .safe-note {
  display: block;
  margin: 12px 0;
  line-height: 1.6;
}
.product-options .option-value {
  border-top: 1px solid #e9eade;
  margin-top: 14px;
  padding-top: 6px;
}
.product-options .option-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 14px 0;
}
.product-options .option-actions button {
  margin: 0;
}
.product-options .options-picker {
  padding: 14px;
  border: 1px solid #dce1d9;
  border-radius: 12px;
  background: #fff;
}
</style>
