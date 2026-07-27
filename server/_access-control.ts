import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { getSql } from "./_db.js";
import {
  hasPermission as sharedHasPermission,
  type DataScope,
  type PlatformSystem,
  type SystemAccessConfig,
} from "../shared/access-control.js";

export type EffectiveAccessSnapshot = {
  permissions: string[];
  inheritedPermissions: string[];
  directPermissions: string[];
  deniedPermissions: string[];
  systemAccess: Partial<Record<PlatformSystem, SystemAccessConfig>>;
  permissionVersion: number;
};

export type PermissionUser = EffectiveAccessSnapshot & {
  id: string;
  fullName: string;
  email: string | null;
  roleCodes: string[];
  roles: string[];
};

function normalizeArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

export function requestId(request: VercelRequest) {
  const existing = String(request.headers["x-request-id"] || request.headers["x-vercel-id"] || "").trim();
  return existing.slice(0, 120) || randomUUID();
}

export function requestUserAgent(request: VercelRequest) {
  return String(request.headers["user-agent"] || "").slice(0, 500) || null;
}

export async function getEffectiveAccess(userId: string): Promise<EffectiveAccessSnapshot> {
  const sql = getSql();
  const [versionRows, permissionRows, systemRows] = await Promise.all([
    sql<{ permission_version: number }[]>`
      select permission_version::int from core.users where id=${userId}::uuid
    `,
    sql<{
      inherited_permissions: string[] | null;
      direct_permissions: string[] | null;
      denied_permissions: string[] | null;
      effective_permissions: string[] | null;
    }[]>`
      with role_ids as (
        select role_id from core.user_roles where user_id=${userId}::uuid
        union
        select role_id from core.user_systems where user_id=${userId}::uuid and role_id is not null
      ), inherited as (
        select distinct p.code
        from role_ids r
        join core.role_permissions rp on rp.role_id=r.role_id
        join core.permissions p on p.id=rp.permission_id and p.is_active=true
      ), direct_allow as (
        select distinct p.code
        from core.user_permission_overrides o
        join core.permissions p on p.id=o.permission_id and p.is_active=true
        where o.user_id=${userId}::uuid and o.effect='allow'
      ), direct_deny as (
        select distinct p.code
        from core.user_permission_overrides o
        join core.permissions p on p.id=o.permission_id and p.is_active=true
        where o.user_id=${userId}::uuid and o.effect='deny'
      ), effective as (
        select code from inherited
        union select code from direct_allow
        except select code from direct_deny
      )
      select
        coalesce((select array_agg(code order by code) from inherited),'{}') as inherited_permissions,
        coalesce((select array_agg(code order by code) from direct_allow),'{}') as direct_permissions,
        coalesce((select array_agg(code order by code) from direct_deny),'{}') as denied_permissions,
        coalesce((select array_agg(code order by code) from effective),'{}') as effective_permissions
    `,
    sql<{
      system_code: PlatformSystem;
      is_enabled: boolean;
      data_scope: DataScope;
      role_id: string | null;
      role_code: string | null;
      branch_codes: string[] | null;
      department_codes: string[] | null;
    }[]>`
      select
        us.system_code,
        us.is_enabled,
        us.data_scope,
        us.role_id::text,
        r.code as role_code,
        coalesce((
          select array_agg(b.code order by usb.is_primary desc,b.sort_order,b.name)
          from core.user_system_branches usb
          join core.branches b on b.id=usb.branch_id and b.is_active=true
          where usb.user_id=us.user_id and usb.system_code=us.system_code
        ),'{}') as branch_codes,
        coalesce((
          select array_agg(d.code order by usd.is_primary desc,d.name)
          from core.user_system_departments usd
          join core.departments d on d.id=usd.department_id and d.is_active=true
          where usd.user_id=us.user_id and usd.system_code=us.system_code
        ),'{}') as department_codes
      from core.user_systems us
      left join core.roles r on r.id=us.role_id
      where us.user_id=${userId}::uuid
    `,
  ]);

  const versionRow = versionRows[0];
  const permissionRow = permissionRows[0];

  const systemAccess: EffectiveAccessSnapshot["systemAccess"] = {};
  for (const row of systemRows) {
    if (!["crm", "marketing", "operations", "tracking"].includes(row.system_code)) continue;
    systemAccess[row.system_code] = {
      enabled: Boolean(row.is_enabled),
      dataScope: row.data_scope,
      roleId: row.role_id,
      roleCode: row.role_code,
      branchCodes: normalizeArray(row.branch_codes),
      departmentCodes: normalizeArray(row.department_codes),
    };
  }

  return {
    permissions: normalizeArray(permissionRow?.effective_permissions),
    inheritedPermissions: normalizeArray(permissionRow?.inherited_permissions),
    directPermissions: normalizeArray(permissionRow?.direct_permissions),
    deniedPermissions: normalizeArray(permissionRow?.denied_permissions),
    systemAccess,
    permissionVersion: Number(versionRow?.permission_version || 1),
  };
}

export function hasPermission(user: PermissionUser | null | undefined, code: string) {
  return sharedHasPermission(user, code);
}

export function getSystemAccess(user: PermissionUser, system: PlatformSystem): SystemAccessConfig {
  return user.systemAccess[system] || {
    enabled: false,
    dataScope: "assigned",
    roleId: null,
    roleCode: null,
    branchCodes: [],
    departmentCodes: [],
  };
}

export async function logSecurityEvent(input: {
  request: VercelRequest;
  user?: PermissionUser | null;
  userEmail?: string | null;
  userRole?: string | null;
  systemCode: string;
  pageCode?: string | null;
  permissionCode?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  result: "allowed" | "denied" | "success" | "failure";
  reason?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  ipAddress?: string | null;
}) {
  const sql = getSql();
  const role = input.userRole || input.user?.roles?.[0] || input.user?.roleCodes?.[0] || null;
  const primarySystem = input.systemCode as PlatformSystem;
  const scope = input.user && ["crm", "marketing", "operations", "tracking"].includes(input.systemCode)
    ? getSystemAccess(input.user, primarySystem)
    : null;
  await sql`
    insert into audit.activity_log(
      user_id,user_email,user_role,system_code,page_code,permission_code,action,entity_type,entity_id,
      before_data,after_data,ip_address,branch_code,department_code,user_agent,result,rejection_reason,request_id
    ) values (
      ${input.user?.id || null}::uuid,${input.userEmail || input.user?.email || null},${role},${input.systemCode},${input.pageCode || null},${input.permissionCode || null},
      ${input.action},${input.entityType || null},${input.entityId || null},
      ${input.beforeData === undefined ? null : sql.json(input.beforeData as any)},
      ${input.afterData === undefined ? null : sql.json(input.afterData as any)},
      ${input.ipAddress || null},${scope?.branchCodes[0] || null},${scope?.departmentCodes[0] || null},
      ${requestUserAgent(input.request)},${input.result},${input.reason || null},${requestId(input.request)}
    )
  `.catch((error) => console.error("Security audit failed", error));
}

export async function requirePermissionForUser(
  request: VercelRequest,
  response: VercelResponse,
  user: PermissionUser,
  permissionCode: string,
  options?: { systemCode?: string; pageCode?: string; action?: string },
) {
  if (hasPermission(user, permissionCode)) return true;
  const systemCode = options?.systemCode || permissionCode.split(".")[0] || "core";
  await logSecurityEvent({
    request,
    user,
    systemCode,
    pageCode: options?.pageCode || null,
    permissionCode,
    action: options?.action || "permission_denied",
    result: "denied",
    reason: "MISSING_PERMISSION",
  });
  response.status(403).json({ ok: false, code: "FORBIDDEN", error: "لا توجد لديك صلاحية لتنفيذ هذا الإجراء", permission: permissionCode });
  return false;
}

export async function invalidateUserAccess(userId: string) {
  const sql = getSql();
  await sql.begin(async (tx) => {
    await tx`update core.users set permission_version=permission_version+1,updated_at=now() where id=${userId}::uuid`;
    await tx`delete from core.sessions where user_id=${userId}::uuid`;
  });
}
