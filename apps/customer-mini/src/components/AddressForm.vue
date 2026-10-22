<script setup>
import AccessibleInput from "@restaurant/mini-core/components/AccessibleInput.vue";
import AddressPoint from "./AddressPoint.vue";
const props = defineProps({
  form: { type: Object, required: true },
  error: { type: String, default: "" },
});
const emit = defineEmits(["save", "cancel", "change"]);
const field = (name, value) => {
  if (["region", "detail"].includes(name) && props.form.point) {
    props.form.point = null;
    props.form.pointNotice = "地区或门牌已修改，请重新确认配送点。";
  }
  props.form[name] = value;
  emit("change");
};
const setPoint = (value) => {
  props.form.point = value;
  props.form.pointNotice = value ? "已使用你明确确认的配送点。" : "";
  emit("change");
};
const toggleDefault = () => {
  props.form.isDefault = !props.form.isDefault;
  emit("change");
};
</script>

<template>
  <view class="address-form">
    <view class="form-intro">
      <text class="form-title">{{ form.id ? "修改收货地址" : "新增收货地址" }}</text>
      <text class="form-help">请填写可以直接送达的收货信息。</text>
    </view>
    <AccessibleInput
      :model-value="form.name"
      label="收货人"
      input-id="address-name"
      :disabled="form.busy"
      :maxlength="40"
      placeholder="请输入收货人姓名"
      autocomplete="name"
      @update:model-value="field('name', $event)"
    />
    <AccessibleInput
      :model-value="form.phone"
      label="手机号码"
      input-id="address-phone"
      :disabled="form.busy"
      :maxlength="11"
      placeholder="请输入11位手机号码"
      autocomplete="tel"
      confirm-type="next"
      @update:model-value="field('phone', $event)"
    />
    <view class="field">
      <label for="address-region" class="field-label">所在地区</label>
      <input
        id="address-region"
        :value="form.region"
        :disabled="form.busy"
        maxlength="100"
        placeholder="省、市、区县或配送区域"
        @input="field('region', $event.detail.value)"
      />
    </view>
    <view class="field">
      <label for="address-detail" class="field-label">详细地址</label>
      <textarea
        id="address-detail"
        :value="form.detail"
        :disabled="form.busy"
        maxlength="200"
        placeholder="街道、门牌号等详细地址"
        @input="field('detail', $event.detail.value)"
      />
    </view>
    <AddressPoint
      :point="form.point"
      :region="form.region"
      :detail="form.detail"
      :disabled="form.busy"
      @change="setPoint"
    />
    <text v-if="form.pointNotice" class="point-notice">{{ form.pointNotice }}</text>
    <button
      class="default-toggle"
      :class="{ chosen: form.isDefault }"
      :disabled="form.busy"
      :aria-pressed="form.isDefault"
      @click="toggleDefault"
    >
      {{ form.isDefault ? "取消默认地址" : "设为默认地址" }}
    </button>
    <text v-if="error" class="form-error" role="alert">{{ error }}</text>
    <view class="form-actions">
      <button class="cancel" :disabled="form.busy" @click="emit('cancel')">取消编辑</button>
      <button class="save" :disabled="form.busy" @click="emit('save')">
        {{ form.busy ? "正在保存…" : "保存地址" }}
      </button>
    </view>
  </view>
</template>

<style scoped>
.address-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.form-intro {
  padding-bottom: 4px;
}
.form-title {
  display: block;
  color: #242820;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.35;
}
.form-help,
.point-notice,
.form-error {
  display: block;
  color: #686e63;
  font-size: 14px;
  line-height: 1.6;
  margin-top: 6px;
}
.field-label {
  display: block;
  color: #242820;
  font-size: 16px;
  font-weight: 650;
  margin-bottom: 8px;
}
.field input,
.field textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 50px;
  padding: 13px 14px;
  border: 0;
  border-radius: 12px;
  background: #f3f2ed;
  color: #242820;
  font-family: inherit;
  font-size: 16px;
  line-height: 1.6;
}
.field textarea {
  height: 96px;
}
.default-toggle {
  min-height: 44px;
  border: 1px solid #d8dbd1;
  background: transparent;
  color: #242820;
  font-size: 16px;
}
.default-toggle.chosen {
  border-color: var(--primary, #35664a);
  background: #eef4ec;
  color: var(--primary, #35664a);
}
.form-error {
  padding: 14px;
  background: #fff0e8;
  color: #924322;
  border-radius: 12px;
  margin: 0;
}
.form-actions {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 10px;
  padding-top: 6px;
}
.form-actions button {
  min-height: 46px;
  font-size: 16px;
}
.cancel {
  background: transparent;
  border: 1px solid #d8dbd1;
  color: #242820;
}
.save {
  background: var(--primary, #35664a);
  color: #fff;
}
</style>
