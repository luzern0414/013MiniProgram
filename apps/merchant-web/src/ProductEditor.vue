<script setup lang="ts">
import { computed, onMounted, reactive } from "vue";
import { api } from "./api";
import Modal from "./Modal.vue";
import {
  createProductController,
  selectableCategories,
  selectableUnits,
} from "../../../packages/mini-core/src/catalog-settings.mjs";
const props = defineProps<{ storeId: string; product?: any }>();
const emit = defineEmits(["close", "saved"]);
const state = reactive<any>({});
const ctl = createProductController({
  state,
  storeId: () => props.storeId,
  request: (path: string, options?: any) =>
    api<any>(
      path,
      options ? { method: options.method, body: options.data } : {},
    ),
  onSaved: () => emit("saved"),
});
const categories = computed(() =>
  selectableCategories(state.settings, props.storeId),
);
const units = computed(() => selectableUnits(state.settings));
const current = computed(() => state.target || props.product);
const disabled = computed(
  () => state.busy || state.loading || state.blocked || !state.settings,
);
onMounted(() => ctl.open(props.product));
</script>
<template>
  <Modal
    :title="product ? '编辑商品' : '新增商品'"
    @close="!state.busy && emit('close')"
    ><form @submit.prevent="ctl.save">
      <p v-if="state.loading" class="muted">正在读取分类与单位…</p>
      <fieldset class="product-fields" :disabled="disabled">
        <div class="form-grid">
          <label class="field"
            ><span>商品名称</span
            ><input v-model="state.form.name" required maxlength="100"
          /></label>
          <label class="field"
            ><span>分类</span
            ><select v-model="state.form.categoryId" required>
              <option value="" disabled>请选择分类</option>
              <option
                v-if="
                  product &&
                  !categories.some((c: any) => c.id === current.categoryId)
                "
                :value="current.categoryId"
              >
                {{
                  state.settings?.categories.find(
                    (c: any) => c.id === current.categoryId,
                  )?.name || "原分类"
                }}（保留原分类）
              </option>
              <option v-for="c in categories" :key="c.id" :value="c.id">
                {{ c.name }}
              </option>
            </select></label
          >
          <label class="field"
            ><span>售卖单位</span
            ><select v-model="state.form.unitId" :required="!product">
              <option v-if="!product" value="" disabled>请选择单位</option>
              <option
                v-if="
                  product && !units.some((u: any) => u.id === current.unitId)
                "
                :value="current.unitId || ''"
              >
                {{ current.unit }}（保留原单位）
              </option>
              <option v-for="u in units" :key="u.id" :value="u.id">
                {{ u.name }}
              </option>
            </select></label
          >
          <label v-if="product" class="check-field"
            ><input
              type="checkbox"
              v-model="state.form.isAvailable"
            />上架售卖</label
          >
        </div>
        <label class="field"
          ><span>商品描述</span
          ><textarea
            v-model="state.form.description"
            maxlength="1000"
            rows="3"
          /></label
        ><label class="field"
          ><span>商品图片地址（选填）</span
          ><input
            type="url"
            v-model="state.form.imageUrl"
            maxlength="2000"
            placeholder="https://"
        /></label>
        <template v-if="!product"
          ><div class="section-heading">
            <h3>规格、价格与库存</h3>
            <button
              type="button"
              class="text-button"
              :disabled="state.form.skus?.length >= 20"
              @click="state.form.skus.push({ name: '', price: '', stock: '0' })"
            >
              添加规格
            </button>
          </div>
          <div
            v-for="(s, index) in state.form.skus"
            :key="index"
            class="sku-editor"
          >
            <label class="field"
              ><span>规格名称</span
              ><input v-model="s.name" required maxlength="80" /></label
            ><label class="field"
              ><span>售价（元）</span
              ><input
                v-model="s.price"
                type="number"
                min="0"
                max="20000000"
                step="0.01"
                required /></label
            ><label class="field"
              ><span>可售库存</span
              ><input
                v-model="s.stock"
                type="number"
                min="0"
                max="2000000000"
                step="1"
                required /></label
            ><button
              v-if="state.form.skus.length > 1"
              type="button"
              class="quiet"
              @click="state.form.skus.splice(index, 1)"
            >
              移除规格
            </button>
          </div>
        </template>
        <p v-else class="muted">价格与库存可在商品列表中单独调整。</p>
      </fieldset>
      <p v-if="state.error" class="error" role="alert">{{ state.error }}</p>
      <button
        v-if="state.blocked || (!state.settings && !state.loading)"
        type="button"
        class="quiet"
        :disabled="state.busy || state.loading"
        @click="state.blocked ? ctl.reload() : ctl.load()"
      >
        重新加载并核对
      </button>
      <div class="form-actions">
        <button
          type="button"
          class="quiet"
          :disabled="state.busy"
          @click="emit('close')"
        >
          取消</button
        ><button class="primary" :disabled="disabled">
          {{ state.busy ? "保存中…" : "保存商品" }}
        </button>
      </div>
    </form></Modal
  >
</template>
<style scoped>
.product-fields {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
p,
button,
input,
select,
span {
  font-size: 14px;
}
</style>
