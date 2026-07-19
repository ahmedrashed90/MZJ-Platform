import type { VercelRequest } from "@vercel/node";
import type { SessionUser } from "./_auth.js";
import { requestIp } from "./_auth.js";

export class OperationsError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function bodyOf(request: VercelRequest): Record<string, any> {
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body || "{}"); } catch { throw new OperationsError("صيغة البيانات المرسلة غير صحيحة"); }
  }
  return (request.body && typeof request.body === "object" ? request.body : {}) as Record<string, any>;
}

export function bool(value: unknown) {
  return value === true || ["1", "true", "yes"].includes(clean(value).toLowerCase());
}

export function integer(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), min), max) : fallback;
}

export function primaryRole(user: SessionUser) {
  return user.roleCodes[0] || "user";
}

export function primaryBranch(user: SessionUser) {
  return user.branchCodes[0] || null;
}

export async function writeAudit(tx: any, request: VercelRequest, user: SessionUser, input: {
  action: string; entityType: string; entityId: string; before?: unknown; after?: unknown;
}) {
  await tx`
    insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data,ip_address)
    values (${user.id}::uuid,'operations',${input.action},${input.entityType},${input.entityId},${input.before ? tx.json(input.before) : null},${input.after ? tx.json(input.after) : null},${requestIp(request)})
  `;
}

export async function writeOutbox(tx: any, input: {
  eventType: string; aggregateType: string; aggregateId: string; title?: string; description?: string;
  path?: string; metadata?: unknown; targetRoles?: string[]; targetUserIds?: string[];
}) {
  await tx`
    insert into operations.event_outbox(event_type,aggregate_type,aggregate_id,title,description,target_roles,target_user_ids,internal_path,metadata)
    values (${input.eventType},${input.aggregateType},${input.aggregateId},${input.title || null},${input.description || null},${input.targetRoles || []}::text[],${input.targetUserIds || []}::uuid[],${input.path || null},${tx.json(input.metadata || {})})
  `;
}

export function handleOperationsError(response: any, error: any) {
  console.error("Operations API error", error);
  if (error instanceof OperationsError) return response.status(error.status).json({ ok: false, error: error.message });
  if (error?.code === "23505") return response.status(409).json({ ok: false, error: "البيانات مكررة أو رقم الهيكل مستخدم بالفعل" });
  if (error?.code === "23503") return response.status(400).json({ ok: false, error: "أحد المراجع المحددة غير صحيح" });
  if (error?.code === "22P02") return response.status(400).json({ ok: false, error: "معرف السجل غير صحيح" });
  return response.status(500).json({ ok: false, error: "تعذر تنفيذ العملية حاليًا" });
}
