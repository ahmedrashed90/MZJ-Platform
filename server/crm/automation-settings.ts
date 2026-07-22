import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, isCrmManager, parseBody, requireCrmUser } from "../_crm-utils.js";
import {
  clearCustomerAutomationSettingsCache,
  DEFAULT_CUSTOMER_AUTOMATION_SETTINGS,
  getCustomerAutomationSettings,
  normalizeCustomerAutomationSettings,
} from "../_crm-customer-automation-settings.js";
import { getSql } from "../_db.js";

function canonicalChoiceToken(value: unknown) {
  return clean(value).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[ـ]/g, "").replace(/[\s_-]+/g, " ");
}

function validate(settings: ReturnType<typeof normalizeCustomerAutomationSettings>, reference?: { departments: Set<string>; branches: Set<string>; fields: Set<string> }) {
  if (!settings.name) throw new Error("اسم الأوتوميشن مطلوب");
  if (!settings.serviceOptions.length) throw new Error("أضف اختيار خدمة واحدًا على الأقل");
  if (!settings.serviceOptions.some((row) => row.active)) throw new Error("يجب تفعيل اختيار خدمة واحد على الأقل");
  if (settings.scheduleEnabled && !settings.scheduleDays.length) throw new Error("حدد يوم تشغيل واحدًا على الأقل");
  const optionKeys = settings.serviceOptions.map((row) => row.key);
  if (new Set(optionKeys).size !== optionKeys.length) throw new Error("كود اختيار الخدمة يجب أن يكون فريدًا");
  const workerKeys = settings.platformWorkers.map((row) => `${row.platformCode}:${row.workerCode}`);
  if (new Set(workerKeys).size !== workerKeys.length) throw new Error("لا يمكن تكرار نفس ربط المنصة والـWorker");
  const activeChoiceTokens = new Map<string, string>();
  for (const option of settings.serviceOptions) {
    if (!option.serviceKey || !option.departmentCode) throw new Error(`حدد الخدمة والقسم للاختيار: ${option.label}`);
    if (!["cash", "finance", "service"].includes(option.serviceKey)) throw new Error(`الخدمة غير معتمدة للاختيار: ${option.label}`);
    if (!["questions", "message"].includes(option.flowType)) throw new Error(`نوع الفلو غير صحيح للاختيار: ${option.label}`);
    if (reference && !reference.departments.has(option.departmentCode)) throw new Error(`القسم المرتبط غير موجود: ${option.departmentCode}`);
    if (reference && option.defaultBranch && !reference.branches.has(option.defaultBranch)) throw new Error(`الفرع الافتراضي غير موجود: ${option.defaultBranch}`);
    if (option.active) {
      for (const rawToken of [option.key, option.label, ...option.aliases]) {
        const token = canonicalChoiceToken(rawToken);
        if (!token || /^\d+$/.test(token)) continue;
        const owner = activeChoiceTokens.get(token);
        if (owner && owner !== option.key) throw new Error(`الرد المقبول «${rawToken}» مستخدم في أكثر من اختيار نشط`);
        activeChoiceTokens.set(token, option.key);
      }
    }
    const stepKeys = option.steps.map((row) => row.key);
    if (new Set(stepKeys).size !== stepKeys.length) throw new Error(`أكواد خطوات ${option.label} يجب أن تكون فريدة`);
    for (const step of option.steps) {
      if (step.answerType !== "message" && !step.prompt) throw new Error(`نص السؤال مطلوب في ${option.label}`);
      if (step.answerType !== "message" && !step.fieldKey) throw new Error(`حدد حقل حفظ إجابة خطوة ${step.name}`);
      if (reference && step.answerType !== "message" && !reference.fields.has(step.fieldKey)) throw new Error(`حقل حفظ الإجابة غير موجود: ${step.fieldKey}`);
      if (step.answerType === "select" && !step.options.length) throw new Error(`أضف اختيارات لخطوة ${step.name}`);
    }
  }
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "إعدادات الأوتوميشن متاحة لإدارة CRM فقط" });
  const sql = getSql();

  if (request.method === "GET") {
    const [settings, endpoints, fields, departments, branches] = await Promise.all([
      getCustomerAutomationSettings(true),
      sql<any[]>`
        select source_code,display_name,is_active,text_send_url,send_url,inbound_webhook_url,webhook_url,health_url
        from crm.integration_endpoints order by display_name
      `,
      sql<any[]>`
        select field_key,label,field_type,options,is_system,is_locked,is_active
        from crm.customer_field_definitions where is_active=true order by sort_order,label
      `,
      sql<any[]>`select code,name from core.departments order by name`,
      sql<any[]>`select code,name from core.branches where is_active=true order by sort_order,name`,
    ]);
    const systemFields = [
      { field_key: "car_name", label: "السيارة", field_type: "text", options: [], is_system: true, is_locked: false, is_active: true },
    ];
    const knownFieldKeys = new Set(fields.map((row: any) => row.field_key));
    const customerFields = [...fields, ...systemFields.filter((row) => !knownFieldKeys.has(row.field_key))];
    const workers = endpoints.flatMap((row: any) => {
      const platformCodes = row.source_code === "tiktok-snapchat"
        ? ["tiktok", "snapchat"]
        : [row.source_code === "installment-calculator" ? "installment_calculator" : row.source_code];
      return platformCodes.map((platformCode: string) => ({
        workerCode: row.source_code,
        platformCode,
        displayName: row.source_code === "tiktok-snapchat" ? `${row.display_name} — ${platformCode === "tiktok" ? "TikTok" : "Snapchat"}` : row.display_name,
        active: row.is_active !== false,
        inboundConnected: Boolean(row.inbound_webhook_url || row.webhook_url),
        outboundConnected: Boolean(row.text_send_url || row.send_url),
      }));
    });
    return response.status(200).json({ ok: true, settings, workers, fields: customerFields, departments, branches });
  }

  if (!["PUT", "POST", "PATCH"].includes(request.method || "")) {
    return response.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const before = await getCustomerAutomationSettings(true);
    const settings = normalizeCustomerAutomationSettings(parseBody(request));
    const protectedKeys = new Set(DEFAULT_CUSTOMER_AUTOMATION_SETTINGS.serviceOptions.filter((row) => row.system).map((row) => row.key));
    settings.serviceOptions = settings.serviceOptions.map((row) => ({ ...row, system: protectedKeys.has(row.key) }));
    for (const protectedKey of protectedKeys) {
      if (!settings.serviceOptions.some((row) => row.key === protectedKey)) throw new Error("لا يمكن حذف اختيارات الخدمات الأساسية؛ يمكن تعطيلها فقط");
    }
    const [endpointRows, departmentRows, branchRows, fieldRows] = await Promise.all([
      sql<any[]>`select source_code,is_active from crm.integration_endpoints`,
      sql<any[]>`select code from core.departments`,
      sql<any[]>`select code from core.branches where is_active=true`,
      sql<any[]>`select field_key from crm.customer_field_definitions where is_active=true`,
    ]);
    validate(settings, {
      departments: new Set(departmentRows.map((row: any) => clean(row.code))),
      branches: new Set(branchRows.map((row: any) => clean(row.code))),
      fields: new Set([...fieldRows.map((row: any) => clean(row.field_key)), "car_name"]),
    });
    const endpointMap = new Map(endpointRows.map((row: any) => [clean(row.source_code), row.is_active !== false]));
    const endpointKeys = new Set(endpointMap.keys());
    for (const binding of settings.platformWorkers) {
      if (!endpointKeys.has(binding.workerCode)) throw new Error(`الـWorker غير موجود في المشروع: ${binding.workerCode}`);
      if (binding.enabled && endpointMap.get(binding.workerCode) === false) throw new Error(`لا يمكن تشغيل Worker غير نشط: ${binding.workerCode}`);
      const expectedPlatform = binding.workerCode === "tiktok-snapchat" ? new Set(["tiktok", "snapchat"]) : new Set([binding.workerCode === "installment-calculator" ? "installment_calculator" : binding.workerCode]);
      if (!expectedPlatform.has(binding.platformCode)) throw new Error(`الـWorker ${binding.workerCode} غير تابع للمنصة ${binding.platformCode}`);
    }

    const nextKeys = new Set(settings.serviceOptions.map((row) => row.key));
    const removedKeys = before.serviceOptions.filter((row) => !row.system && !nextKeys.has(row.key)).map((row) => row.key);
    if (removedKeys.length) {
      const [usage] = await sql<any[]>`select count(*)::int as count from crm.customer_automation_runs where option_key=any(${removedKeys}::text[])`;
      if (Number(usage?.count || 0) > 0) throw new Error("لا يمكن حذف اختيار مستخدم في سجل أوتوميشن سابق؛ قم بتعطيله بدلًا من حذفه");
    }
    const [row] = await sql<any[]>`
      update crm.automation_settings set
        automation_enabled=${settings.enabled},
        service_selection_enabled=${settings.enabled},
        automation_name=${settings.name},
        platform_workers=${sql.json(settings.platformWorkers)},
        trigger_mode=${settings.triggerMode},
        custom_interval_value=${settings.customIntervalValue},
        custom_interval_unit=${settings.customIntervalUnit},
        schedule_enabled=${settings.scheduleEnabled},
        schedule_start=${settings.scheduleStart}::time,
        schedule_end=${settings.scheduleEnd}::time,
        schedule_days=${settings.scheduleDays},
        automation_messages=${sql.json(settings.messages)},
        service_selection_message=${clean(settings.messages.servicePrompt.text)},
        service_options=${sql.json(settings.serviceOptions)},
        flow_timeout_value=${settings.flowTimeoutValue},
        flow_timeout_unit=${settings.flowTimeoutUnit},
        restart_keywords=${settings.restartKeywords},
        cancel_keywords=${settings.cancelKeywords},
        automation_version=automation_version+1,
        updated_by=${user.id}::uuid,
        updated_at=now()
      where id='default'
      returning *,updated_by::text
    `;
    clearCustomerAutomationSettingsCache();
    const saved = normalizeCustomerAutomationSettings(row);
    await audit(user, "crm_customer_automation_settings_saved", "automation_settings", "default", saved, before);
    return response.status(200).json({ ok: true, settings: saved, message: "تم حفظ إعدادات الأوتوميشن" });
  } catch (error: any) {
    return response.status(400).json({ ok: false, error: error?.message || "تعذر حفظ إعدادات الأوتوميشن" });
  }
}
