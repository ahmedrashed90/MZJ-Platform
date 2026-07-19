import type { VercelRequest } from "@vercel/node";
import type { SessionUser } from "../_auth.js";
import { requestIp } from "../_auth.js";
import { actorSnapshot, clean } from "../_operations-auth.js";

export const REQUEST_STAGES = ["request_received", "vehicle_sent", "vehicle_received", "completed"] as const;
export type RequestStage = (typeof REQUEST_STAGES)[number];

export const STAGE_PERMISSIONS: Record<RequestStage, string> = {
  request_received: "operations.requests.receive_order",
  vehicle_sent: "operations.requests.send_vehicle",
  vehicle_received: "operations.requests.receive_vehicle",
  completed: "operations.requests.complete",
};

export function bool(value: unknown) {
  return value === true || ["1", "true", "yes", "نعم", "✓"].includes(clean(value).toLowerCase());
}

export function stringOrNull(value: unknown) {
  const result = clean(value);
  return result || null;
}

export function stringArray(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.map(clean).filter(Boolean))] : [];
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function pageParams(query: Record<string, unknown>, defaultSize = 30, maxSize = 200) {
  const page = Math.max(1, Math.floor(Number(query.page || 1)) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Math.floor(Number(query.pageSize || defaultSize)) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function sessionData(user: SessionUser) {
  return {
    userId: user.id,
    roleCodes: user.roleCodes,
    branchCodes: user.branchCodes,
    departmentCodes: user.departmentCodes,
    isSystemAdmin: user.isSystemAdmin,
  };
}

export async function audit(
  tx: any,
  request: VercelRequest,
  user: SessionUser,
  input: {
    pageCode?: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    beforeData?: unknown;
    afterData?: unknown;
    reason?: string | null;
    isOverride?: boolean;
  },
) {
  const actor = actorSnapshot(user);
  await tx`
    insert into operations.audit_events(
      actor_id,actor_name,actor_role,actor_branch,page_code,action,entity_type,entity_id,
      before_data,after_data,reason,is_override,session_data,ip_address
    ) values (
      ${user.id}::uuid,${user.fullName},${actor.role},${actor.branch},${input.pageCode || null},${input.action},
      ${input.entityType},${input.entityId || null},${input.beforeData == null ? null : tx.json(input.beforeData)},
      ${input.afterData == null ? null : tx.json(input.afterData)},${input.reason || null},${Boolean(input.isOverride)},
      ${tx.json(sessionData(user))},${requestIp(request)}
    )
  `;
  await tx`
    insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data,ip_address)
    values (${user.id}::uuid,'operations',${input.action},${input.entityType},${input.entityId || null},
      ${input.beforeData == null ? null : tx.json(input.beforeData)},${input.afterData == null ? null : tx.json(input.afterData)},${requestIp(request)})
  `.catch(() => undefined);
}

export async function outbox(
  tx: any,
  user: SessionUser,
  input: {
    eventType: string;
    entityType: string;
    entityId?: string | null;
    requestNo?: string | null;
    vehicleId?: string | null;
    vin?: string | null;
    sourceBranchId?: string | null;
    destinationBranchId?: string | null;
    targetRoles?: string[];
    targetUserIds?: string[];
    title: string;
    description?: string | null;
    internalPath?: string | null;
    metadata?: unknown;
  },
) {
  await tx`
    insert into operations.event_outbox(
      event_type,entity_type,entity_id,request_no,vehicle_id,vin,actor_id,source_branch_id,destination_branch_id,
      target_roles,target_user_ids,title,description,internal_path,metadata
    ) values (
      ${input.eventType},${input.entityType},${input.entityId || null},${input.requestNo || null},${input.vehicleId || null}::uuid,
      ${input.vin || null},${user.id}::uuid,${input.sourceBranchId || null}::uuid,${input.destinationBranchId || null}::uuid,
      ${input.targetRoles || []}::text[],${input.targetUserIds || []}::uuid[],${input.title},${input.description || null},
      ${input.internalPath || null},${tx.json(input.metadata || {})}
    )
  `;
}

export function nextStage(status: string): RequestStage | null {
  if (status === "draft") return "request_received";
  const index = REQUEST_STAGES.indexOf(status as RequestStage);
  if (index < 0 || index >= REQUEST_STAGES.length - 1) return null;
  return REQUEST_STAGES[index + 1];
}

export function stageLabel(stage: string) {
  return ({
    draft: "جديد",
    request_received: "تم استلام الطلب",
    vehicle_sent: "تم إرسال السيارة",
    vehicle_received: "تم استلام السيارة",
    completed: "تم الانتهاء",
    cancelled: "ملغي",
    deleted: "محذوف",
  } as Record<string, string>)[stage] || stage;
}

export class OperationsError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
