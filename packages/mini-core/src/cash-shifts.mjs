// Same durable-before-send/readback-before-clear convention as cash refunds and drafts.
const copy = v => JSON.parse(JSON.stringify(v));
const id = v => typeof v === 'string' && !!v.trim() && v.length <= 200;
const amount = v => Number.isInteger(v) && v >= 0 && v <= 2_000_000_000;
const safe = v => Number.isSafeInteger(v);
const fail = (message, code = 'SHIFT_RECOVERY') => Object.assign(Error(message), { code });
const base = '/merchant/cash-shifts';
export const shiftStorageKey = userId => `cash-shift:v1:${encodeURIComponent(userId)}`;
export const shiftLocked = (...locks) => locks.some(Boolean);
export function shiftAmount(text) {
  const v = String(text).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(v)) throw fail('请输入金额，最多两位小数', 'VALIDATION_ERROR');
  const [whole, fraction = ''] = v.split('.');
  const fen = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!amount(fen)) throw fail('金额须在0至20000000元之间', 'VALIDATION_ERROR');
  return fen;
}
export function validShift(s, storeId, shiftId) {
  const person = p => id(p?.id) && typeof p.name === 'string';
  const summary = s?.summary;
  return !!(s && id(s.id) && (!shiftId || s.id === shiftId) && s.storeId === storeId && ['OPEN','CLOSED'].includes(s.state) &&
    amount(s.revision) && amount(s.openingFen) && person(s.openedBy) && Number.isFinite(Date.parse(s.openedAt)) && summary &&
    ['paymentCount','refundCount','paidFen','refundFen'].every(k => safe(summary[k]) && summary[k] >= 0) &&
    safe(summary.netFen) && safe(summary.expectedFen) && summary.paidFen - summary.refundFen === summary.netFen && s.openingFen + summary.netFen === summary.expectedFen &&
    (s.state === 'OPEN' ? s.closedBy === null && s.closedAt === null && ['countedFen','differenceFen','reason'].every(k => summary[k] === null) :
      person(s.closedBy) && Number.isFinite(Date.parse(s.closedAt)) && amount(summary.countedFen) && safe(summary.differenceFen) && summary.countedFen - summary.expectedFen === summary.differenceFen &&
      (summary.reason === null ? summary.differenceFen === 0 : typeof summary.reason === 'string' && summary.reason === summary.reason.trim() && summary.reason.length <= 500 && (summary.differenceFen === 0 || summary.reason.length > 0))));
}
function validAttempt(a, userId) {
  if (!a || a.version !== 1 || a.userId !== userId || !id(a.storeId) || !id(a.key) || a.key.length > 120 || !['open','close'].includes(a.kind) || (a.resultId !== undefined && !id(a.resultId))) return false;
  const d = a.data;
  if (a.kind === 'open') return d && Object.keys(d).length === 2 && d.storeId === a.storeId && amount(d.openingFen);
  return id(a.shiftId) && d && Object.keys(d).length === 4 && d.storeId === a.storeId && amount(d.expectedRevision) && amount(d.countedFen) && typeof d.reason === 'string' && d.reason === d.reason.trim() && d.reason.length <= 500;
}
export function readShiftAttempt(storage, userId) {
  try {
    const raw = storage.get(shiftStorageKey(userId));
    if (raw === undefined) return { attempt: null, error: null };
    const a = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!validAttempt(a, userId)) throw Error();
    return { attempt: copy(a), error: null };
  } catch { return { attempt: null, error: fail('交班恢复记录无法读取，请联系店主核对原操作；核对前不能继续开关班。', 'SHIFT_STORAGE') }; }
}

/** context returns {userId,storeId,owner}; transport/storage match cash refunds. */
export function createCashShiftController({ state, storage, request, context, onChange = () => {}, key = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` }) {
  const identity = context().userId, restored = readShiftAttempt(storage, identity);
  Object.assign(state, { current: null, currentLoaded: false, remote: null, items: [], total: 0, page: 1, pageSize: 20, filter: 'ALL', opening: '', counted: '', reason: '', review: false, busy: false,
    pending: restored.attempt, blocked: !!(restored.attempt || restored.error), corrupt: !!restored.error, error: restored.error, notice: '' });
  if (restored.attempt) {
    const a = restored.attempt;
    if (a.kind === 'open') state.opening = (a.data.openingFen / 100).toFixed(2);
    else { state.counted = (a.data.countedFen / 100).toFixed(2); state.reason = a.data.reason; }
  }
  let alive = true;
  const notify = () => { if (alive) onChange(state); };
  const scope = () => {
    const c = context();
    if (c.userId !== identity || !id(c.storeId) || (state.pending && state.pending.storeId !== c.storeId)) throw fail('请回到原账号及原门店核对交班');
    return { userId: identity, storeId: c.storeId };
  };
  const current = c => alive && context().userId === c.userId && context().storeId === c.storeId;
  const owner = () => { if (context().owner !== true) throw fail('仅店主可开班或关闭班次', 'FORBIDDEN'); };
  function save(a) {
    storage.set(shiftStorageKey(identity), copy(a));
    const actual = readShiftAttempt(storage, identity);
    if (actual.error || JSON.stringify(actual.attempt) !== JSON.stringify(a)) throw fail('交班进度保存失败，尚未发送操作，请检查存储后重试', 'SHIFT_STORAGE');
  }
  function clear() {
    storage.remove(shiftStorageKey(identity));
    const actual = readShiftAttempt(storage, identity);
    if (actual.error || actual.attempt) throw fail('操作已核对，恢复记录未能清理，请再次核对', 'SHIFT_STORAGE');
    state.pending = null; state.blocked = false;
  }
  function publish(s) { state.remote = s; if (s.state === 'OPEN') { state.current = s; state.currentLoaded = true; } else if (state.current?.id === s.id) state.current = null; }
  async function detail(c, shiftId) {
    const s = await request(`${base}/${encodeURIComponent(shiftId)}?storeId=${encodeURIComponent(c.storeId)}`);
    if (!current(c)) return null;
    if (!validShift(s, c.storeId, shiftId)) throw fail('班次明细返回不完整，请重新核对');
    publish(s); return s;
  }
  async function active(c) {
    const result = await request(`${base}/current?storeId=${encodeURIComponent(c.storeId)}`);
    if (!current(c)) return false;
    if (!result || !Object.hasOwn(result, 'shift') || (result.shift !== null && (!validShift(result.shift,c.storeId) || result.shift.state !== 'OPEN'))) throw fail('活动班次返回不完整，请重新核对');
    state.current = result.shift; state.currentLoaded = true; return true;
  }
  async function guarded(fn, allowPending = false) {
    if (!alive || state.busy || state.corrupt || (state.blocked && !allowPending)) return false;
    let c; state.busy = true; state.error = null; state.notice = ''; notify();
    try { c = scope(); return await fn(c); }
    catch (e) { if (!c || current(c)) state.error = e; return false; }
    finally { if (alive && (!c || current(c))) { state.busy = false; notify(); } }
  }
  async function send(a, c) {
    owner();
    const result = await request(a.kind === 'open' ? base : `${base}/${encodeURIComponent(a.shiftId)}/close`, { method:'POST', headers:{'Idempotency-Key':a.key}, data:copy(a.data) });
    if (!current(c)) return false;
    if (!validShift(result,c.storeId,a.shiftId) || (a.kind === 'close' && result.state !== 'CLOSED')) throw fail('交班结果返回不完整，请恢复原操作核对');
    a.resultId = result.id; save(a); state.pending = copy(a);
    if (!await detail(c,result.id)) return false;
    clear(); state.review = false; state.notice = a.kind === 'open' ? '已核对原开班结果，请查看班次状态。' : '已核对关班凭证，实点与差额已保存。'; return true;
  }
  async function write(kind, confirmed) {
    return guarded(async c => {
      owner();
      const discovered = readShiftAttempt(storage, identity);
      if (discovered.error || discovered.attempt) {
        state.pending = discovered.attempt; state.blocked = true; state.corrupt = !!discovered.error;
        throw discovered.error || fail('已有原交班操作待核对，请恢复原操作');
      }
      let data;
      if (kind === 'open') data = {storeId:c.storeId,openingFen:shiftAmount(state.opening)};
      else {
        if (!confirmed) throw fail('请先核对现金并明确确认关闭班次');
        if (!state.current || state.current.state !== 'OPEN') throw fail('请先读取活动班次');
        const countedFen = shiftAmount(state.counted), reason = state.reason.trim();
        if (reason.length > 500 || (countedFen !== state.current.summary.expectedFen && !reason)) throw fail('现金有差额，请填写1至500字差额原因', 'VALIDATION_ERROR');
        data = {storeId:c.storeId,expectedRevision:state.current.revision,countedFen,reason};
      }
      const a = {version:1,userId:identity,storeId:c.storeId,kind,key:key(),data,...(kind === 'close' ? {shiftId:state.current.id} : {})};
      if (!validAttempt(a,identity)) throw fail('交班请求不完整');
      try { save(a); } catch { throw fail('交班进度保存失败，尚未发送操作，请检查存储后重试','SHIFT_STORAGE'); }
      state.pending = a; state.blocked = true; notify();
      try { return await send(copy(a),c); }
      catch (e) {
        if (!current(c)) return false;
        // Only a first definitive rejection is eligible. A replay may follow a committed lost response.
        if (['SHIFT_CHANGED','SHIFT_ALREADY_OPEN','VALIDATION_ERROR','SHIFT_TOTAL_TOO_LARGE'].includes(e.code) && [400,409].includes(e.status)) {
          try {
            if (kind === 'close' ? await detail(c,a.shiftId) : await active(c)) { clear(); state.review = true; }
          } catch (readError) { e.message += `；${readError.message || '读取失败'}，请保留原操作恢复核对`; }
        }
        throw e;
      }
    });
  }
  const ctl = {
    current: () => guarded(active, true),
    load({page=state.page,pageSize=state.pageSize,state:filter=state.filter}={}) {
      return guarded(async c => {
        if (!safe(page) || page<1 || !Number.isInteger(pageSize) || pageSize<1 || pageSize>50 || !['ALL','OPEN','CLOSED'].includes(filter)) throw fail('分页条件无效');
        const result = await request(`${base}?storeId=${encodeURIComponent(c.storeId)}&state=${filter}&page=${page}&pageSize=${pageSize}`);
        if (!current(c)) return false;
        if (!Array.isArray(result?.items) || !result.items.every(s=>validShift(s,c.storeId)) || !safe(result.total) || result.total<0 || result.page!==page || result.pageSize!==pageSize) throw fail('班次列表返回不完整');
        Object.assign(state,{items:result.items,total:result.total,page,pageSize,filter}); return true;
      });
    },
    get: shiftId => guarded(async c => !!await detail(c,shiftId)),
    open: () => write('open'),
    close: confirmed => write('close',confirmed),
    recover(action='read') {
      return guarded(async c => {
        const a = state.pending; if (!a) return false;
        if (action === 'replay') return send(copy(a),c);
        if (a.resultId) {
          if (!await detail(c,a.resultId)) return false;
          clear(); state.notice = '已读取原操作凭证，请核对班次状态。'; return true;
        }
        if (a.kind === 'close') {
          const fact = await detail(c,a.shiftId);
          if (fact?.state === 'CLOSED') { clear(); state.notice = '班次已关闭，已读取保存的关班快照，请核对实点和差额。'; return true; }
        } else await active(c);
        if (!current(c)) return false;
        state.notice = '已读取最新班次；原操作结果仍待确认，请恢复原操作核对。'; return true;
      },true);
    },
    dispose() { alive = false; },
  };
  notify(); return ctl;
}
