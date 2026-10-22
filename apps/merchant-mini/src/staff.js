import { reactive } from "vue";
import { createClient, createStaffController } from "@restaurant/mini-core";
export function useStaff(storeId) {
  const state = reactive({});
  const client = createClient("merchant");
  const controller = createStaffController({ state, storeId, request: client.api });
  return { state, ...controller };
}
