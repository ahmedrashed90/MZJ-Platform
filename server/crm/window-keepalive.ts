import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clean, parseBody, requireCrmUser } from "../_crm-utils.js";
import { hasPermission } from "../_access-control.js";
import { listKeepaliveLog, loadKeepaliveSettings, saveKeepaliveSettings } from "../_crm-window-keepalive.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!hasPermission(user, "settings.crm.view")) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لمشاهدة إعدادات CRM" });
  if (request.method === "GET") {
    const [settings, log] = await Promise.all([loadKeepaliveSettings(), listKeepaliveLog(Number(request.query.limit || 50))]);
    return response.status(200).json({ ok: true, settings, log: log.rows, stats: log.stats });
  }
  if (request.method === "PUT" || request.method === "POST") {
    if (!hasPermission(user, "settings.crm.manage")) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لتعديل إعدادات CRM" });
    const body = parseBody(request);
    const settings = await saveKeepaliveSettings(body.settings || body, clean(user.id) || null);
    return response.status(200).json({ ok: true, settings });
  }
  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
