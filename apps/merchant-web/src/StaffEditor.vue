<script setup lang="ts">
import type { Store } from "./types";
import Modal from "./Modal.vue";
defineProps<{ state: any; stores: Store[] }>();
const emit = defineEmits<{ close: []; submit: []; reload: [] }>();
</script>
<template>
  <Modal :title="state.mode === 'create' ? '新建员工' : state.mode === 'reset' ? '重设员工密码' : state.mode === 'toggle' ? (state.target.enabled ? '停用员工' : '启用员工') : '编辑员工'" @close="!state.busy && emit('close')">
    <form class="staff-form" @submit.prevent="emit('submit')">
      <fieldset :disabled="state.busy || state.conflict">
        <template v-if="state.mode === 'create' || state.mode === 'edit'">
          <label class="field"><span>姓名</span><input v-model="state.form.name" required maxlength="80" autocomplete="off" /></label>
          <label v-if="state.mode === 'create'" class="field"><span>员工账号</span><input v-model="state.form.account" required minlength="3" maxlength="64" autocomplete="off" autocapitalize="none" placeholder="3至64位字母、数字、点、下划线或短横线" /></label>
          <p v-else class="muted">账号：{{ state.target.account || '尚未设置' }}</p>
          <div class="field"><span>授权门店</span><label v-for="store in stores" :key="store.id" class="grant"><input v-model="state.form.storeIds" type="checkbox" :value="store.id" />{{ store.name }}</label></div>
          <p class="muted">变更门店授权后，该员工需要重新登录。新建员工需包含当前门店。</p>
        </template>
        <label v-if="state.mode === 'create' || state.mode === 'reset'" class="field"><span>{{ state.mode === 'reset' ? '新密码' : '初始密码' }}</span><input v-model="state.form.password" required type="password" minlength="12" maxlength="128" autocomplete="new-password" /><span class="muted">12至128个字符，首尾空格会保留。</span></label>
        <p v-if="state.mode === 'reset'">确认重设「{{ state.target.name }}」的密码？旧密码和已登录的会话将立即失效。</p>
        <p v-if="state.mode === 'toggle'">{{ state.target.enabled ? `确认停用「${state.target.name}」？该员工将无法登录，已登录的会话也会失效。` : `确认启用「${state.target.name}」？该员工可使用已有账号和密码登录。` }}</p>
      </fieldset>
      <div v-if="state.error" class="error-box" role="alert">{{ state.error }}</div>
      <button v-if="state.conflict" type="button" class="quiet" :disabled="state.loading || state.busy" @click="emit('reload')">重新加载员工信息</button>
      <div class="modal-actions"><button type="button" class="quiet" :disabled="state.busy" @click="emit('close')">取消</button><button class="primary" :disabled="state.busy || state.conflict">{{ state.busy ? '正在保存…' : state.mode === 'toggle' ? (state.target.enabled ? '确认停用' : '确认启用') : state.mode === 'reset' ? '确认重设密码' : '保存员工' }}</button></div>
    </form>
  </Modal>
</template>
<style scoped>
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; } .staff-form { font-size: 14px; } .grant { display: flex; align-items: center; gap: 10px; padding: 9px 0; } .grant input { width: 18px; height: 18px; } p { line-height: 1.7; } .modal-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
</style>
