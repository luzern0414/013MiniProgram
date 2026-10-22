import { ref, shallowRef, watch, toValue, type MaybeRefOrGetter } from "vue";
import { api } from "./api";
export function useResource<T>(path: MaybeRefOrGetter<string>) {
  const data = shallowRef<T>();
  const error = shallowRef<Error>();
  const loading = ref(true);
  const version = ref(0);
  watch(
    [() => toValue(path), version],
    async ([url], _, onCleanup) => {
      let active = true;
      onCleanup(() => {
        active = false;
      });
      loading.value = true;
      error.value = undefined;
      data.value = undefined;
      try {
        const result = await api<T>(url);
        if (active) data.value = result;
      } catch (e) {
        if (active) error.value = e as Error;
      } finally {
        if (active) loading.value = false;
      }
    },
    { immediate: true },
  );
  return { data, error, loading, reload: () => version.value++ };
}
export function useMutation() {
  const busy = ref(false);
  const error = shallowRef<Error>();
  const success = ref("");
  async function run(action: () => Promise<void>, message = "已保存") {
    if (busy.value) return;
    busy.value = true;
    error.value = undefined;
    success.value = "";
    try {
      await action();
      success.value = message;
    } catch (e) {
      error.value = e instanceof Error ? e : new Error("操作失败，请重试。");
    } finally {
      busy.value = false;
    }
  }
  return {
    busy,
    error,
    success,
    run,
    clear: () => {
      error.value = undefined;
      success.value = "";
    },
  };
}
