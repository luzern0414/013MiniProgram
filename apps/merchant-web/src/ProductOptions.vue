<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { api } from "./api";
import Modal from "./Modal.vue";
import ProductOptionsGroups from "./ProductOptionsGroups.vue";
import { createOptionsController } from "../../../packages/mini-core/src/options-editor.mjs";
import {
  newOptionsSku,
  previewCombinations,
  optionsRef,
  selectOptionsValue,
  removeNewOptionsGroup,
} from "../../../packages/mini-core/src/product-options.mjs";
const props = defineProps<{
  storeId: string;
  product: { id: string; name: string };
  owner: boolean;
  refresh: () => Promise<void>;
}>();
const emit = defineEmits(["close", "busy"]);
const state = reactive<any>({});
const previous = ref(false);
const ctl = createOptionsController({
  state,
  storeId: () => props.storeId,
  productId: () => props.product.id,
  canEdit: () => props.owner,
  request: (path: string, options?: any) =>
    api<any>(
      path,
      options ? { method: options.method, body: options.data } : {},
    ),
  onChanged: props.refresh,
});
const draft = computed(() =>
  previous.value ? state.previousDraft : state.draft,
);
const inventory = computed(() =>
  previous.value ? state.previousInventory : state.inventory,
);
const disabled = computed(
  () =>
    state.busy ||
    state.loading ||
    state.blocked ||
    state.readOnly ||
    previous.value,
);
const preview = computed(() =>
  draft.value ? previewCombinations(draft.value) : { total: 0, items: [] },
);
const activeCount = computed(
  () => draft.value?.skus.filter((s: any) => s.enabled).length || 0,
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
function preventLeave(event: BeforeUnloadEvent) {
  if (state.busy) {
    event.preventDefault();
    event.returnValue = "";
  }
}
onMounted(() => {
  ctl.load();
  window.addEventListener("beforeunload", preventLeave);
});
onUnmounted(() => {
  ctl.dispose();
  emit("busy", false);
  window.removeEventListener("beforeunload", preventLeave);
});
</script>
<template>
  <Modal
    title="规格与口味"
    :locked="state.busy || state.loading"
    @close="!state.busy && !state.loading && emit('close')"
  >
    <div class="product-options">
      <p class="muted">{{ product.name }} · 已有记录可停用，随时恢复。</p>
      <p v-if="state.loading" role="status">正在读取规格与口味…</p>
      <p v-if="state.readOnly" class="notice-strip">
        当前无维护权限，仅可查看已读取的信息。
      </p>
      <p v-if="state.error" class="error-message" role="alert">
        {{ state.error }}
      </p>
      <p v-if="state.notice" class="success" role="status">
        {{ state.notice }}
      </p>
      <div class="row options-recovery">
        <button
          type="button"
          class="quiet"
          :disabled="state.busy || state.loading"
          @click="ctl.load"
        >
          重新读取并核对
        </button>
        <button
          v-if="state.previousDraft"
          type="button"
          class="text-button"
          :disabled="state.busy || state.loading"
          @click="previous = !previous"
        >
          {{ previous ? "返回当前配置" : "查看读取前草稿" }}
        </button>
      </div>
      <p v-if="state.blocked" class="notice-strip">
        已保留草稿。请先重新读取，核对最新结果后再编辑。
      </p>
      <p v-if="previous" class="notice-strip">
        读取前草稿，仅供核对。返回当前配置后可继续编辑。
      </p>
      <form v-if="draft" @submit.prevent="ctl.save()">
        <ProductOptionsGroups
          :groups="draft.specGroups"
          kind="spec"
          :disabled="disabled"
          @remove-group="removeNewOptionsGroup(draft, 'spec', $event)"
        />
        <section class="options-section">
          <div class="row">
            <h3>组合与价格</h3>
            <span class="muted">启用 {{ activeCount }} / 20</span>
          </div>
          <p class="muted">
            {{
              preview.total
                ? `规格共可搭配 ${preview.total} 种组合；按需添加，最多启用20种。`
                : "未启用规格维度时，用名称区分组合。"
            }}已有可售量通过库存入口单独调整。
          </p>
          <fieldset
            v-for="(sku, si) in draft.skus"
            :key="sku.id || 'new-' + si"
            class="option-card"
            :disabled="disabled"
          >
            <legend>
              组合 {{ si + 1 }} · {{ sku.enabled ? "已启用" : "已停用" }}
            </legend>
            <div class="form-grid">
              <label class="field"
                ><span>组合{{ si + 1 }}名称</span
                ><input v-model="sku.name" maxlength="80" /></label
              ><label class="field"
                ><span>组合{{ si + 1 }}售价（元）</span
                ><input v-model="sku.price" inputmode="decimal"
              /></label>
            </div>
            <label
              v-for="(group, gi) in draft.specGroups.filter(
                (g: any) => g.enabled,
              )"
              :key="optionsRef(group)"
              class="field"
              ><span
                >组合{{ si + 1 }} · 维度{{ gi + 1 }}
                {{ group.name || "未命名维度" }}</span
              ><select
                :value="
                  sku.selections.find(
                    (s: any) => s.groupRef === optionsRef(group),
                  )?.valueRef || ''
                "
                @change="
                  selectOptionsValue(
                    sku,
                    group,
                    ($event.target as HTMLSelectElement).value,
                  )
                "
              >
                <option value="">请选择</option>
                <option
                  v-for="value in group.values"
                  :key="optionsRef(value)"
                  :value="optionsRef(value)"
                  :disabled="!value.enabled"
                >
                  {{ value.name || "未命名"
                  }}{{ value.enabled ? "" : "（已停用）" }}
                </option>
              </select></label
            >
            <p v-if="sku.id" class="muted">
              可售 {{ sku.available }} · 预占 {{ sku.reserved }}
            </p>
            <label v-else class="field"
              ><span>组合{{ si + 1 }}初始库存</span
              ><input v-model="sku.initialStock" inputmode="numeric"
            /></label>
            <label class="option-toggle"
              ><input v-model="sku.enabled" type="checkbox" />启用组合{{
                si + 1
              }}</label
            ><button
              v-if="!sku.id"
              type="button"
              class="text-button"
              @click="draft.skus.splice(si, 1)"
            >
              移除未保存组合
            </button>
          </fieldset>
          <div v-if="preview.total" class="combination-preview">
            <strong>待添加组合预览</strong>
            <p v-if="!preview.items.length" class="muted">所有组合已配置。</p>
            <button
              v-for="(item, i) in preview.items"
              :key="i"
              type="button"
              class="quiet"
              :disabled="disabled || activeCount >= 20"
              @click="draft.skus.push(newOptionsSku(item))"
            >
              添加 {{ item.name }}
            </button>
          </div>
          <button
            v-else
            type="button"
            class="quiet"
            :disabled="disabled || activeCount >= 20"
            @click="draft.skus.push(newOptionsSku())"
          >
            添加组合
          </button>
        </section>
        <ProductOptionsGroups
          :groups="draft.attributeGroups"
          kind="attribute"
          :disabled="disabled"
          @remove-group="removeNewOptionsGroup(draft, 'attribute', $event)"
        />
        <section class="options-section">
          <div class="row">
            <h3>加料</h3>
            <button
              type="button"
              class="quiet"
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
            </button>
          </div>
          <p class="muted">加料另计价格并扣除自己的库存，库存调整立即生效。</p>
          <fieldset
            v-for="(item, mi) in draft.modifiers"
            :key="item.id || 'new-' + mi"
            :disabled="disabled"
            class="option-card"
          >
            <legend>
              加料 {{ mi + 1 }} · {{ item.enabled ? "已启用" : "已停用" }}
            </legend>
            <div class="form-grid">
              <label class="field"
                ><span>加料{{ mi + 1 }}名称</span
                ><input v-model="item.name" maxlength="80" /></label
              ><label class="field"
                ><span>加料{{ mi + 1 }}价格（元）</span
                ><input v-model="item.price" inputmode="decimal"
              /></label>
            </div>
            <label class="option-toggle"
              ><input v-model="item.enabled" type="checkbox" />启用加料{{
                mi + 1
              }}</label
            >
            <template v-if="item.id"
              ><p class="muted">
                可售 {{ item.available }} · 预占 {{ item.reserved }}
              </p>
              <label class="field"
                ><span>加料{{ mi + 1 }}可售库存</span
                ><input
                  v-model="inventory[item.id]"
                  inputmode="numeric" /></label
              ><button
                type="button"
                class="quiet"
                @click="ctl.saveInventory(item.id)"
              >
                保存加料{{ mi + 1 }}库存
              </button></template
            >
            <template v-else
              ><label class="field"
                ><span>加料{{ mi + 1 }}初始库存</span
                ><input
                  v-model="item.initialStock"
                  inputmode="numeric" /></label
              ><button
                type="button"
                class="text-button"
                @click="draft.modifiers.splice(mi, 1)"
              >
                移除未保存加料
              </button></template
            >
          </fieldset>
        </section>
        <div class="form-actions">
          <button
            type="button"
            class="quiet"
            :disabled="state.busy || state.loading"
            @click="emit('close')"
          >
            返回商品</button
          ><button class="primary" :disabled="disabled">
            {{ state.busy ? "保存中…" : "保存规格与口味" }}
          </button>
        </div>
      </form>
    </div>
  </Modal>
</template>
<style>
.modal:has(.product-options) {
  width: min(920px, 100%);
}
.product-options {
  font-size: 14px;
}
.product-options h3 {
  font-size: 18px;
  margin: 0;
}
.options-section {
  padding: 22px 0;
  border-top: 1px solid var(--line, #e4e8df);
  margin-top: 18px;
}
.option-card {
  margin: 16px 0;
  padding: 18px;
  border: 1px solid var(--line, #e4e8df);
  border-radius: 12px;
  min-width: 0;
}
.option-card legend {
  font-size: 14px;
  font-weight: 600;
  padding: 0 6px;
}
.option-value {
  display: grid;
  grid-template-columns: minmax(160px, 2fr) minmax(90px, 1fr) auto;
  gap: 12px;
  align-items: center;
  border-top: 1px solid #e9eade;
  padding-top: 12px;
  margin-top: 12px;
}
.option-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  margin: 8px 12px 12px 0;
}
.option-toggle input {
  width: 18px;
  height: 18px;
}
.product-options input,
.product-options select,
.product-options button,
.product-options p {
  font-size: 14px;
}
.combination-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
  align-items: center;
}
.combination-preview strong {
  width: 100%;
}
.options-recovery {
  flex-wrap: wrap;
  gap: 12px;
  margin: 16px 0;
}
@media (max-width: 600px) {
  .option-value {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .option-card {
    padding: 12px;
  }
  .product-options .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
