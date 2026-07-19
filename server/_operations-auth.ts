import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { SessionUser } from "./_auth.js";
import { hasPermission as centralHasPermission, isSystemAdmin, requireUser } from "./_auth.js";
import { getSql, runSqlScript } from "./_db.js";
import { OPERATIONS_MIGRATION_SQL } from "./_operations-schema.js";
import { ensureTrackingSchema } from "./_tracking-schema.js";

let migrationPromise: Promise<void> | null = null;

export function ensureOperationsSchema() {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      await ensureTrackingSchema();
      await runSqlScript(OPERATIONS_MIGRATION_SQL);
    })().catch((error) => {
      migrationPromise = null;
      throw error;
    });
  }
  return migrationPromise;
}

export function hasPermission(user: SessionUser, permission: string) {
  return centralHasPermission(user, permission);
}

export async function requireOperationsPermission(
  request: VercelRequest,
  response: VercelResponse,
  permission: string,
) {
  await ensureOperationsSchema();
  const user = await requireUser(request, response);
  if (!user) return null;
  if (!hasPermission(user, "operations.view")) {
    response.status(403).json({ ok: false, error: "ليس لديك صلاحية الدخول إلى نظام العمليات" });
    return null;
  }
  if (!hasPermission(user, permission)) {
    response.status(403).json({ ok: false, error: "ليس لديك صلاحية تنفيذ هذا الإجراء" });
    return null;
  }
  return user;
}

export async function permittedLocationIds(user: SessionUser) {
  const sql = getSql();
  if (isSystemAdmin(user)) {
    const rows = await sql<{ id: string }[]>`select id::text from operations.locations where is_active=true`;
    return rows.map((row) => row.id);
  }
  if (!user.branchCodes.length) return [];
  const rows = await sql<{ id: string }[]>`
    select l.id::text
    from operations.locations l
    join core.branches b on b.id=l.branch_id
    where l.is_active=true and b.code=any(${user.branchCodes}::text[])
  `;
  return rows.map((row) => row.id);
}

export async function permittedBranchIds(user: SessionUser) {
  const sql = getSql();
  if (isSystemAdmin(user)) {
    const rows = await sql<{ id: string }[]>`select id::text from core.branches where is_active=true`;
    return rows.map((row) => row.id);
  }
  if (!user.branchCodes.length) return [];
  const rows = await sql<{ id: string }[]>`
    select id::text from core.branches where is_active=true and code=any(${user.branchCodes}::text[])
  `;
  return rows.map((row) => row.id);
}

export function actorSnapshot(user: SessionUser) {
  return {
    role: user.roles[0] || user.roleCodes[0] || null,
    roleCode: user.roleCodes[0] || null,
    branch: user.branches[0] || user.branchCodes[0] || null,
    branchCode: user.branchCodes[0] || null,
    isSystemAdmin: isSystemAdmin(user),
  };
}

export function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeVin(value: unknown) {
  return clean(value).replace(/\s+/g, "").toUpperCase();
}

export function bodyOf(request: VercelRequest): Record<string, any> {
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body || "{}"); } catch { return {}; }
  }
  return request.body && typeof request.body === "object" ? request.body as Record<string, any> : {};
}

export function positiveInt(value: unknown, fallback: number, max = 200) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.floor(parsed));
}

export { isSystemAdmin };
