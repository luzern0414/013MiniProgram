<script setup>
import { computed, ref } from "vue";
import AccessibleInput from "./AccessibleInput.vue";
const props = defineProps({ state: Object, locked: Boolean });
const emit = defineEmits(["close", "save", "delete", "reload"]);
const deleting = ref(false);
const label = computed(() =>
  props.state.kind === "categories" ? "分类" : "单位",
);
const disabled = computed(
  () =>
    props.locked ||
    props.state.busy ||
    props.state.loading ||
    props.state.blocked,
);
const visibility = (e) => (props.state.form.visibleStoreIds = e.detail.value);
</script>
<template>
  <view class="overlay"
    ><view
      class="sheet"
      role="dialog"
      :aria-label="(state.target ? '编辑' : '新增') + label"
      ><view class="row"
        ><text class="sheet-title">{{
          (state.target ? "编辑" : "新增") + label
        }}</text
        ><button
          class="small outline"
          :disabled="state.busy"
          @click="emit('close')"
        >
          取消
        </button></view
      >
      <form @submit="emit('save')">
        <AccessibleInput
          v-model="state.form.name"
          input-id="catalog-setting-name"
          :label="label + '名称'"
          :maxlength="state.kind === 'categories' ? 80 : 20"
          :disabled="disabled"
        />
        <template v-if="state.target"
          ><view class="row setting-control"
            ><text class="label">启用{{ label }}</text
            ><switch
              :checked="state.form.enabled"
              :disabled="disabled"
              @change="state.form.enabled = $event.detail.value"
          /></view>
          <template v-if="state.kind === 'categories'"
            ><AccessibleInput
              v-model="state.form.sort"
              input-id="catalog-sort"
              label="排序（数字越小越靠前）"
              :disabled="disabled"
              maxlength="6"
            />
            <view class="row setting-control"
              ><text class="label">全部门店可见（含新门店）</text
              ><switch
                :checked="state.form.allStores"
                :disabled="disabled"
                @change="state.form.allStores = $event.detail.value"
            /></view>
            <view v-if="!state.form.allStores" class="field"
              ><text class="label">可见门店（不选则全部隐藏）</text
              ><checkbox-group @change="visibility"
                ><label
                  v-for="store in state.settings?.stores"
                  :key="store.id"
                  class="grant"
                  ><checkbox
                    :value="store.id"
                    :checked="state.form.visibleStoreIds.includes(store.id)"
                    :disabled="disabled"
                  />{{ store.name }}</label
                ></checkbox-group
              ></view
            >
            <text class="safe-note"
              >停用或隐藏分类后，顾客将无法购买该分类中的商品。</text
            ></template
          ><text v-else class="safe-note"
            >停用后，已有商品可继续保留此单位，新增或更换单位时不能选择。</text
          ></template
        >
        <view v-if="state.error" class="error" role="alert">{{
          state.error
        }}</view
        ><button
          v-if="state.blocked"
          class="outline wide"
          :disabled="state.busy || state.loading"
          @click="emit('reload')"
        >
          重新加载并核对
        </button>
        <view v-if="deleting" class="delete-confirm"
          ><text class="safe-note"
            >确认删除「{{ state.target.name }}」？有商品引用时无法删除。</text
          ><button
            class="outline wide"
            :disabled="disabled"
            @click="emit('delete')"
          >
            确认删除{{ label }}</button
          ><button
            class="link"
            :disabled="state.busy"
            @click="deleting = false"
          >
            保留
          </button></view
        >
        <view class="space" /><button
          form-type="submit"
          class="primary wide"
          :disabled="disabled || !state.settings"
        >
          {{ state.busy ? "保存中…" : "保存" + label }}</button
        ><button
          v-if="state.target && !deleting"
          class="link"
          :disabled="disabled"
          @click="deleting = true"
        >
          删除{{ label }}
        </button>
      </form></view
    ></view
  >
</template>
<style scoped>
.grant {
  display: flex;
  align-items: center;
  padding: 12px 0;
  gap: 8px;
}
.setting-control {
  margin: 18px 0;
}
.safe-note {
  display: block;
  margin: 12px 0;
}
text,
button,
label {
  font-size: 14px;
}
.delete-confirm {
  padding: 12px;
  background: #fff4ed;
  border-radius: 12px;
}
.sheet-title {
  font-size: 24px;
}
</style>
