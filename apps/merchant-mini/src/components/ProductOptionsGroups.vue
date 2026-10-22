<script setup>
import {
  newOptionsGroup,
  newOptionsValue,
  optionsRef,
  attributeRule,
} from "@restaurant/mini-core";
import AccessibleInput from "./AccessibleInput.vue";
defineProps({ groups: Array, kind: String, disabled: Boolean });
const emit = defineEmits(["removeGroup"]);
</script>
<template>
  <view class="options-section">
    <view class="row"
      ><text class="options-heading">{{
        kind === "spec" ? "规格维度" : "口味选择"
      }}</text
      ><button
        class="small outline"
        :disabled="disabled || groups.length >= (kind === 'spec' ? 3 : 5)"
        @click="groups.push(newOptionsGroup(kind, groups.length))"
      >
        添加{{ kind === "spec" ? "维度" : "口味组" }}
      </button></view
    >
    <text class="safe-note">{{
      kind === "spec"
        ? "规格决定商品组合，例如杯型、容量。"
        : "口味不加价，也不扣库存。"
    }}</text>
    <text v-if="!groups.length" class="safe-note"
      >尚未设置{{ kind === "spec" ? "规格维度" : "口味" }}。</text
    >
    <view
      v-for="(group, gi) in groups"
      :key="group.id || group.clientKey"
      class="option-card"
    >
      <view class="row"
        ><text class="label"
          >{{ kind === "spec" ? "维度" : "口味组" }} {{ gi + 1 }}</text
        ><text class="status">{{
          group.enabled ? "已启用" : "已停用"
        }}</text></view
      >
      <AccessibleInput
        v-model="group.name"
        :input-id="kind + '-group-' + gi"
        :label="(kind === 'spec' ? '维度' : '口味组') + (gi + 1) + '名称'"
        :disabled="disabled"
        maxlength="80"
      />
      <AccessibleInput
        v-model="group.sort"
        :input-id="kind + '-sort-' + gi"
        :label="(kind === 'spec' ? '维度' : '口味组') + (gi + 1) + '排序'"
        :disabled="disabled"
        maxlength="6"
      />
      <button
        class="small outline"
        :disabled="disabled"
        @click="group.enabled = !group.enabled"
      >
        {{ group.enabled ? "停用" : "恢复"
        }}{{ kind === "spec" ? "维度" : "口味组" }}{{ gi + 1 }}
      </button>
      <template v-if="kind === 'attribute'">
        <AccessibleInput
          v-model="group.minSelections"
          :input-id="'attribute-min-' + gi"
          :label="'口味组' + (gi + 1) + '最少选择'"
          :disabled="disabled"
          maxlength="2"
        />
        <AccessibleInput
          v-model="group.maxSelections"
          :input-id="'attribute-max-' + gi"
          :label="'口味组' + (gi + 1) + '最多选择'"
          :disabled="disabled"
          maxlength="2"
        />
        <text class="safe-note">{{ attributeRule(group) }}</text>
      </template>
      <view
        v-for="(value, vi) in kind === 'spec' ? group.values : group.options"
        :key="value.id || value.clientKey"
        class="option-value"
      >
        <AccessibleInput
          v-model="value.name"
          :input-id="kind + '-value-' + gi + '-' + vi"
          :label="
            (kind === 'spec' ? '维度' : '口味组') +
            (gi + 1) +
            (kind === 'spec' ? '规格值' : '选项') +
            (vi + 1) +
            '名称'
          "
          :disabled="disabled"
          maxlength="80"
        />
        <AccessibleInput
          v-model="value.sort"
          :input-id="kind + '-value-sort-' + gi + '-' + vi"
          :label="
            (kind === 'spec' ? '维度' : '口味组') +
            (gi + 1) +
            '选项' +
            (vi + 1) +
            '排序'
          "
          :disabled="disabled"
          maxlength="6"
        />
        <view class="option-actions"
          ><button
            class="small outline"
            :disabled="disabled"
            @click="value.enabled = !value.enabled"
          >
            {{ value.enabled ? "停用" : "恢复"
            }}{{ kind === "spec" ? "维度" : "口味组" }}{{ gi + 1 }}选项{{
              vi + 1
            }}</button
          ><button
            v-if="!value.id"
            class="small link"
            :disabled="disabled"
            @click="
              (kind === 'spec' ? group.values : group.options).splice(vi, 1)
            "
          >
            移除未保存选项
          </button></view
        >
      </view>
      <view class="option-actions"
        ><button
          class="small outline"
          :disabled="
            disabled ||
            (kind === 'spec' ? group.values : group.options).length >=
              (kind === 'spec' ? 20 : 10)
          "
          @click="
            (kind === 'spec' ? group.values : group.options).push(
              newOptionsValue(
                (kind === 'spec' ? group.values : group.options).length,
              ),
            )
          "
        >
          添加{{ kind === "spec" ? "规格值" : "口味选项" }}</button
        ><button
          v-if="!group.id"
          class="small link"
          :disabled="disabled"
          @click="emit('removeGroup', gi)"
        >
          移除未保存{{ kind === "spec" ? "维度" : "口味组" }}
        </button></view
      >
    </view>
  </view>
</template>
