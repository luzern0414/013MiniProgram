export function clearMerchantSession(storage) {
  for (const key of ["merchant-token", "merchant-store"])
    storage.removeItem(key);
}
export const shouldExpireSession = (requestToken, currentToken, code) =>
  Boolean(requestToken && requestToken === currentToken && code === "UNAUTHENTICATED");
export async function logoutMerchant(request, clear) {
  const result = request("/auth/logout", { method: "POST", body: {} });
  clear();
  try {
    await result;
    return "已退出登录";
  } catch (error) {
    return `本机已退出，未能确认服务器会话已撤销，请稍后重新登录并退出${error?.requestId ? `（编号 ${error.requestId}）` : ""}`;
  }
}
