export async function operationsFetch<T>(resource: string, options?: RequestInit & { query?: Record<string, string | number | boolean | undefined> }): Promise<T> {
  const params = new URLSearchParams({ resource });
  Object.entries(options?.query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  const response = await fetch(`/api/operations?${params.toString()}`, {
    credentials: "include",
    ...options,
    headers: options?.body ? { "content-type": "application/json", ...(options.headers || {}) } : options?.headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || "تعذر تنفيذ الإجراء داخل نظام العمليات");
  if (typeof window !== "undefined" && String(options?.method || "GET").toUpperCase() !== "GET") {
    window.dispatchEvent(new CustomEvent("operations:data-changed", { detail: { resource } }));
  }
  return payload as T;
}

export function queryString(values: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return params.toString();
}
