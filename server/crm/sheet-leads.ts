import type { VercelRequest, VercelResponse } from "@vercel/node";
import { hasPermission } from "../_access-control.js";
import { requireCrmUser, parseBody, clean } from "../_crm-utils.js";
import { importCrmSheetBatch, normalizePreviouslyImportedSheetPhones, listPreviouslyImportedSheetPhoneIssues } from "../_crm-sheet-import.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!hasPermission(user, "platform.superadmin")) return response.status(403).json({ ok: false, error: "إضافة ليد من الشيت متاحة لمدير النظام فقط" });
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const body = parseBody(request);
  if (body.action === "review_existing_phones") {
    try { return response.status(200).json({ ok: true, ...(await listPreviouslyImportedSheetPhoneIssues()) }); }
    catch (error) { return response.status(500).json({ ok: false, error: error instanceof Error ? error.message : "تعذر قراءة تقرير الأرقام" }); }
  }
  if (body.action === "normalize_existing_phones") {
    if (body.confirm !== true) return response.status(400).json({ ok: false, error: "يجب تأكيد تصحيح الصيغ القديمة" });
    try {
      return response.status(200).json({ ok: true, ...(await normalizePreviouslyImportedSheetPhones(user)) });
    } catch (error) {
      return response.status(500).json({ ok: false, error: error instanceof Error ? error.message : "تعذر تصحيح الصيغ القديمة" });
    }
  }
  if (!Array.isArray(body.rows) || body.rows.length > 25 || body.rows.length === 0) {
    return response.status(400).json({ ok: false, error: "ارفع دفعة بين عميل واحد و25 عميلًا" });
  }
  if (body.serviceKey !== "finance" && body.serviceKey !== "cash") {
    return response.status(400).json({ ok: false, error: "حدد قسم التوزيع: الكاش أو التمويل" });
  }
  try {
    const result = await importCrmSheetBatch(user, body.rows, body.serviceKey, clean(body.campaignName).slice(0, 200));
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    return response.status(500).json({ ok: false, error: error instanceof Error ? error.message : "تعذر استيراد الليدز" });
  }
}
