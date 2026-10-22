<script setup>
import { computed } from "vue";
import {
  newOptionsSku,
  previewCombinations,
  optionsRef,
  selectOptionsValue,
} from "@restaurant/mini-core";
import AccessibleInput from "./AccessibleInput.vue";
const props = defineProps({ draft: Object, disabled: Boolean });
const preview = computed(() => previewCombinations(props.draft));
const activeCount = computed(
  () => props.draft.skus.filter((s) => s.enabled).length,
);
function pick(sku, group, event) {
  const values = group.values.filter((v) => v.enabled);
  const value = values[Number(event.detail.value) - 1];
  selectOptionsValue(sku, group, value ? optionsRef(value) : "");
}
const selectedIndex = (sku, group) =>
  1 +
  group.values
    .filter((v) => v.enabled)
    .findIndex(
      (v) =>
        optionsRef(v) ===
        sku.selections.find((s) => s.groupRef === optionsRef(group))?.valueRef,
    );
function selection(sku, group) {
  const selected = sku.selections.find((s) => s.groupRef === optionsRef(group));
  const value = group.values.find((v) => optionsRef(v) === selected?.valueRef);
  return value ? value.name + (value.enabled ? "" : "（已停用）") : "请选择";
}
</script>
<template>
  <view class="options-section">
    <view class="row"
      ><text class="options-heading">组合与价格</text
      ><text class="safe-note">启用 {{ activeCount }} / 20</text></view
    >
    <text class="safe-note"
      >{{
        preview.total
          ? "规格共可搭配" + preview.total + "种组合；按需添加，最多启用20种。"
          : "未启用规格维度时，用名称区分组合。"
      }}已有组合库存可在电脑端商品页单独调整。</text
    >
    <view
      v-for="(sku, si) in draft.skus"
      :key="sku.id || 'new-' + si"
      class="option-card"
    >
      <view class="row"
        ><text class="label">组合 {{ si + 1 }}</text
        ><text class="status">{{
          sku.enabled ? "已启用" : "已停用"
        }}</text></view
      >
      <AccessibleInput
        v-model="sku.name"
        :input-id="'option-sku-name-' + si"
        :label="'组合' + (si + 1) + '名称'"
        :disabled="disabled"
        maxlength="80"
      />
      <AccessibleInput
        v-model="sku.price"
        :input-id="'option-sku-price-' + si"
        :label="'组合' + (si + 1) + '售价（元）'"
        :disabled="disabled"
        maxlength="12"
      />
      <view
        v-for="(group, gi) in draft.specGroups.filter((g) => g.enabled)"
        :key="group.id || group.clientKey"
        class="field"
      >
        <text class="label"
          >组合{{ si + 1 }} · 维度{{ gi + 1 }}
          {{ group.name || "未命名维度" }}</text
        >
        <picker
          :range="[
            { name: '请选择' },
            ...group.values.filter((v) => v.enabled),
          ]"
          range-key="name"
          :value="selectedIndex(sku, group)"
          :disabled="disabled || !group.values.some((v) => v.enabled)"
          @change="pick(sku, group, $event)"
          ><view
            class="options-picker"
            role="button"
            :aria-label="
              '组合' + (si + 1) + '选择维度' + (gi + 1) + ' ' + group.name
            "
            >{{ selection(sku, group) }} ⌄</view
          ></picker
        >
      </view>
      <text v-if="sku.id" class="safe-note"
        >可售 {{ sku.available }} · 预占 {{ sku.reserved }}</text
      >
      <AccessibleInput
        v-else
        v-model="sku.initialStock"
        :input-id="'option-sku-stock-' + si"
        :label="'组合' + (si + 1) + '初始库存'"
        :disabled="disabled"
        maxlength="10"
      />
      <view class="option-actions"
        ><button
          class="small outline"
          :disabled="disabled"
          @click="sku.enabled = !sku.enabled"
        >
          {{ sku.enabled ? "停用" : "恢复" }}组合{{ si + 1 }}</button
        ><button
          v-if="!sku.id"
          class="small link"
          :disabled="disabled"
          @click="draft.skus.splice(si, 1)"
        >
          移除未保存组合
        </button></view
      >
    </view>
    <view v-if="preview.total"
      ><text class="label">待添加组合预览</text
      ><text v-if="!preview.items.length" class="safe-note"
        >所有组合已配置。</text
      ><view class="option-actions"
        ><button
          v-for="(item, i) in preview.items"
          :key="i"
          class="small outline"
          :disabled="disabled || activeCount >= 20"
          @click="draft.skus.push(newOptionsSku(item))"
        >
          添加 {{ item.name }}
        </button></view
      ></view
    >
    <button
      v-else
      class="outline wide"
      :disabled="disabled || activeCount >= 20"
      @click="draft.skus.push(newOptionsSku())"
    >
      添加组合
    </button>
  </view>
</template>
