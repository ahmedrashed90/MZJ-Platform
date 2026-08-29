import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser } from "../_auth.js";
import { hasPermission } from "../_access-control.js";
import { getSql } from "../_db.js";
import { ensureTrackingSchema } from "../_tracking-schema.js";
import { clean } from "../_tracking-utils.js";
import { defaultTrackingSmsTemplate, TRACKING_SMS_TEMPLATE_STAGES } from "../_tracking-message-templates.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  await ensureTrackingSchema();
  const user = await requireUser(request, response);
  if (!user) return;
  const required = request.method === "GET" ? "settings.tracking.view" : "settings.tracking.manage";
  if (!hasPermission(user, required)) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لإعدادات التتبع" });
  const sql = getSql();

  if (request.method === "GET") {
    const rows = await sql<any[]>`select *,id::text from tracking.stages order by sort_order`;
    const stages = rows.map((stage) => ({
      ...stage,
      sms_message_template: TRACKING_SMS_TEMPLATE_STAGES.has(Number(stage.sort_order))
        ? (clean(stage.sms_message_template) || defaultTrackingSmsTemplate(stage.sort_order))
        : stage.sms_message_template,
    }));
    return response.status(200).json({ ok: true, stages });
  }

  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const id = clean(body.id);
  const name = clean(body.name);
  const description = clean(body.description);
  if (!id || !name) return response.status(400).json({ ok: false, error: "اسم المرحلة مطلوب" });

  const [current] = await sql<any[]>`select id::text,sort_order,sms_message_template from tracking.stages where id=${id}::uuid limit 1`;
  if (!current) return response.status(404).json({ ok: false, error: "المرحلة غير موجودة" });
  const supportsEditableTemplate = TRACKING_SMS_TEMPLATE_STAGES.has(Number(current.sort_order));
  const smsMessageTemplate = supportsEditableTemplate
    ? (clean(body.smsMessageTemplate) || defaultTrackingSmsTemplate(current.sort_order))
    : current.sms_message_template;

  const [stage] = await sql<any[]>`
    update tracking.stages set
      name=${name},
      description=${description||null},
      sms_enabled=${body.smsEnabled===true},
      is_active=${body.isActive!==false},
      sms_message_template=${smsMessageTemplate||null},
      updated_at=now()
    where id=${id}::uuid returning *,id::text
  `;
  await sql`
    insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data)
    values (${user.id}::uuid,'tracking','stage_settings_updated','tracking_stage',${stage.code},${sql.json(stage)})
  `;
  return response.status(200).json({ ok: true, stage, message: "تم حفظ إعدادات المرحلة" });
}
