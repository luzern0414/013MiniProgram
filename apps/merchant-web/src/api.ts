import { errorMessage } from "./domain.mjs";
import { shouldExpireSession } from "./session.mjs";
export class ApiError extends Error {
  constructor(
    public code: string,
    public requestId?: string,
    public status?: number,
  ) {
    super(errorMessage({ code }));
  }
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; key?: string } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const token = sessionStorage.getItem("merchant-token");
  try {
    const response = await fetch(
      `${import.meta.env.VITE_API_BASE || "/api/v1"}${path}`,
      {
        method: options.method || "GET",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.body !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
          ...(options.key ? { "Idempotency-Key": options.key } : {}),
        },
        body:
          options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      },
    );
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !("data" in data)) {
      if (shouldExpireSession(token, sessionStorage.getItem("merchant-token"), data?.error?.code)) {
        sessionStorage.removeItem("merchant-token");
        window.dispatchEvent(new Event("merchant-unauthenticated"));
      }
      throw new ApiError(data?.error?.code || "UNKNOWN", data?.requestId, response.status);
    }
    return data.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError")
      throw new ApiError("TIMEOUT");
    throw new ApiError("NETWORK");
  } finally {
    clearTimeout(timeout);
  }
}
