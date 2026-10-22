<script setup lang="ts">
import { onMounted, reactive } from "vue";
import { api } from "./api";
import { createStaffController } from "../../../packages/mini-core/src/staff.mjs";
import type { Store } from "./types";
import StateBlock from "./StateBlock.vue";
import StaffEditor from "./StaffEditor.vue";
const props = defineProps<{ store: Store; stores: Store[] }>();
const state = reactive<any>({});
const controller = createStaffController({ state, storeId: () => props.store.id, request: (path: string, options?: any) => api<any>(path, options ? { method: options.method, body: options.data } : {}) });
const storeNames = (ids: string[]) => ids.map(id => props.stores.find(store => store.id === id)?.name || '其他授权门店').join('、');
onMounted(controller.load);
</script>
<template>
  <div class="toolbar"><p class="muted">员工可登录并处理已授权门店的经营事务。</p><div class="spacer" /><button class="primary" :disabled="state.loading || state.busy" @click="controller.open()">新建员工</button><button class="quiet" :disabled="state.loading || state.busy" @click="controller.load">刷新员工</button></div>
  <div v-if="state.notice" class="success" role="status">{{ state.notice }}</div>
  <StateBlock :loading="state.loading" :error="!state.mode && state.error ? new Error(state.error) : undefined" :empty="state.items.length === 0" @retry="controller.load"><template #empty>此门店暂无员工。</template>
    <div class="table-wrap"><table><thead><tr><th>员工</th><th>账号</th><th>状态</th><th>授权门店</th><th>操作</th></tr></thead><tbody><tr v-for="person in state.items" :key="person.id"><td><strong>{{ person.name }}</strong><p class="muted">{{ person.role === 'OWNER' ? '店主' : '店员' }}</p></td><td>{{ person.account || '体验身份' }}</td><td><span class="badge" :class="person.enabled ? 'green' : 'neutral'">{{ person.enabled ? '已启用' : '已停用' }}</span></td><td>{{ storeNames(person.storeIds) }}</td><td><div v-if="person.role === 'CLERK'" class="row staff-actions"><button class="quiet" :disabled="state.busy" @click="controller.open(person)">编辑</button><button class="quiet" :disabled="state.busy" @click="controller.open(person, 'toggle')">{{ person.enabled ? '停用' : '启用' }}</button><button v-if="person.account" class="quiet" :disabled="state.busy" @click="controller.open(person, 'reset')">重设密码</button><span v-else class="muted">体验身份</span></div><span v-else class="muted">店主账号</span></td></tr></tbody></table></div>
  </StateBlock>
  <StaffEditor v-if="state.mode" :state="state" :stores="stores" @close="controller.close" @submit="controller.save" @reload="controller.reloadEditor" />
</template>
<style scoped>.staff-actions { flex-wrap: wrap; } th, td, button, p { font-size: 14px; }</style>
