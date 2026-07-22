import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { audit, clean, isCrmManager, parseBody, requireCrmUser } from "../_crm-utils.js";
import { getSql } from "../_db.js";

function list(value: unknown) { return Array.isArray(value) ? value : []; }
function bool(value: unknown, fallback = false) { return value == null ? fallback : value === true || ["1", "true", "yes", "on"].includes(clean(value).toLowerCase()); }
function integer(value: unknown, fallback: number, min = 0, max = 1000000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}
function code(value: unknown, fallback: string) {
  const normalized = clean(value).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || fallback;
}
function platformCompatible(sourceCode: string, workerCode: string) {
  const source = clean(sourceCode).toLowerCase();
  const worker = clean(workerCode).toLowerCase();
  if (!worker) return false;
  if (source === "whatsapp") return ["whatsapp", "mersal"].includes(worker);
  return source === worker;
}

async function readSettings(sql: any) {
  const [definition] = await sql<any[]>`select *,id::text,created_by::text,updated_by::text from crm.automation_definitions where code='default_customer_entry' limit 1`;
  if (!definition) return null;
  const [platforms, startMessages, choices, endpoints] = await Promise.all([
    sql<any[]>`
      select p.*,p.id::text,p.automation_id::text,e.display_name as worker_name,e.is_active as worker_is_active,
        coalesce(e.text_send_url,e.send_url) as worker_send_url,e.health_url,e.updated_at as worker_updated_at
      from crm.automation_platforms p
      left join crm.integration_endpoints e on e.source_code=p.worker_code
      where p.automation_id=${definition.id}::uuid order by p.source_code
    `,
    sql<any[]>`select *,id::text,automation_id::text from crm.automation_start_messages where automation_id=${definition.id}::uuid and is_archived=false order by sort_order,id`,
    sql<any[]>`select *,id::text,automation_id::text from crm.automation_choices where automation_id=${definition.id}::uuid and is_archived=false order by sort_order,id`,
    sql<any[]>`select source_code,display_name,is_active,coalesce(text_send_url,send_url) as send_url,health_url,updated_at from crm.integration_endpoints order by display_name`,
  ]);
  const choiceIds = choices.map((item: any) => item.id);
  const replies = choiceIds.length ? await sql<any[]>`select *,id::text,choice_id::text from crm.automation_choice_replies where choice_id=any(${choiceIds}::uuid[]) order by created_at,id` : [];
  const steps = choiceIds.length ? await sql<any[]>`select *,id::text,choice_id::text from crm.automation_steps where choice_id=any(${choiceIds}::uuid[]) and is_archived=false order by sort_order,id` : [];
  const stepIds = steps.map((item: any) => item.id);
  const options = stepIds.length ? await sql<any[]>`select *,id::text,step_id::text from crm.automation_step_options where step_id=any(${stepIds}::uuid[]) order by sort_order,id` : [];
  return {
    definition,
    platforms,
    startMessages,
    choices: choices.map((choice: any) => ({
      ...choice,
      replies: replies.filter((item: any) => item.choice_id === choice.id),
      steps: steps.filter((step: any) => step.choice_id === choice.id).map((step: any) => ({
        ...step,
        options: options.filter((item: any) => item.step_id === step.id),
      })),
    })),
    endpoints,
  };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "إعدادات الأوتوميشن متاحة لإدارة CRM فقط" });
  const sql = getSql();

  if (request.method === "GET") {
    const settings = await readSettings(sql);
    return response.status(200).json({ ok: true, ...settings });
  }
  if (!["POST", "PUT", "PATCH"].includes(request.method || "")) return response.status(405).json({ ok: false, error: "Method not allowed" });

  try {
  const body = parseBody(request);
  const automation = body.automation && typeof body.automation === "object" ? body.automation : body;
  const name = clean(automation.name);
  if (!name) return response.status(400).json({ ok: false, error: "اسم الأوتوميشن مطلوب" });
  const triggerPolicy = clean(automation.triggerPolicy || automation.trigger_policy);
  if (!["every_message", "once_24_hours", "custom_duration"].includes(triggerPolicy)) return response.status(400).json({ ok: false, error: "سياسة تشغيل الأوتوميشن غير صحيحة" });
  const triggerIntervalSeconds = triggerPolicy === "custom_duration" ? integer(automation.triggerIntervalSeconds || automation.trigger_interval_seconds, 0, 60, 31536000) : null;
  if (triggerPolicy === "custom_duration" && !triggerIntervalSeconds) return response.status(400).json({ ok: false, error: "حدد مدة تشغيل مخصصة صحيحة" });

  const startMessages = list(automation.startMessages).map((item: any, index) => ({
    messageCode: code(item.messageCode || item.message_code, `message_${index + 1}`),
    body: clean(item.body),
    isActive: item.isActive !== false && item.is_active !== false,
    sortOrder: (index + 1) * 10,
  })).filter((item: any) => item.body);
  if (!startMessages.some((item: any) => item.isActive)) return response.status(400).json({ ok: false, error: "أضف رسالة بداية نشطة واحدة على الأقل" });

  const choices = list(automation.choices).map((item: any, choiceIndex) => {
    const choiceCode = code(item.choiceCode || item.choice_code, `choice_${choiceIndex + 1}`);
    const serviceKey = clean(item.serviceKey || item.service_key);
    if (!["cash", "finance", "service"].includes(serviceKey)) throw new Error(`الخدمة المرتبطة بالاختيار ${choiceCode} غير صحيحة`);
    const steps = list(item.steps).map((step: any, stepIndex) => ({
      stepCode: code(step.stepCode || step.step_code, `${choiceCode}_step_${stepIndex + 1}`),
      name: clean(step.name) || `الخطوة ${stepIndex + 1}`,
      prompt: clean(step.prompt),
      stepType: clean(step.stepType || step.step_type) || "text",
      customerFieldKey: clean(step.customerFieldKey || step.customer_field_key) || null,
      isRequired: (clean(step.stepType || step.step_type) || "text") === "message" ? false : step.isRequired !== false && step.is_required !== false,
      validationRules: step.validationRules && typeof step.validationRules === "object" ? step.validationRules : (step.validation_rules || {}),
      validationErrorMessage: clean(step.validationErrorMessage || step.validation_error_message) || null,
      maxAttempts: step.maxAttempts == null && step.max_attempts == null ? null : integer(step.maxAttempts || step.max_attempts, 3, 1, 50),
      sortOrder: (stepIndex + 1) * 10,
      isActive: step.isActive !== false && step.is_active !== false,
      options: list(step.options).map((option: any, optionIndex) => ({
        optionCode: code(option.optionCode || option.option_code, `option_${optionIndex + 1}`),
        label: clean(option.label),
        acceptedReplies: list(option.acceptedReplies || option.accepted_replies).map(clean).filter(Boolean),
        sortOrder: (optionIndex + 1) * 10,
        isActive: option.isActive !== false && option.is_active !== false,
      })).filter((option: any) => option.label),
    }));
    for (const step of steps) {
      if (!["message", "text", "phone", "choice"].includes(step.stepType)) throw new Error(`نوع الخطوة ${step.stepCode} غير مدعوم`);
      if (!step.prompt) throw new Error(`نص السؤال مطلوب في الخطوة ${step.name}`);
      if (step.stepType === "choice" && !step.options.some((option: any) => option.isActive)) throw new Error(`أضف اختيارًا نشطًا واحدًا على الأقل في الخطوة ${step.name}`);
    }
    const finalAction = item.finalAction && typeof item.finalAction === "object" ? item.finalAction : (item.final_action || {});
    return {
      choiceCode,
      displayName: clean(item.displayName || item.display_name),
      emoji: clean(item.emoji),
      departmentCode: clean(item.departmentCode || item.department_code),
      serviceKey,
      branchPolicy: clean(item.branchPolicy || item.branch_policy) === "fixed" ? "fixed" : "system",
      branchCode: clean(item.branchCode || item.branch_code) || null,
      finalAction,
      finalMessage: clean(item.finalMessage || item.final_message),
      sortOrder: (choiceIndex + 1) * 10,
      isActive: item.isActive !== false && item.is_active !== false,
      replies: list(item.replies).map((reply: any) => ({
        replyType: ["text", "number", "payload"].includes(clean(reply.replyType || reply.reply_type)) ? clean(reply.replyType || reply.reply_type) : "text",
        replyValue: clean(reply.replyValue || reply.reply_value || reply),
      })).filter((reply: any) => reply.replyValue),
      steps,
    };
  });
  if (!choices.some((item: any) => item.isActive)) return response.status(400).json({ ok: false, error: "أضف اختيار خدمة نشطًا واحدًا على الأقل" });
  for (const choice of choices) {
    if (!choice.displayName || !choice.departmentCode || (choice.finalAction?.sendFinalMessage !== false && !choice.finalMessage)) throw new Error(`بيانات الاختيار ${choice.choiceCode} غير مكتملة`);
    if (!choice.replies.length) throw new Error(`أضف ردًا مقبولًا واحدًا على الأقل للاختيار ${choice.displayName}`);
    if (choice.branchPolicy === "fixed" && !choice.branchCode) throw new Error(`حدد الفرع الثابت للاختيار ${choice.displayName}`);
  }

  const platforms = list(automation.platforms).map((item: any) => ({
    sourceCode: clean(item.sourceCode || item.source_code).toLowerCase(),
    workerCode: clean(item.workerCode || item.worker_code).toLowerCase(),
    isEnabled: bool(item.isEnabled ?? item.is_enabled),
  })).filter((item: any) => item.sourceCode);

  const before = await readSettings(sql);
  try {
    await sql.begin(async (tx) => {
      const [definition] = await tx<any[]>`
        update crm.automation_definitions set name=${name},is_active=${bool(automation.isActive ?? automation.is_active, true)},
          trigger_policy=${triggerPolicy},trigger_interval_seconds=${triggerIntervalSeconds},version=version+1,updated_by=${user.id}::uuid,updated_at=now()
        where code='default_customer_entry' returning *,id::text
      `;
      if (!definition) throw new Error("تعريف الأوتوميشن الافتراضي غير موجود. شغّل ملف SQL أولًا.");

      const endpointRows = await tx<any[]>`select source_code,is_active,coalesce(text_send_url,send_url) as send_url from crm.integration_endpoints`;
      const endpointMap = new Map(endpointRows.map((row: any) => [clean(row.source_code).toLowerCase(), row]));
      for (const platform of platforms) {
        if (!platformCompatible(platform.sourceCode, platform.workerCode)) throw new Error(`لا يمكن ربط Worker ${platform.workerCode || "غير محدد"} بمنصة ${platform.sourceCode}`);
        const endpoint = endpointMap.get(platform.workerCode);
        if (platform.isEnabled && (!endpoint?.is_active || !clean(endpoint?.send_url))) throw new Error(`Worker منصة ${platform.sourceCode} غير نشط أو لا يحتوي مسار إرسال صالح`);
        await tx`
          insert into crm.automation_platforms(automation_id,source_code,worker_code,is_enabled,updated_at)
          values(${definition.id}::uuid,${platform.sourceCode},${platform.workerCode},${platform.isEnabled},now())
          on conflict(automation_id,source_code) do update set worker_code=excluded.worker_code,is_enabled=excluded.is_enabled,updated_at=now()
        `;
      }

      await tx`update crm.automation_start_messages set sort_order=sort_order+100000,is_archived=true,updated_at=now() where automation_id=${definition.id}::uuid`;
      for (const message of startMessages) {
        await tx`
          insert into crm.automation_start_messages(automation_id,message_code,body,sort_order,is_active,is_archived)
          values(${definition.id}::uuid,${message.messageCode},${message.body},${message.sortOrder},${message.isActive},false)
          on conflict(automation_id,message_code) do update set body=excluded.body,sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=false,updated_at=now()
        `;
      }

      await tx`update crm.automation_choices set sort_order=sort_order+100000,is_archived=true,updated_at=now() where automation_id=${definition.id}::uuid`;
      for (const choice of choices) {
        const [savedChoice] = await tx<any[]>`
          insert into crm.automation_choices(automation_id,choice_code,display_name,emoji,department_code,service_key,branch_policy,branch_code,final_action,final_message,sort_order,is_active,is_archived)
          values(${definition.id}::uuid,${choice.choiceCode},${choice.displayName},${choice.emoji || null},${choice.departmentCode},${choice.serviceKey},${choice.branchPolicy},${choice.branchCode},${tx.json(choice.finalAction as any)},${choice.finalMessage},${choice.sortOrder},${choice.isActive},false)
          on conflict(automation_id,choice_code) do update set display_name=excluded.display_name,emoji=excluded.emoji,department_code=excluded.department_code,
            service_key=excluded.service_key,branch_policy=excluded.branch_policy,branch_code=excluded.branch_code,final_action=excluded.final_action,
            final_message=excluded.final_message,sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=false,updated_at=now()
          returning id::text
        `;
        await tx`delete from crm.automation_choice_replies where choice_id=${savedChoice.id}::uuid`;
        for (const reply of choice.replies) {
          const normalized = clean(reply.replyValue).toLowerCase().replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/[ـًٌٍَُِّْ]/g,"").replace(/[✅🌹👨‍🔧👇🔥🏦🛠💰]/g,"").replace(/[_\-–—|/\\]+/g," ").replace(/[\s،,:؛.!?؟]+/g," ").trim();
          await tx`insert into crm.automation_choice_replies(choice_id,reply_type,reply_value,normalized_value) values(${savedChoice.id}::uuid,${reply.replyType},${reply.replyValue},${normalized})`;
        }

        await tx`update crm.automation_steps set sort_order=sort_order+100000,is_archived=true,updated_at=now() where choice_id=${savedChoice.id}::uuid`;
        for (const step of choice.steps) {
          const [savedStep] = await tx<any[]>`
            insert into crm.automation_steps(choice_id,step_code,name,prompt,step_type,customer_field_key,is_required,validation_rules,validation_error_message,max_attempts,sort_order,is_active,is_archived)
            values(${savedChoice.id}::uuid,${step.stepCode},${step.name},${step.prompt},${step.stepType},${step.customerFieldKey},${step.isRequired},${tx.json(step.validationRules as any)},${step.validationErrorMessage},${step.maxAttempts},${step.sortOrder},${step.isActive},false)
            on conflict(choice_id,step_code) do update set name=excluded.name,prompt=excluded.prompt,step_type=excluded.step_type,customer_field_key=excluded.customer_field_key,
              is_required=excluded.is_required,validation_rules=excluded.validation_rules,validation_error_message=excluded.validation_error_message,max_attempts=excluded.max_attempts,
              sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=false,updated_at=now()
            returning id::text
          `;
          await tx`delete from crm.automation_step_options where step_id=${savedStep.id}::uuid`;
          for (const option of step.options) {
            await tx`insert into crm.automation_step_options(step_id,option_code,label,accepted_replies,sort_order,is_active) values(${savedStep.id}::uuid,${option.optionCode},${option.label},${tx.json(option.acceptedReplies as any)},${option.sortOrder},${option.isActive})`;
          }
        }
      }
    });
  } catch (error: any) {
    return response.status(400).json({ ok: false, error: error?.message || "تعذر حفظ إعدادات الأوتوميشن" });
  }

  const after = await readSettings(sql);
  await audit(user, "crm_automation_settings_saved", "automation_definition", after?.definition?.id || null, after, before);
  return response.status(200).json({ ok: true, message: "تم حفظ إعدادات الأوتوميشن وتفعيل النسخة الجديدة.", ...after });
  } catch (error: any) {
    return response.status(400).json({ ok: false, error: error?.message || "تعذر التحقق من إعدادات الأوتوميشن" });
  }
}
