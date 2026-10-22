import {createHash} from 'node:crypto';
import {fail, money, object, str} from '../../common/domain';
export function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2_000_000_000) fail('VALIDATION_ERROR', '班次版本无效');
  return value;
}
export function openInput(body: unknown, key: unknown) {
  const b = object(body, ['storeId', 'openingFen']);
  return {storeId: str(b.storeId, '门店'), openingFen: money(b.openingFen), key: str(key, 'Idempotency-Key', 120)};
}
export function closeInput(body: unknown, key: unknown) {
  const b = object(body, ['storeId', 'expectedRevision', 'countedFen', 'reason']);
  const reason = b.reason === undefined ? '' : str(typeof b.reason === 'string' ? b.reason.trim() : b.reason, '差异原因', 500, true);
  return {storeId: str(b.storeId, '门店'), expectedRevision: revision(b.expectedRevision), countedFen: money(b.countedFen), reason, key: str(key, 'Idempotency-Key', 120)};
}
export function requestHash(actorId: string, input: object) {
  return createHash('sha256').update(JSON.stringify({actorId, ...input})).digest('hex');
}
export function readQuery(query: unknown, list = false) {
  const b = object(query, ['storeId', ...(list ? ['state', 'page', 'pageSize'] : [])]);
  const storeId = str(b.storeId, '门店'), state = b.state === undefined ? 'ALL' : str(b.state, '班次状态');
  if (!['OPEN', 'CLOSED', 'ALL'].includes(state)) fail('VALIDATION_ERROR', '班次状态无效');
  const integer = (value: unknown, fallback: number, max: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) fail('VALIDATION_ERROR', '分页参数无效');
    return Number(value);
  };
  return {storeId, state, page: integer(b.page, 1, Number.MAX_SAFE_INTEGER), pageSize: integer(b.pageSize, 20, 50)};
}
