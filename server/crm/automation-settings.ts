import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, isCrmManager, parseBody, requireCrmUser } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import {
  CUSTOMER_AUTOMATION_DEFAULTS,
  normalizeCustomerAutomationSettings,
  platformFromWorkerCode,
} from "../_crm-customer-automation-settings.js";

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function platformCatalog(rows: any[]) {
  const workers = rows.map((row) => ({
    code: clean(row.source_code).toLowerCase(),
    name: clean(row.display_name || row.source_code),
    platformCode: platformFromWorkerCode(row.source_code),
    active: row.is_active !== false,
    sendUrl: clean(row.text_send_url || row.send_url),
    healthUrl: clean(row.health_url),
  }));
  const platforms = [...new Map(workers.map((worker) => [worker.platformCode, {
    code: worker.platformCode,
    name: worker.platformCode === "facebook" ? "Facebook" : worker.platformCode === "instagram" ? "Instagram" : worker.platformCode === "whatsapp" ? "WhatsApp" : worker.platformCode === "tiktok" ? "TikTok" : worker.platformCode === "snapchat" ? "Snapchat" : worker.platformCode,
  }])).values()];
  return { platforms, workers };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "إعدادات الأوتوميشن متاحة للإدارة فقط" });

  const sql = getSql();
  const endpoints = await sql<any[]>`
    select source_code,display_name,text_send_url,send_url,health_url,is_active
    from crm.integration_endpoints
    order by display_name,source_code
  `;
  const catalog = platformCatalog(endpoints);

  if (request.method === "GET") {
    const [row] = await sql<any[]>`select *,updated_by::text from crm.customer_automation_settings where id='default' limit 1`;
    const settings = normalizeCustomerAutomationSettings(row || CUSTOMER_AUTOMATION_DEFAULTS);
    return response.status(200).json({ ok: true, settings, ...catalog });
  }

  if (!['PUT', 'PATCH', 'POST'].includes(request.method || "")) {
    return response.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const body = parseBody(request);
  const normalized = normalizeCustomerAutomationSettings(body);
  const workerMap = new Map(catalog.workers.map((worker) => [worker.code, worker]));
  const bindings = array(body.bindings ?? body.platformBindings)
    .map((item: any) => ({
      platformCode: clean(item.platformCode || item.platform_code).toLowerCase(),
      workerCode: clean(item.workerCode || item.worker_code).toLowerCase(),
      enabled: item.enabled !== false,
    }))
    .filter((item: any) => item.platformCode && item.workerCode);

  const uniqueBindings = new Map<string, any>();
  for (const binding of bindings) {
    const worker = workerMap.get(binding.workerCode);
    if (!worker) return response.status(400).json({ ok: false, error: `الـWorker ${binding.workerCode} غير موجود في ربط المنصات` });
    if (worker.platformCode !== binding.platformCode) return response.status(400).json({ ok: false, error: `الـWorker ${binding.workerCode} لا يتبع منصة ${binding.platformCode}` });
    if (binding.enabled && !worker.active) return response.status(400).json({ ok: false, error: `الـWorker ${binding.workerCode} غير نشط` });
    if (binding.enabled && !worker.sendUrl) return response.status(400).json({ ok: false, error: `مسار الإرسال غير مضبوط للـWorker ${binding.workerCode}` });
    uniqueBindings.set(`${binding.platformCode}:${binding.workerCode}`, binding);
  }

  if (normalized.enabled && ![...uniqueBindings.values()].some((binding) => binding.enabled)) {
    return response.status(400).json({ ok: false, error: "فعّل منصة وWorker واحدًا على الأقل قبل تشغيل الأوتوميشن" });
  }

  const choices = normalized.choices.map((choice) => ({
    key: choice.key,
    label: choice.label,
    emoji: choice.emoji,
    aliases: choice.aliases,
    enabled: choice.enabled,
    sortOrder: choice.sortOrder,
  }));

  const [before] = await sql<any[]>`select * from crm.customer_automation_settings where id='default' limit 1`;
  const [saved] = await sql<any[]>`
    update crm.customer_automation_settings set
      enabled=${normalized.enabled},
      automation_name=${normalized.name},
      trigger_policy=${normalized.triggerPolicy},
      interval_value=${normalized.intervalValue},
      interval_unit=${normalized.intervalUnit},
      platform_bindings=${sql.json([...uniqueBindings.values()] as any)},
      entry_messages=${sql.json(normalized.messages as any)},
      service_choices=${sql.json(choices as any)},
      flow_messages=${sql.json(normalized.flows as any)},
      version=version+1,
      updated_by=${user.id}::uuid,
      updated_at=now()
    where id='default'
    returning *,updated_by::text
  `;

  await audit(user, "crm_customer_automation_settings_rebuilt", "customer_automation_settings", "default", saved, before);
  return response.status(200).json({ ok: true, settings: normalizeCustomerAutomationSettings(saved), message: "تم حفظ إعدادات الأوتوميشن" });
}
