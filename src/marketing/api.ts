export async function marketingFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...(init.headers || {}) } : init?.headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || "تعذر تنفيذ طلب التسويق");
  return payload as T;
}

export function marketingMutation<T>(resource: string, method: "POST" | "PUT" | "DELETE", body?: unknown) {
  return marketingFetch<T>(`/api/marketing?resource=${encodeURIComponent(resource)}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
