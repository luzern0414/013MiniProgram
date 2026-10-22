import { selectionLine, selectionKey } from './product-selection.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
const valueOf = value => typeof value === 'function' ? value() : value;
const id = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const fail = (message, code = 'DRAFT_RECOVERY') => Object.assign(Error(message), { code });
const base = '/merchant/cashier-drafts';
const editFingerprint = edit => JSON.stringify({ name: edit.name.trim(), selection: draftSelection(edit.selection.lines.map(l => ({ ...l, modifierIds: [...new Set(l.modifierIds)].sort(), attributeOptionIds: [...l.attributeOptionIds].sort() })), edit.selection) });
export const draftStorageKey = userId => `cashier-draft:v1:${encodeURIComponent(userId)}`;
export const draftLocked = (...values) => values.some(Boolean);

export function draftSelection(cart, context) {
  return {
    mode: context.mode,
    ...(context.mode === 'DINE_IN' && context.tableCode ? { tableCode: context.tableCode } : {}),
    ...(context.mode === 'PICKUP' && context.pickupSlotId ? { pickupSlotId: context.pickupSlotId } : {}),
    note: context.note || '',
    lines: cart.map(({ skuId, quantity, modifierIds = [], attributeOptionIds = [] }) => ({ skuId, quantity, modifierIds: [...modifierIds], attributeOptionIds: [...attributeOptionIds] })),
  };
}
export function hydrateDraft(draft, catalog) {
  const selection = copy(draft.selection);
  return {
    ...selection,
    cart: selection.lines.map((original, index) => {
      const display = copy(draft.display.lines[index] || {});
      const product = (catalog?.products || []).find(p => p.skus.some(s => s.id === original.skuId));
      let line, issue = '';
      try {
        if (!product) throw Error('商品或规格已失效，请重新选择');
        line = selectionLine(product, original);
      } catch (error) { issue = error.message; }
      return { productName: display.productName || '原商品', skuName: display.skuName || '原规格', modifierNames: display.modifierNames || [], unitPriceFen: 0, available: 0, ...line, ...original, display, issue, key: selectionKey(original) };
    }),
  };
}

function validSelection(s) {
  return s && ['PICKUP', 'DINE_IN'].includes(s.mode) && typeof s.note === 'string' && s.note.length <= 500 &&
    (s.tableCode === undefined || id(s.tableCode)) && (s.pickupSlotId === undefined || id(s.pickupSlotId)) &&
    !(s.mode === 'PICKUP' && s.tableCode !== undefined) && !(s.mode === 'DINE_IN' && s.pickupSlotId !== undefined) &&
    Object.keys(s).every(k => ['mode', 'tableCode', 'pickupSlotId', 'note', 'lines'].includes(k)) &&
    Array.isArray(s.lines) && s.lines.length >= 1 && s.lines.length <= 100 && s.lines.every(l =>
      l && id(l.skuId) && Number.isInteger(l.quantity) && l.quantity >= 1 && l.quantity <= 99 &&
      ['modifierIds', 'attributeOptionIds'].every((k, i) => Array.isArray(l[k]) && l[k].length <= (i ? 50 : 20) && l[k].every(id)) &&
      new Set(l.attributeOptionIds).size === l.attributeOptionIds.length &&
      Object.keys(l).every(k => ['skuId', 'quantity', 'modifierIds', 'attributeOptionIds'].includes(k)));
}
function validEdit(edit) { return edit && Object.keys(edit).every(k => ['name', 'selection'].includes(k)) && typeof edit.name === 'string' && edit.name.trim().length >= 1 && edit.name.trim().length <= 60 && validSelection(edit.selection); }
function validView(d, storeId, draftId) {
  return d && id(d.id) && (!draftId || d.id === draftId) && d.storeId === storeId && validEdit({ name: d.name, selection: d.selection }) &&
    Number.isSafeInteger(d.revision) && d.revision >= 0 && ['DRAFT', 'CONVERTED', 'CANCELLED'].includes(d.state) &&
    Array.isArray(d.display?.lines) && Number.isFinite(Date.parse(d.createdAt)) && Number.isFinite(Date.parse(d.updatedAt)) &&
    (d.state === 'CONVERTED' ? id(d.orderId) : d.orderId === null);
}
function validateAttempt(a, userId) {
  if (!a || a.version !== 1 || a.userId !== userId || !id(a.storeId) || !['create', 'update', 'cancel', 'quote', 'convert'].includes(a.kind) || !validEdit(a.edit)) return false;
  if (a.kind !== 'create' && (!id(a.draftId) || !Number.isSafeInteger(a.expectedRevision) || a.expectedRevision < 0)) return false;
  const route = a.kind === 'create' ? base : a.kind === 'convert' ? '/orders' : `${base}/${encodeURIComponent(a.draftId)}${['quote', 'cancel'].includes(a.kind) ? `/${a.kind}` : ''}`;
  if (a.path !== route || a.method !== (a.kind === 'update' ? 'PUT' : 'POST')) return false;
  if (['create', 'convert'].includes(a.kind) && (!id(a.key) || a.key.length > 120)) return false;
  const data = a.kind === 'create' ? { storeId: a.storeId, ...a.edit } : a.kind === 'update' ? { storeId: a.storeId, ...a.edit, expectedRevision: a.expectedRevision } : a.kind === 'convert' ? { quoteId: a.quoteId } : { storeId: a.storeId, expectedRevision: a.expectedRevision };
  return (a.kind !== 'convert' || id(a.quoteId)) && JSON.stringify(a.data) === JSON.stringify(data);
}
export function readDraftAttempt(storage, userId) {
  try {
    const raw = storage.get(draftStorageKey(userId));
    if (raw === undefined) return { attempt: null, error: null };
    const a = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!validateAttempt(a, userId)) throw Error();
    return { attempt: copy(a), error: null };
  } catch {
    return { attempt: null, error: fail('挂单恢复记录无法读取，请联系店主核对原操作；核对前不能继续开单。', 'DRAFT_STORAGE') };
  }
}

/** request uses mini-core's {method,data,headers}; storage uses {get,set,remove}, absent = undefined. */
export function createDraftController({ state, request, storage, userId, storeId, onChange = () => {} }) {
  const identity = valueOf(userId), restored = readDraftAttempt(storage, identity);
  Object.assign(state, { items: [], total: 0, page: 1, pageSize: 20, filter: 'DRAFT', remote: null, edit: { name: '', selection: null }, quote: null, order: null, busy: false, blocked: !!(restored.attempt || restored.error), corrupt: !!restored.error, pending: restored.attempt, error: restored.error, notice: '', review: false });
  if (restored.attempt) state.edit = copy(restored.attempt.edit);
  let alive = true, generation = 0;
  const notify = () => { if (alive) onChange(state); };
  const scope = () => {
    if (valueOf(userId) !== identity || (state.pending && state.pending.storeId !== valueOf(storeId))) throw fail('请回到原账号及原门店核对挂单');
    return { userId: identity, storeId: valueOf(storeId), generation, draftId: state.remote?.id };
  };
  const current = c => alive && c.userId === valueOf(userId) && c.storeId === valueOf(storeId) && c.generation === generation && (c.draftId === undefined || c.draftId === state.remote?.id);
  function persist(a) {
    storage.set(draftStorageKey(identity), copy(a));
    const read = readDraftAttempt(storage, identity);
    if (read.error || JSON.stringify(read.attempt) !== JSON.stringify(a)) throw fail('挂单进度保存失败，尚未发送操作，请检查浏览器存储。', 'DRAFT_STORAGE');
  }
  function clear() {
    storage.remove(draftStorageKey(identity));
    const read = readDraftAttempt(storage, identity);
    if (read.error || read.attempt) throw fail('操作已核对，恢复记录尚未清理，请再次核对。', 'DRAFT_STORAGE');
    state.pending = null; state.blocked = false;
  }
  async function read(c, draftId, accept = () => true) {
    const d = await request(`${base}/${encodeURIComponent(draftId)}?storeId=${encodeURIComponent(c.storeId)}`);
    if (!current(c)) return null;
    if (!validView(d, c.storeId, draftId)) throw fail('挂单返回不完整，请重新核对');
    let order = null;
    if (d.state === 'CONVERTED') {
      order = await request(`/orders/${encodeURIComponent(d.orderId)}`);
      if (!current(c)) return null;
      if (order?.id !== d.orderId || order.storeId !== c.storeId) throw fail('订单返回不完整，请重新核对');
    }
    if (!accept()) return null;
    state.remote = d;
    state.order = order;
    return d;
  }
  async function guarded(fn, allowPending = false, selecting = false) {
    if (!alive || state.busy || state.corrupt || (state.blocked && !allowPending)) return false;
    let c; state.busy = true; state.error = null; state.notice = ''; notify();
    try { c = scope(); if (selecting) c.draftId = undefined; return await fn(c); }
    catch (error) { if (!c || current(c)) state.error = error; return false; }
    finally { if (alive && (!c || current(c))) { state.busy = false; notify(); } }
  }
  function writable() {
    if (!state.remote || state.remote.state !== 'DRAFT') throw fail(state.remote?.state === 'CONVERTED' ? '此挂单已生成订单，请查看原订单。' : '请先取出有效挂单', 'DRAFT_ALREADY_CONVERTED');
    if (!validEdit(state.edit)) throw fail('请填写挂单名并核对商品选择。', 'VALIDATION_ERROR');
  }
  function attempt(kind, details = {}) {
    if (kind !== 'create') writable();
    else if (!validEdit(state.edit)) throw fail('请填写1至60字挂单名，商品数量须为1至99份。', 'VALIDATION_ERROR');
    const a = { version: 1, kind, userId: identity, storeId: valueOf(storeId), edit: copy(state.edit), method: kind === 'update' ? 'PUT' : 'POST', ...details };
    if (kind !== 'create') { a.draftId = state.remote.id; a.expectedRevision = state.remote.revision; }
    if (kind === 'create') a.key = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    a.path = kind === 'create' ? base : kind === 'convert' ? '/orders' : `${base}/${encodeURIComponent(a.draftId)}${['quote', 'cancel'].includes(kind) ? `/${kind}` : ''}`;
    a.data = kind === 'create' ? { storeId: a.storeId, ...a.edit } : kind === 'update' ? { storeId: a.storeId, ...a.edit, expectedRevision: a.expectedRevision } : kind === 'convert' ? { quoteId: a.quoteId } : { storeId: a.storeId, expectedRevision: a.expectedRevision };
    if (!validateAttempt(a, identity)) throw fail('原请求不完整，请重新核对', 'VALIDATION_ERROR');
    try { persist(a); } catch { throw fail('挂单进度保存失败，尚未发送操作，请检查浏览器存储。', 'DRAFT_STORAGE'); }
    state.pending = a; state.blocked = true; notify(); return a;
  }
  async function send(a, c) {
    const result = await request(a.path, { method: a.method, data: copy(a.data), ...(a.key ? { headers: { 'Idempotency-Key': a.key } } : {}) });
    if (!current(c)) return false;
    if (a.kind === 'quote') {
      if (!id(result?.id) || result.cashierDraft?.id !== a.draftId || result.cashierDraft?.revision !== a.expectedRevision) throw fail('金额核对返回不完整');
      state.quote = result;
      clear(); return true;
    }
    if (a.kind === 'convert') {
      if (!id(result?.id) || result.storeId !== c.storeId) throw fail('下单返回不完整');
      const d = await read(c, a.draftId);
      if (!d) return false;
      if (d.orderId !== result.id) throw fail('挂单已被其他收银员转单，请核对原订单');
    } else {
      if (!validView(result, c.storeId, a.draftId)) throw fail('挂单返回不完整');
      // The original create payload remains immutable for same-key replay after a lost GET.
      a.resultId = result.id; persist(a);
      if (!await read(c, result.id)) return false;
    }
    clear(); state.review = false; state.notice = a.kind === 'convert' ? '已读取正式订单，请核对订单后明确确认收现金。' : '挂单已保存并重新读取';
    return true;
  }
  async function write(kind, details) {
    return guarded(async c => {
      const a = attempt(kind, details);
      try { return await send(a, c); }
      catch (error) {
        if (!current(c)) return false;
        if (['DRAFT_CHANGED', 'DRAFT_ALREADY_CONVERTED', 'PRODUCT_OPTIONS_CHANGED', 'VALIDATION_ERROR', 'OUT_OF_STOCK', 'PRICE_CHANGED', 'STORE_CLOSED', 'PICKUP_SLOT_UNAVAILABLE', 'QUOTE_EXPIRED'].includes(error.code) && ![401, 403].includes(error.status)) {
          if (a.draftId && await read(c, a.draftId)) { clear(); state.review = true; state.quote = null; }
          else if (kind === 'create' && error.status === 400) clear();
        }
        throw error;
      }
    });
  }
  const ctl = {
    isDirty(edit = state.edit) {
      return !state.remote || !validEdit(edit) || editFingerprint(edit) !== editFingerprint({ name: state.remote.name, selection: state.remote.selection });
    },
    load({ page = state.page, pageSize = state.pageSize, state: filter = state.filter } = {}) {
      return guarded(async c => {
        if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 || !['DRAFT', 'CONVERTED', 'CANCELLED'].includes(filter)) throw fail('分页条件无效');
        const result = await request(`${base}?storeId=${encodeURIComponent(c.storeId)}&state=${filter}&page=${page}&pageSize=${pageSize}`);
        if (!current(c)) return false;
        if (!Array.isArray(result?.items) || !result.items.every(d => validView(d, c.storeId)) || !Number.isSafeInteger(result.total) || result.total < 0 || result.page !== page || result.pageSize !== pageSize) throw fail('挂单列表返回不完整');
        Object.assign(state, { items: result.items, total: result.total, page, pageSize, filter }); return true;
      }, false, true);
    },
    get(draftId, { accept = () => true } = {}) {
      if (state.busy || state.blocked) return Promise.resolve(false);
      generation++;
      return guarded(async c => {
        const d = await read({ ...c, draftId: undefined }, draftId, accept);
        if (!d) return false;
        state.edit = { name: d.name, selection: copy(d.selection) }; state.quote = null; state.review = false; return true;
      }, false, true);
    },
    create: () => write('create'), update: () => write('update'), cancel: () => write('cancel'),
    async quote() {
      if (!alive || state.busy || state.blocked) return false;
      if (!validEdit(state.edit)) { state.error = fail('请先填写挂单名并核对商品选择。', 'VALIDATION_ERROR'); notify(); return false; }
      const savedEdit = () => ({ name: state.remote?.name || '', selection: state.remote?.selection });
      if (!state.remote || editFingerprint(state.edit) !== editFingerprint(savedEdit())) {
        if (!await ctl.update()) return false;
        if (editFingerprint(state.edit) !== editFingerprint(savedEdit())) {
          state.error = fail('保存后挂单又被修改，请核对最新版本；当前输入已保留。', 'DRAFT_CHANGED'); state.review = true; notify(); return false;
        }
      }
      return write('quote');
    },
    convert({ quoteId, orderKey }) {
      if (state.quote?.id !== quoteId || state.quote.cashierDraft?.id !== state.remote?.id || state.quote.cashierDraft?.revision !== state.remote?.revision) {
        state.error = fail('请先保存并核对当前挂单金额'); notify(); return Promise.resolve(false);
      }
      return write('convert', { quoteId, key: orderKey });
    },
    recover(action = 'read') {
      return guarded(async c => {
        const a = state.pending;
        if (!a) return false;
        if (action === 'replay' && ['create', 'convert'].includes(a.kind)) return send(copy(a), c);
        if (!a.draftId && !a.resultId) throw fail('请使用恢复原挂单，以原请求核对创建结果。');
        const d = await read(c, a.draftId || a.resultId);
        if (!d) return false;
        if (a.kind === 'convert') {
          if (d.state !== 'CONVERTED') { state.notice = '原下单结果尚未确认，请继续核对或恢复原下单。'; return true; }
          clear(); state.review = true; state.notice = '挂单已生成订单，请核对实际订单；其他收银员也可能已完成转单。'; return true;
        }
        state.review = true;
        if (action === 'keep' || action === 'reload') {
          if (action === 'reload') state.edit = { name: d.name, selection: copy(d.selection) };
          clear(); state.notice = action === 'keep' ? '已保留本地输入，请按最新版本重新保存。' : '已重新载入服务器挂单';
        } else state.notice = '已读取远端事实，请明确选择重新载入，或保留本地输入后保存。';
        return true;
      }, true);
    },
    detach() {
      if (state.busy || state.blocked) return false;
      generation++; state.remote = null; state.edit = { name: '', selection: null }; state.quote = null; state.order = null; state.review = false; state.error = null; notify(); return true;
    },
    dispose() { alive = false; generation++; },
  };
  notify(); return ctl;
}
