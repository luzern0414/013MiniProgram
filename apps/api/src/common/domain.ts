export class DomainError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export function fail(code: string, message: string, status = 400): never { throw new DomainError(code, message, status); }
export function assertPositiveQuantity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 99) fail('VALIDATION_ERROR', '数量必须是1至99的整数');
  return value;
}
export function money(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 2_000_000_000) fail('VALIDATION_ERROR', '金额必须是有效的整数分');
  return value;
}
export function availability(value: number): number { return money(value); }
export function assertStoreAccess(user: {role: string; storeIds: string[]}, storeId: string, owner = false): void {
  if (!['OWNER', 'CLERK'].includes(user.role) || !user.storeIds.includes(storeId) || (owner && user.role !== 'OWNER')) fail('FORBIDDEN', '无此门店操作权限', 403);
}
export const transitions: Record<string, Record<string, string>> = {
  AWAITING_ACCEPTANCE: {ACCEPT: 'PREPARING', START: 'PREPARING'},
  PREPARING: {READY: 'READY'}, READY: {DISPATCH: 'DELIVERING', COMPLETE: 'COMPLETED'},
  DELIVERING: {COMPLETE: 'COMPLETED'}
};
export function canTransition(status: string, action: string, mode: string): boolean {
  if (typeof action !== 'string' || !['ACCEPT', 'START', 'READY', 'DISPATCH', 'COMPLETE', 'REJECT'].includes(action)) return false;
  if (action === 'REJECT') return status === 'PENDING_PAYMENT';
  if (action === 'DISPATCH' && mode !== 'DELIVERY') return false;
  if (status === 'READY' && action === 'COMPLETE' && mode === 'DELIVERY') return false;
  return Object.hasOwn(transitions, status) && Object.hasOwn(transitions[status], action);
}
export function assertEnvironment(env: Record<string, string | undefined>): void {
  if (env.NODE_ENV === 'production' && (env.DEV_AUTH_ENABLED === 'true' || env.DEV_SEED_ENABLED === 'true')) throw new Error('Production forbids development authentication and seed flags');
}
export function object(body: unknown, fields: string[]): Record<string, any> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('VALIDATION_ERROR', '请求必须为对象');
  const data = body as Record<string, any>;
  for (const key of Object.keys(data)) if (!fields.includes(key)) fail('VALIDATION_ERROR', `未知字段: ${key}`);
  return data;
}
export function str(value: unknown, field: string, max = 200, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max) fail('VALIDATION_ERROR', `${field}格式不正确`);
  return value;
}
export function maskPhone(value: string | null): string | null {
  if (value === null) return null;
  let digits = value.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('86')) digits = digits.slice(2);
  return /^1\d{10}$/.test(digits) ? `${digits.slice(0,3)}****${digits.slice(-4)}` : '***';
}
