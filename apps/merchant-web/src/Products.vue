<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { Plus, Search, Package, PenLine } from "lucide-vue-next";
import type { Store, Catalog, Product, Sku } from "./types";
import { api } from "./api";
import { useResource, useMutation } from "./ui";
import { money, toFen } from "./domain.mjs";
import StateBlock from "./StateBlock.vue";
import Feedback from "./Feedback.vue";
import Modal from "./Modal.vue";
import CatalogSettings from "./CatalogSettings.vue";
import ProductEditor from "./ProductEditor.vue";
import ProductOptions from "./ProductOptions.vue";
const props = defineProps<{ store: Store; owner: boolean }>();
const emit = defineEmits(['busy']);
const catalog = reactive(
  useResource<Catalog>(`/merchant/products?storeId=${props.store.id}`),
);
const mutation = reactive(useMutation());
const search = ref("");
const category = ref("");
const modal = ref<"create" | "edit" | "sku" | "options" | null>(null);
const settingsOpen = ref(false);
async function refreshOptions() {
  catalog.data = await api<Catalog>(`/merchant/products?storeId=${encodeURIComponent(props.store.id)}`);
}
const selected = ref<Product>();
const sku = ref<Sku>();
const skuDraft = reactive({ price: "", stock: 0 });
const products = computed(
  () =>
    catalog.data?.products.filter(
      (p) =>
        (!category.value || p.categoryId === category.value) &&
        p.name.toLowerCase().includes(search.value.trim().toLowerCase()),
    ) || [],
);
function openCreate() {
  selected.value = undefined;
  modal.value = "create";
}
function edit(p: Product) {
  selected.value = p;
  modal.value = "edit";
}
function editSku(p: Product, s: Sku) {
  mutation.clear();
  selected.value = p;
  sku.value = s;
  Object.assign(skuDraft, {
    price: (s.priceFen / 100).toFixed(2),
    stock: s.available,
  });
  modal.value = "sku";
}
function saveSku() {
  mutation.run(async () => {
    await api(`/merchant/skus/${sku.value!.id}`, {
      method: "PATCH",
      body: {
        storeId: props.store.id,
        priceFen: toFen(skuDraft.price),
        stock: Number(skuDraft.stock),
      },
    });
    modal.value = null;
    catalog.reload();
  }, "价格与库存已保存");
}
</script>
<template>
  <Feedback :error="mutation.error" :success="mutation.success" />
  <section class="panel">
    <div class="toolbar">
      <div class="search-field">
        <Search :size="18" /><input
          v-model="search"
          aria-label="搜索商品"
          placeholder="搜索商品名称"
        />
      </div>
      <select v-model="category" aria-label="商品分类">
        <option value="">全部分类</option>
        <option v-for="c in catalog.data?.categories" :key="c.id" :value="c.id">
          {{ c.name }}
        </option>
      </select>
      <div class="spacer" />
      <button class="quiet" @click="settingsOpen = !settingsOpen">
        {{ settingsOpen ? "收起分类与单位" : "分类与单位" }}</button
      ><button v-if="owner" class="primary" @click="openCreate">
        <Plus :size="18" />新增商品
      </button>
    </div>
    <StateBlock
      :loading="catalog.loading"
      :error="catalog.error"
      :empty="products.length === 0"
      @retry="catalog.reload"
      ><template #empty>{{
        search || category
          ? "没有匹配商品，请调整搜索条件。"
          : "暂无商品，新增商品后即可开始售卖。"
      }}</template>
      <div class="table-wrap">
        <table class="products-table">
          <thead>
            <tr>
              <th>商品</th>
              <th>规格 / 售价</th>
              <th>可售库存</th>
              <th>状态</th>
              <th v-if="owner">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="product in products" :key="product.id">
              <td>
                <div class="product-title">
                  <img
                    v-if="product.imageUrl"
                    :src="product.imageUrl"
                    :alt="product.name"
                    class="product-thumb"
                    @error="
                      ($event.target as HTMLImageElement).style.visibility =
                        'hidden'
                    "
                  /><span v-else class="product-placeholder"
                    ><Package :size="22"
                  /></span>
                  <div>
                    <strong>{{ product.name }}</strong>
                    <p class="muted">
                      {{
                        catalog.data?.categories.find(
                          (c) => c.id === product.categoryId,
                        )?.name
                      }}
                      · {{ product.unit }}
                    </p>
                  </div>
                </div>
              </td>
              <td>
                <div v-for="s in product.skus" :key="s.id" class="sku-line">
                  <span>{{ s.name }}</span
                  ><strong class="amount">{{ money(s.priceFen) }}</strong>
                </div>
              </td>
              <td>
                <div v-for="s in product.skus" :key="s.id" class="sku-line">
                  <span :class="{ 'low-stock': s.available <= 5 }"
                    >{{ s.available }} {{ product.unit }}</span
                  ><button
                    v-if="owner"
                    class="text-button"
                    :aria-label="`调整${product.name}${s.name}库存`"
                    @click="editSku(product, s)"
                  >
                    调整
                  </button>
                </div>
              </td>
              <td>
                <span
                  class="badge"
                  :class="product.isAvailable ? 'green' : 'neutral'"
                  >{{ product.isAvailable ? "售卖中" : "已下架" }}</span
                >
              </td>
              <td v-if="owner">
                <button class="quiet" :aria-label="`配置${product.name}规格与口味`" @click="selected=product;modal='options'">规格与口味</button>
                <button
                  class="quiet"
                  :aria-label="`编辑${product.name}`"
                  @click="edit(product)"
                >
                  <PenLine :size="15" />编辑
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="table-footer">
        共 {{ products.length }} 件商品
        <span v-if="!owner">当前无维护权限，规格、口味与库存由店主管理</span>
      </div></StateBlock
    >
  </section>
  <CatalogSettings
    v-if="settingsOpen"
    :store-id="store.id"
    @changed="catalog.reload"
  />
  <ProductEditor
    v-if="modal === 'create' || modal === 'edit'"
    :store-id="store.id"
    :product="selected"
    @close="modal = null"
    @saved="
      modal = null;
      catalog.reload();
    "
  />
  <ProductOptions v-if="modal === 'options' && selected" :store-id="store.id" :product="selected" :owner="owner" :refresh="refreshOptions" @busy="emit('busy', $event)" @close="modal=null" />
  <Modal
    v-if="modal === 'sku'"
    title="调整价格与库存"
    @close="!mutation.busy && (modal = null)"
    ><p class="muted">{{ selected?.name }} · {{ sku?.name }}</p>
    <form @submit.prevent="saveSku">
      <div class="form-grid">
        <label class="field"
          ><span>售价（元）</span
          ><input
            v-model="skuDraft.price"
            type="number"
            min="0"
            max="20000000"
            step="0.01"
            required /></label
        ><label class="field"
          ><span>可售库存</span
          ><input
            v-model.number="skuDraft.stock"
            type="number"
            min="0"
            max="2000000000"
            step="1"
            required
        /></label>
      </div>
      <Feedback :error="mutation.error" />
      <div class="form-actions">
        <button
          type="button"
          class="quiet"
          :disabled="mutation.busy"
          @click="modal = null"
        >
          取消</button
        ><button class="primary" :disabled="mutation.busy">
          {{ mutation.busy ? "保存中…" : "保存价格与库存" }}
        </button>
      </div>
    </form></Modal
  >
</template>
