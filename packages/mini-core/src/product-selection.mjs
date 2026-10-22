// Customer/cashier selection uses the public catalog, independent of the full-tree editor.
export const enabledNodes = (nodes) =>
  (nodes || []).filter((node) => node.enabled !== false);
export const selectionIds = (ids) => [...new Set(ids || [])].sort();
export const selectionKey = (line) =>
  JSON.stringify([
    line.skuId,
    selectionIds(line.modifierIds),
    selectionIds(line.attributeOptionIds),
  ]);
export const attributeSummary = (line) =>
  (line.attributes || [])
    .filter((g) => g.options.length > 0)
    .map((g) => `${g.groupName}：${g.options.map((o) => o.name).join("、")}`)
    .join(" · ");
export const optionsChangedText =
  "商品规格或口味已调整，请刷新菜单后重新选择并确认金额。";
export function toggleAttribute(group, ids, id) {
  if (ids.includes(id)) return ids.filter((value) => value !== id);
  if (!enabledNodes(group.options).some((o) => o.id === id))
    throw new Error("所选口味已失效，请重新选择");
  if (
    enabledNodes(group.options).filter((o) => ids.includes(o.id)).length >=
    group.maxSelections
  )
    throw new Error(`${group.name}最多选择${group.maxSelections}项`);
  return [...ids, id];
}
export function resolveSelectionSku(product, values) {
  const groups = enabledNodes(product.specGroups);
  return enabledNodes(product.skus).find((sku) =>
    groups.every(
      (group) =>
        enabledNodes(group.values).some(
          (value) => value.id === values[group.id],
        ) &&
        (sku.selections || []).some(
          (s) => s.groupRef === group.id && s.valueRef === values[group.id],
        ),
    ),
  );
}
export function initialSelection(product) {
  const sku = enabledNodes(product.skus).find((s) => s.available > 0);
  return {
    skuId: sku?.id || "",
    specValues: Object.fromEntries(
      (sku?.selections || []).map((s) => [s.groupRef, s.valueRef]),
    ),
    attributeOptionIds: [],
    modifierIds: [],
    quantity: 1,
  };
}
export function selectionLine(product, state) {
  if (product.isAvailable === false) throw new Error("商品已下架，请重新选择");
  const sku = enabledNodes(product.skus).find((s) => s.id === state.skuId);
  if (!sku) throw new Error("所选规格已失效，请重新选择");
  for (const group of enabledNodes(product.specGroups)) {
    if (
      !(sku.selections || []).some(
        (s) =>
          s.groupRef === group.id &&
          enabledNodes(group.values).some((v) => v.id === s.valueRef),
      )
    )
      throw new Error("所选规格已失效，请重新选择");
  }
  const quantity = state.quantity;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99)
    throw new Error("每种搭配请选择1至99份");
  if (quantity > sku.available)
    throw new Error("所选规格库存不足，请减少数量或重新选择");
  const modifierIds = selectionIds(state.modifierIds),
    attributeOptionIds = selectionIds(state.attributeOptionIds);
  const modifiers = modifierIds.map((id) =>
    enabledNodes(product.modifiers).find((m) => m.id === id),
  );
  if (modifiers.some((m) => !m)) throw new Error("所选加料已失效，请重新选择");
  if (modifiers.some((m) => m.available < quantity))
    throw new Error("所选加料库存不足，请减少数量或重新选择");
  const groups = enabledNodes(product.attributeGroups);
  const validIds = groups.flatMap((g) =>
    enabledNodes(g.options).map((o) => o.id),
  );
  if (attributeOptionIds.some((id) => !validIds.includes(id)))
    throw new Error("所选口味已失效，请重新选择");
  const attributes = [];
  for (const group of groups) {
    const options = enabledNodes(group.options).filter((o) =>
      attributeOptionIds.includes(o.id),
    );
    if (options.length < group.minSelections)
      throw new Error(`${group.name}至少选择${group.minSelections}项`);
    if (options.length > group.maxSelections)
      throw new Error(`${group.name}最多选择${group.maxSelections}项`);
    if (options.length)
      attributes.push({
        groupId: group.id,
        groupName: group.name,
        options: options.map((o) => ({ id: o.id, name: o.name })),
      });
  }
  return {
    productId: product.id,
    skuId: sku.id,
    quantity,
    modifierIds,
    attributeOptionIds,
    attributes,
    configurationRevision: product.configurationRevision ?? 0,
    name: product.name,
    productName: product.name,
    skuName: sku.name,
    modifierNames: modifiers.map((m) => m.name),
    unitPriceFen:
      sku.priceFen + modifiers.reduce((sum, m) => sum + m.priceFen, 0),
    available: Math.min(
      sku.available,
      ...modifiers.map((m) => m.available),
      99,
    ),
  };
}
export function cartSelectionIssue(line, products) {
  const product = (products || []).find((p) =>
    p.skus.some((s) => s.id === line.skuId),
  );
  if (!product) return "商品或规格已失效，请重新选择";
  if (
    line.configurationRevision !== undefined &&
    line.configurationRevision !== (product.configurationRevision ?? 0)
  )
    return "规格或口味已调整，请重新选择";
  try {
    selectionLine(product, line);
    return "";
  } catch (error) {
    return error.message;
  }
}
// A known refusal means the server did not create an order. All other results keep recovery.
export const isDefinitiveOrderRejection = (error) =>
  [
    "PRODUCT_OPTIONS_CHANGED",
    "PRICE_CHANGED",
    "CATALOG_CHANGED",
    "OUT_OF_STOCK",
    "VALIDATION_ERROR",
    "STORE_CLOSED",
  ].includes(error?.code);
