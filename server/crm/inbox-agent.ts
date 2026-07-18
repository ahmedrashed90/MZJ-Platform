import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clean, parseBody, requireCrmPermission, requireCrmUser } from "../_crm-utils.js";
import { getSql } from "../_db.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const sql = getSql();

  if (request.method === "GET") {
    if (!(await requireCrmPermission(user, response, "crm.inbox_agent.view"))) return;
    const [settings, managers, logs] = await Promise.all([
      sql`select * from crm.inbox_agent_settings where id='default'`,
      sql`select *,id::text,updated_by::text from crm.inbox_agent_managers order by scope_code`,
      sql`select *,id::text,conversation_id::text,lead_id::text from crm.inbox_agent_logs order by created_at desc limit 500`,
    ]);
    return response.status(200).json({ ok: true, settings: settings[0], managers, logs });
  }

  if (!(await requireCrmPermission(user, response, "crm.inbox_agent.manage"))) return;
  const body = parseBody(request);
  const section = clean(body.section || "settings");

  if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
    if (section === "manager") {
      const scopeCode = clean(body.scopeCode);
      const managerName = clean(body.managerName);
      const whatsappPhone = clean(body.whatsappPhone);
      if (!scopeCode || !managerName || !whatsappPhone) return response.status(400).json({ ok: false, error: "اختر القسم واكتب اسم المدير ورقم الواتساب" });
      const [row] = await sql<any[]>`
        insert into crm.inbox_agent_managers(scope_code,manager_name,whatsapp_phone,is_active,updated_by,updated_at)
        values (${scopeCode},${managerName},${whatsappPhone},${body.isActive!==false},${user.id}::uuid,now())
        on conflict (scope_code) do update set manager_name=excluded.manager_name,whatsapp_phone=excluded.whatsapp_phone,is_active=excluded.is_active,updated_by=excluded.updated_by,updated_at=now()
        returning *,id::text
      `;
      return response.status(200).json({ ok: true, row });
    }

    const replies = Array.isArray(body.replies) ? body.replies.map(clean).filter(Boolean) : [];
    const stopKeywords = Array.isArray(body.stopKeywords) ? body.stopKeywords.map(clean).filter(Boolean) : [];
    const socialPlatforms = Array.isArray(body.socialPlatforms) ? body.socialPlatforms.map(clean).filter(Boolean) : [];
    const [row] = await sql<any[]>`
      update crm.inbox_agent_settings set
        enabled=${Boolean(body.enabled)},first_delay_seconds=${Number(body.firstDelaySeconds||240)},between_replies_seconds=${Number(body.betweenRepliesSeconds||120)},max_bot_messages=${Number(body.maxBotMessages||2)},
        escalate_to_branch_manager=${body.escalateToBranchManager!==false},escalate_to_sales_manager=${body.escalateToSalesManager!==false},sales_manager_delay_seconds=${Number(body.salesManagerDelaySeconds||300)},
        sales_manager_name=${clean(body.salesManagerName)||null},sales_manager_phone=${clean(body.salesManagerPhone)||null},fallback_phone=${clean(body.fallbackPhone)||null},
        business_hours_only=${Boolean(body.businessHoursOnly)},business_start=${clean(body.businessStart)||"09:00"}::time,business_end=${clean(body.businessEnd)||"22:00"}::time,
        stop_keywords=${stopKeywords.length?stopKeywords:["إلغاء","خلاص","لا تتواصلون"]},replies=${replies.length?replies:["أهلًا بك، تم استلام رسالتك وجاري تحويل طلبك للمختص. يسعدنا خدمتك."]},
        branch_escalation_template=${clean(body.branchEscalationTemplate)||null},social_enabled=${Boolean(body.socialEnabled)},
        social_platforms=${socialPlatforms.length?socialPlatforms:["instagram","facebook","tiktok"]},
        updated_by=${user.id}::uuid,updated_at=now()
      where id='default' returning *
    `;
    return response.status(200).json({ ok: true, row });
  }

  if (request.method === "DELETE") {
    const scopeCode = clean(body.scopeCode || request.query.scopeCode);
    await sql`delete from crm.inbox_agent_managers where scope_code=${scopeCode}`;
    return response.status(200).json({ ok: true });
  }
  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
