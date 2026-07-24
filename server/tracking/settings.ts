import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser } from "../_auth.js";
import { hasPermission } from "../_access-control.js";
import { getSql } from "../_db.js";
import { ensureTrackingSchema } from "../_tracking-schema.js";
import { clean } from "../_tracking-utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  await ensureTrackingSchema();
  const user = await requireUser(request, response);
  if (!user) return;
  const required = request.method === "GET" ? "settings.tracking.view" : "settings.tracking.manage";
  if (!hasPermission(user, required)) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لإعدادات التتبع" });
  const sql = getSql();

  if (request.method === "GET") {
    const stages = await sql<any[]>`select *,id::text from tracking.stages order by sort_order`;
    return response.status(200).json({ ok: true, stages });
  }

  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const id = clean(body.id);
  const name = clean(body.name);
  const description = clean(body.description);
  if (!id || !name) return response.status(400).json({ ok: false, error: "اسم المرحلة مطلوب" });

  const [stage] = await sql<any[]>`
    update tracking.stages set name=${name},description=${description||null},sms_enabled=${body.smsEnabled===true},is_active=${body.isActive!==false},updated_at=now()
    where id=${id}::uuid returning *,id::text
  `;
  if (!stage) return response.status(404).json({ ok: false, error: "المرحلة غير موجودة" });
  await sql`
    insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data)
    values (${user.id}::uuid,'tracking','stage_settings_updated','tracking_stage',${stage.code},${sql.json(stage)})
  `;
  return response.status(200).json({ ok: true, stage, message: "تم حفظ إعدادات المرحلة" });
}
