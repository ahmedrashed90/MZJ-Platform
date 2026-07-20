import { randomUUID } from "node:crypto";
import type { VercelResponse } from "@vercel/node";

export function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function boolValue(value: unknown) {
  return value === true || ["1", "true", "yes", "on"].includes(clean(value).toLowerCase());
}

export function intValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

export function requestId(prefix = "ops") {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

export type OperationErrorCode =
  | "VALIDATION_ERROR"
  | "VEHICLE_NOT_FOUND"
  | "VEHICLE_NOT_ELIGIBLE"
  | "INVALID_STATUS_TRANSITION"
  | "APPROVALS_REQUIRED"
  | "INVALID_SOURCE_LOCATION"
  | "INVALID_DESTINATION_LOCATION"
  | "DUPLICATE_VIN"
  | "DUPLICATE_ACTIVE_REQUEST"
  | "FORBIDDEN"
  | "CONFLICT"
  | "IMPORT_VALIDATION_FAILED"
  | "TRACKING_REQUEST_NOT_FOUND"
  | "TRACKING_SOURCE_ALREADY_DELETED"
  | "VEHICLE_HAS_HISTORY"
  | "DATABASE_ERROR";

export class OperationError extends Error {
  status: number;
  code: OperationErrorCode;
  fieldErrors?: Record<string, string>;
  safeDetails?: Record<string, unknown>;

  constructor(status: number, code: OperationErrorCode, message: string, options?: { fieldErrors?: Record<string, string>; safeDetails?: Record<string, unknown> }) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = options?.fieldErrors;
    this.safeDetails = options?.safeDetails;
  }
}

export function sendOperationError(response: VercelResponse, error: unknown, id: string) {
  if (error instanceof OperationError) {
    return response.status(error.status).json({
      ok: false,
      code: error.code,
      error: error.message,
      message: error.message,
      fieldErrors: error.fieldErrors,
      details: error.safeDetails,
      requestId: id,
    });
  }
  const dbCode = clean((error as { code?: unknown })?.code);
  if (dbCode === "23505") {
    return response.status(409).json({ ok: false, code: "CONFLICT", error: "توجد بيانات مكررة تمنع تنفيذ العملية", message: "توجد بيانات مكررة تمنع تنفيذ العملية", requestId: id });
  }
  if (dbCode === "23503") {
    return response.status(409).json({ ok: false, code: "CONFLICT", error: "العملية مرتبطة ببيانات أخرى ولا يمكن تنفيذها بهذه الصورة", message: "العملية مرتبطة ببيانات أخرى ولا يمكن تنفيذها بهذه الصورة", requestId: id });
  }
  return response.status(500).json({ ok: false, code: "DATABASE_ERROR", error: "تعذر تنفيذ العملية بسبب خطأ في قاعدة البيانات", message: "تعذر تنفيذ العملية بسبب خطأ في قاعدة البيانات", requestId: id });
}

export function parseBody(body: unknown) {
  if (typeof body === "string") return JSON.parse(body || "{}");
  return body && typeof body === "object" ? body as Record<string, any> : {};
}

export function statusLabel(code: string) {
  const labels: Record<string, string> = {
    available_for_sale: "متاح للبيع",
    reserved: "حجز",
    has_notes: "بها ملاحظات",
    under_delivery: "مباع تحت التسليم",
    delivered: "مباع تم التسليم",
  };
  return labels[code] || code || "—";
}
