import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, isCrmManager, parseBody, requireCrmUser } from "../_crm-utils.js";
import {
  clearCustomerAutomationSettingsCache,
  getCustomerAutomationSettings,
  normalizeCustomerAutomationSettings,
} from "../_crm-customer-automation-settings.js";
import { getSql } from "../_db.js";

function canonicalChoiceToken(value: unknown) {
  return clean(value).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[ـ]/g, "").replace(/[\s_-]+/g, " ");
}

function validate(settings: ReturnType<typeof normalizeCustomerAutomationSettings>) {
  if (!settings.name) throw new Error("اسم الأوتوميشن مطلوب");
  if (!settings.messages.welcome.text) throw new Error("رسالة الترحيب مطلوبة");
  if (!settings.messages.servicePrompt.text) throw new Error("رسالة اختيار الخدمة مطلوبة");
  const optionKeys = settings.serviceOptions.map((row) => row.key).join(",");
  if (optionKeys !== "cash,finance,service") throw new Error("بنية فلو الأوتوميشن غير صحيحة");
  const activeChoiceTokens = new Map<string, string>();
  for (const option of settings.serviceOptions) {
    if (!option.aliases.length) throw new Error(`أضف ردًا مقبولًا واحدًا على الأقل لاختيار ${option.label}`);
    if (!option.endMessage.text) throw new Error(`رسالة ${option.label} مطلوبة`);
    if (option.key === "finance" && !option.startMessage.text) throw new Error("رسالة بداية فلو التمويل مطلوبة");
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
      if (step.answerType !== "message" && !step.fieldKey) throw new Error(`حقل حفظ إجابة خطوة ${step.name} غير مضبوط`);
      if (!step.errorMessage) throw new Error(`رسالة التحقق مطلوبة في خطوة ${step.name}`);
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
    const submitted = parseBody(request);
    const settings = normalizeCustomerAutomationSettings({
      ...before,
      messages: submitted?.messages || before.messages,
      serviceOptions: submitted?.serviceOptions || before.serviceOptions,
      platformWorkers: before.platformWorkers,
      version: before.version,
    });
    // The scenario structure and technical routing are not editable from this page.
    // Only message text, validation text and accepted replies are accepted.
    settings.platformWorkers = before.platformWorkers;
    validate(settings);
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
    return response.status(200).json({ ok: true, settings: saved, message: "تم حفظ رسائل وردود الأوتوميشن" });
  } catch (error: any) {
    return response.status(400).json({ ok: false, error: error?.message || "تعذر حفظ إعدادات الأوتوميشن" });
  }
}
