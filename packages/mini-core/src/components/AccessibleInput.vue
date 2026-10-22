<script setup>
import { ref, watchPostEffect, onMounted, onUnmounted, nextTick } from "vue";
const props = defineProps({
  modelValue: String,
  label: { type: String, required: true },
  inputId: { type: String, required: true },
  password: Boolean,
  disabled: Boolean,
  maxlength: { type: [Number, String], default: 140 },
  placeholder: String,
  autocomplete: String,
  confirmType: { type: String, default: "done" },
});
const emit = defineEmits(["update:modelValue", "confirm"]);
const root = ref(null);
// uni-h5 puts id/aria-label on its wrapper instead of the native input.
// Keep the native accessibility attributes in sync even when uni replaces it.
// #ifdef H5
let observer;
function nativeInput() {
  return (root.value?.$el || root.value)?.querySelector("input");
}
function bindAccessibility() {
  const element = root.value?.$el || root.value;
  element?.querySelector("uni-input")?.removeAttribute("aria-label");
  const input = nativeInput();
  if (input) {
    input.setAttribute("aria-label", props.label);
    input.id = `${props.inputId}-native`;
  }
}
watchPostEffect(() => {
  void props.label;
  void props.disabled;
  void props.password;
  nextTick(bindAccessibility);
});
onMounted(() => {
  bindAccessibility();
  const element = root.value?.$el || root.value;
  observer = new MutationObserver(bindAccessibility);
  observer.observe(element, { childList: true, subtree: true });
});
onUnmounted(() => observer?.disconnect());
// #endif
function focusInput() {
  // #ifdef H5
  if (!props.disabled) nativeInput()?.focus();
  // #endif
}
</script>
<template>
  <view ref="root" class="field">
    <label :for="inputId" class="label" @click="focusInput">{{ label }}</label>
    <input :id="inputId" :value="modelValue" :aria-label="label" :password="password" :disabled="disabled" :maxlength="maxlength" :placeholder="placeholder" :autocomplete="autocomplete" :confirm-type="confirmType" @input="emit('update:modelValue', $event.detail.value)" @confirm="emit('confirm')" />
    <slot />
  </view>
</template>
