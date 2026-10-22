import {
  createDraftController, draftSelection, hydrateDraft,
} from '../../../packages/mini-core/src/cashier-drafts.mjs';
import {
  cartSelectionIssue, selectionLine, selectionKey, createPickupSelection,
} from '@restaurant/mini-core';

const copy = value => JSON.parse(JSON.stringify(value));

// uni returns '' for absent keys. Enumerate first so damaged values fail closed.
export function uniDraftStorage(runtime = uni) {
  return {
    get(key) {
      const keys = runtime.getStorageInfoSync().keys;
      if (!Array.isArray(keys)) throw Error('无法核对本机存储');
      return keys.includes(key) ? runtime.getStorageSync(key) : undefined;
    },
    set: (key, value) => runtime.setStorageSync(key, copy(value)),
    remove: key => runtime.removeStorageSync(key),
  };
}

/** Mobile selection/presentation adapter; all draft writes/recovery use the shared controller. */
export function createMiniCashier({ state, request, storage, userId, storeId, modes = ['PICKUP', 'DINE_IN'], locked = () => false, onOrder = () => {} }) {
  const identity = userId(), store = storeId();
  let alive = true, taking = 0;
  const current = () => alive && userId() === identity && storeId() === store;
  Object.assign(state, { drafts: {}, catalog: { categories: [], products: [] }, tables: [], cart: [], name: '', mode: modes.find(mode => ['PICKUP', 'DINE_IN'].includes(mode)) || 'PICKUP', tableCode: '', note: '', pickup: {}, loading: false, menuError: '', error: '' });
  const controller = createDraftController({ state: state.drafts, request, storage, userId, storeId });
  const navigationLocked = () => !current() || locked() || state.loading || state.pickup.loading || state.drafts.busy || state.drafts.blocked;
  const editingLocked = () => navigationLocked() || !!state.drafts.order || (!!state.drafts.remote && state.drafts.remote.state !== 'DRAFT');
  const pickup = createPickupSelection({ state: state.pickup, request, storeId, locked: editingLocked, onChange: () => { state.drafts.quote = null; } });
  function applySelection(selection, display = { lines: [] }) {
    const value = hydrateDraft({ selection, display }, state.catalog);
    state.cart = value.cart;
    state.mode = value.mode; state.tableCode = value.tableCode || ''; state.note = value.note;
    Object.assign(state.pickup, { slotId: value.pickupSlotId || '', selected: null, needsRefresh: !!value.pickupSlotId, error: value.pickupSlotId ? '原预约时间尚待核对，请重新查询；不会自动改成即时自取。' : '' });
  }
  if (state.drafts.edit.selection) {
    state.name = state.drafts.edit.name;
    applySelection(state.drafts.edit.selection);
  }
  function sync() {
    state.drafts.edit = { name: state.name, selection: draftSelection(state.cart, { mode: state.mode, tableCode: state.tableCode, pickupSlotId: state.pickup.slotId, note: state.note }) };
  }
  function refreshCartDisplay() {
    if (state.drafts.order) return;
    const remote = state.drafts.remote;
    // Remote lines may have been reordered or edited; only borrow names for the same choices.
    const display = { lines: state.cart.map(line => {
      const index = remote?.selection.lines.findIndex(item => selectionKey(item) === selectionKey(line));
      return { productName: line.productName, skuName: line.skuName, modifierNames: line.modifierNames, ...line.display, ...(index >= 0 ? remote.display.lines[index] : {}) };
    }) };
    const selection = draftSelection(state.cart, { mode: state.mode, tableCode: state.tableCode, pickupSlotId: state.pickup.slotId, note: state.note });
    const hydrated = hydrateDraft({ selection, display }, state.catalog).cart;
    state.cart = state.cart.map((line, index) => {
      const { productName, skuName, modifierNames, attributes, display } = hydrated[index];
      // Preserve input, prices and configuration revisions; this is presentation-only hydration.
      // Keep the next fallback consistent with the resolved names, including menu-derived names.
      return { ...line, productName, skuName, modifierNames, attributes: attributes || line.attributes, display: { ...display, productName, skuName, modifierNames } };
    });
  }
  const lineIssue = line => cartSelectionIssue(line, state.catalog.products);
  function changed() { state.error = ''; state.drafts.quote = null; sync(); }
  function selectionAllowed(fn) {
    if (editingLocked()) return false;
    try { fn(); changed(); return true; } catch (error) { state.error = error.message; return false; }
  }
  const api = {
    state, controller, pickup, navigationLocked, editingLocked, lineIssue,
    pendingStore: () => state.drafts.pending?.storeId || '',
    async loadMenu() {
      if (!current() || state.loading || locked() || state.drafts.busy) return false;
      state.loading = true; state.menuError = '';
      try {
        const [catalog, tables] = await Promise.all([request(`/stores/${encodeURIComponent(store)}/catalog`), request(`/stores/${encodeURIComponent(store)}/tables`)]);
        if (!current()) return false;
        if (!Array.isArray(catalog?.products) || !Array.isArray(tables)) throw Error('菜单读取不完整，请重新加载');
        state.catalog = catalog; state.tables = tables;
        refreshCartDisplay();
        return true;
      } catch (error) { if (current()) state.menuError = `${error.message}${error.requestId ? `（编号 ${error.requestId}）` : ''}`; return false; }
      finally { if (current()) state.loading = false; }
    },
    editField(field, value) {
      if (!['name', 'note', 'mode', 'tableCode'].includes(field)) return false;
      return selectionAllowed(() => { state[field] = value; });
    },
    add(original, replaceIndex = -1) {
      return selectionAllowed(() => {
        const product = state.catalog.products.find(p => p.skus.some(s => s.id === original.skuId));
        if (!product) throw Error('商品或规格已失效，请重新选择');
        let line = selectionLine(product, original);
        const cart = state.cart.filter((_, index) => index !== replaceIndex).map(item => ({ ...item }));
        const existing = cart.find(item => selectionKey(item) === selectionKey(line));
        if (existing) {
          line = selectionLine(product, { ...line, quantity: line.quantity + existing.quantity });
          Object.assign(existing, line);
        } else cart.push(line);
        state.cart = cart;
      });
    },
    changeQuantity(index, quantity) {
      return selectionAllowed(() => {
        const original = state.cart[index];
        const product = state.catalog.products.find(p => p.skus.some(s => s.id === original?.skuId));
        if (!product) throw Error('商品或规格已失效，请重新选择');
        state.cart[index] = selectionLine(product, { ...original, quantity });
      });
    },
    remove(index) { return selectionAllowed(() => { state.cart.splice(index, 1); }); },
    async take(id, { replace = false } = {}) {
      if (editingLocked() || (state.cart.length && !replace)) return false;
      const ticket = ++taking;
      const accepted = await controller.get(id, { accept: () => current() && ticket === taking && !locked() });
      if (!accepted || !current() || ticket !== taking) return false;
      state.name = state.drafts.remote.name;
      applySelection(state.drafts.remote.selection, state.drafts.remote.display);
      state.error = '';
      return true;
    },
    cancelTake() { taking++; },
    async save() {
      if (editingLocked() || !state.cart.length) return false;
      state.drafts.quote = null; sync();
      return state.drafts.remote ? controller.update() : controller.create();
    },
    async quote() {
      if (editingLocked()) return false;
      state.error = ''; state.drafts.quote = null;
      try {
        if (!state.cart.length) throw Error('请先选择商品');
        const issue = state.cart.map(lineIssue).find(Boolean);
        if (issue) throw Error(issue);
        if (state.mode === 'DINE_IN' && !state.tables.some(t => t.code === state.tableCode && t.enabled !== false)) throw Error('原桌台暂不可用，请重新选择本店桌台');
        if (state.mode === 'PICKUP') pickup.quoteFields();
        sync();
        if (!state.drafts.remote && !await controller.create()) return false;
        return controller.quote();
      } catch (error) { if (current()) state.error = error.message; return false; }
    },
    convert() {
      if (editingLocked() || !state.drafts.quote) return Promise.resolve(false);
      return controller.convert({ quoteId: state.drafts.quote.id, orderKey: globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` });
    },
    async recover(action = 'read') {
      if (!current() || locked() || state.drafts.busy) return false;
      const result = await controller.recover(action);
      if (result && current() && action === 'reload') {
        state.name = state.drafts.edit.name;
        applySelection(state.drafts.edit.selection, state.drafts.remote.display);
      } else if (result && current()) refreshCartDisplay();
      return result;
    },
    async cancel() {
      if (editingLocked()) return false;
      state.drafts.quote = null;
      sync(); return controller.cancel();
    },
    reloadRemote() {
      if (navigationLocked() || !state.drafts.remote) return Promise.resolve(false);
      return api.take(state.drafts.remote.id, { replace: true });
    },
    newBag() {
      if (navigationLocked() || !controller.detach()) return false;
      Object.assign(state, { cart: [], name: '', note: '', tableCode: '', error: '' });
      Object.assign(state.pickup, { slotId: '', selected: null, needsRefresh: false, error: '' });
      return true;
    },
    showOrder() {
      if (navigationLocked() || !state.drafts.order) return false;
      onOrder(copy(state.drafts.order)); return true;
    },
    dispose() { alive = false; taking++; controller.dispose(); pickup.dispose(); },
  };
  return api;
}
