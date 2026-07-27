import type { NotificationsResponse } from "./types";

async function readJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || "تعذر تنفيذ طلب الإشعارات");
  return payload;
}

export async function fetchNotifications(system = "", limit = 30, unreadOnly = false) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (system) params.set("system", system);
  if (unreadOnly) params.set("unreadOnly", "true");
  const response = await fetch(`/api/notifications?${params.toString()}`, { credentials: "include", cache: "no-store" });
  return readJson(response) as Promise<NotificationsResponse>;
}

export async function updateNotifications(input: { ids?: string[]; system?: string; read?: boolean; dismiss?: boolean }) {
  const response = await fetch("/api/notifications", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson(response) as Promise<{ ok: boolean; updated: number }>;
}
