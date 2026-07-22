import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, isCrmManager, parseBody, requireCrmUser } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import {
  normalizeAutomationEndpoints,
  normalizeAutomationSettings,
  type AutomationSettingsResponse,
} from "../../shared/crmAutomationContract.js";

function list(value: unknown): any[] { return Array.isArray(value) ? value : []; }
function record(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
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

async function readSettingsRows(sql: any) {
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

  const safeChoices = list(choices);
  const choiceIds = safeChoices.map((item: any) => item.id).filter(Boolean);
  const replies = choiceIds.length
    ? await sql<any[]>`select *,id::text,choice_id::text from crm.automation_choice_replies where choice_id=any(${choiceIds}::uuid[]) order by created_at,id`
    : [];
  const steps = choiceIds.length
    ? await sql<any[]>`select *,id::text,choice_id::text from crm.automation_steps where choice_id=any(${choiceIds}::uuid[]) and is_archived=false order by sort_order,id`
    : [];
  const safeSteps = list(steps);
  const stepIds = safeSteps.map((item: any) => item.id).filter(Boolean);
  const options = stepIds.length
    ? await sql<any[]>`select *,id::text,step_id::text from crm.automation_step_options where step_id=any(${stepIds}::uuid[]) order by sort_order,id`
    : [];

  return {
    definition,
    platforms: list(platforms),
    startMessages: list(startMessages),
    choices: safeChoices.map((choice: any) => ({
      ...choice,
      replies: list(replies).filter((item: any) => item.choice_id === choice.id),
      steps: safeSteps.filter((step: any) => step.choice_id === choice.id).map((step: any) => ({
        ...step,
        options: list(options).filter((item: any) => item.step_id === step.id),
      })),
    })),
    endpoints: list(endpoints),
  };
}

function toResponse(rows: NonNullable<Awaited<ReturnType<typeof readSettingsRows>>>, message?: string): AutomationSettingsResponse {
  const definition = rows.definition;
  const automation = normalizeAutomationSettings({
    id: definition.id,
    code: definition.code,
    name: definition.name,
    isActive: definition.is_active,
    triggerPolicy: definition.trigger_policy,
    triggerIntervalSeconds: definition.trigger_interval_seconds,
    version: definition.version,
    platforms: rows.platforms.map((item: any) => ({
      id: item.id,
      sourceCode: item.source_code,
      workerCode: item.worker_code,
      isEnabled: item.is_enabled,
      workerName: item.worker_name,
      workerIsActive: item.worker_is_active,
      workerSendUrl: item.worker_send_url,
      healthUrl: item.health_url,
      lastHealthStatus: item.last_health_status,
      lastHealthAt: item.last_health_at,
      lastSuccessAt: item.last_success_at,
      lastError: item.last_error,
    })),
    startMessages: rows.startMessages.map((item: any) => ({
      id: item.id,
      messageCode: item.message_code,
      body: item.body,
      isActive: item.is_active,
    })),
    choices: rows.choices.map((choice: any) => ({
      id: choice.id,
      choiceCode: choice.choice_code,
      displayName: choice.display_name,
      emoji: choice.emoji,
      departmentCode: choice.department_code,
      serviceKey: choice.service_key,
      branchPolicy: choice.branch_policy,
      branchCode: choice.branch_code,
      finalAction: choice.final_action,
      finalMessage: choice.final_message,
      isActive: choice.is_active,
      replies: list(choice.replies).map((reply: any) => ({
        id: reply.id,
        replyType: reply.reply_type,
        replyValue: reply.reply_value,
      })),
      steps: list(choice.steps).map((step: any) => ({
        id: step.id,
        stepCode: step.step_code,
        name: step.name,
        prompt: step.prompt,
        stepType: step.step_type,
        customerFieldKey: step.customer_field_key,
        isRequired: step.is_required,
        validationRules: step.validation_rules,
        validationErrorMessage: step.validation_error_message,
        maxAttempts: step.max_attempts,
        isActive: step.is_active,
        options: list(step.options).map((option: any) => ({
          id: option.id,
          optionCode: option.option_code,
          label: option.label,
          acceptedReplies: option.accepted_replies,
          isActive: option.is_active,
        })),
      })),
    })),
  });

  return {
    ok: true,
    automation,
    endpoints: normalizeAutomationEndpoints(rows.endpoints.map((item: any) => ({
      sourceCode: item.source_code,
      displayName: item.display_name,
      isActive: item.is_active,
      sendUrl: item.send_url,
      healthUrl: item.health_url,
      updatedAt: item.updated_at,
    }))),
    ...(message ? { message } : {}),
  };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "إعدادات الأوتوميشن متاحة لإدارة CRM فقط" });
  const sql = getSql();

  if (request.method === "GET") {
    const rows = await readSettingsRows(sql);
    if (!rows) return response.status(409).json({ ok: false, error: "تعريف الأوتوميشن غير موجود في قاعدة البيانات الحالية" });
    return response.status(200).json(toResponse(rows));
  }
  if (!["POST", "PUT", "PATCH"].includes(request.method || "")) return response.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const body = record(parseBody(request));
    const automation = record(body.automation);
    if (!Object.keys(automation).length) return response.status(400).json({ ok: false, error: "عقد بيانات الأوتوميشن مطلوب" });

    const name = clean(automation.name);
    if (!name) return response.status(400).json({ ok: false, error: "اسم الأوتوميشن مطلوب" });

    const triggerPolicy = clean(automation.triggerPolicy);
    if (!["every_message", "once_24_hours", "custom_duration"].includes(triggerPolicy)) return response.status(400).json({ ok: false, error: "سياسة تشغيل الأوتوميشن غير صحيحة" });
    const triggerIntervalSeconds = triggerPolicy === "custom_duration" ? integer(automation.triggerIntervalSeconds, 0, 60, 31536000) : null;
    if (triggerPolicy === "custom_duration" && !triggerIntervalSeconds) return response.status(400).json({ ok: false, error: "حدد مدة تشغيل مخصصة صحيحة" });

    const startMessages = list(automation.startMessages).map((item: any, index) => ({
      messageCode: code(item.messageCode, `message_${index + 1}`),
      body: clean(item.body),
      isActive: item.isActive !== false,
      sortOrder: (index + 1) * 10,
    })).filter((item: any) => item.body);
    if (!startMessages.some((item: any) => item.isActive)) return response.status(400).json({ ok: false, error: "أضف رسالة بداية نشطة واحدة على الأقل" });

    const choices = list(automation.choices).map((item: any, choiceIndex) => {
      const choiceCode = code(item.choiceCode, `choice_${choiceIndex + 1}`);
      const serviceKey = clean(item.serviceKey);
      if (!["cash", "finance", "service"].includes(serviceKey)) throw new Error(`الخدمة المرتبطة بالاختيار ${choiceCode} غير صحيحة`);

      const steps = list(item.steps).map((step: any, stepIndex) => ({
        stepCode: code(step.stepCode, `${choiceCode}_step_${stepIndex + 1}`),
        name: clean(step.name) || `الخطوة ${stepIndex + 1}`,
        prompt: clean(step.prompt),
        stepType: clean(step.stepType) || "text",
        customerFieldKey: clean(step.customerFieldKey) || null,
        isRequired: (clean(step.stepType) || "text") === "message" ? false : step.isRequired !== false,
        validationRules: record(step.validationRules),
        validationErrorMessage: clean(step.validationErrorMessage) || null,
        maxAttempts: step.maxAttempts == null ? null : integer(step.maxAttempts, 3, 1, 50),
        sortOrder: (stepIndex + 1) * 10,
        isActive: step.isActive !== false,
        options: list(step.options).map((option: any, optionIndex) => ({
          optionCode: code(option.optionCode, `option_${optionIndex + 1}`),
          label: clean(option.label),
          acceptedReplies: list(option.acceptedReplies).map(clean).filter(Boolean),
          sortOrder: (optionIndex + 1) * 10,
          isActive: option.isActive !== false,
        })).filter((option: any) => option.label),
      }));

      for (const step of steps) {
        if (!["message", "text", "phone", "choice"].includes(step.stepType)) throw new Error(`نوع الخطوة ${step.stepCode} غير مدعوم`);
        if (!step.prompt) throw new Error(`نص السؤال مطلوب في الخطوة ${step.name}`);
        if (step.stepType === "choice" && !step.options.some((option: any) => option.isActive)) throw new Error(`أضف اختيارًا نشطًا واحدًا على الأقل في الخطوة ${step.name}`);
      }

      return {
        choiceCode,
        displayName: clean(item.displayName),
        emoji: clean(item.emoji),
        departmentCode: clean(item.departmentCode),
        serviceKey,
        branchPolicy: clean(item.branchPolicy) === "fixed" ? "fixed" : "system",
        branchCode: clean(item.branchCode) || null,
        finalAction: record(item.finalAction),
        finalMessage: clean(item.finalMessage),
        sortOrder: (choiceIndex + 1) * 10,
        isActive: item.isActive !== false,
        replies: list(item.replies).map((reply: any) => ({
          replyType: ["text", "number", "payload"].includes(clean(reply.replyType)) ? clean(reply.replyType) : "text",
          replyValue: clean(reply.replyValue),
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
      sourceCode: clean(item.sourceCode).toLowerCase(),
      workerCode: clean(item.workerCode).toLowerCase(),
      isEnabled: bool(item.isEnabled),
    })).filter((item: any) => item.sourceCode);

    const beforeRows = await readSettingsRows(sql);
    if (!beforeRows) return response.status(409).json({ ok: false, error: "تعريف الأوتوميشن غير موجود في قاعدة البيانات الحالية" });
    const before = toResponse(beforeRows).automation;

    try {
      await sql.begin(async (tx: any) => {
        const [definition] = await tx<any[]>`
          update crm.automation_definitions set name=${name},is_active=${bool(automation.isActive, true)},
            trigger_policy=${triggerPolicy},trigger_interval_seconds=${triggerIntervalSeconds},version=version+1,updated_by=${user.id}::uuid,updated_at=now()
          where code='default_customer_entry' returning *,id::text
        `;
        if (!definition) throw new Error("تعريف الأوتوميشن الافتراضي غير موجود");

        const endpointRows = list(await tx<any[]>`select source_code,is_active,coalesce(text_send_url,send_url) as send_url from crm.integration_endpoints`);
        const endpointMap = new Map(endpointRows.map((row: any) => [clean(row.source_code).toLowerCase(), row]));
        for (const platform of platforms) {
          if (!platformCompatible(platform.sourceCode, platform.workerCode)) throw new Error(`لا يمكن ربط Worker ${platform.workerCode || "غير محدد"} بمنصة ${platform.sourceCode}`);
          const endpoint = endpointMap.get(platform.workerCode) as any;
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

    const afterRows = await readSettingsRows(sql);
    if (!afterRows) return response.status(500).json({ ok: false, error: "تم الحفظ لكن تعذر إعادة قراءة عقد الأوتوميشن" });
    const result = toResponse(afterRows, "تم حفظ إعدادات الأوتوميشن وتفعيل النسخة الجديدة.");
    await audit(user, "crm_automation_settings_saved", "automation_definition", result.automation.id || null, result.automation, before);
    return response.status(200).json(result);
  } catch (error: any) {
    return response.status(400).json({ ok: false, error: error?.message || "تعذر التحقق من إعدادات الأوتوميشن" });
  }
}
