<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { X } from "lucide-vue-next";
const props = defineProps<{ title: string; locked?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const box = ref<HTMLElement>();
let previous: HTMLElement | null = null;
function key(event: KeyboardEvent) {
  if (event.key === "Escape" && !props.locked) emit("close");
  if (event.key !== "Tab" || !box.value) return;
  const nodes = Array.from(
    box.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
    ),
  );
  const first = nodes[0],
    last = nodes.at(-1);
  if (!first) {
    event.preventDefault();
    box.value.focus();
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
onMounted(() => {
  previous = document.activeElement as HTMLElement;
  box.value?.querySelector<HTMLElement>("input,button,select")?.focus();
  document.addEventListener("keydown", key);
});
onUnmounted(() => {
  document.removeEventListener("keydown", key);
  previous?.focus();
});
</script>
<template>
  <Teleport to="body"
    ><div class="modal-shade" @mousedown.self="!locked && emit('close')">
      <section
        ref="box"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        class="modal"
        tabindex="-1"
      >
        <div class="panel-title">
          <h2>{{ title }}</h2>
          <button
            type="button"
            aria-label="关闭"
            class="icon-button"
            :disabled="locked"
            @click="emit('close')"
          >
            <X />
          </button>
        </div>
        <slot />
      </section></div
  ></Teleport>
</template>
