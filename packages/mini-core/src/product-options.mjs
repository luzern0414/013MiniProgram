// Full-tree editing helpers. Persisted identities are never recreated or removed.
export const optionsRef = (node) => node.id || node.clientKey;
export const copyOptions = (value) => JSON.parse(JSON.stringify(value));
let nextKey = 0;
export const newOptionsValue = (sort = 0) => ({
  clientKey: `draft_${Date.now()}_${++nextKey}`,
  name: "",
  sort: String(sort),
  enabled: true,
});
export function newOptionsGroup(kind, sort = 0) {
  return {
    ...newOptionsValue(sort),
    ...(kind === "spec"
      ? { values: [newOptionsValue()] }
      : {
          minSelections: "0",
          maxSelections: "1",
          options: [newOptionsValue()],
        }),
  };
}
export const newOptionsSku = (combination) => ({
  name: combination?.name || "",
  enabled: true,
  price: "",
  initialStock: "0",
  selections: copyOptions(combination?.selections || []),
});
export function removeNewOptionsGroup(draft, kind, index) {
  const groups = kind === "spec" ? draft.specGroups : draft.attributeGroups;
  const group = groups[index];
  if (!group || group.id) return;
  if (kind === "spec")
    for (const sku of draft.skus)
      sku.selections = sku.selections.filter(
        (s) => s.groupRef !== optionsRef(group),
      );
  groups.splice(index, 1);
}
export function optionsDraft(data) {
  const draft = copyOptions(data);
  for (const group of [...draft.specGroups, ...draft.attributeGroups]) {
    group.sort = String(group.sort);
    for (const value of group.values || group.options)
      value.sort = String(value.sort);
  }
  for (const item of [...draft.skus, ...draft.modifiers])
    item.price = (item.priceFen / 100).toFixed(2);
  for (const group of draft.attributeGroups) {
    group.minSelections = String(group.minSelections);
    group.maxSelections = String(group.maxSelections);
  }
  return draft;
}
export function optionsInteger(value, max, label) {
  if (
    String(value ?? "").trim() === "" ||
    !Number.isInteger(Number(value)) ||
    Number(value) < 0 ||
    Number(value) > max
  )
    throw new Error(`${label}需为0至${max}的整数`);
  return Number(value);
}
const name = (value) => {
  const result = String(value || "").trim();
  if (!result || result.length > 80) throw new Error("名称需为1至80个字符");
  return result;
};
function named(node, sorted = false) {
  return {
    ...(node.id ? { id: node.id } : {}),
    name: name(node.name),
    enabled: !!node.enabled,
    ...(sorted ? { sort: optionsInteger(node.sort, 100000, "排序") } : {}),
  };
}
function priced(node) {
  if (
    !/^\d+(\.\d{1,2})?$/.test(String(node.price)) ||
    Number(node.price) > 20000000
  )
    throw new Error("价格需为0至20000000元，最多两位小数");
  return {
    ...named(node),
    priceFen: Math.round(Number(node.price) * 100),
    ...(!node.id
      ? {
          initialStock: optionsInteger(
            node.initialStock ?? "0",
            2000000000,
            "初始库存",
          ),
        }
      : {}),
  };
}
function limit(items, max, label) {
  if (items.length > max)
    throw new Error(`${label}超出${max}项限制，请调整；已有记录保留，仅可停用`);
}
export function optionsPayload(storeId, draft) {
  limit(draft.specGroups, 3, "规格维度");
  limit(draft.attributeGroups, 5, "口味组");
  limit(draft.modifiers, 20, "加料");
  const specGroups = draft.specGroups.map((g) => {
    limit(g.values, 20, "规格值");
    return {
      ...named(g, true),
      ...(!g.id ? { clientKey: g.clientKey } : {}),
      values: g.values.map((v) => ({
        ...named(v, true),
        ...(!v.id ? { clientKey: v.clientKey } : {}),
      })),
    };
  });
  const active = specGroups.filter((g) => g.enabled),
    keys = new Set();
  limit(
    draft.skus.filter((s) => s.enabled),
    20,
    "启用组合",
  );
  const skus = draft.skus.map((s) => {
    const result = {
      ...priced(s),
      selections: s.selections.map((v) => ({
        groupRef: v.groupRef,
        valueRef: v.valueRef,
      })),
    };
    const selected = new Set();
    for (const selection of result.selections) {
      const group = specGroups.find(
        (g) => optionsRef(g) === selection.groupRef,
      );
      const value = group?.values.find(
        (v) => optionsRef(v) === selection.valueRef,
      );
      if (!group || !value || selected.has(selection.groupRef))
        throw new Error("规格选择已失效或重复，请重新选择");
      if (s.enabled && group.enabled && !value.enabled)
        throw new Error("启用组合不能选择停用的规格值");
      selected.add(selection.groupRef);
    }
    if (s.enabled) {
      for (const group of active)
        if (!selected.has(optionsRef(group)))
          throw new Error(`请为「${result.name}」选择${group.name}`);
      const key = active.length
        ? JSON.stringify(
            active
              .map((g) => [
                optionsRef(g),
                result.selections.find((v) => v.groupRef === optionsRef(g))
                  .valueRef,
              ])
              .sort(),
          )
        : result.name;
      if (keys.has(key))
        throw new Error("组合或名称重复，请停用或调整重复组合");
      keys.add(key);
    }
    return result;
  });
  const attributeGroups = draft.attributeGroups.map((g) => {
    limit(g.options, 10, "口味选项");
    const minSelections = optionsInteger(g.minSelections, 10, "最少选择"),
      maxSelections = optionsInteger(g.maxSelections, 10, "最多选择");
    if (minSelections > maxSelections)
      throw new Error("最少选择不能大于最多选择");
    if (g.enabled && g.options.filter((o) => o.enabled).length < minSelections)
      throw new Error(`「${g.name}」启用选项不足，请调整最少选择`);
    return {
      ...named(g, true),
      minSelections,
      maxSelections,
      options: g.options.map((o) => named(o, true)),
    };
  });
  return {
    storeId,
    expectedRevision: draft.configurationRevision,
    specGroups,
    skus,
    attributeGroups,
    modifiers: draft.modifiers.map(priced),
  };
}
export function selectOptionsValue(sku, group, valueRef) {
  sku.selections = sku.selections.filter(
    (v) => v.groupRef !== optionsRef(group),
  );
  if (valueRef) sku.selections.push({ groupRef: optionsRef(group), valueRef });
}
// Compute total first, then visit at most 20 missing combinations; no bulk creation.
export function previewCombinations(draft) {
  const groups = draft.specGroups.filter((g) => g.enabled);
  const total = groups.length
    ? groups.reduce((n, g) => n * g.values.filter((v) => v.enabled).length, 1)
    : 0;
  const items = [];
  function visit(index, selections, names) {
    if (items.length >= 20) return;
    if (index === groups.length) {
      if (
        !draft.skus.some(
          (s) =>
            s.enabled &&
            selections.every((v) =>
              s.selections.some(
                (x) => x.groupRef === v.groupRef && x.valueRef === v.valueRef,
              ),
            ),
        )
      )
        items.push({ name: names.join(" / "), selections });
      return;
    }
    const g = groups[index];
    for (const v of g.values.filter((v) => v.enabled))
      visit(
        index + 1,
        [...selections, { groupRef: optionsRef(g), valueRef: optionsRef(v) }],
        [...names, v.name || "未命名"],
      );
  }
  if (total) visit(0, [], []);
  return { total, items };
}
export const attributeRule = (group) =>
  Number(group.minSelections) > 0
    ? `必选，至少${group.minSelections}项，最多${group.maxSelections}项`
    : `可不选，最多${group.maxSelections}项`;
