import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isCrmManager, requireCrmUser } from "../_crm-utils.js";
import { getCustomerAutomationSettings } from "../_crm-customer-automation-settings.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "إعدادات دخول وتوزيع العملاء متاحة للإدارة فقط" });

  if (request.method === "GET") {
    const settings = await getCustomerAutomationSettings(true);
    return response.status(200).json({
      ok: true,
      settings: {
        automation_enabled: settings.enabled,
        automation_name: settings.name,
        active_service_count: settings.serviceOptions.filter((row) => row.active).length,
        active_worker_count: settings.platformWorkers.filter((row) => row.enabled).length,
        trigger_mode: settings.triggerMode,
        source_of_truth: "crm/automation-settings",
      },
    });
  }

  return response.status(409).json({
    ok: false,
    error: "تم توحيد إعدادات رسائل دخول العميل داخل تبويب إعدادات الأوتوميشن. هذا المسار للقراءة فقط لمنع وجود مصدرين للإعدادات.",
  });
}
