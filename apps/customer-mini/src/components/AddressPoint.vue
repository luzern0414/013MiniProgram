<script setup>
import { computed, onUnmounted, ref, watch } from "vue";
const props = defineProps({
  point: { type: Object, default: null },
  region: { type: String, default: "" },
  detail: { type: String, default: "" },
  disabled: Boolean,
});
const emit = defineEmits(["change"]);
const proposal = ref(null);
const locating = ref(false);
const error = ref("");
let ticket = 0;
let alive = true;
const available = computed(() => typeof uni !== "undefined" && typeof uni.getLocation === "function");
const savedLabel = computed(() =>
  props.point?.source === "DEVICE" ? "已确认的设备配送点" : "已确认的配送点",
);
function clearProposal() {
  ticket++;
  locating.value = false;
  proposal.value = null;
}
watch(
  () => [props.region, props.detail],
  () => {
    clearProposal();
    error.value = "";
  },
);
function normalizeLocation(result) {
  const latitude = result?.latitude;
  const longitude = result?.longitude;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  )
    throw Error("没有取得可用的配送点，可继续填写文字地址");
  const latitudeE6 = Math.round(latitude * 1_000_000);
  const longitudeE6 = Math.round(longitude * 1_000_000);
  if (
    !Number.isInteger(latitudeE6) ||
    !Number.isInteger(longitudeE6) ||
    latitudeE6 < -90_000_000 ||
    latitudeE6 > 90_000_000 ||
    longitudeE6 < -180_000_000 ||
    longitudeE6 > 180_000_000
  )
    throw Error("没有取得可用的配送点，可继续填写文字地址");
  return { latitudeE6, longitudeE6 };
}
function locate() {
  if (props.disabled || locating.value) return;
  if (!available.value) {
    error.value = "当前设备无法获取配送点，可继续填写文字地址";
    return;
  }
  const current = ++ticket;
  locating.value = true;
  proposal.value = null;
  error.value = "";
  uni.getLocation({
    type: "wgs84",
    success(result) {
      if (!alive || current !== ticket) return;
      try {
        proposal.value = normalizeLocation(result);
      } catch (caught) {
        error.value = caught.message;
      } finally {
        locating.value = false;
      }
    },
    fail() {
      if (!alive || current !== ticket) return;
      locating.value = false;
      error.value = "无法取得当前位置，可继续填写文字地址后保存";
    },
  });
}
function adopt() {
  if (!alive || props.disabled || !proposal.value) return;
  emit("change", {
    system: "WGS84",
    latitudeE6: proposal.value.latitudeE6,
    longitudeE6: proposal.value.longitudeE6,
    source: "DEVICE",
    confirmedAt: new Date().toISOString(),
  });
  proposal.value = null;
  error.value = "";
}
function cancel() {
  clearProposal();
  error.value = "";
}
function remove() {
  if (!props.disabled) emit("change", null);
}
onUnmounted(() => {
  alive = false;
  ticket++;
});
</script>

<template>
  <view class="point-field">
    <text class="point-label">配送点</text>
    <text class="point-help">配送点用于以后核对收货位置，不会自动替换文字地址。</text>
    <view v-if="point" class="point-confirmed">
      <view>
        <text class="point-title">{{ savedLabel }}</text>
        <text class="point-meta">已在你确认后保存</text>
      </view>
      <button class="point-action" :disabled="disabled" @click="remove">清除配送点</button>
    </view>
    <view v-else-if="proposal" class="point-proposal">
      <view>
        <text class="point-title">待确认的配送点</text>
        <text class="point-meta">只有点击“使用此配送点”后，才会写入这个地址。</text>
      </view>
      <view class="point-actions">
        <button class="point-action primary" :disabled="disabled" @click="adopt">使用此配送点</button>
        <button class="point-action" :disabled="disabled" @click="cancel">取消</button>
      </view>
    </view>
    <button
      v-else
      class="point-action locate"
      :disabled="disabled || locating || !available"
      @click="locate"
    >
      {{ locating ? "正在获取…" : available ? "获取配送点" : "当前设备不能获取配送点" }}
    </button>
    <text v-if="!available && !point" class="point-help">可继续填写文字地址并保存。</text>
    <text v-if="error" class="point-error" role="alert">{{ error }}</text>
  </view>
</template>

<style scoped>
.point-field {
  border-top: 1px solid #e5e7dc;
  padding-top: 18px;
  margin-top: 18px;
}
.point-label,
.point-title {
  display: block;
  color: #242820;
  font-size: 16px;
  font-weight: 650;
}
.point-help,
.point-meta {
  display: block;
  color: #686e63;
  font-size: 14px;
  line-height: 1.6;
  margin-top: 6px;
}
.point-confirmed,
.point-proposal {
  display: flex;
  gap: 14px;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
  padding: 16px;
  border: 1px solid #d8dbd1;
  border-radius: 14px;
  background: #fff;
}
.point-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.point-action {
  min-height: 44px;
  padding: 10px 14px;
  font-size: 14px;
  border-radius: 12px;
  background: #f1f2ec;
  color: #242820;
}
.point-action.primary {
  background: var(--primary, #35664a);
  color: #fff;
}
.point-action.locate {
  margin-top: 14px;
  background: transparent;
  border: 1px solid #d8dbd1;
}
.point-error {
  display: block;
  color: #924322;
  font-size: 14px;
  line-height: 1.6;
  margin-top: 10px;
}
</style>
