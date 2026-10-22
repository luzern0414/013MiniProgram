<script setup>
import { onMounted, onUnmounted, reactive, watch, ref } from "vue";
import AccessibleInput from "./AccessibleInput.vue";
import {
  createClient,
  createPickupManager,
  pickupPreview,
  pickupWindowText,
  pickupErrorText,
} from "@restaurant/mini-core";
const props = defineProps({ store: Object, owner: Boolean, locked: Boolean });
const emit = defineEmits(["busy"]);
const state = reactive({});
const form = reactive({
  start: "12:00",
  end: "14:00",
  interval: "30",
  capacity: "10",
});
const ctl = createPickupManager({
  state,
  storeId: () => props.store.id,
  canEdit: () => props.owner && !props.locked,
  request: createClient("merchant").api,
});
const locked = () =>
  props.locked || state.busy || state.loading || state.blocked;
function preview() {
  try {
    state.preview = pickupPreview({ date: state.date, ...form });
    state.error = "";
  } catch (e) {
    state.error = pickupErrorText(e);
  }
}
function dateChanged(event) {
  state.date = event.detail.value;
  state.preview = [];
  ctl.load();
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
onMounted(ctl.load);
onUnmounted(() => {
  ctl.dispose();
  emit("busy", false);
});
</script>
<template>
  <view class="panel pickup-settings">
    <view class="row"
      ><text class="sheet-title">预约自提</text
      ><button
        class="small outline"
        :disabled="props.locked || state.busy || state.loading"
        @click="ctl.load"
      >
        {{ state.loading ? "读取中…" : "重新读取并核对" }}
      </button></view
    >
    <text class="safe-note">按时段安排接单容量 · 北京时间</text>
    <text v-if="state.error" class="error" role="alert">{{ state.error }}</text
    ><text v-if="state.notice" class="notice">{{ state.notice }}</text>
    <text v-if="!owner" class="notice"
      >你可以查看预约安排，修改请联系店主。</text
    >
    <text v-if="state.blocked" class="notice"
      >提交已锁定。请先重新读取，核对门店记录与原草稿后继续。</text
    >
    <view v-if="state.policy" class="pickup-section">
      <text class="label">预约规则</text
      ><text v-if="state.missing" class="notice"
        >预约规则尚未建立。以下为待保存草稿，由店主明确保存后生效。</text
      >
      <view class="row"
        ><label :for="'pickup-enabled-' + store.id">允许预约自提</label
        ><switch
          :id="'pickup-enabled-' + store.id"
          :checked="state.policy.enabled"
          :disabled="!owner || locked()"
          @change="state.policy.enabled = $event.detail.value"
      /></view>
      <AccessibleInput
        :input-id="'pickup-lead-' + store.id"
        :modelValue="String(state.policy.leadMinutes)"
        @update:modelValue="state.policy.leadMinutes = $event"
        label="至少提前（分钟）"
        :disabled="!owner || locked()"
      />
      <AccessibleInput
        :input-id="'pickup-days-' + store.id"
        :modelValue="String(state.policy.maxAdvanceDays)"
        @update:modelValue="state.policy.maxAdvanceDays = $event"
        label="最远可约（天）"
        :disabled="!owner || locked()"
      />
      <text class="safe-note"
        >提前0至1440分钟，最远1至90天。关闭仅停止新预约，已成立订单仍按原取餐时间履约。</text
      >
      <button
        v-if="owner"
        class="primary wide"
        :disabled="locked()"
        @click="ctl.savePolicy"
      >
        保存预约规则
      </button>
    </view>
    <picker
      mode="date"
      :value="state.date"
      :disabled="locked()"
      @change="dateChanged"
      ><view class="store-picker"
        >查看 / 新增日期：{{ state.date }}⌄</view
      ></picker
    >
    <view v-if="owner && state.policy && !state.missing" class="pickup-section">
      <text class="label">生成时段</text>
      <view class="row"
        ><picker
          mode="time"
          :value="form.start"
          :disabled="locked()"
          @change="form.start = $event.detail.value"
          ><view class="store-picker">开始 {{ form.start }}⌄</view></picker
        ><picker
          mode="time"
          :value="form.end"
          :disabled="locked()"
          @change="form.end = $event.detail.value"
          ><view class="store-picker">结束 {{ form.end }}⌄</view></picker
        ></view
      >
      <AccessibleInput
        :input-id="'pickup-interval-' + store.id"
        :modelValue="String(form.interval)"
        @update:modelValue="form.interval = $event"
        label="间隔（分钟）"
        :disabled="locked()"
      />
      <AccessibleInput
        :input-id="'pickup-capacity-' + store.id"
        :modelValue="String(form.capacity)"
        @update:modelValue="form.capacity = $event"
        label="每时段容量（单）"
        :disabled="locked()"
      />
      <text class="safe-note"
        >间隔5至240分钟，容量1至1000单，每次最多96个时段。</text
      ><button class="outline wide" :disabled="locked()" @click="preview">
        生成预览
      </button>
      <view v-if="state.preview.length" class="pickup-preview"
        ><text class="label">待创建 · 共 {{ state.preview.length }} 个时段</text
        ><text v-for="(slot, index) in state.preview" :key="index"
          >{{ pickupWindowText(slot) }} · {{ slot.capacity }} 单</text
        ><button
          class="primary wide"
          :disabled="locked()"
          @click="ctl.createSlots"
        >
          核对无误，创建时段
        </button></view
      >
    </view>
    <text class="label">门店时段表 · {{ state.date }}</text
    ><text class="safe-note"
      >容量按订单笔数计算，不能低于待付款占用与已确认合计；已确认订单完成后仍计入容量。关闭时段不影响已成立订单，原时段只能调整容量或启停。</text
    >
    <text v-if="state.loading" class="safe-note">正在读取时段…</text
    ><text v-else-if="!state.slots.length" class="safe-note"
      >该日暂无时段。</text
    >
    <view v-for="slot in state.slots" :key="slot.id" class="pickup-section">
      <text class="label"
        >{{ pickupWindowText(slot) }} ·
        {{ slot.enabled ? "开放中" : "已关闭" }}</text
      ><text
        >待付款占用 {{ slot.heldCount }} · 已确认 {{ slot.confirmedCount }} ·
        剩余 {{ slot.capacity - slot.heldCount - slot.confirmedCount }}</text
      >
      <AccessibleInput
        :input-id="'pickup-slot-' + slot.id"
        :modelValue="String(slot.draftCapacity)"
        @update:modelValue="slot.draftCapacity = $event"
        label="容量（单）"
        :disabled="!owner || locked()"
      />
      <view class="row"
        ><label :for="'pickup-open-' + slot.id">开放此时段</label
        ><switch
          :id="'pickup-open-' + slot.id"
          :checked="slot.draftEnabled"
          :disabled="!owner || locked()"
          @change="slot.draftEnabled = $event.detail.value"
      /></view>
      <button
        v-if="owner"
        class="outline wide"
        :disabled="locked()"
        @click="
          ctl.saveSlot(slot, {
            capacity: slot.draftCapacity,
            enabled: slot.draftEnabled,
          })
        "
      >
        保存时段
      </button>
    </view>
    <template v-if="state.previousDraft"
      ><button class="link" @click="showDraft = !showDraft">
        {{ showDraft ? "收起" : "查看" }}上次提交 / 重读前草稿</button
      ><view v-if="showDraft" class="pickup-preview"
        ><text
          >预约{{ state.previousDraft.policy?.enabled ? "开启" : "关闭" }} ·
          提前 {{ state.previousDraft.policy?.leadMinutes }} 分钟 · 最远
          {{ state.previousDraft.policy?.maxAdvanceDays }} 天</text
        ><text v-for="(slot, index) in state.previousDraft.preview" :key="index"
          >{{ pickupWindowText(slot) }} · {{ slot.capacity }} 单</text
        ><text v-for="slot in state.previousDraft.slots" :key="slot.id"
          >{{ pickupWindowText(slot) }} · 草稿容量 {{ slot.draftCapacity }} 单 ·
          {{ slot.draftEnabled ? "开放" : "关闭" }}</text
        ><text class="safe-note"
          >请对照门店时段表确认，已有时段请勿再次创建。</text
        ></view
      ></template
    >
  </view>
</template>
<style scoped>
.pickup-settings,
.pickup-section,
.pickup-preview {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: 14px;
}
.pickup-section {
  padding: 16px 0;
  border-bottom: 1px solid #dce5dd;
}
.pickup-preview {
  background: #f3f8f4;
  padding: 14px;
  border-radius: 12px;
}
input {
  font-size: 16px;
}
label {
  font-size: 14px;
}
</style>
