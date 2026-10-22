<script setup>
import { ref } from "vue";
import { money } from "@restaurant/mini-core";
import CatalogSettings from "./CatalogSettings.vue";
import ProductEditor from "./ProductEditor.vue";
import ProductOptions from "./ProductOptions.vue";
defineProps({
  store: Object,
  catalog: Object,
  owner: Boolean,
  locked: Boolean,
  refresh: Function,
});
const emit = defineEmits(["busy", "refresh", "toggle"]);
const settingsOpen = ref(false),
  optionsEditing = ref(false),
  editing = ref(false),
  selected = ref(null),
  childBusy = ref(false);
function busy(value) {
  childBusy.value = value;
  emit("busy", value);
}
function edit(product = null) {
  selected.value = product;
  editing.value = true;
}
function saved() {
  editing.value = false;
  emit("refresh");
}
</script>
<template>
  <view class="row section-title"
    ><text class="title">商品</text
    ><button
      class="link"
      :disabled="locked || childBusy"
      @click="emit('refresh')"
    >
      刷新
    </button></view
  >
  <view class="product-tools"
    ><button
      class="outline"
      :disabled="locked || childBusy"
      @click="settingsOpen = !settingsOpen"
    >
      {{ settingsOpen ? "收起分类与单位" : "分类与单位" }}</button
    ><button
      v-if="owner"
      class="primary"
      :disabled="locked || childBusy"
      @click="edit()"
    >
      新增商品
    </button></view
  >
  <view v-if="!owner" class="safe-note">当前无维护权限，规格、口味与库存由店主管理。</view>
  <CatalogSettings
    v-if="settingsOpen"
    :key="store.id"
    :store="store"
    :locked="locked"
    @busy="busy"
    @changed="emit('refresh')"
  />
  <view v-for="product in catalog.products" :key="product.id" class="panel"
    ><view class="row"
      ><text class="sheet-title">{{ product.name }}</text
      ><text class="status">{{
        product.isAvailable ? "售卖中" : "已下架"
      }}</text></view
    ><text class="safe-note"
      >{{ catalog.categories.find((c) => c.id === product.categoryId)?.name }} ·
      {{ product.unit }}</text
    ><text v-if="product.description" class="product-description">{{
      product.description
    }}</text
    ><view v-for="sku in product.skus" :key="sku.id" class="list-item"
      ><text>{{ sku.name }} · {{ money(sku.priceFen) }}</text
      ><text>可售 {{ sku.available }} {{ product.unit }}</text></view
    ><view v-if="owner" class="product-tools"
      ><button class="small outline" :aria-label="'配置'+product.name+'规格与口味'" :disabled="locked || childBusy" @click="selected=product;optionsEditing=true">规格与口味</button
      ><button
        class="small outline"
        :aria-label="'编辑' + product.name"
        :disabled="locked || childBusy"
        @click="edit(product)"
      >
        编辑</button
      ><button
        class="small outline"
        :disabled="locked || childBusy"
        @click="emit('toggle', product)"
      >
        {{ product.isAvailable ? "标记售罄" : "恢复销售" }}
      </button></view
    ></view
  >
  <view v-if="!catalog.products.length" class="empty"
    >门店暂无商品，新增商品后即可开始售卖。</view
  >
  <ProductEditor
    v-if="editing"
    :store="store"
    :product="selected"
    :locked="locked"
    @busy="busy"
    @close="editing = false"
    @saved="saved"
  />
  <ProductOptions v-if="optionsEditing" :store="store" :product="selected" :owner="owner" :locked="locked" :refresh="refresh" @busy="busy" @close="optionsEditing=false" />
</template>
<style scoped>
.product-tools {
  display: flex;
  gap: 12px;
  margin: 16px 0;
  flex-wrap: wrap;
}
.product-tools button {
  margin: 0;
}
.safe-note {
  display: block;
  margin: 12px 0;
}
text,
button {
  font-size: 14px;
}
.sheet-title {
  font-size: 24px;
}
.title {
  font-size: 28px;
}
</style>
