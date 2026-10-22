<script setup>
import { onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { createClient, createCatalogController } from "@restaurant/mini-core";
import CatalogSettingsEditor from "./CatalogSettingsEditor.vue";
const props = defineProps({ store: Object, locked: Boolean });
const emit = defineEmits(["busy", "changed"]);
const state = reactive({}),
  kind = ref("categories");
const ctl = createCatalogController({
  state,
  request: createClient("merchant").api,
  storeId: () => props.store.id,
});
const names = (ids) =>
  ids === null
    ? "全部门店（含新门店）"
    : ids.length
      ? ids
          .map(
            (id) =>
              state.settings.stores.find((s) => s.id === id)?.name ||
              "其他门店",
          )
          .join("、")
      : "全部隐藏";
watch(
  () => state.busy,
  (value) => emit("busy", value),
  { flush: "sync" },
);
onMounted(ctl.load);
watch(
  () => state.notice,
  (value) => {
    if (value) emit("changed");
  },
);
onUnmounted(() => emit("busy", false));
</script>
<template>
  <view class="panel"
    ><view class="row"
      ><text class="sheet-title">分类与单位</text
      ><button
        class="small outline"
        :disabled="locked || state.loading || state.busy"
        @click="ctl.load"
      >
        刷新设置
      </button></view
    >
    <view class="setting-tabs"
      ><button
        class="small"
        :class="{ primary: kind === 'categories' }"
        :disabled="state.busy"
        @click="kind = 'categories'"
      >
        商品分类</button
      ><button
        class="small"
        :class="{ primary: kind === 'units' }"
        :disabled="state.busy"
        @click="kind = 'units'"
      >
        售卖单位
      </button></view
    >
    <text
      v-if="state.settings && !state.settings.canManageBrand"
      class="safe-note"
      >仅拥有全部门店权限的店主可维护品牌分类与单位。</text
    >
    <button
      v-if="state.settings?.canManageBrand"
      class="primary wide"
      :disabled="locked || state.busy || state.loading"
      @click="ctl.open(kind)"
    >
      新增{{ kind === "categories" ? "分类" : "单位" }}
    </button>
    <view v-if="state.loading" class="loading">正在读取分类与单位…</view
    ><view v-if="state.error && !state.mode" class="error" role="alert">{{
      state.error
    }}</view
    ><view v-if="state.notice" class="notice" role="status">{{
      state.notice
    }}</view>
    <view v-if="state.settings && !state.settings[kind].length" class="empty"
      >暂无{{ kind === "categories" ? "分类" : "单位" }}。</view
    >
    <view
      v-for="item in state.settings?.[kind]"
      :key="item.id"
      class="setting-item"
      ><view class="row"
        ><text class="label">{{ item.name }}</text
        ><text class="status">{{
          item.enabled ? "已启用" : "已停用"
        }}</text></view
      ><text class="safe-note"
        >引用 {{ item.productCount }} 件商品<template
          v-if="kind === 'categories'"
        >
          · 排序 {{ item.sort }}</template
        ></text
      ><text v-if="kind === 'categories'" class="safe-note"
        >可见门店：{{ names(item.visibleStoreIds) }}</text
      ><button
        v-if="state.settings.canManageBrand"
        class="small outline"
        :aria-label="`编辑${item.name}${kind === 'categories' ? '分类' : '单位'}`"
        :disabled="locked || state.busy"
        @click="ctl.open(kind, item)"
      >
        编辑
      </button></view
    >
  </view>
  <CatalogSettingsEditor
    v-if="state.mode"
    :state="state"
    :locked="locked"
    @close="ctl.close"
    @save="ctl.save()"
    @delete="ctl.save(true)"
    @reload="ctl.reloadEditor"
  />
</template>
<style scoped>
.setting-tabs {
  display: flex;
  gap: 8px;
  margin: 18px 0;
}
.setting-tabs button {
  margin: 0;
}
.setting-item {
  padding: 18px 0;
  border-bottom: 1px solid #e9eade;
}
.setting-item button {
  margin: 12px 0 0;
}
.safe-note {
  display: block;
  margin: 8px 0;
}
text,
button {
  font-size: 14px;
}
.sheet-title {
  font-size: 24px;
}
</style>
