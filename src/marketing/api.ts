export async function marketingFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || payload.ok === false) {
    const error = new Error(String(payload.error || "تعذر تنفيذ العملية")) as Error & { code?: string; details?: unknown };
    error.code = typeof payload.code === "string" ? payload.code : undefined;
    error.details = payload.details;
    throw error;
  }
  return payload as T;
}
export function marketingQuery(values: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
}
export function formatDate(value: unknown, withTime = false) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return String(value);
  return withTime ? date.toLocaleString("ar-SA") : date.toLocaleDateString("ar-SA");
}
export function uid(prefix = "row") { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }
export function todayIso() { return new Date().toISOString().slice(0, 10); }
export function monthStartIso() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`; }
