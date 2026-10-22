<script setup lang="ts">
import { onMounted, onUnmounted, reactive, watch, ref } from "vue";
import { api } from "./api";
import type { Store } from "./types";
import {
  createPickupManager,
  pickupPreview,
  pickupWindowText,
  pickupErrorText,
} from "../../../packages/mini-core/src/pickup.mjs";
const props = defineProps<{ store: Store; owner: boolean }>();
const emit = defineEmits<{ busy: [value: boolean] }>();
const state = reactive<any>({});
const form = reactive({
  start: "12:00",
  end: "14:00",
  interval: "30",
  capacity: "10",
});
const ctl = createPickupManager({
  state,
  storeId: () => props.store.id,
  canEdit: () => props.owner,
  request: (path: string, options?: any) =>
    api(path, options ? { method: options.method, body: options.data } : {}),
});
const locked = () => state.busy || state.loading || state.blocked;
function preview() {
  try {
    state.preview = pickupPreview({ date: state.date, ...form });
    state.error = "";
  } catch (e) {
    state.error = pickupErrorText(e);
  }
}
watch(form, () => {
  if (!locked()) state.preview = [];
});
watch(
  () => [state.busy, state.loading, state.blocked],
  () => emit("busy", !!(state.busy || state.loading || state.blocked)),
  { flush: "sync" },
);
const showDraft = ref(false);
function preventClose(event: BeforeUnloadEvent) {
  if (state.busy || state.blocked) {
    event.preventDefault();
    event.returnValue = "";
  }
}
onMounted(() => {
  ctl.load();
  window.addEventListener("beforeunload", preventClose);
});
onUnmounted(() => {
  ctl.dispose();
  emit("busy", false);
  window.removeEventListener("beforeunload", preventClose);
});
</script>
<template>
  <section class="panel pickup-settings">
    <div class="row between">
      <div>
        <h2>预约自提</h2>
        <p class="muted">按时段安排接单容量 · 北京时间</p>
      </div>
      <button
        class="quiet"
        :disabled="state.busy || state.loading"
        @click="ctl.load"
      >
        {{ state.loading ? "读取中…" : "重新读取并核对" }}
      </button>
    </div>
    <p v-if="state.error" class="error-box" role="alert">{{ state.error }}</p>
    <p v-if="state.notice" class="success" role="status">{{ state.notice }}</p>
    <p v-if="!owner" class="notice-strip">
      你可以查看预约安排，修改请联系店主。
    </p>
    <p v-if="state.blocked" class="notice-strip">
      提交已锁定。请先重新读取，核对门店记录与原草稿后继续。
    </p>
    <form v-if="state.policy" @submit.prevent="ctl.savePolicy">
      <p v-if="state.missing" class="notice-strip">
        预约规则尚未建立。以下为待保存草稿，由店主明确保存后生效。
      </p>
      <fieldset :disabled="!owner || locked()">
        <legend>预约规则</legend>
        <label class="checkbox-field"
          ><input
            v-model="state.policy.enabled"
            type="checkbox"
          />允许预约自提</label
        >
        <div class="pickup-grid">
          <label class="field"
            ><span>至少提前（分钟）</span
            ><input
              v-model="state.policy.leadMinutes"
              type="number"
              min="0"
              max="1440"
              step="1"
              required /></label
          ><label class="field"
            ><span>最远可约（天）</span
            ><input
              v-model="state.policy.maxAdvanceDays"
              type="number"
              min="1"
              max="90"
              step="1"
              required
          /></label>
        </div>
        <p class="muted">关闭仅停止新预约，已成立订单仍按原取餐时间履约。</p>
        <button v-if="owner" class="primary">保存预约规则</button>
      </fieldset>
    </form>
    <label class="field"
      ><span>查看 / 新增日期（北京时间）</span
      ><input
        type="date"
        v-model="state.date"
        :disabled="locked()"
        @change="
          state.preview = [];
          ctl.load();
        "
    /></label>
    <div v-if="owner && state.policy && !state.missing">
      <h3>生成时段</h3>
      <fieldset :disabled="locked()">
        <div class="pickup-grid">
          <label class="field"
            ><span>开始时间</span
            ><input v-model="form.start" type="time" required /></label
          ><label class="field"
            ><span>结束时间</span
            ><input v-model="form.end" type="time" required /></label
          ><label class="field"
            ><span>间隔（分钟）</span
            ><input
              v-model="form.interval"
              type="number"
              min="5"
              max="240"
              step="1" /></label
          ><label class="field"
            ><span>每时段容量（单）</span
            ><input
              v-model="form.capacity"
              type="number"
              min="1"
              max="1000"
              step="1"
          /></label>
        </div>
        <button type="button" class="quiet" @click="preview">生成预览</button>
      </fieldset>
      <div v-if="state.preview.length" class="preview">
        <h3>待创建 · 共 {{ state.preview.length }} 个时段</h3>
        <p v-for="(slot, index) in state.preview" :key="index">
          {{ pickupWindowText(slot) }} · {{ slot.capacity }} 单
        </p>
        <button class="primary" :disabled="locked()" @click="ctl.createSlots">
          核对无误，创建时段
        </button>
      </div>
    </div>
    <h3>门店时段表 · {{ state.date }}</h3>
    <p class="muted">
      容量按订单笔数计算，不能低于待付款占用与已确认合计；已确认订单完成后仍计入容量。关闭时段不影响已成立订单；原时段只能调整容量或启停。
    </p>
    <p v-if="state.loading" class="muted">正在读取时段…</p>
    <p v-else-if="!state.slots.length" class="muted">该日暂无时段。</p>
    <div v-for="slot in state.slots" :key="slot.id" class="slot-row">
      <strong
        >{{ pickupWindowText(slot) }} ·
        {{ slot.enabled ? "开放中" : "已关闭" }}</strong
      >
      <p>
        待付款占用 {{ slot.heldCount }} · 已确认 {{ slot.confirmedCount }} ·
        剩余 {{ slot.capacity - slot.heldCount - slot.confirmedCount }}
      </p>
      <fieldset :disabled="!owner || locked()">
        <div class="row wrap">
          <label class="field"
            ><span>容量（单）</span
            ><input
              v-model="slot.draftCapacity"
              type="number"
              :min="Math.max(1, slot.heldCount + slot.confirmedCount)"
              max="1000"
              step="1" /></label
          ><label class="checkbox-field"
            ><input
              v-model="slot.draftEnabled"
              type="checkbox"
            />开放此时段</label
          ><button
            v-if="owner"
            class="quiet"
            @click="
              ctl.saveSlot(slot, {
                capacity: slot.draftCapacity,
                enabled: slot.draftEnabled,
              })
            "
          >
            保存时段
          </button>
        </div>
      </fieldset>
    </div>
    <template v-if="state.previousDraft"
      ><button class="text-button" @click="showDraft = !showDraft">
        {{ showDraft ? "收起" : "查看" }}上次提交 / 重读前草稿
      </button>
      <div v-if="showDraft" class="preview">
        <p>
          预约{{ state.previousDraft.policy?.enabled ? "开启" : "关闭" }} · 提前
          {{ state.previousDraft.policy?.leadMinutes }} 分钟 · 最远
          {{ state.previousDraft.policy?.maxAdvanceDays }} 天
        </p>
        <p v-for="(slot, index) in state.previousDraft.preview" :key="index">
          {{ pickupWindowText(slot) }} · {{ slot.capacity }} 单
        </p>
        <p v-for="slot in state.previousDraft.slots" :key="slot.id">
          {{ pickupWindowText(slot) }} · 草稿容量 {{ slot.draftCapacity }} 单 ·
          {{ slot.draftEnabled ? "开放" : "关闭" }}
        </p>
        <p class="muted">请对照门店时段表确认，已有时段请勿再次创建。</p>
      </div></template
    >
  </section>
</template>
<style scoped>
.pickup-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
  font-size: 14px;
  max-width: 1000px;
}
.pickup-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
legend {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 14px;
}
.slot-row,
.preview {
  padding: 16px;
  border: 1px solid #dce5dd;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.preview {
  background: #f3f8f4;
}
.slot-row .field {
  max-width: 180px;
}
.checkbox-field {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 14px;
}
@media (max-width: 600px) {
  .pickup-grid {
    grid-template-columns: 1fr;
  }
  .row {
    flex-wrap: wrap;
  }
}
</style>
