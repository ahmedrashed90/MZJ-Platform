import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { requireAnyPermission, requirePermission, requestIp, type SessionUser } from "./_auth.js";
import { ensureAccessControlSchema } from "./_access-control-schema.js";
import { assertGrantablePermissions, bumpPermissionVersion, getEffectivePermissions } from "./_permissions.js";
import { getSql } from "./_db.js";

const SETTINGS_VIEW_PERMISSIONS = [
  "settings.users.view",
  "settings.users.create",
  "settings.users.update",
  "settings.users.disable",
  "settings.roles.manage",
  "settings.permissions.manage",
  "settings.branches.manage",
  "settings.audit.view",
  "settings.security.view",
];

const USER_ACCESS_VIEW_PERMISSIONS = [
  "settings.users.view",
  "settings.users.update",
  "settings.users.disable",
  "settings.permissions.manage",
];

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? Array.from(new Set(value.map(clean).filter(Boolean))) : [];
}

function parseBody(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, any>;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body || "{}"); } catch { return {}; }
  }
  return {};
}

function requestContext(request: VercelRequest) {
  return {
    requestId: clean(request.headers["x-request-id"]) || randomUUID(),
    ip: requestIp(request),
    userAgent: clean(request.headers["user-agent"]).slice(0, 500) || null,
  };
}

async function loadCatalog() {
  const sql = getSql();
  const [systems, pages, permissions, roles, branches, departments] = await Promise.all([
    sql`select code, name_ar, is_active, sort_order from core.systems order by sort_order, name_ar`,
    sql`select id::text, system_code, code, name_ar, route, is_active, sort_order from core.system_pages order by system_code, sort_order, name_ar`,
    sql`select id::text, code, system_code, page_code, action_code, coalesce(name_ar,name) as name_ar, description_ar, category, is_sensitive, is_active, sort_order from core.permissions order by system_code, page_code nulls first, sort_order, code`,
    sql`select id::text, code, name, is_system from core.roles order by name`,
    sql`select id::text, code, name, is_active, sort_order from core.branches order by sort_order, name`,
    sql`select id::text, code, name, system_code, is_active from core.departments order by system_code, name`,
  ]);
  return { systems, pages, permissions, roles, branches, departments };
}

async function loadUserAccess(userId: string) {
  const sql = getSql();
  const [user] = await sql<any[]>`
    select id::text, employee_no, full_name, email, mobile, is_active, can_receive_leads, can_receive_tasks,
      permission_version, last_login_at, created_at
    from core.users where id=${userId}::uuid limit 1
  `;
  if (!user) return null;

  const [roles, systems, branches, departments, overrides, scopes, storedInheritedRows, access] = await Promise.all([
    sql`select r.id::text, r.code, r.name from core.user_roles ur join core.roles r on r.id=ur.role_id where ur.user_id=${userId}::uuid order by r.name`,
    sql`select us.system_code, us.is_enabled, us.role_id::text, r.name as role_name, us.data_scope, us.updated_at from core.user_systems us left join core.roles r on r.id=us.role_id where us.user_id=${userId}::uuid order by us.system_code`,
    sql`select b.id::text, b.code, b.name, ub.is_primary from core.user_branches ub join core.branches b on b.id=ub.branch_id where ub.user_id=${userId}::uuid order by ub.is_primary desc, b.name`,
    sql`select d.id::text, d.code, d.name, d.system_code, ud.is_primary from core.user_departments ud join core.departments d on d.id=ud.department_id where ud.user_id=${userId}::uuid order by ud.is_primary desc, d.name`,
    sql`select p.code, o.effect, o.reason, o.updated_at from core.user_permission_overrides o join core.permissions p on p.id=o.permission_id where o.user_id=${userId}::uuid order by p.code`,
    sql`select system_code, scope_code, branch_ids::text[], department_ids::text[], updated_at from core.user_scope_rules where user_id=${userId}::uuid order by system_code`,
    sql<{ code: string }[]>`
      select distinct p.code
      from core.permissions p
      join core.role_permissions rp on rp.permission_id=p.id
      join (
        select role_id from core.user_roles where user_id=${userId}::uuid
        union
        select role_id from core.user_systems where user_id=${userId}::uuid and role_id is not null
      ) assigned_roles on assigned_roles.role_id=rp.role_id
      where p.is_active=true
      order by p.code
    `,
    getEffectivePermissions(userId),
  ]);

  return {
    user, roles, systems, branches, departments, overrides, scopes,
    access: { ...access, storedInheritedPermissions: storedInheritedRows.map((row) => row.code) },
  };
}

async function permissionLog(limit: number) {
  const sql = getSql();
  return sql`
    select l.id::text, l.change_type, l.permission_code, l.system_code, l.old_value, l.new_value, l.reason,
      l.request_id, l.ip_address::text, l.user_agent, l.created_at,
      target.full_name as target_user_name, target.email as target_user_email,
      actor.full_name as changed_by_name, actor.email as changed_by_email,
      role.name as target_role_name
    from core.permission_change_log l
    left join core.users target on target.id=l.target_user_id
    left join core.users actor on actor.id=l.changed_by
    left join core.roles role on role.id=l.target_role_id
    order by l.created_at desc
    limit ${limit}
  `;
}

async function securityLog(limit: number) {
  const sql = getSql();
  return sql`
    select a.id::text, a.system_code, a.page_code, a.permission_code, a.action, a.entity_type, a.entity_id,
      a.ip_address::text, a.user_agent, a.request_id, a.result, a.rejection_reason, a.created_at,
      u.full_name as user_name, u.email as user_email
    from audit.activity_log a
    left join core.users u on u.id=a.user_id
    order by a.created_at desc
    limit ${limit}
  `;
}

async function writePermissionLog(
  tx: any,
  actor: SessionUser,
  request: VercelRequest,
  input: { targetUserId?: string | null; targetRoleId?: string | null; changeType: string; permissionCode?: string | null; systemCode?: string | null; oldValue?: unknown; newValue?: unknown; reason?: string | null },
) {
  const context = requestContext(request);
  await tx`
    insert into core.permission_change_log(
      target_user_id, target_role_id, changed_by, change_type, permission_code, system_code,
      old_value, new_value, reason, request_id, ip_address, user_agent
    ) values (
      ${input.targetUserId || null}::uuid, ${input.targetRoleId || null}::uuid, ${actor.id}::uuid,
      ${input.changeType}, ${input.permissionCode || null}, ${input.systemCode || null},
      ${input.oldValue === undefined ? null : tx.json(input.oldValue)},
      ${input.newValue === undefined ? null : tx.json(input.newValue)},
      ${input.reason || null}, ${context.requestId}, ${context.ip}, ${context.userAgent}
    )
  `;
}

async function saveUserAccess(request: VercelRequest, response: VercelResponse, actor: SessionUser, body: Record<string, any>) {
  const userId = clean(body.userId);
  if (!userId) return response.status(400).json({ ok: false, error: "معرف المستخدم مطلوب" });
  if (userId === actor.id) {
    return response.status(403).json({ ok: false, error: "لا يمكن تعديل صلاحيات الحساب الحالي من الجلسة نفسها" });
  }

  const systems = Array.isArray(body.systems) ? body.systems : [];
  const roleIds = stringArray(body.roleIds);
  const overrides = Array.isArray(body.overrides) ? body.overrides : [];
  const allowedCodes = overrides.filter((item: any) => item?.effect === "allow").map((item: any) => clean(item.code)).filter(Boolean);
  const systemRoleIds = systems.map((item: any) => clean(item?.roleId)).filter(Boolean);
  const requestedRoleIds = Array.from(new Set([...roleIds, ...systemRoleIds]));
  const enabledSystemAccessCodes = systems
    .filter((item: any) => item?.isEnabled === true && clean(item?.systemCode))
    .map((item: any) => `system.${clean(item.systemCode)}.access`);

  const sql = getSql();
  const before = await loadUserAccess(userId);
  if (!before) return response.status(404).json({ ok: false, error: "المستخدم غير موجود" });
  const rolePermissionRows = requestedRoleIds.length > 0
    ? await sql<{ code: string }[]>`
        select distinct p.code
        from core.role_permissions rp
        join core.permissions p on p.id=rp.permission_id and p.is_active=true
        where rp.role_id=any(${requestedRoleIds}::uuid[])
      `
    : [];
  const currentGrantCodes = [
    ...(before.access.storedInheritedPermissions || before.access.inheritedPermissions || []),
    ...(before.access.allowedOverrides || []),
    ...before.systems.filter((item: any) => item.is_enabled).map((item: any) => `system.${item.system_code}.access`),
  ];
  await assertGrantablePermissions(actor, Array.from(new Set([
    ...currentGrantCodes,
    ...allowedCodes,
    ...enabledSystemAccessCodes,
    ...rolePermissionRows.map((row) => row.code),
  ])));

  await sql.begin(async (tx) => {
    if (roleIds.length > 0 || body.replaceRoles === true) {
      await tx`delete from core.user_roles where user_id=${userId}::uuid`;
      for (const roleId of roleIds) {
        await tx`insert into core.user_roles(user_id, role_id) values (${userId}::uuid, ${roleId}::uuid) on conflict do nothing`;
      }
    }

    for (const item of systems) {
      const systemCode = clean(item.systemCode);
      if (!systemCode || !["operations", "tracking", "marketing", "crm"].includes(systemCode)) continue;
      const isEnabled = item.isEnabled === true;
      const roleId = clean(item.roleId) || null;
      const dataScope = clean(item.dataScope) || "assigned";
      const branchIds = stringArray(item.branchIds);
      const departmentIds = stringArray(item.departmentIds);

      await tx`
        insert into core.user_systems(user_id, system_code, is_enabled, role_id, data_scope, updated_at)
        values (${userId}::uuid, ${systemCode}, ${isEnabled}, ${roleId}::uuid, ${dataScope}, now())
        on conflict (user_id, system_code) do update set
          is_enabled=excluded.is_enabled, role_id=excluded.role_id, data_scope=excluded.data_scope, updated_at=now()
      `;
      await tx`
        insert into core.user_scope_rules(user_id, system_code, scope_code, branch_ids, department_ids, created_by, updated_at)
        values (${userId}::uuid, ${systemCode}, ${dataScope}, ${branchIds}::uuid[], ${departmentIds}::uuid[], ${actor.id}::uuid, now())
        on conflict (user_id, system_code) do update set
          scope_code=excluded.scope_code, branch_ids=excluded.branch_ids, department_ids=excluded.department_ids,
          created_by=excluded.created_by, updated_at=now()
      `;
    }

    await tx`delete from core.user_permission_overrides where user_id=${userId}::uuid`;
    for (const item of overrides) {
      const code = clean(item.code);
      const effect = clean(item.effect);
      if (!code || !["allow", "deny"].includes(effect)) continue;
      await tx`
        insert into core.user_permission_overrides(user_id, permission_id, effect, reason, created_by, updated_at)
        select ${userId}::uuid, p.id, ${effect}, ${clean(item.reason) || null}, ${actor.id}::uuid, now()
        from core.permissions p where p.code=${code}
        on conflict (user_id, permission_id) do update set effect=excluded.effect, reason=excluded.reason, created_by=excluded.created_by, updated_at=now()
      `;
    }

    const allBranchIds = Array.from(new Set(systems.flatMap((item: any) => stringArray(item.branchIds))));
    const allDepartmentIds = Array.from(new Set(systems.flatMap((item: any) => stringArray(item.departmentIds))));
    if (body.replaceOrganization === true || allBranchIds.length > 0 || allDepartmentIds.length > 0) {
      await tx`delete from core.user_branches where user_id=${userId}::uuid`;
      await tx`delete from core.user_departments where user_id=${userId}::uuid`;
      for (const [index, branchId] of allBranchIds.entries()) {
        await tx`insert into core.user_branches(user_id, branch_id, is_primary) values (${userId}::uuid, ${branchId}::uuid, ${index === 0}) on conflict do nothing`;
      }
      for (const [index, departmentId] of allDepartmentIds.entries()) {
        await tx`insert into core.user_departments(user_id, department_id, is_primary) values (${userId}::uuid, ${departmentId}::uuid, ${index === 0}) on conflict do nothing`;
      }
    }

    await tx`update core.users set permission_version=permission_version+1, updated_at=now() where id=${userId}::uuid`;
    await writePermissionLog(tx, actor, request, {
      targetUserId: userId,
      changeType: "user_access_updated",
      oldValue: before,
      newValue: { systems, roleIds, overrides },
      reason: clean(body.reason) || null,
    });
  });

  return response.status(200).json({ ok: true, access: await loadUserAccess(userId) });
}

async function saveRole(request: VercelRequest, response: VercelResponse, actor: SessionUser, body: Record<string, any>) {
  const roleId = clean(body.roleId);
  const permissionCodes = stringArray(body.permissionCodes);
  if (!roleId) return response.status(400).json({ ok: false, error: "اختر الدور" });
  await assertGrantablePermissions(actor, permissionCodes);
  const sql = getSql();
  const oldRows = await sql<{ code: string }[]>`select p.code from core.role_permissions rp join core.permissions p on p.id=rp.permission_id where rp.role_id=${roleId}::uuid order by p.code`;
  await assertGrantablePermissions(actor, Array.from(new Set([...oldRows.map((row) => row.code), ...permissionCodes])));
  await sql.begin(async (tx) => {
    await tx`delete from core.role_permissions where role_id=${roleId}::uuid`;
    if (permissionCodes.length > 0) {
      await tx`
        insert into core.role_permissions(role_id, permission_id)
        select ${roleId}::uuid, id from core.permissions where code=any(${permissionCodes}::text[])
        on conflict do nothing
      `;
    }
    await tx`update core.users set permission_version=permission_version+1, updated_at=now() where id in (select user_id from core.user_roles where role_id=${roleId}::uuid union select user_id from core.user_systems where role_id=${roleId}::uuid)`;
    await writePermissionLog(tx, actor, request, {
      targetRoleId: roleId,
      changeType: "role_permissions_updated",
      oldValue: oldRows.map((row) => row.code),
      newValue: permissionCodes,
      reason: clean(body.reason) || null,
    });
  });
  return response.status(200).json({ ok: true });
}

async function saveOrganization(request: VercelRequest, response: VercelResponse, actor: SessionUser, body: Record<string, any>) {
  const entity = clean(body.entity);
  const id = clean(body.id) || null;
  const code = clean(body.code).toLowerCase().replace(/\s+/g, "_");
  const name = clean(body.name);
  const systemCode = clean(body.systemCode);
  const isActive = body.isActive !== false;
  if (!code || !name || !["branch", "department"].includes(entity)) return response.status(400).json({ ok: false, error: "أكمل بيانات الفرع أو القسم" });
  const sql = getSql();
  await sql.begin(async (tx) => {
    if (entity === "branch") {
      if (id) await tx`update core.branches set code=${code}, name=${name}, is_active=${isActive}, updated_at=now() where id=${id}::uuid`;
      else await tx`insert into core.branches(code,name,is_active,sort_order) values (${code},${name},${isActive},coalesce((select max(sort_order)+10 from core.branches),10))`;
    } else {
      if (!systemCode) throw new Error("SYSTEM_REQUIRED");
      if (id) await tx`update core.departments set code=${code}, name=${name}, system_code=${systemCode}, is_active=${isActive}, updated_at=now() where id=${id}::uuid`;
      else await tx`insert into core.departments(code,name,system_code,is_active) values (${code},${name},${systemCode},${isActive})`;
    }
    await writePermissionLog(tx, actor, request, {
      changeType: `${entity}_saved`,
      systemCode: entity === "department" ? systemCode : "core",
      newValue: { id, code, name, systemCode, isActive },
    });
  });
  return response.status(200).json({ ok: true });
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  await ensureAccessControlSchema();
  response.setHeader("Cache-Control", "no-store");

  try {
    if (request.method === "GET") {
      const view = clean(request.query.view) || "catalog";
      let actor: SessionUser | null = null;
      if (view === "permission-log") actor = await requirePermission(request, response, "settings.audit.view");
      else if (view === "security-log") actor = await requirePermission(request, response, "settings.security.view");
      else if (view === "user") actor = await requireAnyPermission(request, response, USER_ACCESS_VIEW_PERMISSIONS);
      else if (view === "roles") actor = await requireAnyPermission(request, response, ["settings.roles.manage", "settings.permissions.manage"]);
      else actor = await requireAnyPermission(request, response, SETTINGS_VIEW_PERMISSIONS);
      if (!actor) return;

      if (view === "catalog") return response.status(200).json({ ok: true, ...(await loadCatalog()) });
      if (view === "user") {
        const userId = clean(request.query.id);
        const access = await loadUserAccess(userId);
        return access ? response.status(200).json({ ok: true, ...access }) : response.status(404).json({ ok: false, error: "المستخدم غير موجود" });
      }
      if (view === "roles") {
        const sql = getSql();
        const roles = await sql`
          select r.id::text, r.code, r.name, r.is_system,
            coalesce(array_agg(p.code order by p.code) filter (where p.id is not null), '{}') as permission_codes
          from core.roles r
          left join core.role_permissions rp on rp.role_id=r.id
          left join core.permissions p on p.id=rp.permission_id
          group by r.id order by r.name
        `;
        return response.status(200).json({ ok: true, roles });
      }
      if (view === "permission-log") return response.status(200).json({ ok: true, entries: await permissionLog(Math.min(500, Number(request.query.limit) || 200)) });
      if (view === "security-log") return response.status(200).json({ ok: true, entries: await securityLog(Math.min(500, Number(request.query.limit) || 200)) });
      return response.status(400).json({ ok: false, error: "عرض غير معروف" });
    }

    if (request.method === "POST" || request.method === "PUT") {
      const body = parseBody(request);
      const action = clean(body.action);
      if (action === "save-user-access") {
        const actor = await requirePermission(request, response, "settings.permissions.manage");
        if (!actor) return;
        return saveUserAccess(request, response, actor, body);
      }
      if (action === "save-role") {
        const actor = await requirePermission(request, response, "settings.roles.manage");
        if (!actor) return;
        return saveRole(request, response, actor, body);
      }
      if (action === "save-organization") {
        const actor = await requirePermission(request, response, "settings.branches.manage");
        if (!actor) return;
        return saveOrganization(request, response, actor, body);
      }
      return response.status(400).json({ ok: false, error: "إجراء غير معروف" });
    }

    return response.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error: any) {
    console.error("Access control failed", error);
    if (error?.code === "PERMISSION_ESCALATION") return response.status(403).json({ ok: false, error: error.message, forbidden: error.forbidden });
    if (error?.code === "23505") return response.status(409).json({ ok: false, error: "الكود مستخدم بالفعل" });
    if (error?.message === "SYSTEM_REQUIRED") return response.status(400).json({ ok: false, error: "اختر النظام التابع له القسم" });
    return response.status(500).json({ ok: false, error: "تعذر تنفيذ عملية الصلاحيات" });
  }
}
