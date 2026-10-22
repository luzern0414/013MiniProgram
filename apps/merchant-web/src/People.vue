<script setup lang="ts">
import { reactive, ref } from "vue";
import { Search, Users } from "lucide-vue-next";
import type { Store } from "./types";
import { useResource } from "./ui";
import { money } from "./domain.mjs";
import StateBlock from "./StateBlock.vue";
import StaffManager from "./StaffManager.vue";
const props = defineProps<{ store: Store; stores: Store[]; owner: boolean }>();
const tab = ref("members");
const search = ref("");
const query = ref("");
const members = reactive(
  useResource<
    {
      id: string;
      name: string;
      phone: string;
      levelName: string;
      balanceFen: number;
      points: number;
    }[]
  >(
    () =>
      `/merchant/members?storeId=${props.store.id}&search=${encodeURIComponent(query.value)}`,
  ),
);
</script>
<template>
  <section class="panel">
    <div class="toolbar">
      <div class="filter-tabs">
        <button
          :class="{ selected: tab === 'members' }"
          @click="tab = 'members'"
        >
          会员</button
        ><button
          v-if="owner"
          :class="{ selected: tab === 'staff' }"
          @click="tab = 'staff'"
        >
          门店员工
        </button>
      </div>
      <div class="spacer" />
      <form
        v-if="tab === 'members'"
        class="row"
        @submit.prevent="query = search"
      >
        <div class="search-field">
          <Search :size="18" /><input
            v-model="search"
            aria-label="搜索会员"
            maxlength="100"
            placeholder="会员姓名或手机号"
          />
        </div>
        <button class="quiet">查询</button>
      </form>
    </div>
    <StateBlock
      v-if="tab === 'members'"
      :loading="members.loading"
      :error="members.error"
      :empty="members.data?.length === 0"
      @retry="members.reload"
      ><template #empty>{{
        query ? "未找到匹配会员，请调整搜索内容。" : "暂无会员记录。"
      }}</template>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>会员</th>
              <th>手机号</th>
              <th>等级</th>
              <th>余额</th>
              <th>积分</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="member in members.data" :key="member.id">
              <td>
                <div class="row">
                  <span class="avatar soft"><Users :size="17" /></span
                  ><strong>{{ member.name }}</strong>
                </div>
              </td>
              <td>{{ member.phone || "未填写" }}</td>
              <td>{{ member.levelName || "普通会员" }}</td>
              <td class="amount">{{ money(member.balanceFen) }}</td>
              <td>{{ member.points }}</td>
            </tr>
          </tbody>
        </table>
      </div></StateBlock
    >
    <StaffManager v-else-if="owner" :store="store" :stores="stores" />
    <div class="table-footer">显示最多 100 条记录</div>
  </section>
</template>
