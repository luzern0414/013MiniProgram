<script setup lang="ts">
import { ref } from "vue";
import { api } from "./api";
import { staffLoginPayload, staffErrorText } from "../../../packages/mini-core/src/staff.mjs";
const props = defineProps<{ config: { brandId: string; environment: string }; devLogin: boolean; disabled?: boolean }>();
const emit = defineEmits<{ authenticated: [token: string] }>();
const account = ref("");
const password = ref("");
const devAccount = ref("owner");
const busy = ref(false);
const error = ref("");
async function login(development = false) {
  if (busy.value || props.disabled) return;
  busy.value = true;
  error.value = "";
  try {
    const result = await api<{ token: string; environment: string }>(development ? "/auth/dev-login" : "/auth/staff-login", {
      method: "POST",
      body: development ? { account: devAccount.value } : staffLoginPayload(props.config, account.value, password.value),
    });
    if (development && result.environment !== "development") throw new Error("登录环境不匹配，请联系管理员");
    emit("authenticated", result.token);
  } catch (e) { error.value = staffErrorText(e, true); }
  finally { password.value = ""; busy.value = false; }
}
</script>
<template>
  <div v-if="error" class="error-box" role="alert">{{ error }}</div>
  <form @submit.prevent="login()">
    <label class="field"><span>员工账号</span><input v-model="account" required maxlength="64" autocomplete="username" autocapitalize="none" :disabled="busy || disabled" placeholder="请输入店主分配的账号" /></label>
    <label class="field"><span>密码</span><input v-model="password" required type="password" minlength="12" maxlength="128" autocomplete="current-password" :disabled="busy || disabled" /></label>
    <button class="primary large" :disabled="busy || disabled || !config.brandId">{{ busy ? "正在登录…" : "员工登录" }}</button>
    <p v-if="!config.brandId" class="error-box">门店配置尚未就绪，请重新加载后登录。</p>
  </form>
  <form v-if="devLogin" class="dev-login" @submit.prevent="login(true)">
    <div class="environment-label">开发体验环境</div>
    <label class="field"><span>体验身份</span><select v-model="devAccount" :disabled="busy || disabled"><option value="owner">体验店主 · 全部门店</option><option value="clerk-a">梧桐里店员 · 授权门店</option><option value="clerk-b">湖滨店员 · 授权门店</option></select></label>
    <button class="quiet large" :disabled="busy || disabled">进入体验工作台</button>
  </form>
</template>
<style scoped>.dev-login { margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--line, #e7e2da); } input, select, button, p { font-size: 14px; }</style>
