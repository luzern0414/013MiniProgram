<script setup>
import AccessibleInput from "@restaurant/mini-core/components/AccessibleInput.vue";
defineOptions({ inheritAttrs: false });
</script>
<template>
  <AccessibleInput v-bind="$attrs">
    <slot />
  </AccessibleInput>
</template>
