<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { api } from "./api";
import { createCatalogController } from "../../../packages/mini-core/src/catalog-settings.mjs";
import CatalogSettingsEditor from "./CatalogSettingsEditor.vue";
import StateBlock from "./StateBlock.vue";
const props = defineProps<{ storeId: string }>();
const emit = defineEmits(["changed"]);
const state = reactive<any>({});
const kind = ref("categories");
const ctl = createCatalogController({
  state,
  storeId: () => props.storeId,
  request: (path: string, options?: any) =>
    api<any>(
      path,
      options ? { method: options.method, body: options.data } : {},
    ),
});
const names = (ids: string[] | null) =>
  ids === null
    ? "全部门店（含新门店）"
    : ids.length
      ? ids
          .map(
            (id) =>
              state.settings.stores.find((s: any) => s.id === id)?.name ||
              "其他门店",
          )
          .join("、")
      : "全部隐藏";
onMounted(ctl.load);
watch(
  () => state.notice,
  (value) => {
    if (value) emit("changed");
  },
);
</script>
<template>
  <section class="panel catalog-settings">
    <div class="toolbar">
      <button
        class="quiet"
        :aria-pressed="kind === 'categories'"
        @click="kind = 'categories'"
      >
        商品分类</button
      ><button
        class="quiet"
        :aria-pressed="kind === 'units'"
        @click="kind = 'units'"
      >
        售卖单位
      </button>
      <div class="spacer" />
      <button
        v-if="state.settings?.canManageBrand"
        class="primary"
        :disabled="state.busy || state.loading"
        @click="ctl.open(kind)"
      >
        新增{{ kind === "categories" ? "分类" : "单位" }}</button
      ><button
        class="quiet"
        :disabled="state.busy || state.loading"
        @click="ctl.load"
      >
        刷新分类与单位
      </button>
    </div>
    <p v-if="state.settings && !state.settings.canManageBrand" class="muted">
      仅拥有全部门店权限的店主可维护品牌分类与单位。
    </p>
    <p v-if="state.notice" class="success" role="status">{{ state.notice }}</p>
    <StateBlock
      :loading="state.loading"
      :error="!state.mode && state.error ? new Error(state.error) : undefined"
      :empty="!state.settings?.[kind]?.length"
      @retry="ctl.load"
      ><template #empty
        >暂无{{ kind === "categories" ? "分类" : "单位" }}。</template
      >
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>状态</th>
              <th>引用商品</th>
              <template v-if="kind === 'categories'"
                ><th>排序</th>
                <th>可见门店</th></template
              >
              <th v-if="state.settings?.canManageBrand">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in state.settings?.[kind]" :key="item.id">
              <td>
                <strong>{{ item.name }}</strong>
              </td>
              <td>
                <span
                  class="badge"
                  :class="item.enabled ? 'green' : 'neutral'"
                  >{{ item.enabled ? "已启用" : "已停用" }}</span
                >
              </td>
              <td>{{ item.productCount }} 件</td>
              <template v-if="kind === 'categories'"
                ><td>{{ item.sort }}</td>
                <td>{{ names(item.visibleStoreIds) }}</td></template
              >
              <td v-if="state.settings?.canManageBrand">
                <button
                  class="quiet"
                  :aria-label="`编辑${item.name}${kind === 'categories' ? '分类' : '单位'}`"
                  :disabled="state.busy"
                  @click="ctl.open(kind, item)"
                >
                  编辑
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </StateBlock>
  </section>
  <CatalogSettingsEditor
    v-if="state.mode"
    :state="state"
    @close="ctl.close"
    @save="ctl.save()"
    @delete="ctl.save(true)"
    @reload="ctl.reloadEditor"
  />
</template>
<style scoped>
.catalog-settings {
  margin-top: 20px;
}
.catalog-settings button,
.catalog-settings p,
.catalog-settings th,
.catalog-settings td {
  font-size: 14px;
}
button[aria-pressed="true"] {
  background: #edf3ed;
  color: #28523b;
}
</style>
