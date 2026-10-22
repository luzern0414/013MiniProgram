<script setup>
import { ref, reactive, computed } from 'vue';
import { enabledNodes, initialSelection, selectionLine, resolveSelectionSku, toggleAttribute, attributeRule, attributeSummary, money } from '@restaurant/mini-core';
import AccessibleInput from './AccessibleInput.vue';
const props = defineProps({ cashier: { type: Object, required: true }, locked: Boolean });
const state = computed(() => props.cashier.state);
const search = ref(''), category = ref(''), product = ref(null), editIndex = ref(-1), error = ref('');
const choice = reactive({});
const products = computed(() => state.value.catalog.products.filter(p => (!category.value || p.categoryId === category.value) && (!search.value || p.name.includes(search.value))));
const groups = computed(() => enabledNodes(product.value?.specGroups));
const sku = computed(() => groups.value.length ? resolveSelectionSku(product.value, choice.specValues) : enabledNodes(product.value?.skus).find(s => s.id === choice.skuId));
const blocked = computed(() => props.locked || props.cashier.editingLocked());
function choose(value, index = -1) {
  if (blocked.value) return;
  product.value = value; editIndex.value = index; error.value = '';
  const original = state.value.cart[index];
  const selectedSku = value.skus.find(s => s.id === original?.skuId);
  Object.assign(choice, original ? { ...original, modifierIds: [...original.modifierIds], attributeOptionIds: [...original.attributeOptionIds], specValues: Object.fromEntries((selectedSku?.selections || []).map(s => [s.groupRef, s.valueRef])) } : initialSelection(value));
}
function edit(index) {
  const original = state.value.cart[index];
  const value = state.value.catalog.products.find(p => p.skus.some(s => s.id === original.skuId));
  if (value) choose(value, index);
  else state.value.error = '原商品或规格已失效，原选择仍保留；请加入可用商品后明确移除此行。';
}
function attribute(group, id) {
  try { choice.attributeOptionIds = toggleAttribute(group, choice.attributeOptionIds, id); error.value = ''; }
  catch (e) { error.value = e.message; }
}
function modifier(id) { choice.modifierIds = choice.modifierIds.includes(id) ? choice.modifierIds.filter(v => v !== id) : [...choice.modifierIds, id]; }
function add() {
  if (blocked.value) return;
  try {
    const line = selectionLine(product.value, { ...choice, skuId: sku.value?.id });
    if (props.cashier.add(line, editIndex.value)) product.value = null;
    else error.value = state.value.error;
  } catch (e) { error.value = e.message; }
}
function amount(line) {
  try { return money(selectionLine(state.value.catalog.products.find(p => p.skus.some(s => s.id === line.skuId)), line).unitPriceFen * line.quantity); }
  catch { return '待重新核价'; }
}
const summary = line => [attributeSummary(line) || line.display?.attributeNames?.join('、'), (line.modifierNames || line.display?.modifierNames || []).join('、')].filter(Boolean).join(' · ');
</script>
<template>
  <view class="cashier-selection">
    <view class="panel">
      <view class="row"><text class="sheet-title">选择商品</text><button class="link" :disabled="locked || state.loading || state.drafts.busy" @click="cashier.loadMenu()">刷新菜单</button></view>
      <AccessibleInput v-model="search" label="收银商品搜索" input-id="cashier-search" placeholder="搜索商品" :disabled="blocked" />
      <view class="chips"><button class="chip" :class="{chosen: !category}" :disabled="blocked" @click="category = ''">全部</button><button v-for="item in state.catalog.categories" :key="item.id" class="chip" :class="{chosen: category === item.id}" :disabled="blocked" @click="category = item.id">{{ item.name }}</button></view>
      <text v-if="state.loading" class="loading">正在读取菜单…</text>
      <view v-if="state.menuError" class="error" role="alert">{{ state.menuError }}</view>
      <view v-for="item in products" :key="item.id" class="list-item row">
        <view class="grow"><text class="label">{{ item.name }}</text><text class="muted">{{ item.skus.length ? money(Math.min(...item.skus.map(s => s.priceFen))) + '起' : '暂无规格' }}</text></view>
        <button class="small outline" :disabled="blocked || !item.isAvailable || !item.skus.some(s => s.enabled !== false && s.available > 0)" @click="choose(item)">选购</button>
      </view>
      <text v-if="!state.loading && !products.length && !state.menuError" class="empty">暂无可选商品</text>
    </view>
    <view class="panel">
      <text class="sheet-title">购物袋 · {{ state.cart.reduce((sum, line) => sum + line.quantity, 0) }}份</text>
      <view v-for="(line, index) in state.cart" :key="index" class="list-item">
        <view class="row"><text class="label">{{ line.productName }} · {{ line.skuName }} ×{{ line.quantity }}</text><text>{{ amount(line) }}</text></view>
        <text class="muted">{{ summary(line) }}</text>
        <text v-if="cashier.lineIssue(line)" class="error">{{ cashier.lineIssue(line) }}</text>
        <text v-if="cashier.lineIssue(line)" class="safe-note">原规格 {{ line.skuId }} · 口味 {{ line.attributeOptionIds.join('、') || '无' }} · 加料 {{ line.modifierIds.join('、') || '无' }}</text>
        <view class="row"><view class="counter"><button :disabled="blocked || line.quantity <= 1" aria-label="减少数量" @click="cashier.changeQuantity(index, line.quantity - 1)">−</button><text>{{ line.quantity }}</text><button :disabled="blocked || line.quantity >= 99" aria-label="增加数量" @click="cashier.changeQuantity(index, line.quantity + 1)">+</button></view><button class="link" :disabled="blocked" @click="edit(index)">修改搭配</button><button class="link" :disabled="blocked" @click="cashier.remove(index)">移除</button></view>
      </view>
      <text v-if="!state.cart.length" class="empty">选择商品后可挂单或核对金额。</text>
      <text class="safe-note">购物袋金额为预估，保存并核价后以门店实际报价为准。</text>
    </view>
    <view v-if="product" class="overlay"><view class="sheet">
      <view class="row"><text class="sheet-title">{{ product.name }}</text><button class="small outline" :disabled="blocked" @click="product = null">关闭</button></view>
      <text class="product-description">{{ product.description }}</text>
      <view v-for="group in groups" :key="group.id" class="selection-group"><text class="label">{{ group.name }}</text><view class="chips"><button v-for="value in enabledNodes(group.values)" :key="value.id" class="chip" :class="{chosen: choice.specValues[group.id] === value.id}" :disabled="blocked" @click="choice.specValues[group.id] = value.id">{{ value.name }}</button></view></view>
      <view v-if="!groups.length" class="selection-group"><text class="label">规格</text><view class="chips"><button v-for="item in enabledNodes(product.skus)" :key="item.id" class="chip" :class="{chosen: choice.skuId === item.id}" :disabled="blocked || item.available <= 0" @click="choice.skuId = item.id">{{ item.name }} · {{ money(item.priceFen) }}</button></view></view>
      <text v-if="!sku || sku.available <= 0" class="error">此规格组合暂无可售库存，请重新选择。</text>
      <view v-for="group in enabledNodes(product.attributeGroups)" :key="group.id" class="selection-group"><text class="label">{{ group.name }} · {{ attributeRule(group) }}</text><view class="chips"><button v-for="option in enabledNodes(group.options)" :key="option.id" class="chip" :class="{chosen: choice.attributeOptionIds.includes(option.id)}" :disabled="blocked" @click="attribute(group, option.id)">{{ option.name }}</button></view><text v-if="group.minSelections > enabledNodes(group.options).length" class="error">暂无足够可用选项，请选择其他商品或联系店主。</text></view>
      <view v-if="enabledNodes(product.modifiers).length" class="selection-group"><text class="label">加料（选填）</text><view class="chips"><button v-for="item in enabledNodes(product.modifiers)" :key="item.id" class="chip" :class="{chosen: choice.modifierIds.includes(item.id)}" :disabled="blocked || (!choice.modifierIds.includes(item.id) && item.available < choice.quantity)" @click="modifier(item.id)">{{ item.name }} +{{ money(item.priceFen) }}</button></view></view>
      <view class="row"><text class="label">数量</text><view class="counter"><button :disabled="blocked || choice.quantity <= 1" aria-label="减少搭配数量" @click="choice.quantity--">−</button><text>{{ choice.quantity }}</text><button :disabled="blocked || choice.quantity >= Math.min(sku?.available || 0, 99)" aria-label="增加搭配数量" @click="choice.quantity++">+</button></view></view>
      <view v-if="error" class="error" role="alert">{{ error }}</view><button class="primary wide" :disabled="blocked || !sku || sku.available <= 0" @click="add">{{ editIndex >= 0 ? '确认修改搭配' : '加入购物袋' }}</button>
    </view></view>
  </view>
</template>
<style scoped>
.cashier-selection,.selection-group{font-size:14px}.selection-group{margin:18px 0}.chip{font-size:14px;transition:background-color .15s}.muted,.safe-note{display:block;margin-top:6px}.sheet .primary{margin-top:20px}
@media(prefers-reduced-motion:reduce){.chip{transition:none}}
</style>
