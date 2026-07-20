import { randomBytes } from "node:crypto";
import type { VercelResponse } from "@vercel/node";

export type OperationsErrorCode =
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

export class OperationsError extends Error {
  status: number;
  code: OperationsErrorCode;
  fieldErrors?: Record<string, string>;
  details?: Record<string, unknown>;

  constructor(status: number, code: OperationsErrorCode, message: string, options?: { fieldErrors?: Record<string, string>; details?: Record<string, unknown> }) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = options?.fieldErrors;
    this.details = options?.details;
  }
}

export function operationsRequestId() {
  return `ops-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

export function sendOperationsError(response: VercelResponse, error: unknown, requestId: string) {
  if (error instanceof OperationsError) {
    return response.status(error.status).json({
      ok: false,
      code: error.code,
      message: error.message,
      error: error.message,
      fieldErrors: error.fieldErrors,
      details: error.details,
      requestId,
    });
  }

  const pgCode = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code || "") : "";
  let message = "تعذر تنفيذ العملية بسبب خطأ في قاعدة البيانات";
  let code: OperationsErrorCode = "DATABASE_ERROR";
  let status = 500;
  if (pgCode === "23505") {
    message = "توجد بيانات مكررة تمنع تنفيذ العملية";
    code = "CONFLICT";
    status = 409;
  } else if (pgCode === "23503") {
    message = "لا يمكن تنفيذ العملية لوجود بيانات مرتبطة";
    code = "CONFLICT";
    status = 409;
  }
  console.error("Operations request failed", { requestId, error });
  return response.status(status).json({ ok: false, code, message, error: message, requestId });
}
