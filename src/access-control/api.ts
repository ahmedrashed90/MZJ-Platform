export async function accessFetch<T>(resource = "bootstrap", init?: RequestInit): Promise<T> {
  const url = resource.startsWith("/") ? resource : `/api/access-control?resource=${resource}`;
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || "تعذر تنفيذ طلب الصلاحيات");
  return payload as T;
}

export async function accessAction<T>(payload: Record<string, unknown>): Promise<T> {
  return accessFetch<T>("bootstrap", { method: "POST", body: JSON.stringify(payload) });
}
