<script setup>
import { computed, onMounted, ref } from "vue";
import AddressForm from "./AddressForm.vue";
const props = defineProps({
  controller: { type: Object, required: true },
  selectable: Boolean,
  selectedId: { type: String, default: "" },
  embedded: Boolean,
});
const emit = defineEmits(["select", "changed"]);
const state = props.controller.state;
const confirmingId = ref("");
const pendingLabel = computed(
  () =>
    ({
      CREATE: "新增地址",
      UPDATE: "修改地址",
      DEFAULT: "设置默认地址",
      DELETE: "删除地址",
    })[state.pending?.kind] || "地址操作",
);
const canAdd = computed(
  () =>
    !state.busy &&
    !state.loading &&
    !state.blocked &&
    !state.corrupt &&
    !state.pending &&
    state.items.length < 20,
);
onMounted(() => {
  props.controller.load();
});
async function run(action) {
  confirmingId.value = "";
  const result = await action();
  if (result) emit("changed");
  return result;
}
function create() {
  if (props.controller.beginCreate()) confirmingId.value = "";
}
function edit(item) {
  if (props.controller.beginEdit(item)) confirmingId.value = "";
}
async function save() {
  const result =
    state.editor === "edit"
      ? await props.controller.update()
      : await props.controller.create();
  if (result) emit("changed");
}
async function select(item) {
  if (props.selectable && item?.deletedAt === null) emit("select", item);
}
function askRemove(item) {
  confirmingId.value = item.id;
}
async function remove(item) {
  await run(() => props.controller.remove(item));
}
async function setDefault(item) {
  await run(() => props.controller.setDefault(item));
}
async function readRecovery() {
  await props.controller.recover("read");
}
async function replayRecovery() {
  await run(() => props.controller.recover("replay"));
}
async function readReview() {
  await props.controller.reloadForReview();
}
function acceptReview() {
  if (props.controller.acceptReview()) emit("changed");
}
</script>

<template>
  <view class="customer-addresses" :class="{ embedded }">
    <view class="address-heading">
      <view>
        <text class="address-eyebrow">配送信息</text>
        <text class="address-title">收货地址</text>
        <text class="address-subtitle">地址由当前顾客账号保存，门店切换不会另建一份。</text>
      </view>
      <button
        v-if="!state.editor && !state.pending && !state.corrupt"
        class="add-address"
        :disabled="!canAdd"
        @click="create"
      >
        {{ state.items.length >= 20 ? "已达 20 个上限" : "新增收货地址" }}
      </button>
    </view>

    <view v-if="state.corrupt" class="recovery-panel recovery-danger" role="alert">
      <text class="recovery-title">本机地址恢复记录需要核对</text>
      <text class="recovery-copy">{{ state.error }}</text>
      <text class="recovery-copy">为保护原账号信息，系统不会自动删除记录或猜测原操作结果。</text>
    </view>

    <view v-else-if="state.pending" class="recovery-panel" role="status">
      <text class="recovery-title">原{{ pendingLabel }}待核对</text>
      <text v-if="state.pending.body?.name || state.pending.body?.detail" class="recovery-copy">
        原收货人：{{ state.pending.body.name || "未填写" }}
      </text>
      <text v-if="state.pending.body?.detail" class="recovery-copy">
        原地址：{{ state.pending.body.region || "" }} {{ state.pending.body.detail }}
      </text>
      <text class="recovery-copy">
        请先读取最新内容；读取不会解除原操作，也不会自动再次提交。
      </text>
      <view class="recovery-actions">
        <button :disabled="state.busy || state.loading" @click="readRecovery">
          读取最新地址
        </button>
        <button
          class="primary"
          :disabled="state.busy || state.loading"
          @click="replayRecovery"
        >
          恢复原操作
        </button>
      </view>
    </view>

    <view v-if="state.review && !state.pending" class="review-panel" role="status">
      <text class="recovery-title">地址版本已变化</text>
      <text class="recovery-copy">你的编辑内容仍保留。请读取最新地址后再明确决定。</text>
      <button :disabled="state.loading" @click="readReview">
        {{ state.reviewReady ? "重新读取最新地址" : "读取最新地址" }}
      </button>
      <view v-if="state.reviewReady" class="latest-address">
        <text class="latest-label">服务器当前内容</text>
        <text v-if="state.reviewAddress">
          {{ state.reviewAddress.region }} {{ state.reviewAddress.detail }}
        </text>
        <text v-else-if="state.reviewAddress === null" class="recovery-copy">
          当前地址列表已读；新增操作可继续核对。
        </text>
        <text v-if="state.reviewAddress?.deletedAt" class="recovery-copy">
          当前地址已经删除，不能直接覆盖已删除地址。
        </text>
        <button class="primary use-latest" @click="acceptReview">
          使用最新版本继续
        </button>
      </view>
    </view>

    <text v-if="state.error" class="address-error" role="alert">{{ state.error }}</text>
    <text v-if="state.notice" class="address-notice" role="status">{{ state.notice }}</text>

    <view v-if="state.editor" class="address-form-wrap">
      <AddressForm
        :form="state.form"
        :error="state.error"
        @save="save"
        @cancel="controller.cancelEdit"
        @change="state.error = ''"
      />
    </view>

    <template v-else>
      <text v-if="state.loading" class="address-loading">正在读取收货地址…</text>
      <view v-else-if="!state.items.length" class="address-empty">
        <text>还没有收货地址</text>
        <text>新增后，配送结算可直接选择当前账号保存的地址。</text>
        <button class="primary" :disabled="!canAdd" @click="create">新增收货地址</button>
      </view>
      <view v-else class="address-list">
        <view
          v-for="item in state.items"
          :key="item.id"
          class="address-row"
          :class="{ selected: selectedId === item.id }"
        >
          <view class="address-copy">
            <view class="address-topline">
              <text class="address-name">{{ item.name }}</text>
              <text v-if="item.isDefault" class="default-mark">默认地址</text>
              <text v-if="selectedId === item.id" class="selected-mark">配送结算已选</text>
            </view>
            <text class="address-region">{{ item.region }}</text>
            <text class="address-detail">{{ item.detail }}</text>
            <text class="address-phone">手机号码：{{ item.phone }}</text>
          </view>
          <view class="address-actions">
            <button
              v-if="selectable"
              class="select-address"
              :disabled="state.busy"
              @click="select(item)"
            >
              {{ selectedId === item.id ? "当前已选" : "选择此地址" }}
            </button>
            <button
              v-if="!item.isDefault"
              :disabled="state.busy || state.pending"
              @click="setDefault(item)"
            >
              设为默认
            </button>
            <button :disabled="state.busy || state.pending" @click="edit(item)">修改</button>
            <button
              class="danger-link"
              :disabled="state.busy || state.pending"
              @click="askRemove(item)"
            >
              删除
            </button>
          </view>
          <view v-if="confirmingId === item.id" class="delete-confirm" role="alert">
            <text class="delete-title">确认删除地址</text>
            <text class="recovery-copy">
              删除后不会自动把其他地址设为默认，历史订单中的地址快照不会改变。
            </text>
            <view class="recovery-actions">
              <button :disabled="state.busy" @click="confirmingId = ''">取消删除</button>
              <button class="danger" :disabled="state.busy" @click="remove(item)">
                {{ state.busy ? "正在删除…" : "确认删除" }}
              </button>
            </view>
          </view>
        </view>
      </view>
      <text v-if="state.items.length >= 20" class="limit-tip">
        已保存 20 个地址，如需新增，请先删除不需要的地址。
      </text>
    </template>
  </view>
</template>

<style scoped>
.customer-addresses {
  color: #242820;
  padding: 20px 24px;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 16px;
}
.customer-addresses.embedded {
  padding: 0;
}
.address-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 0 20px;
}
.address-eyebrow {
  display: block;
  color: var(--primary, #35664a);
  font-size: 14px;
  font-weight: 700;
}
.address-title {
  display: block;
  font-size: 30px;
  font-weight: 800;
  line-height: 1.25;
  letter-spacing: -0.6px;
  margin-top: 4px;
}
.address-subtitle {
  display: block;
  color: #686e63;
  font-size: 14px;
  line-height: 1.6;
  margin-top: 8px;
}
.add-address,
.address-actions button,
.recovery-actions button,
.use-latest,
.address-empty button {
  min-height: 44px;
  font-size: 14px;
  padding: 10px 14px;
}
.add-address,
.select-address,
.use-latest,
.address-empty button {
  background: var(--primary, #35664a);
  color: #fff;
}
.recovery-panel,
.review-panel,
.delete-confirm {
  border: 1px solid #d8dbd1;
  border-radius: 16px;
  background: #fffefa;
  padding: 18px;
  margin: 0 0 18px;
}
.recovery-danger {
  background: #fff0e8;
  border-color: #efc6b4;
}
.recovery-title,
.delete-title {
  display: block;
  font-size: 18px;
  font-weight: 750;
  margin-bottom: 8px;
}
.recovery-copy,
.address-loading,
.limit-tip {
  display: block;
  color: #686e63;
  font-size: 14px;
  line-height: 1.6;
  margin-top: 6px;
}
.recovery-actions,
.address-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.latest-address {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid #e5e7dc;
}
.latest-label {
  display: block;
  color: #686e63;
  font-size: 14px;
  margin-bottom: 6px;
}
.address-error,
.address-notice {
  display: block;
  padding: 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
  margin: 12px 0;
  word-break: break-word;
}
.address-error {
  color: #924322;
  background: #fff0e8;
}
.address-notice {
  color: #665325;
  background: #f5ecd8;
}
.address-form-wrap {
  margin-top: 16px;
  animation: address-enter 170ms ease-out both;
}
.address-list {
  border-top: 1px solid #d8dbd1;
}
.address-row {
  padding: 20px 0;
  border-bottom: 1px solid #d8dbd1;
}
.address-row.selected {
  background: #f3f7f1;
}
.address-copy {
  min-width: 0;
}
.address-topline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.address-name {
  font-size: 15px;
  font-weight: 650;
}
.default-mark,
.selected-mark {
  display: inline-block;
  border-radius: 999px;
  padding: 4px 9px;
  font-size: 14px;
  line-height: 1.45;
}
.default-mark {
  background: #eef4ec;
  color: var(--primary, #35664a);
}
.selected-mark {
  background: #f5ecd8;
  color: #665325;
}
.address-region,
.address-detail,
.address-phone {
  display: block;
  overflow-wrap: anywhere;
}
.address-region {
  color: #686e63;
  font-size: 14px;
  margin-top: 9px;
}
.address-detail {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.55;
  margin-top: 6px;
}
.address-phone {
  color: #686e63;
  font-size: 14px;
  margin-top: 7px;
}
.address-actions {
  margin-top: 12px;
}
.address-actions button {
  background: transparent;
  border: 1px solid #d8dbd1;
  color: #242820;
}
.address-actions .select-address {
  background: var(--primary, #35664a);
  color: #fff;
}
.address-actions .danger-link,
.danger {
  color: #924322;
}
.danger {
  border: 1px solid #c47c5d;
  background: transparent;
}
.delete-confirm {
  margin: 14px 0 0;
  background: #fff8f4;
}
.address-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  padding: 44px 16px;
  border-top: 1px solid #d8dbd1;
  color: #686e63;
  font-size: 14px;
}
.address-empty text:first-child {
  color: #242820;
  font-size: 18px;
  font-weight: 700;
}
.address-loading {
  padding: 28px 0;
}
.limit-tip {
  margin-top: 16px;
}
@keyframes address-enter {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (max-width: 390px) {
  .customer-addresses {
    padding: 20px;
  }
  .address-heading {
    flex-direction: column;
  }
  .add-address {
    width: 100%;
  }
  .address-actions button {
    flex: 1 1 calc(50% - 8px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .address-form-wrap {
    animation: none;
  }
}
</style>
