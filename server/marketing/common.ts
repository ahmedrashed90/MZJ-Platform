import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import type { SessionUser } from "../_auth.js";
import { requireUser } from "../_auth.js";
import { getSql } from "../_db.js";

export class MarketingError extends Error {
  constructor(public status: number, message: string, public code = "MARKETING_ERROR") {
    super(message);
  }
}

export function clean(value: unknown) { return String(value ?? "").trim(); }
export function boolValue(value: unknown) { return value === true || ["true", "1", "yes", "on"].includes(clean(value).toLowerCase()); }
export function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
export function dateValue(value: unknown) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}
export function parseBody(value: unknown): Record<string, any> {
  if (value && typeof value === "object") return value as Record<string, any>;
  if (typeof value === "string") {
    try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed : {}; } catch { return {}; }
  }
  return {};
}
export function arrayValue<T = any>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
export function safeJson(value: unknown): any { return JSON.parse(JSON.stringify(value ?? null)); }
export function requestId(prefix = "mkt") { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`; }
export function isAdmin(user: SessionUser) { return user.roleCodes.some((code) => ["admin", "system_admin"].includes(code)); }
export function hasPermission(user: SessionUser, permission: string) { return isAdmin(user) || user.permissions.includes(permission); }
export function marketingMember(user: SessionUser) {
  return isAdmin(user) || user.permissions.includes("marketing.view") || user.departmentCodes.includes("marketing") || user.roleCodes.includes("marketing_user");
}

export async function requireMarketingUser(request: VercelRequest, response: VercelResponse, permission?: string) {
  const user = await requireUser(request, response);
  if (!user) return null;
  if (!marketingMember(user)) {
    response.status(403).json({ ok: false, error: "لا توجد لديك صلاحية دخول نظام التسويق" });
    return null;
  }
  if (permission && !hasPermission(user, permission)) {
    response.status(403).json({ ok: false, error: "لا توجد لديك صلاحية تنفيذ هذا الإجراء" });
    return null;
  }
  return user;
}

export function pageValues(request: VercelRequest) {
  const page = Math.max(1, Math.floor(numberValue(request.query.page, 1)));
  const pageSize = Math.min(500, Math.max(1, Math.floor(numberValue(request.query.pageSize, 50))));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export async function audit(user: Pick<SessionUser, "id"> | null, action: string, entityType: string, entityId: string, beforeData?: unknown, afterData?: unknown) {
  const sql = getSql();
  await sql`
    insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data)
    values (${user?.id || null}::uuid,'marketing',${action},${entityType},${entityId},${beforeData === undefined ? null : sql.json(safeJson(beforeData))},${afterData === undefined ? null : sql.json(safeJson(afterData))})
  `;
}

export function normalizeDepartment(value: unknown) {
  const raw = clean(value).toLowerCase();
  if (["content", "المحتوى", "قسم المحتوى"].includes(raw)) return "content";
  if (["montage", "editing", "المونتاج", "قسم المونتاج"].includes(raw)) return "montage";
  if (["photography", "shooting", "التصوير", "قسم التصوير"].includes(raw)) return "photography";
  if (["design", "التصميم", "قسم التصميم"].includes(raw)) return "design";
  if (["publishing", "publish", "النشر", "قسم النشر"].includes(raw)) return "publishing";
  return raw.replace(/[^a-z0-9_-]+/g, "_") || "general";
}

export function buildPairKey(input: { campaignId: string; creativeId: string; departmentCode: string; executionUserId: string; contentUserId: string }) {
  return [input.campaignId, input.creativeId, normalizeDepartment(input.departmentCode), input.executionUserId, input.contentUserId].join(":");
}

export function buildTaskCode(campaignCode: string, instanceCode: string, departmentCode: string, serial: number, kind: "C" | "E") {
  const department = normalizeDepartment(departmentCode).toUpperCase().slice(0, 8);
  return `${campaignCode}-${instanceCode}-${department}-${kind}${String(serial).padStart(2, "0")}`;
}

export async function allocateCampaignCode(tx: any, campaignTypeId: string, sourceType: string) {
  const [type] = await tx<any[]>`select id::text,name,prefix from marketing.campaign_types where id=${campaignTypeId}::uuid and is_active=true for update`;
  if (!type) throw new MarketingError(400, "نوع الحملة غير صحيح", "INVALID_CAMPAIGN_TYPE");
  await tx`insert into marketing.campaign_counters(campaign_type_id,counter) values (${type.id}::uuid,0) on conflict(campaign_type_id) do nothing`;
  const [counter] = await tx<any[]>`update marketing.campaign_counters set counter=counter+1,updated_at=now() where campaign_type_id=${type.id}::uuid returning counter`;
  const prefix = sourceType === "agenda" ? "AGN" : clean(type.prefix).toUpperCase();
  const code = `${prefix}-${new Date().getFullYear()}-${String(counter.counter).padStart(4, "0")}`;
  return { code, type };
}

export async function recalculateCampaign(tx: any, campaignId: string) {
  const taskRows = await tx<any[]>`
    select t.id::text,t.department_code,t.task_type,t.status,t.progress_percent,t.requires_final_file,
      exists(select 1 from marketing.task_files f where f.task_id=t.id and f.file_kind='final' and f.is_active=true) as has_final_file
    from marketing.tasks t where t.campaign_id=${campaignId}::uuid
  `;
  const departmentMap = new Map<string, number[]>();
  for (const row of taskRows) {
    const progress = Math.max(0, Math.min(100, Number(row.progress_percent || 0)));
    const gated = row.task_type === "execution" && row.requires_final_file && !row.has_final_file && progress >= 100 ? 99 : progress;
    const list = departmentMap.get(row.department_code) || [];
    list.push(gated);
    departmentMap.set(row.department_code, list);
  }
  const departmentProgress = [...departmentMap.entries()].map(([departmentCode, values]) => ({
    departmentCode,
    progress: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0,
    taskCount: values.length,
    startedCount: values.filter((value) => value > 0).length,
  }));
  const progress = departmentProgress.length ? Math.round(departmentProgress.reduce((sum, item) => sum + item.progress, 0) / departmentProgress.length) : 0;
  const [campaign] = await tx<any[]>`
    update marketing.campaigns set progress_percent=${progress},status=case
      when status in ('archived','cancelled') then status
      when ${progress}>=100 then case when released_at is null then 'ready_for_publish' else 'completed' end
      when ${progress}>0 then 'in_progress'
      when publish_start_date>current_date then 'scheduled'
      else 'draft' end,
      updated_at=now(),version=version+1
    where id=${campaignId}::uuid returning *,id::text
  `;
  return { campaign, departmentProgress };
}

export function storageKeyForTask(taskId: string, fileKind: string, fileName: string) {
  const safeName = clean(fileName).normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "file.bin";
  const now = new Date();
  return `marketing/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${taskId}/${fileKind}/${crypto.randomUUID()}-${safeName}`;
}

export async function userCanAccessTask(sql: ReturnType<typeof getSql>, user: SessionUser, taskId: string) {
  if (isAdmin(user) || hasPermission(user, "marketing.tasks.review")) return true;
  const [row] = await sql<any[]>`select 1 from marketing.tasks where id=${taskId}::uuid and assigned_to=${user.id}::uuid`;
  return Boolean(row);
}
