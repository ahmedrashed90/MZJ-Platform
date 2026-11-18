import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser } from "./_auth.js";
import { isSystemAdministrator, listNotifications, markNotifications } from "./_notifications.js";

function bodyObject(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, any>;
  if (typeof request.body === "string") { try { return JSON.parse(request.body || "{}"); } catch { return {}; } }
  return {};
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  const user = await requireUser(request, response); if (!user) return;
  try {
    if (request.method === "GET") {
      const system = String(request.query.system || "").trim();
      const result = await listNotifications(user, {
        system,
        limit: Number(request.query.limit || 30),
        offset: Number(request.query.offset || 0),
        unreadOnly: String(request.query.unreadOnly || "") === "true",
      });
      return response.status(200).json({ ...result, canViewAll: isSystemAdministrator(user) });
    }
    if (request.method === "POST" || request.method === "PATCH") {
      const body = bodyObject(request);
      const result = await markNotifications(user, {
        ids: Array.isArray(body.ids) ? body.ids : body.id ? [body.id] : [],
        system: String(body.system || ""),
        read: body.read !== false,
        dismiss: body.dismiss === true,
      });
      return response.status(200).json(result);
    }
    return response.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error: any) {
    const message = String(error?.message || "تعذر تحميل الإشعارات");
    return response.status(/صلاحية|مدير النظام/.test(message) ? 403 : 400).json({ ok: false, error: message });
  }
}
