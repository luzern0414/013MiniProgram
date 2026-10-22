<script setup>
import { onMounted, onUnmounted, watch } from "vue";
import { useStaff } from "../staff.js";
import StaffEditor from "./StaffEditor.vue";
const props = defineProps({ store: Object, stores: Array, locked: Boolean });
const emit = defineEmits(["busy"]);
const { state, open, close, load, save, reloadEditor } = useStaff(() => props.store.id);
const names = ids => ids.map(id => props.stores.find(store => store.id === id)?.name || "其他授权门店").join("、");
watch(() => state.busy, value => emit("busy", value));
onUnmounted(() => { state.form.password = ""; emit("busy", false); });
onMounted(load);
</script>
<template>
  <view class="panel"><view class="row"><text class="sheet-title">门店员工</text><button class="small outline" :disabled="locked || state.loading || state.busy" @click="load">刷新</button></view>
    <text class="safe-note">员工可登录并处理已授权门店的经营事务。</text><view class="space" />
    <button class="primary wide" :disabled="locked || state.loading || state.busy" @click="open()">新建员工</button>
    <view v-if="state.notice" class="notice" role="status">{{ state.notice }}</view>
    <view v-if="state.error && !state.mode" class="error" role="alert">{{ state.error }}</view>
    <view v-if="state.loading" class="loading">正在读取员工…</view>
    <view v-else-if="!state.items.length && !state.error" class="empty">此门店暂无员工。</view>
    <template v-if="!state.mode"><view v-for="person in state.items" :key="person.id" class="staff-person">
      <view class="row"><text class="label">{{ person.name }} · {{ person.role === 'OWNER' ? '店主' : '店员' }}</text><text class="status">{{ person.enabled ? '已启用' : '已停用' }}</text></view>
      <text class="muted">{{ person.account ? '账号：' + person.account : '体验身份' }}</text><text class="safe-note">授权：{{ names(person.storeIds) }}</text>
      <view v-if="person.role === 'CLERK'" class="staff-actions"><button class="small outline" :disabled="locked || state.busy" @click="open(person)">编辑</button><button class="small outline" :disabled="locked || state.busy" @click="open(person, 'toggle')">{{ person.enabled ? '停用' : '启用' }}</button><button v-if="person.account" class="small outline" :disabled="locked || state.busy" @click="open(person, 'reset')">重设密码</button><text v-else class="safe-note">体验身份</text></view>
    </view></template>
  </view>
  <StaffEditor v-if="state.mode" :state="state" :stores="stores" :locked="locked" @close="close" @submit="save" @reload="reloadEditor" />
</template>
<style scoped>.staff-person { padding: 20px 0; border-bottom: 1px solid #e9eade; } .staff-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; } .staff-actions button { margin: 0; } .staff-person .muted { display: block; margin: 8px 0; }</style>
