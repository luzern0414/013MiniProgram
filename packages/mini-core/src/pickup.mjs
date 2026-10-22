const copy = (value) => JSON.parse(JSON.stringify(value));
export const pickupDate = (value = new Date()) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("日期无效");
  return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
};
export const pickupWindowText = (window) => {
  if (!window) return "尽快取餐";
  // Fixed store timezone; never use the device's default timezone.
  const local = (value) =>
    new Date(new Date(value).getTime() + 8 * 3600000).toISOString();
  const start = local(window.startsAt),
    end = local(window.endsAt);
  return `${start.slice(0, 10)} ${start.slice(11, 16)}–${end.slice(11, 16)}（北京时间）`;
};
const integer = (value, min, max, name) => {
  if (
    !/^\d+$/.test(String(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw new Error(`${name}请输入${min}至${max}的整数`);
  return Number(value);
};
const validDate = (date) => {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  )
    throw new Error("请选择有效日期");
  return date;
};
export function pickupPreview({ date, start, end, interval, capacity }) {
  validDate(date);
  const minutes = (value) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
      throw new Error("请输入有效起止时间");
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  };
  const first = minutes(start),
    last = minutes(end),
    step = integer(interval, 5, 240, "时段间隔"),
    count = integer(capacity, 1, 1000, "每时段容量");
  if (last <= first || (last - first) % step)
    throw new Error("结束时间须晚于开始时间，且能按间隔完整划分");
  if ((last - first) / step > 96) throw new Error("一次最多生成96个时段");
  const iso = (m) =>
    `${date}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00+08:00`;
  return Array.from({ length: (last - first) / step }, (_, i) => ({
    startsAt: iso(first + i * step),
    endsAt: iso(first + (i + 1) * step),
    capacity: count,
  }));
}
export const isPickupRejection = (error) =>
  [
    "PICKUP_SLOT_FULL",
    "PICKUP_RULES_CHANGED",
    "PICKUP_TIME_UNAVAILABLE",
  ].includes(error?.code);
export const pickupErrorText = (error) => {
  const text =
    {
      PICKUP_SLOT_FULL: "该时段名额已满，请重新查询并选择取餐时间",
      PICKUP_RULES_CHANGED: "预约安排已调整，请重新查询并确认取餐时间",
      PICKUP_TIME_UNAVAILABLE: "该取餐时间已不可预约，请重新查询并选择",
      PICKUP_CONFIGURATION_MISSING:
        "门店尚未设置预约规则，请由店主明确保存后启用",
      STATE_CONFLICT: "信息已变化，请重新读取并核对后操作",
      FORBIDDEN: "你没有当前门店的操作权限，请联系店主",
      UNAUTHENTICATED: "登录已过期，请重新登录",
    }[error?.code] ||
    error?.message ||
    "操作失败，请稍后重试";
  return `${text}${error?.requestId ? `（编号 ${error.requestId}）` : ""}`;
};
const unknown = (e) =>
  ![
    "STATE_CONFLICT",
    "FORBIDDEN",
    "UNAUTHENTICATED",
    "VALIDATION_ERROR",
    "NOT_FOUND",
    "PICKUP_CONFIGURATION_MISSING",
  ].includes(e?.code);

export function createPickupSelection({
  state,
  request,
  storeId,
  locked = () => false,
  onChange = () => {},
  initial = null,
}) {
  Object.assign(state, {
    date: initial?.date || pickupDate(),
    slotId: initial?.slotId || "",
    selected: initial?.selected || null,
    slots: [],
    loading: false,
    error: "",
    needsRefresh: false,
  });
  let generation = 0,
    alive = true;
  const changed = () =>
    onChange(
      copy({
        date: state.date,
        slotId: state.slotId,
        selected: state.selected,
      }),
    );
  return {
    async load(date = state.date) {
      if (!alive || state.loading) return false;
      const store = storeId(),
        ticket = ++generation;
      state.loading = true;
      state.error = "";
      try {
        validDate(date);
        state.date = date;
        const slots = await request(
          `/stores/${encodeURIComponent(store)}/pickup-slots?date=${date}`,
        );
        if (!alive || store !== storeId() || ticket !== generation)
          return false;
        if (!Array.isArray(slots))
          throw new Error("时段读取不完整，请重新查询");
        state.slots = slots;
        state.needsRefresh = false;
        if (
          state.slotId &&
          !slots.some((slot) => slot.id === state.slotId) &&
          !locked()
        )
          changed();
        return true;
      } catch (e) {
        if (alive && ticket === generation) {
          state.needsRefresh = true;
          state.error = pickupErrorText(e);
          if (state.slotId && !locked()) changed();
        }
        return false;
      } finally {
        if (alive && ticket === generation) state.loading = false;
      }
    },
    select(slot) {
      if (!alive || locked() || state.loading) return false;
      state.slotId = slot?.id || "";
      state.selected = slot ? copy(slot) : null;
      state.error = "";
      changed();
      return true;
    },
    quoteFields() {
      if (!state.slotId) return {};
      if (state.needsRefresh || !state.slots.some((s) => s.id === state.slotId))
        throw new Error("原取餐时间尚未确认，请重新查询并重新选择");
      return { pickupSlotId: state.slotId };
    },
    invalidate(error) {
      state.needsRefresh = true;
      state.error = pickupErrorText(error);
    },
    dispose() {
      alive = false;
      generation++;
    },
  };
}

export function createPickupManager({
  state,
  request,
  storeId,
  canEdit = () => true,
}) {
  Object.assign(state, {
    policy: null,
    slots: [],
    date: pickupDate(),
    preview: [],
    previousDraft: null,
    loading: false,
    busy: false,
    blocked: false,
    missing: false,
    error: "",
    notice: "",
  });
  let alive = true,
    generation = 0;
  const current = (c) =>
    alive && c.ticket === generation && c.store === storeId();
  const context = () => ({ ticket: ++generation, store: storeId() });
  async function read(c) {
    let policy,
      missing = false;
    try {
      policy = await request(
        `/merchant/pickup-policy?storeId=${encodeURIComponent(c.store)}`,
      );
    } catch (e) {
      if (e.code !== "PICKUP_CONFIGURATION_MISSING") throw e;
      missing = true;
      policy = {
        enabled: false,
        revision: 0,
        leadMinutes: 15,
        maxAdvanceDays: 14,
        timezone: "Asia/Shanghai",
      };
    }
    if (!current(c)) return false;
    const slots = await request(
      `/merchant/pickup-slots?storeId=${encodeURIComponent(c.store)}&from=${validDate(state.date)}&to=${state.date}`,
    );
    if (!current(c)) return false;
    if (!Array.isArray(slots) || !Number.isInteger(policy.revision))
      throw new Error("预约设置读取不完整，请重新读取");
    state.policy = copy(policy);
    state.missing = missing;
    state.slots = slots.map((slot) => ({
      ...slot,
      draftCapacity: String(slot.capacity),
      draftEnabled: slot.enabled,
    }));
    return true;
  }
  async function load() {
    if (!alive || state.busy || state.loading) return false;
    const c = context();
    state.loading = true;
    state.error = "";
    state.notice = "";
    const previous = copy({
      policy: state.policy,
      preview: state.preview,
      slots: state.slots,
    });
    try {
      if (!(await read(c))) return false;
      if (previous.policy) state.previousDraft = previous;
      if (state.blocked) state.preview = [];
      state.blocked = false;
      state.notice = previous.policy
        ? "已读取门店记录，请对照原草稿核对；已存在的时段请勿再次创建"
        : "";
      return true;
    } catch (e) {
      if (current(c)) state.error = pickupErrorText(e);
      return false;
    } finally {
      if (current(c)) state.loading = false;
    }
  }
  async function write(kind, slot, values) {
    if (
      !alive ||
      state.busy ||
      state.loading ||
      state.blocked ||
      !canEdit() ||
      !state.policy
    )
      return false;
    const c = context();
    let sent = false;
    state.busy = true;
    state.error = "";
    state.notice = "";
    try {
      let path = "/merchant/pickup-policy",
        method = "PUT",
        data;
      if (kind === "policy")
        data = {
          storeId: c.store,
          expectedRevision: state.policy.revision,
          enabled: !!state.policy.enabled,
          leadMinutes: integer(state.policy.leadMinutes, 0, 1440, "提前分钟数"),
          maxAdvanceDays: integer(
            state.policy.maxAdvanceDays,
            1,
            90,
            "可预约天数",
          ),
        };
      else if (kind === "create") {
        if (!state.preview.length || state.preview.length > 96)
          throw new Error("请先生成并核对时段预览");
        path = "/merchant/pickup-slots";
        method = "POST";
        data = { storeId: c.store, slots: copy(state.preview) };
      } else {
        path = `/merchant/pickup-slots/${encodeURIComponent(slot.id)}`;
        method = "PATCH";
        data = {
          storeId: c.store,
          expectedRevision: slot.revision,
          enabled: !!values.enabled,
          capacity: integer(
            values.capacity,
            Math.max(1, slot.heldCount + slot.confirmedCount),
            1000,
            "时段容量",
          ),
        };
      }
      state.previousDraft = copy({
        policy: state.policy,
        preview: state.preview,
        slots: state.slots,
      });
      sent = true;
      await request(path, { method, data });
      if (!current(c)) return false;
      state.blocked = true;
      if (!(await read(c))) return false;
      state.blocked = false;
      if (kind === "create") state.preview = [];
      state.notice = "已保存并读取门店最新记录";
      return true;
    } catch (e) {
      if (current(c)) {
        state.blocked =
          sent && (state.blocked || e.code === "STATE_CONFLICT" || unknown(e));
        state.error =
          pickupErrorText(e) +
          (state.blocked ? "；请重新读取并核对门店记录，勿重复提交" : "");
      }
      return false;
    } finally {
      if (current(c)) state.busy = false;
    }
  }
  return {
    load,
    savePolicy: () => write("policy"),
    createSlots: () => write("create"),
    saveSlot: (slot, values) => write("slot", slot, values),
    dispose() {
      alive = false;
      generation++;
    },
  };
}

export function createPickupRedemption({
  state,
  request,
  storeId,
  orderId,
  onChanged = async (_order) => {},
}) {
  Object.assign(state, {
    number: "",
    order: null,
    busy: false,
    blocked: false,
    error: "",
    notice: "",
  });
  let alive = true,
    generation = 0;
  const current = (c) =>
    alive &&
    c.ticket === generation &&
    c.store === storeId() &&
    c.order === orderId();
  const context = () => ({
    ticket: ++generation,
    store: storeId(),
    order: orderId(),
  });
  async function read(c) {
    const actual = await request(`/orders/${encodeURIComponent(c.order)}`);
    if (!current(c)) return false;
    state.order = actual;
    await onChanged(actual);
    return current(c);
  }
  async function load() {
    if (!alive || state.busy) return false;
    const c = context();
    state.busy = true;
    state.error = "";
    try {
      if (!(await read(c))) return false;
      state.blocked = false;
      state.notice =
        state.order.status === "COMPLETED"
          ? "已确认取餐完成"
          : "已读取订单，请核对状态后继续";
      return true;
    } catch (e) {
      if (current(c)) state.error = pickupErrorText(e);
      return false;
    } finally {
      if (current(c)) state.busy = false;
    }
  }
  async function submit() {
    if (!alive || state.busy || state.blocked) return false;
    const c = context();
    state.busy = true;
    state.error = "";
    state.notice = "";
    let sent = false;
    try {
      const number = state.number.trim();
      if (!number || number.length > 100)
        throw new Error("请输入顾客出示的取餐号");
      sent = true;
      await request(`/merchant/orders/${encodeURIComponent(c.order)}/pickup`, {
        method: "POST",
        data: { storeId: c.store, pickupNumber: number },
      });
      if (!current(c)) return false;
      state.blocked = true;
      if (!(await read(c))) return false;
      state.blocked = false;
      state.notice = "已核销取餐，并读取最新订单";
      return true;
    } catch (e) {
      if (current(c)) {
        state.blocked =
          sent && (state.blocked || unknown(e) || e.code === "STATE_CONFLICT");
        state.error =
          (e.code === "VALIDATION_ERROR"
            ? `取餐号不匹配，请核对顾客出示的号码${e.requestId ? `（编号 ${e.requestId}）` : ""}`
            : pickupErrorText(e)) +
          (state.blocked ? "；结果尚未确认，请读取订单后继续" : "");
      }
      return false;
    } finally {
      if (current(c)) state.busy = false;
    }
  }
  return {
    load,
    submit,
    dispose() {
      alive = false;
      generation++;
    },
  };
}

// Page only the server-authorized exact match set; publish it atomically.
export function createPickupSearch({ state, request, storeId }) {
  Object.assign(state, {
    number: "",
    date: pickupDate(),
    items: [],
    active: false,
    loading: false,
    complete: false,
    error: "",
    readPages: 0,
  });
  let alive = true,
    generation = 0;
  const clear = () => {
    generation++;
    state.active = false;
    state.loading = false;
    state.complete = false;
    state.items = [];
    state.error = "";
  };
  async function search() {
    if (!alive || state.loading) return false;
    const store = storeId(),
      ticket = ++generation,
      number = state.number.trim().toUpperCase(),
      date = state.date;
    const current = () => alive && ticket === generation && store === storeId();
    state.active = true;
    state.loading = true;
    state.complete = false;
    state.error = "";
    state.items = [];
    state.readPages = 0;
    try {
      validDate(date);
      if (!/^(Q\d{4,}|[A-F0-9]{10})$/.test(number) || number.length > 100)
        throw new Error("请输入完整取餐号");
      const found = [];
      const ids = new Set();
      let total;
      for (let page = 1; page <= 10000; page++) {
        const result = await request(
          `/orders?storeId=${encodeURIComponent(store)}&pickupNumber=${encodeURIComponent(number)}&pickupServiceDate=${date}&page=${page}&pageSize=100`,
        );
        if (!current()) return false;
        if (!result || !Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0 ||
            result.page !== page || result.pageSize !== 100 ||
            (total !== undefined && total !== result.total) ||
            result.items.length !== Math.min(100, Math.max(0, result.total - (page - 1) * 100)))
          throw new Error("订单读取不完整，请重新查询");
        total = result.total;
        state.readPages = page;
        for (const order of result.items) {
          if (!order?.id || ids.has(order.id)) throw new Error("订单读取不完整，请重新查询");
          ids.add(order.id);
          found.push(order);
        }
        if (page * 100 >= total) {
          state.items = found;
          state.complete = true;
          return true;
        }
      }
      throw new Error("订单查询未完成，请重新查询");
    } catch (e) {
      if (current()) state.error = pickupErrorText(e);
      return false;
    } finally {
      if (current()) state.loading = false;
    }
  }
  return {
    search,
    clear,
    dispose() {
      alive = false;
      generation++;
    },
  };
}
