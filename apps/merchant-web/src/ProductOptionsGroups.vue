<script setup lang="ts">
import {
  newOptionsGroup,
  newOptionsValue,
  optionsRef,
  attributeRule,
} from "../../../packages/mini-core/src/product-options.mjs";
defineProps<{ groups: any[]; kind: "spec" | "attribute"; disabled: boolean }>();
const emit = defineEmits(["removeGroup"]);
</script>
<template>
  <section class="options-section">
    <div class="row">
      <h3>{{ kind === "spec" ? "规格维度" : "口味选择" }}</h3>
      <button
        type="button"
        class="quiet"
        :disabled="disabled || groups.length >= (kind === 'spec' ? 3 : 5)"
        @click="groups.push(newOptionsGroup(kind, groups.length))"
      >
        添加{{ kind === "spec" ? "维度" : "口味组" }}
      </button>
    </div>
    <p class="muted">
      {{
        kind === "spec"
          ? "规格决定商品组合，例如杯型、容量。"
          : "口味不加价，也不扣库存。"
      }}
    </p>
    <p v-if="!groups.length" class="muted">
      尚未设置{{ kind === "spec" ? "规格维度" : "口味" }}。
    </p>
    <fieldset
      v-for="(group, gi) in groups"
      :key="optionsRef(group)"
      :disabled="disabled"
      class="option-card"
    >
      <legend>
        {{ kind === "spec" ? "维度" : "口味组" }} {{ gi + 1 }} ·
        {{ group.enabled ? "已启用" : "已停用" }}
      </legend>
      <div class="form-grid">
        <label class="field"
          ><span>{{ kind === "spec" ? "维度" : "口味组" }}{{ gi + 1 }}名称</span
          ><input v-model="group.name" maxlength="80"
        /></label>
        <label class="field"
          ><span>{{ kind === "spec" ? "维度" : "口味组" }}{{ gi + 1 }}排序</span
          ><input v-model="group.sort" type="number" min="0" max="100000"
        /></label>
      </div>
      <label class="option-toggle"
        ><input v-model="group.enabled" type="checkbox" />启用{{
          kind === "spec" ? "维度" : "口味组"
        }}{{ gi + 1 }}</label
      >
      <template v-if="kind === 'attribute'">
        <div class="form-grid">
          <label class="field"
            ><span>口味组{{ gi + 1 }}最少选择</span
            ><input
              v-model="group.minSelections"
              type="number"
              min="0"
              max="10" /></label
          ><label class="field"
            ><span>口味组{{ gi + 1 }}最多选择</span
            ><input
              v-model="group.maxSelections"
              type="number"
              min="0"
              max="10"
          /></label>
        </div>
        <p class="muted">{{ attributeRule(group) }}</p>
      </template>
      <div
        v-for="(value, vi) in kind === 'spec' ? group.values : group.options"
        :key="optionsRef(value)"
        class="option-value"
      >
        <label class="field"
          ><span
            >{{ kind === "spec" ? "维度" : "口味组" }}{{ gi + 1
            }}{{ kind === "spec" ? "规格值" : "选项" }}{{ vi + 1 }}名称</span
          ><input v-model="value.name" maxlength="80"
        /></label>
        <label class="field"
          ><span
            >{{ kind === "spec" ? "维度" : "口味组" }}{{ gi + 1 }}选项{{
              vi + 1
            }}排序</span
          ><input v-model="value.sort" type="number" min="0" max="100000"
        /></label>
        <label class="option-toggle"
          ><input v-model="value.enabled" type="checkbox" />启用{{
            kind === "spec" ? "维度" : "口味组"
          }}{{ gi + 1 }}选项{{ vi + 1 }}</label
        >
        <button
          v-if="!value.id"
          type="button"
          class="text-button"
          @click="
            (kind === 'spec' ? group.values : group.options).splice(vi, 1)
          "
        >
          移除未保存选项
        </button>
      </div>
      <div class="row">
        <button
          type="button"
          class="quiet"
          :disabled="
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
          type="button"
          class="text-button"
          @click="emit('removeGroup', gi)"
        >
          移除未保存{{ kind === "spec" ? "维度" : "口味组" }}
        </button>
      </div>
    </fieldset>
  </section>
</template>
