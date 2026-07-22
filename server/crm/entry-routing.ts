import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isCrmManager, requireCrmUser } from "../_crm-utils.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "إعدادات دخول وتوزيع العملاء متاحة للإدارة فقط" });
  if (request.method === "GET") {
    return response.status(200).json({
      ok: true,
      moved: true,
      automationPath: "/api/crm/conversation-automation",
      message: "تم نقل رسائل واختيارات دخول العميل إلى إعدادات الأوتوميشن. قواعد التوزيع الحالية لم تتغير.",
    });
  }
  return response.status(409).json({
    ok: false,
    code: "ENTRY_AUTOMATION_MOVED",
    error: "رسائل واختيارات دخول العميل تُدار الآن من تبويب إعدادات الأوتوميشن فقط.",
  });
}
