import { createCashShiftController, readShiftAttempt } from '../../../packages/mini-core/src/cash-shifts.mjs';
import { uniDraftStorage } from './cashier.js';

export const uniShiftStorage = (runtime = uni) => uniDraftStorage(runtime);

// The shared controller owns writes and recovery. This adapter only composes the
// merchant's other operation locks and discovers records without mounting a view.
export function createMiniCashShifts({ state, request, context, storage = uniShiftStorage(), locked = () => false, key }) {
  const controller = createCashShiftController({ state, request, context, storage, key });
  let alive = true;
  function discover() {
    if (!alive || state.busy) return;
    const found = readShiftAttempt(storage, context().userId);
    if (found.attempt || found.error) {
      state.pending = found.attempt; state.blocked = true; state.corrupt = !!found.error;
      if (found.error) state.error = found.error;
    }
  }
  const gate = fn => async (...args) => {
    if (!alive || locked()) return false;
    discover();
    return fn(...args);
  };
  return {
    state, discover,
    current: gate(controller.current), load: gate(controller.load), get: gate(controller.get),
    open: gate(controller.open), close: gate(controller.close), recover: gate(controller.recover),
    dispose() { alive = false; controller.dispose(); },
  };
}
