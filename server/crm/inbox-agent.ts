import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clean, isCrmManager, parseBody, positiveInt, requireCrmUser } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import { ensureInboxAgentEngineSchema, DEFAULT_CUSTOMER_MESSAGE } from "../_crm-inbox-agent-engine.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const sql = getSql();
  await ensureInboxAgentEngineSchema();

  if (request.method === "GET") {
    const limit = positiveInt(request.query.limit, 100, 200);
    const offset = Math.max(0, Number(request.query.offset || 0) || 0);
    const [settings, managers, logs, logCounts, statuses, templates, statusRules] = await Promise.all([
      sql`select * from crm.inbox_agent_settings where id='default'`,
      sql`select *,id::text,updated_by::text from crm.inbox_agent_managers order by scope_code`,
      sql`select *,id::text,conversation_id::text,lead_id::text from crm.inbox_agent_logs order by created_at desc limit ${limit} offset ${offset}`,
      sql<{ total: number; today: number }[]>`
        select count(*)::int as total,
          count(*) filter (where (created_at at time zone 'Asia/Riyadh')::date=(now() at time zone 'Asia/Riyadh')::date)::int as today
        from crm.inbox_agent_logs
      `,
      sql<{ label: string }[]>`select distinct label from crm.dashboard_statuses where is_active=true order by label`,
      sql<any[]>`select id::text,name,display_name,content,language_code,status from crm.message_templates where provider='mersal' and is_active=true order by display_name`,
      sql<any[]>`select *,id::text,updated_by::text from crm.inbox_agent_status_rules order by sort_order,id`.catch(() => [] as any[]),
    ]);
    return response.status(200).json({ ok: true, defaultCustomerMessage: DEFAULT_CUSTOMER_MESSAGE, statuses: statuses.map((row) => row.label), templates, settings: settings[0], managers, statusRules, logs, logsTotal: Number(logCounts[0]?.total || 0), logsToday: Number(logCounts[0]?.today || 0), limit, offset });
  }

  if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لحفظ إعدادات الوكيل" });
  const body = parseBody(request);
  const section = clean(body.section || "settings");

  if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
    if (section === "status_rule") {
      // Upsert a per-status escalation rule.
      // body: { statusLabel, delayMinutes, target, sortOrder, isActive }
      // DELETE: body: { section: "status_rule", delete: true, statusLabel, target }
      const statusLabel = clean(body.statusLabel);
      const target = clean(body.target);
      if (!statusLabel || !target) return response.status(400).json({ ok: false, error: "statusLabel و target مطلوبان" });
      if (!["branch_manager", "sales_manager", "system_manager"].includes(target)) return response.status(400).json({ ok: false, error: "target غير صحيح" });
      if (body.delete) {
        await sql`delete from crm.inbox_agent_status_rules where status_label=${statusLabel} and target=${target}`;
        return response.status(200).json({ ok: true });
      }
      const delayMinutes = Math.min(10080, Math.max(1, Number(body.delayMinutes) || 60));
      const sortOrder = Number(body.sortOrder) || 0;
      const isActive = body.isActive !== false;
      const [row] = await sql<any[]>`
        insert into crm.inbox_agent_status_rules(status_label,delay_minutes,target,sort_order,is_active,updated_by,updated_at)
        values (${statusLabel},${delayMinutes},${target},${sortOrder},${isActive},${user.id}::uuid,now())
        on conflict (status_label,target) do update
          set delay_minutes=excluded.delay_minutes,sort_order=excluded.sort_order,is_active=excluded.is_active,updated_by=excluded.updated_by,updated_at=now()
        returning *,id::text
      `;
      return response.status(200).json({ ok: true, row });
    }

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

    const stopKeywords = Array.isArray(body.stopKeywords) ? body.stopKeywords.map(clean).filter(Boolean) : [];
    const socialPlatforms = (Array.isArray(body.socialPlatforms) ? body.socialPlatforms.map(clean) : []).filter((item: string) => ["instagram", "facebook", "tiktok", "whatsapp"].includes(item));
    const excludedStatuses = Array.isArray(body.excludedStatuses) ? body.excludedStatuses.map(clean).filter(Boolean) : [];
    const minutes = (value: unknown, fallback: number, min: number, max: number) => { const n = Math.floor(Number(value)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };
    const templateId = clean(body.escalationTemplateId);
    const [row] = await sql<any[]>`
      update crm.inbox_agent_settings set
        escalation_started_at=case when ${Boolean(body.enabled)} and (enabled=false or escalation_started_at is null) then now() else escalation_started_at end,
        enabled=${Boolean(body.enabled)},
        idle_minutes=${minutes(body.idleMinutes, 60, 1, 1380)},window_hours=${minutes(body.windowHours, 23, 2, 23)},step_minutes=${minutes(body.stepMinutes, 10, 1, 120)},
        customer_message=${clean(body.customerMessage) || null},excluded_statuses=${excludedStatuses}::text[],
        escalate_to_branch_manager=${body.escalateToBranchManager!==false},escalate_to_sales_manager=${body.escalateToSalesManager!==false},escalate_to_system_manager=${body.escalateToSystemManager!==false},
        sales_manager_name=${clean(body.salesManagerName)||null},sales_manager_phone=${clean(body.salesManagerPhone)||null},
        system_manager_name=${clean(body.systemManagerName)||null},system_manager_phone=${clean(body.systemManagerPhone)||null},fallback_phone=${clean(body.fallbackPhone)||null},
        escalation_template_id=${templateId || null}::uuid,
        business_hours_only=${Boolean(body.businessHoursOnly)},business_start=${clean(body.businessStart)||"09:00"}::time,business_end=${clean(body.businessEnd)||"22:00"}::time,
        stop_keywords=${stopKeywords.length?stopKeywords:["إلغاء","خلاص","لا تتواصلون"]},
        social_enabled=true,social_platforms=${socialPlatforms.length?socialPlatforms:["instagram","facebook","tiktok","whatsapp"]},
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
