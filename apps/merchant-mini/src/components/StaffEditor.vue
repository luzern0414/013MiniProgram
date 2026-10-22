<script setup>
import { computed } from "vue";
import AccessibleInput from "./AccessibleInput.vue";
const props = defineProps({ state: Object, stores: Array, locked: Boolean });
const emit = defineEmits(["close", "submit", "reload"]);
const title = computed(() => ({ create: "新建员工", edit: "编辑员工", reset: "重设员工密码", toggle: props.state.target?.enabled ? "停用员工" : "启用员工" })[props.state.mode]);
const disabled = computed(() => props.locked || props.state.busy || props.state.conflict);
function changeGrants(event) { props.state.form.storeIds = event.detail.value; }
</script>
<template>
  <view class="panel staff-editor" role="dialog" :aria-label="title">
    <view class="row"><text class="sheet-title">{{ title }}</text><button class="small outline" :disabled="state.busy" @click="emit('close')">取消</button></view>
    <form @submit="emit('submit')">
      <template v-if="state.mode === 'create' || state.mode === 'edit'">
        <AccessibleInput v-model="state.form.name" input-id="staff-name" label="姓名" :disabled="disabled" maxlength="80" placeholder="员工姓名" />
        <AccessibleInput v-if="state.mode === 'create'" v-model="state.form.account" input-id="new-account" label="员工账号" :disabled="disabled" maxlength="64" placeholder="3至64位字母、数字、点、下划线或短横线" />
        <text v-else class="muted">账号：{{ state.target.account || '尚未设置' }}</text>
        <view class="field"><text class="label">授权门店</text><checkbox-group @change="changeGrants"><label v-for="store in stores" :key="store.id" class="grant"><checkbox :value="store.id" :checked="state.form.storeIds.includes(store.id)" :disabled="disabled" />{{ store.name }}</label></checkbox-group></view>
        <text class="safe-note">变更门店授权后，员工需重新登录。新建员工需包含当前门店。</text>
      </template>
      <AccessibleInput v-if="state.mode === 'create' || state.mode === 'reset'" v-model="state.form.password" input-id="new-password" :label="state.mode === 'reset' ? '新密码' : '初始密码'" :password="true" :disabled="disabled" maxlength="128" placeholder="12至128个字符" autocomplete="new-password"><text class="safe-note">首尾空格会保留。</text></AccessibleInput>
      <text v-if="state.mode === 'reset'" class="safe-note">确认重设「{{ state.target.name }}」的密码？旧密码和已登录会话将立即失效。</text>
      <text v-if="state.mode === 'toggle'" class="safe-note">{{ state.target.enabled ? `确认停用「${state.target.name}」？该员工将无法登录，已登录会话也会失效。` : `确认启用「${state.target.name}」？该员工可使用已有账号和密码登录。` }}</text>
      <view v-if="state.error" class="error" role="alert">{{ state.error }}</view>
      <button v-if="state.conflict" class="outline wide" :disabled="state.loading || state.busy" @click="emit('reload')">重新加载员工信息</button>
      <view class="space" /><button form-type="submit" class="primary wide" :disabled="disabled">{{ state.busy ? '正在保存…' : state.mode === 'toggle' ? (state.target.enabled ? '确认停用' : '确认启用') : state.mode === 'reset' ? '确认重设密码' : '保存员工' }}</button>
    </form>
  </view>
</template>
<style scoped>.grant { display: flex; align-items: center; padding: 12px 0; gap: 8px; font-size: 14px; } .staff-editor { border: 1px solid #d2d8cc; } .safe-note { display: block; }</style>
