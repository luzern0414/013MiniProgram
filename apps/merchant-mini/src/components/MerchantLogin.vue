<script setup>
import { ref } from "vue";
import AccessibleInput from "./AccessibleInput.vue";
const props = defineProps({ config: Object, busy: Boolean, login: Function, staffLogin: Function, wechatLogin: Function });
const account = ref("");
const password = ref("");
async function submit() {
  if (props.busy) return;
  try { await props.staffLogin(account.value, password.value); }
  finally { password.value = ""; }
}
</script>
<template>
  <view class="panel auth">
    <text class="eyebrow">门店伙伴</text><text class="title">准备好，开餐了。</text>
    <text class="product-description">登录你的门店，处理订单与营业状态。</text>
    <form @submit="submit">
      <AccessibleInput v-model="account" input-id="staff-account" label="员工账号" :disabled="busy" maxlength="64" placeholder="请输入店主分配的账号" autocomplete="username" />
      <AccessibleInput v-model="password" input-id="staff-password" label="密码" :password="true" :disabled="busy" maxlength="128" placeholder="请输入密码" autocomplete="current-password" @confirm="submit" />
      <text v-if="!config.brandId" class="error">门店配置尚未就绪，请重新加载后登录。</text>
      <button class="primary wide" form-type="submit" :disabled="busy || !config.brandId">{{ busy ? '正在登录…' : '员工登录' }}</button>
    </form>
    <view class="space" /><button class="outline wide" :disabled="busy" @click="wechatLogin">微信登录</button>
    <template v-if="config.environment === 'development'">
      <view class="divider" /><text class="safe-note">体验身份仅用于本地体验门店。</text>
      <view class="stack"><button class="outline" :disabled="busy" @click="login('owner')">体验店主登录</button><button class="outline" :disabled="busy" @click="login('clerk-a')">体验店员 A 登录</button><button class="outline" :disabled="busy" @click="login('clerk-b')">体验店员 B 登录</button></view>
    </template>
  </view>
</template>
