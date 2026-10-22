<script setup lang="ts">
import { computed, ref } from "vue";
import Modal from "./Modal.vue";
const props = defineProps<{ state: any }>();
const emit = defineEmits(["close", "save", "delete", "reload"]);
const deleting = ref(false);
const label = computed(() =>
  props.state.kind === "categories" ? "分类" : "单位",
);
const disabled = computed(
  () => props.state.busy || props.state.loading || props.state.blocked,
);
</script>
<template>
  <Modal
    :title="(state.target ? '编辑' : '新增') + label"
    @close="!state.busy && emit('close')"
  >
    <form @submit.prevent="emit('save')">
      <fieldset :disabled="disabled" class="settings-fields">
        <label class="field"
          ><span>{{ label }}名称</span
          ><input
            v-model="state.form.name"
            required
            :maxlength="state.kind === 'categories' ? 80 : 20"
        /></label>
        <template v-if="state.target"
          ><label class="check-field"
            ><input type="checkbox" v-model="state.form.enabled" />启用{{
              label
            }}</label
          >
          <template v-if="state.kind === 'categories'"
            ><label class="field"
              ><span>排序（数字越小越靠前）</span
              ><input
                v-model="state.form.sort"
                type="number"
                required
                min="0"
                max="100000"
                step="1"
            /></label>
            <label class="check-field"
              ><input
                type="checkbox"
                v-model="state.form.allStores"
              />全部门店可见，包含未来新门店</label
            >
            <div v-if="!state.form.allStores" class="visibility">
              <span>可见门店（不选则全部隐藏）</span
              ><label
                v-for="store in state.settings?.stores"
                :key="store.id"
                class="check-field"
                ><input
                  type="checkbox"
                  v-model="state.form.visibleStoreIds"
                  :value="store.id"
                />{{ store.name }}</label
              >
            </div>
            <p class="muted">
              停用或隐藏分类后，顾客将无法购买该分类中的商品。
            </p></template
          >
          <p v-else class="muted">
            停用后，已有商品可继续保留此单位，新增或更换单位时不能选择。
          </p></template
        >
      </fieldset>
      <p v-if="state.error" class="error" role="alert">{{ state.error }}</p>
      <button
        v-if="state.blocked || (!state.settings && !state.loading)"
        type="button"
        class="quiet"
        :disabled="state.busy || state.loading"
        @click="emit('reload')"
      >
        重新加载并核对
      </button>
      <div v-if="deleting" class="delete-confirm">
        <p>确认删除「{{ state.target.name }}」？有商品引用时无法删除。</p>
        <button
          type="button"
          class="quiet"
          :disabled="disabled"
          @click="emit('delete')"
        >
          确认删除{{ label }}</button
        ><button
          type="button"
          class="quiet"
          :disabled="state.busy"
          @click="deleting = false"
        >
          保留
        </button>
      </div>
      <div class="form-actions">
        <button
          v-if="state.target && !deleting"
          type="button"
          class="quiet"
          :disabled="disabled"
          @click="deleting = true"
        >
          删除{{ label }}
        </button>
        <div class="spacer" />
        <button
          type="button"
          class="quiet"
          :disabled="state.busy"
          @click="emit('close')"
        >
          取消</button
        ><button class="primary" :disabled="disabled || !state.settings">
          {{ state.busy ? "保存中…" : "保存" + label }}
        </button>
      </div>
    </form>
  </Modal>
</template>
<style scoped>
.settings-fields {
  border: 0;
  padding: 0;
  margin: 0;
  font-size: 14px;
  min-width: 0;
}
.visibility {
  margin: 16px 0;
}
.delete-confirm {
  padding: 12px;
  background: #fff4ed;
  border-radius: 12px;
}
p,
button,
input,
span,
label {
  font-size: 14px;
}
</style>
