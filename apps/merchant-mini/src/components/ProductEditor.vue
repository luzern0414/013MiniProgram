<script setup>
import { computed, onMounted, onUnmounted, reactive, watch } from "vue";
import {
  createClient,
  createProductController,
  selectableCategories,
  selectableUnits,
} from "@restaurant/mini-core";
import AccessibleInput from "./AccessibleInput.vue";
const props = defineProps({ store: Object, product: Object, locked: Boolean });
const emit = defineEmits(["close", "saved", "busy"]);
const state = reactive({});
const ctl = createProductController({
  state,
  request: createClient("merchant").api,
  storeId: () => props.store.id,
  onSaved: () => emit("saved"),
});
const categories = computed(() => {
  const list = selectableCategories(state.settings, props.store.id);
  if (props.product && !list.some((c) => c.id === state.target?.categoryId))
    list.unshift({
      id: state.target?.categoryId,
      name:
        (state.settings?.categories.find(
          (c) => c.id === state.target?.categoryId,
        )?.name || "原分类") + "（保留原分类）",
    });
  return [{ id: "", name: "请选择分类" }, ...list];
});
const units = computed(() => {
  const list = selectableUnits(state.settings);
  if (props.product && !list.some((u) => u.id === state.target?.unitId))
    list.unshift({
      id: state.target?.unitId || "",
      name: state.target?.unit + "（保留原单位）",
    });
  return props.product ? list : [{ id: "", name: "请选择单位" }, ...list];
});
const categoryName = computed(
  () =>
    categories.value.find((c) => c.id === state.form.categoryId)?.name ||
    "请选择分类",
);
const unitName = computed(
  () =>
    units.value.find((u) => u.id === state.form.unitId)?.name || "请选择单位",
);
const disabled = computed(
  () =>
    props.locked ||
    state.busy ||
    state.loading ||
    state.blocked ||
    !state.settings,
);
watch(
  () => state.busy,
  (value) => emit("busy", value),
  { flush: "sync" },
);
onMounted(() => ctl.open(props.product));
onUnmounted(() => emit("busy", false));
function chooseCategory(e) {
  state.form.categoryId = categories.value[Number(e.detail.value)]?.id || "";
}
function chooseUnit(e) {
  state.form.unitId = units.value[Number(e.detail.value)]?.id || "";
}
</script>
<template>
  <view class="overlay"
    ><view
      class="sheet"
      role="dialog"
      :aria-label="product ? '编辑商品' : '新增商品'"
      ><view class="row"
        ><text class="sheet-title">{{ product ? "编辑商品" : "新增商品" }}</text
        ><button
          class="small outline"
          :disabled="state.busy"
          @click="emit('close')"
        >
          取消
        </button></view
      >
      <view v-if="state.loading" class="loading">正在读取分类与单位…</view>
      <form @submit="ctl.save">
        <AccessibleInput
          v-model="state.form.name"
          input-id="product-name"
          label="商品名称"
          :disabled="disabled"
          maxlength="100"
        />
        <view class="field"
          ><text class="label">分类</text
          ><picker
            :range="categories"
            range-key="name"
            :value="
              Math.max(
                0,
                categories.findIndex((c) => c.id === state.form.categoryId),
              )
            "
            :disabled="disabled || !categories.length"
            @change="chooseCategory"
            ><view class="picker-value" role="button" aria-label="选择商品分类"
              >{{ categoryName }}⌄</view
            ></picker
          ></view
        >
        <view class="field"
          ><text class="label">售卖单位</text
          ><picker
            :range="units"
            range-key="name"
            :value="
              Math.max(
                0,
                units.findIndex((u) => u.id === state.form.unitId),
              )
            "
            :disabled="disabled || !units.length"
            @change="chooseUnit"
            ><view class="picker-value" role="button" aria-label="选择售卖单位"
              >{{ unitName }}⌄</view
            ></picker
          ></view
        >
        <AccessibleInput
          v-model="state.form.description"
          input-id="product-description"
          label="商品描述"
          :disabled="disabled"
          maxlength="1000"
        />
        <AccessibleInput
          v-model="state.form.imageUrl"
          input-id="product-image"
          label="商品图片地址（选填）"
          :disabled="disabled"
          maxlength="2000"
          placeholder="https://"
        />
        <view v-if="product" class="row"
          ><text class="label">上架售卖</text
          ><switch
            :checked="state.form.isAvailable"
            :disabled="disabled"
            @change="state.form.isAvailable = $event.detail.value"
        /></view>
        <template v-else
          ><view class="row"
            ><text class="label">规格、价格与库存</text
            ><button
              class="small outline"
              :disabled="disabled || state.form.skus?.length >= 20"
              @click="state.form.skus.push({ name: '', price: '', stock: '0' })"
            >
              添加规格
            </button></view
          >
          <view
            v-for="(sku, index) in state.form.skus"
            :key="index"
            class="sku-draft"
            ><AccessibleInput
              v-model="sku.name"
              :input-id="'sku-name-' + index"
              :label="'规格' + (index + 1) + '名称'"
              :disabled="disabled"
              maxlength="80"
            /><AccessibleInput
              v-model="sku.price"
              :input-id="'sku-price-' + index"
              :label="'规格' + (index + 1) + '售价（元）'"
              :disabled="disabled"
              maxlength="12"
            /><AccessibleInput
              v-model="sku.stock"
              :input-id="'sku-stock-' + index"
              :label="'规格' + (index + 1) + '可售库存'"
              :disabled="disabled"
              maxlength="10"
            /><button
              v-if="state.form.skus.length > 1"
              class="link"
              :disabled="disabled"
              @click="state.form.skus.splice(index, 1)"
            >
              移除规格{{ index + 1 }}
            </button></view
          ></template
        >
        <text v-if="product" class="safe-note"
          >保留现有规格及库存。价格与库存可在电脑端单独调整。</text
        >
        <view v-if="state.error" class="error" role="alert">{{
          state.error
        }}</view
        ><button
          v-if="state.blocked || (!state.settings && !state.loading)"
          class="outline wide"
          :disabled="state.busy || state.loading"
          @click="state.blocked ? ctl.reload() : ctl.load()"
        >
          重新加载并核对
        </button>
        <view class="space" /><button
          form-type="submit"
          class="primary wide"
          :disabled="disabled"
        >
          {{ state.busy ? "保存中…" : "保存商品" }}
        </button>
      </form></view
    ></view
  >
</template>
<style scoped>
.picker-value {
  padding: 14px;
  border: 1px solid #dce1d9;
  border-radius: 12px;
  background: #fff;
}
.sku-draft {
  border-top: 1px solid #e9eade;
  margin-top: 18px;
  padding-top: 8px;
}
.safe-note {
  display: block;
  margin: 16px 0;
}
text,
button,
.picker-value {
  font-size: 14px;
}
.sheet-title {
  font-size: 24px;
}
</style>
