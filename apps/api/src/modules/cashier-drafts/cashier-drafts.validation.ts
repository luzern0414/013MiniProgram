import {assertPositiveQuantity, fail, object, str} from '../../common/domain';
export type DraftSelection = {
  mode: 'PICKUP' | 'DINE_IN'; tableCode?: string; pickupSlotId?: string; note: string;
  lines: {skuId: string; quantity: number; modifierIds: string[]; attributeOptionIds: string[]}[];
};
export type DraftBinding = {id: string; revision: number};
export function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('VALIDATION_ERROR', '草稿版本无效');
  return value;
}
function ids(value: unknown, max: number, unique: boolean): string[] {
  if (!Array.isArray(value) || value.length > max) fail('VALIDATION_ERROR', '商品选项格式无效');
  const values = value.map(id => str(id, '选项ID'));
  if (unique && new Set(values).size !== values.length) fail('VALIDATION_ERROR', '属性选项不可重复');
  return [...new Set(values)].sort();
}
export function selection(value: unknown): DraftSelection {
  const b = object(value, ['mode', 'tableCode', 'pickupSlotId', 'note', 'lines']);
  if (!['PICKUP', 'DINE_IN'].includes(b.mode)) fail('VALIDATION_ERROR', '请选择自取或堂食');
  if (b.mode === 'PICKUP' && b.tableCode !== undefined) fail('VALIDATION_ERROR', '自取不能携带桌码');
  if (b.mode === 'DINE_IN' && b.pickupSlotId !== undefined) fail('VALIDATION_ERROR', '堂食不能携带预约时段');
  const table = b.mode === 'DINE_IN' ? {tableCode: str(b.tableCode, '桌码')} : {};
  const slot = b.pickupSlotId === undefined ? {} : {pickupSlotId: str(b.pickupSlotId, '预约时段')};
  if (!Array.isArray(b.lines) || b.lines.length < 1 || b.lines.length > 100) fail('VALIDATION_ERROR', '挂单需包含1至100行');
  return {mode: b.mode, ...table, ...slot, note: str(b.note, '备注', 500, true), lines: b.lines.map(input => {
    const line = object(input, ['skuId', 'quantity', 'modifierIds', 'attributeOptionIds']);
    return {skuId: str(line.skuId, 'skuId'), quantity: assertPositiveQuantity(line.quantity), modifierIds: ids(line.modifierIds, 20, false), attributeOptionIds: ids(line.attributeOptionIds, 50, true)};
  })};
}
export function write(body: unknown, edit = false) {
  const b = object(body, ['storeId', 'name', 'selection', ...(edit ? ['expectedRevision'] : [])]);
  return {storeId: str(b.storeId, 'storeId'), name: str(typeof b.name === 'string' ? b.name.trim() : b.name, '挂单名称', 60), selection: selection(b.selection), ...(edit ? {expectedRevision: revision(b.expectedRevision)} : {})};
}
export function version(body: unknown) {
  const b = object(body, ['storeId', 'expectedRevision']);
  return {storeId: str(b.storeId, 'storeId'), expectedRevision: revision(b.expectedRevision)};
}
export function readQuery(query: unknown, list = false) {
  const b = object(query, ['storeId', ...(list ? ['state', 'page', 'pageSize'] : [])]);
  const storeId = str(b.storeId, 'storeId');
  const integer = (value: unknown, fallback: number, max: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) fail('VALIDATION_ERROR', '分页参数无效');
    return Number(value);
  };
  const state = b.state === undefined ? 'DRAFT' : str(b.state, 'state');
  if (!['DRAFT', 'CONVERTED', 'CANCELLED'].includes(state)) fail('VALIDATION_ERROR', '草稿状态无效');
  return {storeId, state, page: integer(b.page, 1, Number.MAX_SAFE_INTEGER), pageSize: integer(b.pageSize, 20, 50)};
}
