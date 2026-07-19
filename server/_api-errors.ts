import { randomUUID } from "node:crypto";
import type { VercelResponse } from "@vercel/node";

export type ApiErrorCode =
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

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function requestId() {
  return randomUUID();
}

export function sendApiError(response: VercelResponse, error: unknown, traceId = requestId()) {
  if (error instanceof ApiError) {
    return response.status(error.status).json({
      ok: false,
      code: error.code,
      message: error.message,
      error: error.message,
      fieldErrors: error.fieldErrors,
      details: error.details,
      requestId: traceId,
    });
  }
  console.error("Unhandled structured API error", { traceId, error });
  return response.status(500).json({
    ok: false,
    code: "DATABASE_ERROR",
    message: "تعذر تنفيذ العملية بسبب خطأ في قاعدة البيانات",
    error: "تعذر تنفيذ العملية بسبب خطأ في قاعدة البيانات",
    requestId: traceId,
  });
}
