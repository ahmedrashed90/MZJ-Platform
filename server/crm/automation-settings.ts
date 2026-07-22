import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, isCrmManager, parseBody, requireCrmUser } from "../_crm-utils.js";
import { getSql } from "../_db.js";

function list(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function normalizeAlias(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[✅🌹👨‍🔧👇🔥🏦🛠💰]/g, "")
    .replace(/[_\-–—|/\\]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

async function loadAutomationSettings(sql: any) {
  const [settings, startMessages, platforms, workers, flows, sessions] = await Promise.all([
    sql`select * from crm.automation_settings where id='default'`,
    sql`select *,id::text from crm.automation_start_messages order by sort_order,id`,
    sql`
      select p.*,p.id::text,e.display_name as worker_name,e.is_active as worker_is_active,
        coalesce(nullif(e.text_send_url,''),nullif(e.send_url,'')) as worker_send_url,
        e.media_send_url,e.inbound_webhook_url,e.health_url as endpoint_health_url
      from crm.automation_platforms p
      left join crm.integration_endpoints e on e.source_code=p.worker_code
      order by p.platform_code
    `,
    sql`
      select source_code as code,display_name,is_active,health_url,
        coalesce(nullif(text_send_url,''),nullif(send_url,'')) as text_send_url,
        media_send_url,inbound_webhook_url,updated_at
      from crm.integration_endpoints
      order by display_name,source_code
    `,
    sql`
      select f.*,f.id::text,
        coalesce((select json_agg(json_build_object(
          'id',a.id::text,'aliasType',a.alias_type,'aliasValue',a.alias_value,'normalizedValue',a.normalized_value
        ) order by a.created_at) from crm.automation_flow_aliases a where a.flow_id=f.id),'[]'::json) as aliases,
        coalesce((select json_agg(json_build_object(
          'id',s.id::text,'stepKey',s.step_key,'stepName',s.step_name,'promptText',s.prompt_text,
          'stepType',s.step_type,'customerField',s.customer_field,'isRequired',s.is_required,
          'validationRules',s.validation_rules,'validationError',s.validation_error,'maxAttempts',s.max_attempts,
          'isActive',s.is_active,'sortOrder',s.sort_order
        ) order by s.sort_order,s.id) from crm.automation_flow_steps s where s.flow_id=f.id),'[]'::json) as steps
      from crm.automation_flows f
      order by f.sort_order,f.display_name
    `,
    sql`
      select s.id::text,s.status,s.platform_code,s.worker_code,s.trigger_policy,s.started_at,s.last_activity_at,s.completed_at,s.error_message,
        c.customer_name,f.display_name as flow_name,f.flow_code,fa.status as final_action_status,
        sales.full_name as assigned_name,cc.full_name as call_center_name
      from crm.automation_sessions s
      join crm.conversations c on c.id=s.conversation_id
      left join crm.automation_flows f on f.id=s.flow_id
      left join crm.automation_final_actions fa on fa.session_id=s.id
      left join crm.service_requests r on r.id=fa.service_request_id
      left join core.users sales on sales.id=r.assigned_to
      left join core.users cc on cc.id=r.call_center_assigned_to
      order by s.started_at desc limit 100
    `,
  ]);
  return { settings: settings[0] || null, startMessages, platforms, workers, flows, sessions };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "إعدادات الأوتوميشن متاحة لإدارة CRM فقط" });
  const sql = getSql();

  if (request.method === "GET") {
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json({ ok: true, ...(await loadAutomationSettings(sql)) });
  }

  const body = parseBody(request);
  const section = clean(body.section);

  if (request.method === "DELETE") {
    const id = clean(body.id || request.query.id);
    if (!id) return response.status(400).json({ ok: false, error: "المعرف مطلوب" });
    if (section === "start_message") {
      await sql`delete from crm.automation_start_messages where id=${id}::uuid`;
      await audit(user, "crm_automation_start_message_deleted", "automation_start_message", id);
      return response.status(200).json({ ok: true, message: "تم حذف رسالة البداية" });
    }
    if (section === "flow") {
      const [usage] = await sql<any[]>`
        select exists(select 1 from crm.automation_sessions where flow_id=${id}::uuid) as used
      `;
      if (usage?.used) {
        await sql`update crm.automation_flows set is_active=false,updated_at=now() where id=${id}::uuid`;
        await audit(user, "crm_automation_flow_deactivated", "automation_flow", id);
        return response.status(200).json({ ok: true, deactivated: true, message: "تم إيقاف الاختيار لأنه مستخدم في جلسات سابقة" });
      }
      await sql`delete from crm.automation_flows where id=${id}::uuid`;
      await audit(user, "crm_automation_flow_deleted", "automation_flow", id);
      return response.status(200).json({ ok: true, message: "تم حذف الاختيار" });
    }
    if (section === "step") {
      const [usage] = await sql<any[]>`
        select exists(select 1 from crm.automation_answers where step_id=${id}::uuid)
          or exists(select 1 from crm.automation_sessions where current_step_id=${id}::uuid) as used
      `;
      if (usage?.used) {
        await sql`update crm.automation_flow_steps set is_active=false,updated_at=now() where id=${id}::uuid`;
        return response.status(200).json({ ok: true, deactivated: true, message: "تم إيقاف الخطوة لأنها مستخدمة في جلسات سابقة" });
      }
      await sql`delete from crm.automation_flow_steps where id=${id}::uuid`;
      return response.status(200).json({ ok: true, message: "تم حذف الخطوة" });
    }
    return response.status(400).json({ ok: false, error: "قسم الحذف غير معروف" });
  }

  if (!['POST','PUT','PATCH'].includes(request.method || "")) {
    return response.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (section === "general") {
    const triggerPolicy = ["every_message", "once_24_hours", "custom"].includes(clean(body.triggerPolicy)) ? clean(body.triggerPolicy) : "every_message";
    const intervalUnit = ["minute", "hour", "day"].includes(clean(body.customIntervalUnit)) ? clean(body.customIntervalUnit) : "hour";
    const intervalValue = Math.max(1, Math.min(100000, Number(body.customIntervalValue || 24)));
    const [row] = await sql<any[]>`
      update crm.automation_settings set
        automation_name=${clean(body.automationName) || "أوتوميشن استقبال العملاء"},
        automation_enabled=${body.automationEnabled !== false},
        trigger_policy=${triggerPolicy},custom_interval_value=${intervalValue},custom_interval_unit=${intervalUnit},
        service_selection_enabled=${body.automationEnabled !== false},updated_by=${user.id}::uuid,updated_at=now()
      where id='default' returning *
    `;
    await audit(user, "crm_automation_general_saved", "automation_settings", "default", row);
    return response.status(200).json({ ok: true, row, message: "تم حفظ الحالة العامة وسياسة التشغيل" });
  }

  if (section === "start_message") {
    const id = clean(body.id);
    const messageText = clean(body.messageText);
    if (!messageText) return response.status(400).json({ ok: false, error: "نص الرسالة مطلوب" });
    const messageKey = clean(body.messageKey) || `message_${Date.now()}`;
    const [row] = id ? await sql<any[]>`
      update crm.automation_start_messages set message_key=${messageKey},message_text=${messageText},
        is_active=${body.isActive !== false},sort_order=${Number(body.sortOrder || 10)},updated_at=now()
      where id=${id}::uuid returning *,id::text
    ` : await sql<any[]>`
      insert into crm.automation_start_messages(message_key,message_text,is_active,sort_order)
      values(${messageKey},${messageText},${body.isActive !== false},${Number(body.sortOrder || 10)})
      returning *,id::text
    `;
    await audit(user, "crm_automation_start_message_saved", "automation_start_message", row?.id || id, row);
    return response.status(200).json({ ok: true, row, message: "تم حفظ رسالة البداية" });
  }

  if (section === "platform") {
    const platformCode = clean(body.platformCode).toLowerCase();
    const workerCode = clean(body.workerCode).toLowerCase();
    if (!platformCode) return response.status(400).json({ ok: false, error: "كود المنصة مطلوب" });
    if (body.isEnabled !== false) {
      if (!workerCode) return response.status(400).json({ ok: false, error: "اختر Worker للمنصة" });
      if (workerCode !== platformCode) return response.status(400).json({ ok: false, error: "لا يمكن ربط Worker تابع لمنصة مختلفة" });
      const [worker] = await sql<any[]>`
        select * from crm.integration_endpoints where source_code=${workerCode} limit 1
      `;
      if (!worker) return response.status(400).json({ ok: false, error: "الـWorker غير مسجل في إعدادات ربط المنصات" });
      if (!worker.is_active) return response.status(400).json({ ok: false, error: "الـWorker غير نشط" });
      if (!clean(worker.text_send_url || worker.send_url)) return response.status(400).json({ ok: false, error: "الـWorker لا يحتوي على مسار إرسال نص صالح" });
    }
    const [row] = await sql<any[]>`
      insert into crm.automation_platforms(platform_code,worker_code,is_enabled,connection_status,health_url,updated_by,updated_at)
      values(${platformCode},${workerCode || null},${body.isEnabled !== false},${body.isEnabled !== false ? "connected" : "disconnected"},${clean(body.healthUrl) || null},${user.id}::uuid,now())
      on conflict(platform_code) do update set worker_code=excluded.worker_code,is_enabled=excluded.is_enabled,
        connection_status=excluded.connection_status,health_url=excluded.health_url,updated_by=excluded.updated_by,updated_at=now()
      returning *,id::text
    `;
    await audit(user, "crm_automation_platform_saved", "automation_platform", row?.id || platformCode, row);
    return response.status(200).json({ ok: true, row, message: "تم حفظ ربط المنصة والـWorker" });
  }

  if (section === "platform_health") {
    const platformCode = clean(body.platformCode).toLowerCase();
    const [platform] = await sql<any[]>`
      select p.*,coalesce(nullif(p.health_url,''),nullif(e.health_url,'')) as resolved_health_url
      from crm.automation_platforms p left join crm.integration_endpoints e on e.source_code=p.worker_code
      where p.platform_code=${platformCode} limit 1
    `;
    if (!platform) return response.status(404).json({ ok: false, error: "المنصة غير موجودة" });
    const healthUrl = clean(platform.resolved_health_url);
    if (!healthUrl) return response.status(400).json({ ok: false, error: "لا يوجد رابط Health Check" });
    try {
      const healthResponse = await fetch(healthUrl, { headers: { accept: "application/json" } });
      const raw = await healthResponse.text();
      const status = healthResponse.ok ? "connected" : "error";
      await sql`
        update crm.automation_platforms set connection_status=${status},
          last_success_at=case when ${healthResponse.ok} then now() else last_success_at end,
          last_error=case when ${healthResponse.ok} then null else ${`HTTP ${healthResponse.status}: ${raw.slice(0,300)}`} end,updated_at=now()
        where platform_code=${platformCode}
      `;
      return response.status(healthResponse.ok ? 200 : 502).json({ ok: healthResponse.ok, status, httpStatus: healthResponse.status });
    } catch (error: any) {
      const message = clean(error?.message || error);
      await sql`update crm.automation_platforms set connection_status='error',last_error=${message},updated_at=now() where platform_code=${platformCode}`;
      return response.status(502).json({ ok: false, error: message });
    }
  }

  if (section === "flow") {
    const id = clean(body.id);
    const flowCode = clean(body.flowCode).toLowerCase().replace(/[^a-z0-9_\-]/g, "_");
    const displayName = clean(body.displayName);
    const serviceKey = clean(body.serviceKey);
    const departmentCode = clean(body.departmentCode);
    if (!flowCode || !displayName || !serviceKey || !departmentCode) {
      return response.status(400).json({ ok: false, error: "كود الاختيار والاسم والخدمة والقسم مطلوبة" });
    }
    const serviceDepartments: Record<string, string> = { cash: "cash_sales", finance: "finance_sales", service: "customer_service" };
    if (!serviceDepartments[serviceKey]) {
      return response.status(400).json({ ok: false, error: "الخدمة يجب أن تكون كاش أو تمويل أو خدمة عملاء" });
    }
    if (serviceDepartments[serviceKey] !== departmentCode) {
      return response.status(400).json({ ok: false, error: "القسم المختار لا يطابق الخدمة، لمنع توزيع العميل على قسم خاطئ" });
    }
    const branchPolicy = clean(body.branchPolicy) === "fixed" ? "fixed" : "system";
    const aliases = list(body.aliases).map((item: any) => ({
      aliasType: ["text","number","payload"].includes(clean(item.aliasType)) ? clean(item.aliasType) : "text",
      aliasValue: clean(item.aliasValue || item.value),
    })).filter((item: any) => item.aliasValue);
    const steps = list(body.steps).map((item: any, index: number) => ({
      id: clean(item.id),
      stepKey: clean(item.stepKey) || `step_${index + 1}`,
      stepName: clean(item.stepName) || `الخطوة ${index + 1}`,
      promptText: clean(item.promptText),
      stepType: ["message","text","phone","choice"].includes(clean(item.stepType)) ? clean(item.stepType) : "text",
      customerField: clean(item.customerField) || null,
      isRequired: item.isRequired !== false,
      validationRules: item.validationRules && typeof item.validationRules === "object" ? item.validationRules : {},
      validationError: clean(item.validationError) || "البيانات المدخلة غير صحيحة، برجاء المحاولة مرة أخرى.",
      maxAttempts: item.maxAttempts ? Math.max(1, Number(item.maxAttempts)) : null,
      isActive: item.isActive !== false,
      sortOrder: Number(item.sortOrder || (index + 1) * 10),
    }));
    if (steps.some((step: any) => !step.promptText)) return response.status(400).json({ ok: false, error: "كل خطوة يجب أن تحتوي على نص سؤال" });

    const row = await sql.begin(async (tx) => {
      const [flow] = id ? await tx<any[]>`
        update crm.automation_flows set flow_code=${flowCode},display_name=${displayName},emoji=${clean(body.emoji) || null},
          button_payload=${clean(body.buttonPayload) || flowCode},service_key=${serviceKey},department_code=${departmentCode},
          branch_policy=${branchPolicy},branch_code=${branchPolicy === "fixed" ? clean(body.branchCode) || null : null},
          final_action=${tx.json((body.finalAction || {}) as any)},final_message=${clean(body.finalMessage)},
          is_active=${body.isActive !== false},sort_order=${Number(body.sortOrder || 10)},updated_at=now()
        where id=${id}::uuid returning *,id::text
      ` : await tx<any[]>`
        insert into crm.automation_flows(flow_code,display_name,emoji,button_payload,service_key,department_code,branch_policy,branch_code,final_action,final_message,is_active,sort_order)
        values(${flowCode},${displayName},${clean(body.emoji) || null},${clean(body.buttonPayload) || flowCode},${serviceKey},${departmentCode},
          ${branchPolicy},${branchPolicy === "fixed" ? clean(body.branchCode) || null : null},${tx.json((body.finalAction || {}) as any)},${clean(body.finalMessage)},
          ${body.isActive !== false},${Number(body.sortOrder || 10)}) returning *,id::text
      `;
      if (!flow) throw new Error("تعذر حفظ الاختيار");

      await tx`delete from crm.automation_flow_aliases where flow_id=${flow.id}::uuid`;
      for (const alias of aliases) {
        const normalized = normalizeAlias(alias.aliasValue);
        if (!normalized) continue;
        await tx`
          insert into crm.automation_flow_aliases(flow_id,alias_type,alias_value,normalized_value)
          values(${flow.id}::uuid,${alias.aliasType},${alias.aliasValue},${normalized})
          on conflict(flow_id,alias_type,normalized_value) do update set alias_value=excluded.alias_value
        `;
      }

      const savedStepIds: string[] = [];
      for (const step of steps) {
        const [saved] = step.id ? await tx<any[]>`
          update crm.automation_flow_steps set step_key=${step.stepKey},step_name=${step.stepName},prompt_text=${step.promptText},
            step_type=${step.stepType},customer_field=${step.customerField},is_required=${step.isRequired},validation_rules=${tx.json(step.validationRules)},
            validation_error=${step.validationError},max_attempts=${step.maxAttempts},is_active=${step.isActive},sort_order=${step.sortOrder},updated_at=now()
          where id=${step.id}::uuid and flow_id=${flow.id}::uuid returning id::text
        ` : await tx<any[]>`
          insert into crm.automation_flow_steps(flow_id,step_key,step_name,prompt_text,step_type,customer_field,is_required,validation_rules,validation_error,max_attempts,is_active,sort_order)
          values(${flow.id}::uuid,${step.stepKey},${step.stepName},${step.promptText},${step.stepType},${step.customerField},${step.isRequired},${tx.json(step.validationRules)},
            ${step.validationError},${step.maxAttempts},${step.isActive},${step.sortOrder}) returning id::text
        `;
        if (saved?.id) savedStepIds.push(saved.id);
      }
      if (savedStepIds.length) {
        await tx`
          update crm.automation_flow_steps set is_active=false,updated_at=now()
          where flow_id=${flow.id}::uuid and not(id=any(${savedStepIds}::uuid[]))
        `;
      } else {
        await tx`update crm.automation_flow_steps set is_active=false,updated_at=now() where flow_id=${flow.id}::uuid`;
      }
      return flow;
    });
    await audit(user, "crm_automation_flow_saved", "automation_flow", row.id, row);
    return response.status(200).json({ ok: true, row, message: "تم حفظ الاختيار وخطوات الفلو" });
  }

  return response.status(400).json({ ok: false, error: "قسم إعدادات الأوتوميشن غير معروف" });
}
