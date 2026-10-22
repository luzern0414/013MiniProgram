<script setup lang="ts">
import { AlertCircle, CheckCircle2 } from "lucide-vue-next";
defineProps<{ error?: Error & {requestId?:string}; success?: string }>();
</script>
<template>
  <div v-if="error" role="alert" class="error-box">
    <AlertCircle :size="20" /><strong>{{ error.message }}<span v-if="error.requestId">（编号 {{ error.requestId }}）</span></strong>
  </div>
  <div v-if="success" role="status" class="success">
    <CheckCircle2 :size="18" />{{ success }}
  </div>
</template>
