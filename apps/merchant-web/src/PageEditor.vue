<script setup lang="ts">
import { computed, reactive, watch, ref } from "vue";
import { Smartphone, ArrowUpRight, Upload, Save } from "lucide-vue-next";
import { api } from "./api";
import type { Store, PageData, PageContent } from "./types";
import { useResource, useMutation } from "./ui";
import Feedback from "./Feedback.vue";
import StateBlock from "./StateBlock.vue";
import { samePageContent } from "./domain.mjs";
const props = defineProps<{ store: Store; owner: boolean }>();
const page = reactive(
  useResource<PageData>(`/merchant/page?storeId=${props.store.id}`),
);
const publicPage = reactive(
  useResource<{
    home: { notice: string; bannerTitle: string; bannerSubtitle: string };
    theme: { primaryColor: string };
  }>(`/public-config?storeId=${props.store.id}`),
);
const mutation = reactive(useMutation());
const draft = reactive<PageContent>({
  notice: "",
  bannerTitle: "",
  bannerSubtitle: "",
  primaryColor: "#c66336",
});
const preview = ref("published");
watch(
  () => page.data,
  (data) => {
    if (data) Object.assign(draft, data.draft);
  },
  { immediate: true },
);
const dirty = computed(
  () => !!page.data && !samePageContent(draft, page.data.draft),
);
const canPublish = computed(
  () =>
    !dirty.value &&
    !!page.data &&
    !samePageContent(page.data.draft, page.data.published),
);
const current = computed(() =>
  preview.value === "draft"
    ? draft
    : publicPage.data
      ? {
          ...publicPage.data.home,
          primaryColor: publicPage.data.theme.primaryColor,
        }
      : undefined,
);
function save() {
  mutation.run(async () => {
    page.data = await api<PageData>(
      `/merchant/page?storeId=${props.store.id}`,
      { method: "PUT", body: { ...draft } },
    );
  }, "草稿已保存，发布后顾客可见。");
}
function publish() {
  mutation.run(async () => {
    page.data = await api<PageData>(
      `/merchant/page/publish?storeId=${props.store.id}`,
      { method: "POST", body: { expectedVersion: page.data!.version } },
    );
    publicPage.reload();
    preview.value = "published";
  }, "页面已发布");
}
</script>
<template>
  <StateBlock :loading="page.loading" :error="page.error" @retry="page.reload"
    ><div class="editor-layout">
      <section class="panel">
        <div class="panel-title">
          <div>
            <h2>首页内容</h2>
            <p class="muted">
              {{
                dirty
                  ? "有未保存的修改"
                  : `已保存 · 版本 ${page.data?.version ?? "—"}`
              }}
            </p>
          </div>
          <button
            class="text-button"
            :disabled="mutation.busy"
            @click="
              page.reload();
              publicPage.reload();
            "
          >
            重新加载
          </button>
        </div>
        <form class="settings-form" @submit.prevent="save">
          <label class="field"
            ><span>首页标题</span
            ><input
              v-model="draft.bannerTitle"
              maxlength="100"
              :disabled="!owner || mutation.busy" /></label
          ><label class="field"
            ><span>首页副标题</span
            ><textarea
              v-model="draft.bannerSubtitle"
              maxlength="200"
              rows="3"
              :disabled="!owner || mutation.busy"
            /></label
          ><label class="field"
            ><span>公告</span
            ><textarea
              v-model="draft.notice"
              maxlength="1000"
              rows="3"
              :disabled="!owner || mutation.busy"
            /></label
          ><label class="field"
            ><span>页面主题色</span>
            <div class="row">
              <input
                type="color"
                v-model="draft.primaryColor"
                :disabled="!owner || mutation.busy"
              /><span>{{ draft.primaryColor }}</span>
            </div></label
          ><Feedback :error="mutation.error" :success="mutation.success" />
          <p v-if="!owner" class="muted">
            页面内容由店主管理，当前可查看已发布内容。
          </p>
          <div v-else class="form-actions">
            <button
              type="submit"
              class="quiet"
              :disabled="mutation.busy || !dirty"
            >
              <Save :size="16" />保存草稿</button
            ><button
              type="button"
              class="primary"
              :disabled="mutation.busy || !canPublish"
              @click="publish"
            >
              <Upload :size="16" />{{ mutation.busy ? "处理中…" : "发布页面" }}
            </button>
          </div>
          <p v-if="dirty" class="muted">先保存草稿，再发布到顾客首页。</p>
        </form>
      </section>
      <section class="preview-column">
        <div class="row between">
          <h2><Smartphone :size="19" />页面预览</h2>
          <div class="filter-tabs">
            <button
              :class="{ selected: preview === 'published' }"
              @click="preview = 'published'"
            >
              已发布</button
            ><button
              :class="{ selected: preview === 'draft' }"
              @click="preview = 'draft'"
            >
              当前草稿
            </button>
          </div>
        </div>
        <StateBlock
          :loading="preview === 'published' && publicPage.loading"
          :error="preview === 'published' ? publicPage.error : undefined"
          @retry="publicPage.reload"
          ><div v-if="current" class="phone-preview">
            <div class="phone-top"><span>门店首页</span><span>•••</span></div>
            <div
              class="preview-hero"
              :style="{ background: current.primaryColor }"
            >
              <p>{{ store.name }}</p>
              <h2>{{ current.bannerTitle || "未设置标题" }}</h2>
              <p>{{ current.bannerSubtitle }}</p>
              <ArrowUpRight :size="35" />
            </div>
            <div class="preview-body">
              <span class="badge" :class="store.isOpen ? 'green' : 'neutral'">{{
                store.isOpen ? "营业中" : "休息中"
              }}</span>
              <h3>{{ store.name }}</h3>
              <p class="muted">{{ store.address }}</p>
              <div v-if="current.notice" class="preview-notice">
                {{ current.notice }}
              </div>
              <div class="preview-service">
                <span>到店自取</span
                ><span>{{ store.pickupMinutes }} 分钟备餐</span>
              </div>
            </div>
          </div></StateBlock
        >
        <p class="muted">
          {{
            preview === "published"
              ? "当前顾客可见的已发布内容"
              : "草稿预览，顾客暂不可见"
          }}
        </p>
      </section>
    </div></StateBlock
  >
</template>
