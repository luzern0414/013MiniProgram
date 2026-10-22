<script setup lang="ts">
import { reactive, computed, ref } from "vue";
import type { Product } from "./types";
import {
  enabledNodes,
  initialSelection,
  resolveSelectionSku,
  selectionLine,
  toggleAttribute,
} from "../../../packages/mini-core/src/product-selection.mjs";
import { attributeRule } from "../../../packages/mini-core/src/product-options.mjs";
import { money } from "./domain.mjs";
const props = defineProps<{ product: Product }>();
const emit = defineEmits(["add", "close"]);
const state = reactive<any>(initialSelection(props.product));
const error = ref("");
const groups = computed(() => enabledNodes(props.product.specGroups));
const sku = computed(() =>
  groups.value.length
    ? resolveSelectionSku(props.product, state.specValues)
    : props.product.skus.find((s) => s.id === state.skuId),
);
const price = computed(
  () =>
    (sku.value?.priceFen || 0) +
    props.product.modifiers
      .filter((m) => state.modifierIds.includes(m.id))
      .reduce((sum, m) => sum + m.priceFen, 0),
);
function attribute(group: any, id: string, event: Event) {
  try {
    state.attributeOptionIds = toggleAttribute(
      group,
      state.attributeOptionIds,
      id,
    );
    error.value = "";
  } catch (e) {
    error.value = (e as Error).message;
  }
  (event.target as HTMLInputElement).checked =
    state.attributeOptionIds.includes(id);
}
function add() {
  try {
    error.value = "";
    emit(
      "add",
      selectionLine(props.product, { ...state, skuId: sku.value?.id }),
    );
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <form @submit.prevent="add">
    <p v-if="product.description" class="muted">{{ product.description }}</p>
    <label v-for="group in groups" :key="group.id" class="field"
      ><span>{{ group.name }}</span
      ><select v-model="state.specValues[group.id]" required>
        <option value="" disabled>请选择</option>
        <option
          v-for="value in enabledNodes(group.values)"
          :key="value.id"
          :value="value.id"
        >
          {{ value.name }}
        </option>
      </select></label
    >
    <label v-if="!groups.length" class="field"
      ><span>商品规格</span
      ><select v-model="state.skuId" required>
        <option value="" disabled>请选择规格</option>
        <option
          v-for="item in enabledNodes(product.skus)"
          :key="item.id"
          :value="item.id"
          :disabled="item.available <= 0"
        >
          {{ item.name }} · {{ money(item.priceFen) }}
          {{ item.available <= 0 ? "已售罄" : "" }}
        </option>
      </select></label
    >
    <p v-if="!sku || sku.available <= 0" class="muted">
      此规格组合暂无可售库存，请选择其他规格。
    </p>
    <fieldset
      v-for="group in enabledNodes(product.attributeGroups)"
      :key="group.id"
      class="modifier-options"
    >
      <legend>{{ group.name }} · {{ attributeRule(group) }}</legend>
      <label
        v-for="option in enabledNodes(group.options)"
        :key="option.id"
        class="check-field"
        ><input
          type="checkbox"
          :checked="state.attributeOptionIds.includes(option.id)"
          @change="attribute(group, option.id, $event)"
          :aria-label="`${group.name}：${option.name}`"
        />{{ option.name }}</label
      >
    </fieldset>
    <fieldset
      v-if="enabledNodes(product.modifiers).length"
      class="modifier-options"
    >
      <legend>加料（选填）</legend>
      <label
        v-for="item in enabledNodes(product.modifiers)"
        :key="item.id"
        class="check-field"
        ><input
          type="checkbox"
          v-model="state.modifierIds"
          :value="item.id"
          :disabled="
            !state.modifierIds.includes(item.id) &&
            item.available < state.quantity
          "
        />{{ item.name }} +{{ money(item.priceFen) }}
        <span v-if="item.available < state.quantity">库存不足</span></label
      >
    </fieldset>
    <label class="field"
      ><span>数量</span
      ><input
        v-model.number="state.quantity"
        type="number"
        min="1"
        max="99"
        step="1"
        required
    /></label>
    <p>预估 {{ money(price * state.quantity) }}，核对金额后以门店报价为准。</p>
    <p v-if="error" class="notice" role="alert">{{ error }}</p>
    <div class="form-actions">
      <button type="button" class="quiet" @click="emit('close')">取消</button
      ><button class="primary" :disabled="!sku || sku.available <= 0">
        加入账单
      </button>
    </div>
  </form>
</template>
<style scoped>
fieldset {
  margin: 16px 0;
}
legend,
.muted,
.check-field {
  font-size: 14px;
}
</style>
