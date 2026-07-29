import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser } from "./_auth.js";
import { hasPermission } from "../shared/system-access.js";
import { getDashboardData } from "./_dashboard-data.js";
import { ensureOperationsSchema } from "./_operations-schema.js";
import { ensureTrackingSchema } from "./_tracking-schema.js";
import { getDashboardLayout, saveDashboardLayout } from "./_dashboard-layout.js";
import { ensureErpNextSalesOrderSchema } from "./_erpnext-integration-schema.js";

function validDate(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function riyadhDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!["GET", "PUT"].includes(request.method || "")) return response.status(405).json({ ok: false, error: "Method not allowed" });
  const user = await requireUser(request, response);
  if (!user) return;
  if (!hasPermission(user, "platform.dashboard.view")) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لمشاهدة الداش بورد الموحدة" });
  if (request.method === "PUT") {
    let body: Record<string, unknown> = {};
    if (request.body && typeof request.body === "object") body = request.body as Record<string, unknown>;
    else if (typeof request.body === "string") {
      try { body = JSON.parse(request.body || "{}"); } catch { body = {}; }
    }
    const layout = await saveDashboardLayout(user.id, body.operationWidgetOrder);
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json({ ok: true, layout });
  }
  const requestedFrom = validDate(request.query.from);
  const requestedTo = validDate(request.query.to);
  const to = requestedTo || riyadhDate();
  const from = requestedFrom || riyadhDate(-6);
  if (from > to) return response.status(400).json({ ok: false, error: "تاريخ البداية يجب أن يكون قبل تاريخ النهاية" });
  await Promise.all([ensureTrackingSchema(), ensureOperationsSchema(), ensureErpNextSalesOrderSchema()]);
  const [data, layout] = await Promise.all([getDashboardData(user, { from, to }), getDashboardLayout(user.id)]);
  (data as any).layout = layout;
  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json(data);
}
