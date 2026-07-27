export async function operationsFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const message = payload.error || payload.message || "تعذر تنفيذ العملية";
    const error = new Error(payload.requestId ? `${message} — رقم المرجع: ${payload.requestId}` : message) as Error & { code?: string; requestId?: string; details?: unknown };
    error.code = payload.code;
    error.requestId = payload.requestId;
    error.details = payload.details;
    throw error;
  }
  return payload as T;
}

export function queryString(values: Record<string, unknown>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  });
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function formatOperationsDate(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date.toLocaleString("ar-SA") : "—";
}

export { exportXlsx as exportExcel, parseDelimitedFile } from "./excel";
