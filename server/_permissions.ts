import { ensureAccessControlSchema } from "./_access-control-schema.js";
import { getSql } from "./_db.js";

export type PermissionEffect = "allow" | "deny";
export type DataScopeCode =
  | "self"
  | "assigned"
  | "created_by_me"
  | "branch"
  | "branches"
  | "department"
  | "departments"
  | "branch_and_department"
  | "source_branch"
  | "destination_branch"
  | "workflow_assigned"
  | "all";

export type SystemScopeRule = {
  scopeCode: DataScopeCode;
  branchCodes: string[];
  departmentCodes: string[];
};

export type EffectiveAccess = {
  permissions: string[];
  inheritedPermissions: string[];
  allowedOverrides: string[];
  deniedOverrides: string[];
  systemCodes: string[];
  dataScopes: Record<string, DataScopeCode>;
  scopeRules: Record<string, SystemScopeRule>;
};

export async function getEffectivePermissions(userId: string): Promise<EffectiveAccess> {
  await ensureAccessControlSchema();
  const sql = getSql();
  const [inheritedRows, overrideRows, systemRows, scopeRows] = await Promise.all([
    sql<{ code: string; system_code: string }[]>`
      select distinct p.code, p.system_code
      from core.permissions p
      join core.role_permissions rp on rp.permission_id=p.id
      join (
        select role_id from core.user_roles where user_id=${userId}::uuid
        union
        select role_id from core.user_systems where user_id=${userId}::uuid and role_id is not null and is_enabled=true
      ) roles on roles.role_id=rp.role_id
      where p.is_active=true
    `,
    sql<{ code: string; system_code: string; effect: PermissionEffect }[]>`
      select p.code, p.system_code, o.effect
      from core.user_permission_overrides o
      join core.permissions p on p.id=o.permission_id and p.is_active=true
      where o.user_id=${userId}::uuid
    `,
    sql<{ system_code: string; data_scope: DataScopeCode; is_enabled: boolean }[]>`
      select system_code, data_scope, is_enabled
      from core.user_systems
      where user_id=${userId}::uuid
    `,
    sql<{ system_code: string; scope_code: DataScopeCode; branch_codes: string[] | null; department_codes: string[] | null }[]>`
      select r.system_code, r.scope_code,
        coalesce(array(select b.code from core.branches b where b.id=any(r.branch_ids) order by b.sort_order,b.name), '{}') as branch_codes,
        coalesce(array(select d.code from core.departments d where d.id=any(r.department_ids) order by d.name), '{}') as department_codes
      from core.user_scope_rules r
      where r.user_id=${userId}::uuid
    `,
  ]);

  const enabledSystems = new Set(systemRows.filter((row) => row.is_enabled).map((row) => row.system_code));
  const permissionEnabled = (systemCode: string) => systemCode === "core" || enabledSystems.has(systemCode);
  const inherited = new Set(inheritedRows.filter((row) => permissionEnabled(row.system_code)).map((row) => row.code));
  const allowed = new Set(overrideRows.filter((row) => row.effect === "allow" && permissionEnabled(row.system_code)).map((row) => row.code));
  const denied = new Set(overrideRows.filter((row) => row.effect === "deny").map((row) => row.code));
  const effective = new Set<string>([...inherited, ...allowed]);
  for (const row of systemRows.filter((item) => item.is_enabled)) {
    effective.add(`system.${row.system_code}.access`);
  }
  for (const code of denied) effective.delete(code);

  const systemCodes = new Set<string>();
  for (const code of Array.from(effective)) {
    const match = /^system\.([^.]+)\.access$/.exec(code);
    if (match) systemCodes.add(match[1]);
  }

  const dataScopes: Record<string, DataScopeCode> = {};
  for (const row of systemRows.filter((item) => item.is_enabled)) dataScopes[row.system_code] = row.data_scope;
  const scopeRules: Record<string, SystemScopeRule> = {};
  for (const row of scopeRows) {
    if (!enabledSystems.has(row.system_code)) continue;
    scopeRules[row.system_code] = {
      scopeCode: row.scope_code,
      branchCodes: Array.isArray(row.branch_codes) ? row.branch_codes.map(String) : [],
      departmentCodes: Array.isArray(row.department_codes) ? row.department_codes.map(String) : [],
    };
  }

  return {
    permissions: Array.from(effective).sort(),
    inheritedPermissions: Array.from(inherited).sort(),
    allowedOverrides: Array.from(allowed).sort(),
    deniedOverrides: Array.from(denied).sort(),
    systemCodes: Array.from(systemCodes).sort(),
    dataScopes,
    scopeRules,
  };
}

export function hasPermission(user: { permissions?: string[]; roleCodes?: string[] } | null | undefined, permissionCode: string) {
  if (!user) return false;
  return Boolean(user.permissions?.includes(permissionCode));
}

export function hasAnyPermission(user: { permissions?: string[] } | null | undefined, permissionCodes: string[]) {
  return permissionCodes.some((code) => hasPermission(user, code));
}

export function getUserScope(user: { dataScopes?: Record<string, DataScopeCode> }, systemCode: string): DataScopeCode {
  return user.dataScopes?.[systemCode] || "assigned";
}

export async function assertGrantablePermissions(
  actor: { permissions?: string[]; roleCodes?: string[] },
  permissionCodes: string[],
) {
  const actorPermissions = new Set(actor.permissions || []);
  const forbidden = permissionCodes.filter((code) => !actorPermissions.has(code));
  if (forbidden.length > 0) {
    const error = new Error("لا يمكنك منح صلاحيات أعلى من صلاحياتك الفعلية");
    (error as Error & { code?: string; forbidden?: string[] }).code = "PERMISSION_ESCALATION";
    (error as Error & { code?: string; forbidden?: string[] }).forbidden = forbidden;
    throw error;
  }
}

export async function bumpPermissionVersion(userId: string) {
  const sql = getSql();
  await sql`update core.users set permission_version=permission_version+1, updated_at=now() where id=${userId}::uuid`;
}
