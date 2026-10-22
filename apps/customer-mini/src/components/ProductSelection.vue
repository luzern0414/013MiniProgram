<script setup>
import { reactive, computed, ref } from "vue";
import {
  enabledNodes,
  initialSelection,
  resolveSelectionSku,
  selectionLine,
  toggleAttribute,
  attributeRule,
  money,
} from "@restaurant/mini-core";
const props = defineProps({
  product: { type: Object, required: true },
  busy: Boolean,
});
const emit = defineEmits(["add"]);
const state = reactive(initialSelection(props.product));
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
function attribute(group, id) {
  try {
    state.attributeOptionIds = toggleAttribute(
      group,
      state.attributeOptionIds,
      id,
    );
    error.value = "";
  } catch (e) {
    error.value = e.message;
  }
}
function modifier(id) {
  state.modifierIds = state.modifierIds.includes(id)
    ? state.modifierIds.filter((v) => v !== id)
    : [...state.modifierIds, id];
}
function add() {
  try {
    error.value = "";
    emit(
      "add",
      selectionLine(props.product, { ...state, skuId: sku.value?.id }),
    );
  } catch (e) {
    error.value = e.message;
  }
}
</script>
<template>
  <view>
    <text class="product-description">{{ product.description }}</text>
    <view v-for="group in groups" :key="group.id" class="selection-group">
      <text class="label">{{ group.name }}</text
      ><view class="chips">
        <button
          v-for="value in enabledNodes(group.values)"
          :key="value.id"
          class="chip"
          :aria-label="`${group.name}：${value.name}`"
          :aria-pressed="state.specValues[group.id] === value.id"
          :class="{ chosen: state.specValues[group.id] === value.id }"
          @click="state.specValues[group.id] = value.id"
        >
          {{ value.name }}
        </button>
      </view>
    </view>
    <view v-if="!groups.length" class="selection-group"
      ><text class="label">规格</text
      ><view class="chips">
        <button
          v-for="item in enabledNodes(product.skus)"
          :key="item.id"
          class="chip"
          :class="{ chosen: state.skuId === item.id }"
          :disabled="item.available <= 0"
          @click="state.skuId = item.id"
        >
          {{ item.name }} · {{ money(item.priceFen) }}
          {{ item.available <= 0 ? "已售罄" : "" }}
        </button>
      </view></view
    >
    <text v-if="!sku || sku.available <= 0" class="muted"
      >此规格组合暂无可售库存，请选择其他规格。</text
    >
    <view
      v-for="group in enabledNodes(product.attributeGroups)"
      :key="group.id"
      class="selection-group"
    >
      <text class="label">{{ group.name }}</text
      ><text class="muted">{{ attributeRule(group) }}</text
      ><view class="chips">
        <button
          v-for="option in enabledNodes(group.options)"
          :key="option.id"
          class="chip"
          :class="{ chosen: state.attributeOptionIds.includes(option.id) }"
          :aria-label="`${group.name}：${option.name}`"
          :aria-pressed="state.attributeOptionIds.includes(option.id)"
          @click="attribute(group, option.id)"
        >
          {{ option.name }}
        </button>
      </view>
    </view>
    <view v-if="enabledNodes(product.modifiers).length" class="selection-group"
      ><text class="label">加料（选填）</text
      ><view class="chips">
        <button
          v-for="item in enabledNodes(product.modifiers)"
          :key="item.id"
          class="chip"
          :class="{ chosen: state.modifierIds.includes(item.id) }"
          :disabled="
            !state.modifierIds.includes(item.id) &&
            item.available < state.quantity
          "
          @click="modifier(item.id)"
        >
          {{ item.name }} +{{ money(item.priceFen) }}
          {{ item.available < state.quantity ? "库存不足" : "" }}
        </button>
      </view></view
    >
    <view v-if="error" class="error" role="alert">{{ error }}</view>
    <view class="row"
      ><text class="price">{{ money(price * state.quantity) }}</text
      ><view class="counter">
        <button
          :disabled="state.quantity <= 1"
          aria-label="减少数量"
          @click="state.quantity--"
        >
          −</button
        ><text>{{ state.quantity }}</text
        ><button
          :disabled="state.quantity >= Math.min(sku?.available || 0, 99)"
          aria-label="增加数量"
          @click="state.quantity++"
        >
          +
        </button>
      </view></view
    ><text class="muted">预估金额，确认金额后以门店报价为准。</text>
    <view class="space" /><button
      class="primary wide"
      :disabled="!sku || sku.available <= 0 || busy"
      @click="add"
    >
      加入购物袋
    </button>
  </view>
</template>
<style scoped>
.selection-group {
  margin-bottom: 20px;
  font-size: 14px;
}
.selection-group .muted {
  display: block;
  margin: 6px 0;
}
.chip {
  font-size: 14px;
  transition:
    background-color 0.15s,
    border-color 0.15s,
    transform 0.15s;
}
.chip:active {
  transform: scale(0.97);
}
@media (prefers-reduced-motion: reduce) {
  .chip {
    transition: none;
  }
  .chip:active {
    transform: none;
  }
}
</style>
