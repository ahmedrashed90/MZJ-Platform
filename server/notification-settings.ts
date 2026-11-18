import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser } from "./_auth.js";
import { getNotificationPreferences, saveNotificationPreferences, type NotificationPreferencesInput } from "./_notifications.js";

function bodyObject(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as NotificationPreferencesInput;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body || "{}") as NotificationPreferencesInput; } catch { return {}; }
  }
  return {};
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  const user = await requireUser(request, response);
  if (!user) return;

  try {
    if (request.method === "GET") {
      const preferences = await getNotificationPreferences(user.id);
      return response.status(200).json({ ok: true, preferences });
    }
    if (request.method === "POST" || request.method === "PATCH") {
      const preferences = await saveNotificationPreferences(user.id, bodyObject(request));
      return response.status(200).json({ ok: true, preferences });
    }
    return response.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error: any) {
    console.error("Notification settings error", error);
    return response.status(400).json({ ok: false, error: String(error?.message || "تعذر حفظ إعدادات الإشعارات") });
  }
}
