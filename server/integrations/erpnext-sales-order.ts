import type { VercelRequest, VercelResponse } from "@vercel/node";
import { safeSecretEquals } from "../_auth.js";
import {
  ErpNextSalesOrderError,
  normalizeErpNextSalesOrder,
} from "../_erpnext-sales-order-normalizer.js";
import { cancelErpNextSalesOrder, resolveErpNextPlatformUser, syncErpNextSalesOrder, updateErpNextSalesOrderAmounts } from "../_erpnext-sales-order-sync.js";
import { resolveErpNextTrackingBranchCode } from "../_erpnext-branch-routing.js";
import { clean } from "../_tracking-utils.js";
import { ingestTrackingOrder, TrackingIngestError } from "./tracking-orders.js";

function requestBody(request: VercelRequest) {
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  return request.body || {};
}

function requestKey(request: VercelRequest) {
  return clean(
    request.headers["x-mzj-erpnext-key"]
      || request.headers["x-mzj-tracking-key"]
      || request.query.key,
  );
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });

  const configuredKey = clean(process.env.ERPNEXT_WEBHOOK_KEY || process.env.TRACKING_INGEST_KEY);
  if (!configuredKey) {
    return response.status(503).json({ ok: false, error: "يجب ضبط ERPNEXT_WEBHOOK_KEY في Vercel قبل تفعيل الربط" });
  }
  if (!safeSecretEquals(requestKey(request), configuredKey)) {
    return response.status(401).json({ ok: false, error: "مفتاح ERPNext Webhook غير صحيح" });
  }

  let body: unknown;
  try {
    body = requestBody(request);
  } catch {
    return response.status(400).json({ ok: false, error: "صيغة JSON القادمة من ERPNext غير صحيحة" });
  }

  try {
    const normalized = normalizeErpNextSalesOrder(body);
    if (normalized.isCancellation) {
      const cancellation = await cancelErpNextSalesOrder({ normalized });
      return response.status(200).json({
        ok: true,
        message: cancellation.alreadyCancelled
          ? `طلب ${normalized.orderNo} ملغي بالفعل داخل المنصة`
          : cancellation.found
            ? `تم إلغاء طلب ${normalized.orderNo} من NEXT ERP وتحديث التراكينج وCRM والعمليات`
            : `تم استلام إلغاء طلب ${normalized.orderNo} ولم يتم العثور على نسخة مرتبطة داخل المنصة`,
        orderNo: normalized.orderNo,
        sourceInstanceKey: normalized.sourceInstanceKey,
        erpStatus: normalized.erpStatus,
        cancellation,
        warnings: cancellation.warnings,
      });
    }

    if (normalized.isUpdateAfterSubmit) {
      const update = await updateErpNextSalesOrderAmounts({ normalized });
      if (!update.found) {
        return response.status(404).json({
          ok: false,
          error: `لم يتم العثور على طلب ${normalized.orderNo} داخل المنصة لتحديث المبالغ`,
          orderNo: normalized.orderNo,
        });
      }
      return response.status(200).json({
        ok: true,
        message: `تم تحديث المبالغ لنفس طلب ${normalized.orderNo} دون إنشاء طلب جديد`,
        orderNo: normalized.orderNo,
        event: normalized.erpEvent,
        update,
      });
    }

    const userResolution = await resolveErpNextPlatformUser(normalized.erpUserId);
    const trackingBranchCode = resolveErpNextTrackingBranchCode({
      erpBranch: normalized.erpBranch,
      erpUserId: normalized.erpUserId,
      platformUser: userResolution.candidate,
    });
    const results = [];
    for (const payload of normalized.payloads) {
      results.push(await ingestTrackingOrder({ ...payload, branch: trackingBranchCode || payload.branch }));
    }
    const linkage = await syncErpNextSalesOrder({ normalized, trackingResults: results, userResolution });

    return response.status(200).json({
      ok: true,
      message: `تم استلام طلب ${normalized.orderNo} من ERPNext ومعالجته من مسار موحد للتراكينج وCRM والعمليات`,
      orderNo: normalized.orderNo,
      erpStatus: normalized.erpStatus,
      importedVehicles: results.length,
      registrationFeeRowsIgnoredAsVehicles: normalized.registrationFeeRows,
      orderId: results.find((result) => result.orderId)?.orderId || null,
      vehicleIds: results.map((result) => result.vehicleId).filter(Boolean),
      warnings: linkage.warnings,
      linkage,
      results,
    });
  } catch (error) {
    if (error instanceof ErpNextSalesOrderError || error instanceof TrackingIngestError) {
      return response.status(error.status).json({ ok: false, error: error.message });
    }
    console.error("ERPNext sales order webhook failed", { error });
    return response.status(500).json({ ok: false, error: "تعذر مزامنة طلب ERPNext مع المنصة" });
  }
}
