import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isCrmManager, requireCrmUser } from "../_crm-utils.js";
import { getSql } from "../_db.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "إعدادات دخول وتوزيع العملاء متاحة للإدارة فقط" });
  if (request.method !== "GET") {
    return response.status(409).json({
      ok: false,
      error: "تم نقل رسائل واختيارات دخول العملاء إلى إعدادات الأوتوميشن لمنع وجود مصدرين متوازيين.",
      settingsRoute: "/api/crm/automation-settings",
    });
  }
  const sql = getSql();
  const [settings] = await sql<any[]>`
    select automation_name,automation_enabled,trigger_policy,custom_interval_value,custom_interval_unit,updated_at
    from crm.automation_settings where id='default'
  `;
  return response.status(200).json({
    ok: true,
    managedBy: "automation-settings",
    settings,
    responsibilities: {
      automation: ["messages", "choices", "steps", "answers", "platforms", "workers", "final_actions"],
      entryDistribution: ["assignment_rules", "round_robin", "branches", "departments", "eligible_users", "call_center_assignment"],
    },
  });
}
