import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { requireOperationsUser, requirePermission } from "../_operations-auth.js";
import {
  OperationsError,
  archiveVehicle,
  cancelOrDeleteRequest,
  createMovement,
  createRequest,
  getOperationsDashboard,
  getOperationsMeta,
  getRequestDetail,
  getShortages,
  getVehicleDetail,
  importVehicles,
  listActivity,
  listApprovals,
  listMovements,
  listRequests,
  listVehicles,
  progressRequest,
  recordOperationsAudit,
  saveVehicle,
  saveOperationLocation,
  saveOperationStatus,
  searchVehicles,
  updateApproval,
} from "../_operations-service.js";

function clean(value: unknown) {
  return String(value ?? "").trim();
}
function bool(value: unknown) {
  return ["1", "true", "yes", "on"].includes(clean(value).toLowerCase());
}
function bodyOf(request: VercelRequest): Record<string, unknown> {
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body || "{}"); } catch { throw new OperationsError("VALIDATION_ERROR", "صيغة البيانات المرسلة غير صحيحة", 400); }
  }
  return request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
}
function sendError(response: VercelResponse, error: unknown, requestId: string) {
  if (error instanceof OperationsError) {
    return response.status(error.status).json({
      ok: false,
      code: error.code,
      error: error.message,
      message: error.message,
      fieldErrors: error.fieldErrors || undefined,
      requestId,
      details: error.safeDetails || undefined,
    });
  }
  const pg = error as { code?: string; message?: string };
  console.error("Operations API failed", { requestId, error });
  if (pg?.code === "23505") return response.status(409).json({ ok: false, code: "CONFLICT", error: "البيانات مكررة بالفعل", message: "البيانات مكررة بالفعل", requestId });
  if (pg?.code === "23503") return response.status(409).json({ ok: false, code: "CONFLICT", error: "تعذر تنفيذ العملية لوجود ارتباطات غير صحيحة", message: "تعذر تنفيذ العملية لوجود ارتباطات غير صحيحة", requestId });
  return response.status(500).json({ ok: false, code: "DATABASE_ERROR", error: "تعذر تنفيذ العملية. تم تسجيل الخطأ للمراجعة.", message: "تعذر تنفيذ العملية. تم تسجيل الخطأ للمراجعة.", requestId });
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const requestId = String(request.headers["x-request-id"] || randomUUID());
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Request-Id", requestId);
  try {
    await ensureOperationsSchema();
    const user = await requireOperationsUser(request, response);
    if (!user) return;

    if (request.method === "GET") {
      const resource = clean(request.query.resource || "dashboard");
      if (resource === "meta") return response.status(200).json({ ok: true, ...(await getOperationsMeta()) });
      if (resource === "dashboard") return response.status(200).json({ ok: true, dashboard: await getOperationsDashboard(user) });
      if (resource === "vehicles") {
        if (!requirePermission(response, user, "operations.vehicles.view")) return;
        const exportAll = bool(request.query.exportAll);
        if (exportAll && !requirePermission(response, user, "operations.vehicles.export")) return;
        const filters = {
          search: clean(request.query.search), location: clean(request.query.location), status: clean(request.query.status),
          model: clean(request.query.model), agent: clean(request.query.agent), archived: bool(request.query.archived), metric: clean(request.query.metric),
          page: Number(request.query.page || 1), pageSize: Number(request.query.pageSize || 50),
        };
        const data = await listVehicles(user, filters, exportAll);
        if (exportAll) {
          await recordOperationsAudit(user, "vehicles.exported", "vehicle_export", requestId, {}, { filters, total: data.total }, null, requestId).catch((auditError) => console.error("Operations export audit failed", { requestId, auditError }));
        }
        return response.status(200).json({ ok: true, ...data });
      }
      if (resource === "vehicle_search") {
        if (!requirePermission(response, user, "operations.vehicles.view")) return;
        return response.status(200).json({ ok: true, rows: await searchVehicles(user, request.query.search, request.query.limit) });
      }
      if (resource === "vehicle") {
        if (!requirePermission(response, user, "operations.vehicles.view")) return;
        return response.status(200).json({ ok: true, detail: await getVehicleDetail(user, request.query.id) });
      }
      if (resource === "requests") {
        if (!requirePermission(response, user, "operations.requests.view")) return;
        return response.status(200).json({ ok: true, rows: await listRequests(user, request.query) });
      }
      if (resource === "request") {
        if (!requirePermission(response, user, "operations.requests.view")) return;
        return response.status(200).json({ ok: true, request: await getRequestDetail(user, request.query.id) });
      }
      if (resource === "approvals") {
        if (!requirePermission(response, user, "operations.approvals.view")) return;
        return response.status(200).json({ ok: true, rows: await listApprovals(user, request.query) });
      }
      if (resource === "movements") {
        if (!requirePermission(response, user, "operations.vehicles.view")) return;
        return response.status(200).json({ ok: true, rows: await listMovements(user, request.query) });
      }
      if (resource === "shortages") {
        if (!requirePermission(response, user, "operations.vehicles.view")) return;
        return response.status(200).json({ ok: true, ...(await getShortages(user, request.query.branch)) });
      }
      if (resource === "activity") return response.status(200).json({ ok: true, rows: await listActivity(user, request.query) });
      throw new OperationsError("NOT_FOUND", "المورد المطلوب غير موجود", 404);
    }

    if (request.method === "POST") {
      const body = bodyOf(request);
      const action = clean(body.action);
      if (action === "save_vehicle") {
        if (!requirePermission(response, user, clean(body.id) ? "operations.vehicles.update" : "operations.vehicles.create")) return;
        return response.status(clean(body.id) ? 200 : 201).json({ ok: true, vehicle: await saveVehicle(user, body), message: clean(body.id) ? "تم تحديث السيارة" : "تمت إضافة السيارة" });
      }
      if (action === "import_vehicles") {
        if (!requirePermission(response, user, "operations.vehicles.import")) return;
        return response.status(200).json({ ok: true, report: await importVehicles(user, body.rows), message: "تمت معالجة ملف الاستيراد" });
      }
      if (action === "create_movement") {
        if (!requirePermission(response, user, "operations.movements.create")) return;
        return response.status(201).json({ ok: true, result: await createMovement(user, body), message: "تم تنفيذ الحركة لجميع السيارات" });
      }
      if (action === "create_request") {
        if (!requirePermission(response, user, "operations.requests.create")) return;
        try {
          return response.status(201).json({ ok: true, request: await createRequest(user, body), message: "تم إنشاء الطلب بنجاح" });
        } catch (createError) {
          await recordOperationsAudit(user, "request.create_failed", "request_attempt", requestId, body, {}, createError instanceof Error ? createError.message : "تعذر إنشاء الطلب", requestId).catch((auditError) => console.error("Operations failed-request audit failed", { requestId, auditError }));
          throw createError;
        }
      }
      if (action === "progress_request") {
        if (!requirePermission(response, user, "operations.requests.progress")) return;
        return response.status(200).json({ ok: true, request: await progressRequest(user, body), message: "تم تنفيذ مرحلة الطلب" });
      }
      if (action === "request_state") {
        if (!requirePermission(response, user, "operations.requests.cancel")) return;
        return response.status(200).json({ ok: true, request: await cancelOrDeleteRequest(user, body), message: clean(body.mode) === "delete" ? "تم حذف الطلب قبل بدء التنفيذ" : "تم إلغاء الطلب" });
      }
      if (action === "update_approval") {
        const approvalType = clean(body.approvalType);
        const allowed = user.isSystemAdmin
          || (approvalType === "financial" && user.roleCodes.includes("accounting_manager"))
          || (approvalType === "administrative" && user.roleCodes.includes("operations_manager"));
        if (!allowed) return response.status(403).json({ ok: false, code: "FORBIDDEN", error: "ليس لديك صلاحية تنفيذ هذا النوع من الموافقات", message: "ليس لديك صلاحية تنفيذ هذا النوع من الموافقات", requestId });
        if (approvalType === "all" && !user.isSystemAdmin) return response.status(403).json({ ok: false, code: "FORBIDDEN", error: "مسح الموافقات متاح لمدير النظام فقط", requestId });
        return response.status(200).json({ ok: true, approval: await updateApproval(user, body), message: "تم تحديث الموافقة" });
      }
      if (action === "save_location") {
        if (!requirePermission(response, user, "operations.settings.manage")) return;
        return response.status(200).json({ ok: true, location: await saveOperationLocation(user, body), message: "تم حفظ الموقع" });
      }
      if (action === "save_status") {
        if (!requirePermission(response, user, "operations.settings.manage")) return;
        return response.status(200).json({ ok: true, status: await saveOperationStatus(user, body), message: "تم حفظ الحالة" });
      }
      if (action === "archive_vehicle") {
        if (!requirePermission(response, user, "operations.archive.create")) return;
        return response.status(200).json({ ok: true, vehicle: await archiveVehicle(user, body), message: "تمت أرشفة السيارة" });
      }
      throw new OperationsError("VALIDATION_ERROR", "الإجراء غير مدعوم", 400);
    }

    return response.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED", error: "Method not allowed", requestId });
  } catch (error) {
    return sendError(response, error, requestId);
  }
}
