export function normalizeStaffAccount(account) {
  const value = String(account || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,64}$/.test(value))
    throw new Error("账号需为3至64位字母、数字、点、下划线或短横线");
  return value;
}
function passwordValue(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 128)
    throw new Error("密码需为12至128个字符，首尾空格会保留");
  return password;
}
function nameValue(name) {
  const value = String(name || "").trim();
  if (!value || value.length > 80) throw new Error("请填写1至80个字符的姓名");
  return value;
}
function grants(storeIds) {
  const ids = [...new Set(storeIds || [])];
  if (!ids.length || ids.length > 100) throw new Error("请选择1至100家授权门店");
  return ids;
}
export function staffLoginPayload(config, account, password) {
  if (!config?.brandId) throw new Error("门店配置尚未就绪，请重新加载后登录");
  return { brandId: config.brandId, account: normalizeStaffAccount(account), password: passwordValue(password) };
}
export function staffCreatePayload(storeId, form) {
  const storeIds = grants(form.storeIds);
  if (!storeIds.includes(storeId)) throw new Error("新员工需授权当前门店");
  return { storeId, name: nameValue(form.name), account: normalizeStaffAccount(form.account), password: passwordValue(form.password), storeIds };
}
export function staffEditPayload(storeId, target, form) {
  return { storeId, expectedRevision: target.revision, name: nameValue(form.name), storeIds: grants(form.storeIds) };
}
export const staffConflict = (error) => error?.code === "VERSION_CONFLICT";
export function staffErrorText(error, login = false) {
  const message = ({
    UNAUTHENTICATED: login ? "账号或密码不正确，请核对后重试" : "登录已过期，请重新登录",
    ACCOUNT_CONFLICT: "该账号已存在，请更换账号或查看员工列表",
    VERSION_CONFLICT: "员工信息已被修改，请重新加载并核对后保存",
    RATE_LIMITED: "登录尝试过于频繁，请稍后再试",
    FORBIDDEN: "你没有管理此员工或门店的权限，请联系店主",
    VALIDATION_ERROR: "填写内容不符合要求，请核对账号、姓名、密码和授权门店",
  })[error?.code] || error?.message || "操作失败，请稍后重试";
  return `${message}${error?.requestId ? `（编号 ${error.requestId}）` : ""}`;
}

// State is supplied by the host so Vue and uni-app can keep their own reactivity.
export function createStaffController({ state, request, storeId }) {
  Object.assign(state, { items: [], loading: false, busy: false, error: "", notice: "", mode: "", target: null, form: {}, conflict: false });
  function open(target = null, mode = "edit") {
    if (state.busy) return;
    state.target = target ? { ...target, storeIds: [...target.storeIds] } : null;
    state.form = { name: target?.name || "", account: target?.account || "", password: "", storeIds: [...(target?.storeIds || [storeId()])] };
    state.mode = target ? mode : "create";
    state.conflict = false;
    state.error = "";
    state.notice = "";
  }
  function close() {
    if (state.busy) return;
    state.form.password = "";
    state.mode = "";
    state.target = null;
  }
  async function load() {
    if (state.loading || state.busy) return false;
    state.loading = true;
    state.error = "";
    try {
      state.items = await request(`/merchant/staff?storeId=${encodeURIComponent(storeId())}`);
      return true;
    } catch (e) {
      state.error = staffErrorText(e);
      return false;
    } finally { state.loading = false; }
  }
  async function reloadEditor() {
    const id = state.target?.id;
    if (!await load()) return;
    const latest = state.items.find((item) => item.id === id);
    if (latest) open(latest, state.mode);
    else { close(); state.notice = "该员工已不在当前门店，请核对列表"; }
  }
  async function save() {
    if (state.busy || state.conflict) return false;
    const target = state.target;
    let path = "/merchant/staff", method = "POST", data;
    state.error = "";
    state.notice = "";
    try {
      if (!target) data = staffCreatePayload(storeId(), state.form);
      else {
        if (target.role !== "CLERK") throw new Error("店主账号不通过员工入口修改");
        path += `/${encodeURIComponent(target.id)}`;
        if (state.mode === "reset") {
          path += "/reset-password";
          data = { storeId: storeId(), expectedRevision: target.revision, password: passwordValue(state.form.password) };
        } else if (state.mode === "toggle") {
          method = "PATCH";
          data = { storeId: storeId(), expectedRevision: target.revision, enabled: !target.enabled };
        } else {
          method = "PATCH";
          data = staffEditPayload(storeId(), target, state.form);
        }
      }
      state.busy = true;
      const result = await request(path, { method, data });
      state.items = state.items.filter((item) => item.id !== result.id);
      if (result.storeIds.includes(storeId())) state.items.push(result);
      state.notice = state.mode === "reset" ? "密码已重设，员工需重新登录" : state.mode === "toggle" ? (result.enabled ? "员工已启用" : "员工已停用，登录会话已撤销") : "员工信息已保存";
      state.busy = false;
      close();
      return true;
    } catch (e) {
      state.conflict = staffConflict(e);
      state.error = staffErrorText(e);
      if (["NETWORK", "NETWORK_ERROR", "TIMEOUT", "UNKNOWN", "INVALID_RESPONSE"].includes(e?.code))
        state.error += "；未能确认保存结果，请先关闭并刷新员工列表核对";
      return false;
    } finally {
      state.form.password = "";
      state.busy = false;
    }
  }
  return { open, close, load, reloadEditor, save };
}
