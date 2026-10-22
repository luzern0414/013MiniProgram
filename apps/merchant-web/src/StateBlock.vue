<script setup lang="ts">
import { AlertCircle, RefreshCw, Inbox } from "lucide-vue-next";
import { ApiError } from "./api";
defineProps<{ loading?: boolean; error?: Error; empty?: boolean }>();
defineEmits<{ retry: [] }>();
</script>
<template>
  <div v-if="error" role="alert" class="error-box">
    <AlertCircle :size="20" />
    <div>
      <strong>{{ error.message }}</strong>
      <p v-if="error instanceof ApiError && error.requestId" class="muted">
        凭证 {{ error.requestId }}
      </p>
    </div>
    <button class="quiet" @click="$emit('retry')">
      <RefreshCw :size="16" />重试
    </button>
  </div>
  <div v-else-if="loading" role="status" aria-label="正在加载" class="skeleton">
    <i /><i /><i />
  </div>
  <div v-else-if="empty" class="empty">
    <Inbox :size="32" />
    <p><slot name="empty">暂无内容</slot></p>
  </div>
  <slot v-else />
</template>
