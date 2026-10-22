<script setup lang="ts">
import { reactive } from "vue";
import { Armchair } from "lucide-vue-next";
import type { Store } from "./types";
import { useResource } from "./ui";
import StateBlock from "./StateBlock.vue";
const props = defineProps<{ store: Store }>();
const tables = reactive(
  useResource<
    {
      id: string;
      name: string;
      capacity: number;
      status: string;
      code: string;
    }[]
  >(`/stores/${props.store.id}/tables`),
);
</script>
<template>
  <StateBlock
    :loading="tables.loading"
    :error="tables.error"
    :empty="tables.data?.length === 0"
    @retry="tables.reload"
    ><template #empty>暂无桌台，请联系管理员配置门店桌台。</template>
    <div class="table-grid">
      <article v-for="table in tables.data" :key="table.id" class="table-card">
        <div class="row between">
          <Armchair :size="24" /><span
            class="badge"
            :class="table.status === 'FREE' ? 'green' : 'orange'"
            >{{ table.status === "FREE" ? "空闲" : "使用中" }}</span
          >
        </div>
        <h2>{{ table.name }}</h2>
        <p class="muted">{{ table.capacity }} 人桌</p>
        <p>
          桌号标识 <strong>{{ table.code }}</strong>
        </p>
      </article>
    </div></StateBlock
  >
</template>
