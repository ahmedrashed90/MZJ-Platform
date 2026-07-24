import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, requestIp } from "./_auth.js";
import { getSql } from "./_db.js";
import {
  getEffectiveAccess,
  hasPermission,
  logSecurityEvent,
  requestId,
  requestUserAgent,
  requirePermissionForUser,
  type PermissionUser,
} from "./_access-control.js";
import { DATA_SCOPE_OPTIONS, SYSTEM_CATALOG, type DataScope, type PlatformSystem } from "../shared/access-control.js";

function clean(value: unknown) { return String(value ?? "").trim(); }
function bodyObject(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, any>;
  if (typeof request.body === "string") { try { return JSON.parse(request.body || "{}"); } catch { return {}; } }
  return {};
}
function bool(value: unknown, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === "true" || value === 1 || value === "1";
}
function array(value: unknown) { return Array.isArray(value) ? value.map(clean).filter(Boolean) : []; }
function validSystem(value: unknown): value is PlatformSystem { return ["crm", "marketing", "operations", "tracking"].includes(clean(value)); }
function validScope(value: unknown): value is DataScope { return DATA_SCOPE_OPTIONS.some((item) => item.code === clean(value)); }
function safeRoleCode(value: unknown) { return clean(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80); }


const SCOPE_GRANT_MATRIX: Record<DataScope, DataScope[]> = {
  all: DATA_SCOPE_OPTIONS.map((item) => item.code),
  branches: ["branches", "branch", "assigned", "self", "created_by_me", "workflow_assigned"],
  branch: ["branch", "assigned", "self", "created_by_me", "workflow_assigned"],
  departments: ["departments", "department", "assigned", "self", "created_by_me", "workflow_assigned"],
  department: ["department", "assigned", "self", "created_by_me", "workflow_assigned"],
  branch_and_department: ["branch_and_department", "branch", "department", "assigned", "self", "created_by_me", "workflow_assigned"],
  source_branch: ["source_branch", "assigned", "self", "created_by_me", "workflow_assigned"],
  destination_branch: ["destination_branch", "assigned", "self", "created_by_me", "workflow_assigned"],
  workflow_assigned: ["workflow_assigned", "assigned", "self"],
  created_by_me: ["created_by_me", "self"],
  assigned: ["assigned", "self"],
  self: ["self"],
};

async function actorCanGrantScope(actor: PermissionUser, systems: any[]) {
  if (hasPermission(actor, "platform.superadmin")) return true;
  const sql = getSql();
  const branchIds = [...new Set(systems.flatMap((item: any) => array(item?.branchIds)))];
  const departmentIds = [...new Set(systems.flatMap((item: any) => array(item?.departmentIds)))];
  const [branches, departments] = await Promise.all([
    branchIds.length ? sql<{ id: string; code: string }[]>`select id::text,code from core.branches where id in ${sql(branchIds)} and is_active=true` : Promise.resolve([]),
    departmentIds.length ? sql<{ id: string; code: string; system_code: string | null }[]>`select id::text,code,system_code from core.departments where id in ${sql(departmentIds)} and is_active=true` : Promise.resolve([]),
  ]);
  if (branches.length !== branchIds.length || departments.length !== departmentIds.length) return false;
  const branchCodeById = new Map(branches.map((row) => [row.id, row.code]));
  const departmentById = new Map(departments.map((row) => [row.id, row]));

  for (const config of systems) {
    const systemCode = clean(config?.systemCode);
    if (!validSystem(systemCode)) return false;
    const actorAccess = actor.systemAccess?.[systemCode];
    if (!actorAccess?.enabled) return false;
    const requestedScope = validScope(config?.dataScope) ? clean(config.dataScope) as DataScope : "assigned";
    if (!SCOPE_GRANT_MATRIX[actorAccess.dataScope]?.includes(requestedScope)) return false;
    const requestedBranchCodes = array(config?.branchIds).map((id) => branchCodeById.get(id)).filter(Boolean) as string[];
    const requestedDepartments = array(config?.departmentIds).map((id) => departmentById.get(id)).filter(Boolean) as { code: string; system_code: string | null }[];
    if (requestedDepartments.some((row) => row.system_code && row.system_code !== systemCode)) return false;
    if (actorAccess.dataScope !== "all") {
      if (requestedBranchCodes.some((code) => !actorAccess.branchCodes.includes(code))) return false;
      if (requestedDepartments.some((row) => !actorAccess.departmentCodes.includes(row.code))) return false;
    }
  }
  return true;
}

async function actorCanGrant(actor: PermissionUser, permissionCodes: string[], roleIds: string[], enabledSystems: string[]) {
  if (hasPermission(actor, "platform.superadmin")) return true;
  const sql = getSql();
  const requested = new Set(permissionCodes);
  if ([...requested].some((code) => !hasPermission(actor, code))) return false;
  if (enabledSystems.some((system) => !hasPermission(actor, `system.${system}.access`))) return false;
  if (roleIds.length) {
    const rows = await sql<{ code: string }[]>`
      select distinct p.code
      from core.role_permissions rp join core.permissions p on p.id=rp.permission_id
      where rp.role_id in ${sql(roleIds)} and p.is_active=true
    `;
    if (rows.some((row) => !hasPermission(actor, row.code))) return false;
  }
  return true;
}


const ACCESS_CONTROL_VIEW_PERMISSIONS = [
  "settings.users.view", "settings.users.create", "settings.users.update", "settings.users.disable", "settings.users.delete",
  "settings.roles.manage", "settings.permissions.manage", "settings.branches.manage", "settings.departments.manage",
  "settings.audit.view", "settings.security.view",
];
function canOpenAccessControl(user: PermissionUser) {
  return ACCESS_CONTROL_VIEW_PERMISSIONS.some((code) => hasPermission(user, code));
}
function canReadUsers(user: PermissionUser) {
  return ["settings.users.view","settings.users.update","settings.users.disable","settings.users.delete","settings.permissions.manage"].some((code) => hasPermission(user, code));
}
function accessPayloadSignature(roleIds: string[], systems: any[], overrides: any[]) {
  return JSON.stringify({
    roleIds: [...roleIds].sort(),
    systems: systems.map((item: any) => ({
      systemCode: clean(item.systemCode), isEnabled: bool(item.isEnabled), roleId: clean(item.roleId),
      dataScope: validScope(item.dataScope) ? clean(item.dataScope) : "assigned",
      branchIds: array(item.branchIds).sort(), departmentIds: array(item.departmentIds).sort(),
      primaryBranchId: clean(item.primaryBranchId), primaryDepartmentId: clean(item.primaryDepartmentId),
    })).sort((a: any, b: any) => a.systemCode.localeCompare(b.systemCode)),
    overrides: overrides.map((item: any) => ({ permissionCode: clean(item.permissionCode), effect: clean(item.effect) }))
      .sort((a: any, b: any) => a.permissionCode.localeCompare(b.permissionCode)),
  });
}

async function userSnapshot(userId: string) {
  const sql = getSql();
  const [row] = await sql<any[]>`
    select jsonb_build_object(
      'user',to_jsonb(u)-'password_hash',
      'roles',coalesce((select jsonb_agg(jsonb_build_object('id',r.id::text,'code',r.code,'name',r.name) order by r.name) from core.user_roles ur join core.roles r on r.id=ur.role_id where ur.user_id=u.id),'[]'::jsonb),
      'systems',coalesce((select jsonb_agg(jsonb_build_object(
        'systemCode',us.system_code,'isEnabled',us.is_enabled,'roleId',us.role_id::text,'dataScope',us.data_scope,
        'branchIds',coalesce((select jsonb_agg(usb.branch_id::text order by usb.is_primary desc) from core.user_system_branches usb where usb.user_id=u.id and usb.system_code=us.system_code),'[]'::jsonb),
        'departmentIds',coalesce((select jsonb_agg(usd.department_id::text order by usd.is_primary desc) from core.user_system_departments usd where usd.user_id=u.id and usd.system_code=us.system_code),'[]'::jsonb),
        'primaryBranchId',(select usb.branch_id::text from core.user_system_branches usb where usb.user_id=u.id and usb.system_code=us.system_code order by usb.is_primary desc limit 1),
        'primaryDepartmentId',(select usd.department_id::text from core.user_system_departments usd where usd.user_id=u.id and usd.system_code=us.system_code order by usd.is_primary desc limit 1)
      ) order by us.system_code) from core.user_systems us where us.user_id=u.id),'[]'::jsonb),
      'overrides',coalesce((select jsonb_agg(jsonb_build_object('permissionCode',p.code,'effect',o.effect,'reason',o.reason) order by p.code) from core.user_permission_overrides o join core.permissions p on p.id=o.permission_id where o.user_id=u.id),'[]'::jsonb)
    ) as snapshot
    from core.users u where u.id=${userId}::uuid
  `;
  return row?.snapshot || null;
}

async function listUsers() {
  const sql = getSql();
  return sql<any[]>`
    select u.id::text,u.employee_no,u.full_name,u.email,u.mobile,u.next_erp_user_id,u.is_active,u.can_receive_leads,u.can_receive_tasks,
      u.last_login_at,u.created_at,u.updated_at,u.permission_version,
      coalesce((select string_agg(distinct r.name,'، ' order by r.name) from core.user_roles ur join core.roles r on r.id=ur.role_id where ur.user_id=u.id),'') as roles,
      coalesce((select string_agg(b.name,'، ' order by b.sort_order,b.name) from core.user_branches ub join core.branches b on b.id=ub.branch_id where ub.user_id=u.id),'') as branches,
      coalesce((select string_agg(d.name,'، ' order by d.name) from core.user_departments ud join core.departments d on d.id=ud.department_id where ud.user_id=u.id),'') as departments,
      coalesce((select array_agg(ur.role_id::text order by ur.role_id::text) from core.user_roles ur where ur.user_id=u.id),'{}') as role_ids,
      coalesce((select array_agg(ub.branch_id::text order by ub.branch_id::text) from core.user_branches ub where ub.user_id=u.id),'{}') as branch_ids,
      coalesce((select array_agg(ud.department_id::text order by ud.department_id::text) from core.user_departments ud where ud.user_id=u.id),'{}') as department_ids,
      coalesce((select jsonb_object_agg(us.system_code,jsonb_build_object('enabled',us.is_enabled,'dataScope',us.data_scope,'roleId',us.role_id::text)) from core.user_systems us where us.user_id=u.id),'{}'::jsonb) as systems,
      (select l.created_at from core.permission_change_log l where l.target_user_id=u.id order by l.created_at desc limit 1) as last_access_change_at,
      (select cu.full_name from core.permission_change_log l left join core.users cu on cu.id=l.changed_by where l.target_user_id=u.id order by l.created_at desc limit 1) as last_access_changed_by
    from core.users u where u.deleted_at is null order by u.is_active desc,u.full_name,u.created_at
  `;
}

async function userDetail(userId: string) {
  const sql = getSql();
  const [userRows, roles, systems, overrides, access] = await Promise.all([
    sql<any[]>`select id::text,employee_no,full_name,email,mobile,next_erp_user_id,is_active,can_receive_leads,can_receive_tasks,last_login_at,created_at,updated_at,permission_version from core.users where id=${userId}::uuid and deleted_at is null`,
    sql<any[]>`select r.id::text,r.code,r.name from core.user_roles ur join core.roles r on r.id=ur.role_id where ur.user_id=${userId}::uuid order by r.name`,
    sql<any[]>`
      select us.system_code,us.is_enabled,us.role_id::text,us.data_scope,
        coalesce((select array_agg(usb.branch_id::text order by usb.is_primary desc,b.sort_order,b.name) from core.user_system_branches usb join core.branches b on b.id=usb.branch_id where usb.user_id=us.user_id and usb.system_code=us.system_code),'{}') as branch_ids,
        coalesce((select array_agg(usd.department_id::text order by usd.is_primary desc,d.name) from core.user_system_departments usd join core.departments d on d.id=usd.department_id where usd.user_id=us.user_id and usd.system_code=us.system_code),'{}') as department_ids,
        (select usb.branch_id::text from core.user_system_branches usb where usb.user_id=us.user_id and usb.system_code=us.system_code order by usb.is_primary desc limit 1) as primary_branch_id,
        (select usd.department_id::text from core.user_system_departments usd where usd.user_id=us.user_id and usd.system_code=us.system_code order by usd.is_primary desc limit 1) as primary_department_id
      from core.user_systems us where us.user_id=${userId}::uuid order by us.system_code
    `,
    sql<any[]>`select p.code as permission_code,o.effect,o.reason from core.user_permission_overrides o join core.permissions p on p.id=o.permission_id where o.user_id=${userId}::uuid order by p.code`,
    getEffectiveAccess(userId),
  ]);
  const user = userRows[0];
  if (!user) return null;
  return { user, roleIds: roles.map((row) => row.id), roles, systems, overrides, effective: access };
}

async function bootstrap() {
  const sql = getSql();
  const [systems, pages, permissions, roles, branches, departments] = await Promise.all([
    sql<any[]>`select code,name_ar,sort_order,is_active from core.systems where code in ('crm','marketing','operations','tracking') order by sort_order`,
    sql<any[]>`select id::text,system_code,code,name_ar,route,sort_order,is_active from core.system_pages where is_active=true order by system_code,sort_order`,
    sql<any[]>`select id::text,code,system_code,page_code,action_code,name_ar,description_ar,category,is_sensitive,sort_order from core.permissions where is_active=true order by system_code,sort_order,code`,
    sql<any[]>`
      select r.id::text,r.code,r.name,r.description_ar,r.is_system,r.is_active,
        coalesce((select array_agg(p.code order by p.system_code,p.sort_order,p.code) from core.role_permissions rp join core.permissions p on p.id=rp.permission_id and p.is_active=true where rp.role_id=r.id),'{}') as permission_codes,
        (select count(*)::int from core.user_roles ur where ur.role_id=r.id)+(select count(*)::int from core.user_systems us where us.role_id=r.id) as users_count
      from core.roles r where r.is_active=true order by r.name
    `,
    sql<any[]>`select id::text,code,name,is_active,sort_order from core.branches order by is_active desc,sort_order,name`,
    sql<any[]>`select id::text,code,name,system_code,is_active from core.departments order by is_active desc,system_code,name`,
  ]);
  return { systems, pages, permissions, roles, branches, departments, dataScopes: DATA_SCOPE_OPTIONS };
}

async function saveUser(request: VercelRequest, actor: PermissionUser, body: Record<string, any>) {
  const sql = getSql();
  const input = body.user && typeof body.user === "object" ? body.user : body;
  const userId = clean(input.id || body.userId);
  const creating = !userId;
  if (creating && !hasPermission(actor, "settings.users.create")) throw Object.assign(new Error("لا توجد صلاحية لإنشاء المستخدم"), { status: 403 });
  if (!creating && userId === actor.id) throw Object.assign(new Error("لا يمكن تعديل الحساب الحالي من نفس الجلسة"), { status: 403 });

  const fullName = clean(input.fullName);
  const employeeNo = clean(input.employeeNo) || null;
  const email = clean(input.email).toLowerCase() || null;
  const mobile = clean(input.mobile) || null;
  const nextErpUserId = clean(input.nextErpUserId).toLowerCase() || null;
  const password = clean(input.password);
  const isActive = bool(input.isActive, true);
  const canReceiveLeads = bool(input.canReceiveLeads);
  const canReceiveTasks = bool(input.canReceiveTasks);
  const roleIds = array(body.roleIds);
  const systems = Array.isArray(body.systems) ? body.systems.filter((item: any) => validSystem(item?.systemCode)) : [];
  const overrides = Array.isArray(body.overrides) ? body.overrides.filter((item: any) => clean(item?.permissionCode) && ["allow", "deny"].includes(clean(item?.effect))) : [];
  const reason = clean(body.reason) || null;
  if (!fullName) throw Object.assign(new Error("اسم المستخدم مطلوب"), { status: 400 });
  if (!email && !mobile) throw Object.assign(new Error("البريد أو رقم الجوال مطلوب"), { status: 400 });
  if (creating && password.length < 10) throw Object.assign(new Error("كلمة المرور المؤقتة يجب ألا تقل عن 10 أحرف"), { status: 400 });
  if (password && password.length < 10) throw Object.assign(new Error("كلمة المرور الجديدة يجب ألا تقل عن 10 أحرف"), { status: 400 });

  const before = creating ? null : await userSnapshot(userId);
  if (!creating && (!before || before?.user?.deleted_at)) throw Object.assign(new Error("المستخدم غير موجود"), { status: 404 });
  const beforeUser = before?.user || {};
  const profileChanged = creating
    || clean(beforeUser.full_name) !== fullName
    || clean(beforeUser.employee_no) !== clean(employeeNo)
    || clean(beforeUser.email).toLowerCase() !== clean(email).toLowerCase()
    || clean(beforeUser.mobile) !== clean(mobile)
    || clean(beforeUser.next_erp_user_id).toLowerCase() !== clean(nextErpUserId).toLowerCase()
    || Boolean(beforeUser.can_receive_leads) !== canReceiveLeads
    || Boolean(beforeUser.can_receive_tasks) !== canReceiveTasks
    || Boolean(password);
  const activeChanged = !creating && Boolean(beforeUser.is_active) !== isActive;
  if (!creating && profileChanged && !hasPermission(actor, "settings.users.update")) {
    throw Object.assign(new Error("لا توجد صلاحية لتعديل بيانات المستخدم"), { status: 403 });
  }
  if (activeChanged && !hasPermission(actor, "settings.users.disable")) {
    throw Object.assign(new Error("لا توجد صلاحية لتعطيل أو تفعيل المستخدم"), { status: 403 });
  }

  const creatingWithAccess = creating && (
    roleIds.length > 0
    || overrides.length > 0
    || systems.some((item: any) => bool(item.isEnabled) || clean(item.roleId) || array(item.branchIds).length || array(item.departmentIds).length)
  );
  const requestedAccessChanged = creating
    ? creatingWithAccess
    : accessPayloadSignature(roleIds, systems, overrides) !== accessPayloadSignature(
        (before?.roles || []).map((item: any) => clean(item.id)),
        (before?.systems || []).map((item: any) => ({ systemCode:item.systemCode,isEnabled:item.isEnabled,roleId:item.roleId,dataScope:item.dataScope,branchIds:item.branchIds,departmentIds:item.departmentIds,primaryBranchId:item.primaryBranchId,primaryDepartmentId:item.primaryDepartmentId })),
        (before?.overrides || []).map((item: any) => ({ permissionCode:item.permissionCode,effect:item.effect })),
      );
  if (requestedAccessChanged && !hasPermission(actor, "settings.permissions.manage")) {
    throw Object.assign(new Error("لا توجد صلاحية لتعديل أدوار المستخدم أو نطاقه أو صلاحياته"), { status: 403 });
  }

  const enabledSystems = systems.filter((item: any) => bool(item.isEnabled)).map((item: any) => clean(item.systemCode));
  const allowCodes = overrides.filter((item: any) => clean(item.effect) === "allow").map((item: any) => clean(item.permissionCode));
  const systemRoleIds = systems.map((item: any) => clean(item.roleId)).filter(Boolean);
  if (requestedAccessChanged && !await actorCanGrant(actor, allowCodes, [...new Set([...roleIds, ...systemRoleIds])], enabledSystems)) {
    throw Object.assign(new Error("لا يمكنك منح صلاحية أو دور أعلى من صلاحياتك الفعلية"), { status: 403 });
  }
  const previousSystems = new Map((before?.systems || []).map((item: any) => [clean(item.systemCode), item]));
  const scopeSystemsToValidate = systems.filter((item: any) => {
    const systemCode = clean(item.systemCode);
    const previous = previousSystems.get(systemCode) as any;
    if (bool(item.isEnabled)) return true;
    if (!previous) return false;
    return clean(item.roleId) !== clean(previous.roleId)
      || clean(item.dataScope) !== clean(previous.dataScope)
      || JSON.stringify(array(item.branchIds).sort()) !== JSON.stringify(array(previous.branchIds).sort())
      || JSON.stringify(array(item.departmentIds).sort()) !== JSON.stringify(array(previous.departmentIds).sort())
      || clean(item.primaryBranchId) !== clean(previous.primaryBranchId)
      || clean(item.primaryDepartmentId) !== clean(previous.primaryDepartmentId);
  });
  if (requestedAccessChanged && scopeSystemsToValidate.length && !await actorCanGrantScope(actor, scopeSystemsToValidate)) {
    throw Object.assign(new Error("لا يمكنك منح نطاق بيانات أو فروع أو أقسام خارج نطاقك الفعلي"), { status: 403 });
  }
  const requiredPermission = creating
    ? "settings.users.create"
    : activeChanged
      ? "settings.users.disable"
      : requestedAccessChanged
        ? "settings.permissions.manage"
        : "settings.users.update";

  const targetId = await sql.begin(async (tx) => {
    let id = userId;
    if (creating) {
      const [created] = await tx<any[]>`
        insert into core.users(employee_no,full_name,email,mobile,next_erp_user_id,password_hash,must_change_password,is_active,can_receive_leads,can_receive_tasks)
        values(${employeeNo},${fullName},${email},${mobile},${nextErpUserId},crypt(${password},gen_salt('bf')),true,${isActive},${canReceiveLeads},${canReceiveTasks})
        returning id::text
      `;
      id = created.id;
    } else if (password) {
      await tx`
        update core.users set employee_no=${employeeNo},full_name=${fullName},email=${email},mobile=${mobile},next_erp_user_id=${nextErpUserId},
          password_hash=crypt(${password},gen_salt('bf')),must_change_password=true,password_changed_at=null,is_active=${isActive},
          disabled_at=case when ${isActive} then null else now() end,disabled_by=case when ${isActive} then null else ${actor.id}::uuid end,disabled_reason=case when ${isActive} then null else ${reason} end,
          can_receive_leads=${canReceiveLeads},can_receive_tasks=${canReceiveTasks},updated_at=now()
        where id=${id}::uuid
      `;
    } else {
      await tx`
        update core.users set employee_no=${employeeNo},full_name=${fullName},email=${email},mobile=${mobile},next_erp_user_id=${nextErpUserId},is_active=${isActive},
          disabled_at=case when ${isActive} then null else coalesce(disabled_at,now()) end,disabled_by=case when ${isActive} then null else ${actor.id}::uuid end,disabled_reason=case when ${isActive} then null else ${reason} end,
          can_receive_leads=${canReceiveLeads},can_receive_tasks=${canReceiveTasks},updated_at=now()
        where id=${id}::uuid
      `;
    }

    await tx`delete from core.user_roles where user_id=${id}::uuid`;
    await tx`insert into core.user_roles(user_id,role_id) select ${id}::uuid,x::uuid from unnest(${roleIds}::text[]) x`;

    for (const system of SYSTEM_CATALOG) {
      const config = systems.find((item: any) => clean(item.systemCode) === system.code);
      if (!config) continue;
      const dataScope = validScope(config.dataScope) ? clean(config.dataScope) : "assigned";
      const roleId = clean(config.roleId) || null;
      await tx`
        insert into core.user_systems(user_id,system_code,is_enabled,role_id,data_scope,updated_at)
        values(${id}::uuid,${system.code},${bool(config.isEnabled)},${roleId}::uuid,${dataScope},now())
        on conflict(user_id,system_code) do update set is_enabled=excluded.is_enabled,role_id=excluded.role_id,data_scope=excluded.data_scope,updated_at=now()
      `;
      const branchIds = array(config.branchIds);
      const departmentIds = array(config.departmentIds);
      const requestedPrimaryBranchId = clean(config.primaryBranchId);
      const requestedPrimaryDepartmentId = clean(config.primaryDepartmentId);
      const primaryBranchId = branchIds.includes(requestedPrimaryBranchId) ? requestedPrimaryBranchId : branchIds[0] || null;
      const primaryDepartmentId = departmentIds.includes(requestedPrimaryDepartmentId) ? requestedPrimaryDepartmentId : departmentIds[0] || null;
      await tx`delete from core.user_system_branches where user_id=${id}::uuid and system_code=${system.code}`;
      if (branchIds.length) await tx`
        insert into core.user_system_branches(user_id,system_code,branch_id,is_primary)
        select ${id}::uuid,${system.code},x::uuid,x=${primaryBranchId} from unnest(${branchIds}::text[]) x
      `;
      await tx`delete from core.user_system_departments where user_id=${id}::uuid and system_code=${system.code}`;
      if (departmentIds.length) await tx`
        insert into core.user_system_departments(user_id,system_code,department_id,is_primary)
        select ${id}::uuid,${system.code},x::uuid,x=${primaryDepartmentId} from unnest(${departmentIds}::text[]) x
      `;
    }

    await tx`delete from core.user_branches where user_id=${id}::uuid`;
    await tx`
      insert into core.user_branches(user_id,branch_id,is_primary)
      select ${id}::uuid,branch_id,bool_or(is_primary) from core.user_system_branches where user_id=${id}::uuid group by branch_id
      on conflict do nothing
    `;
    await tx`delete from core.user_departments where user_id=${id}::uuid`;
    await tx`
      insert into core.user_departments(user_id,department_id,is_primary)
      select ${id}::uuid,department_id,bool_or(is_primary) from core.user_system_departments where user_id=${id}::uuid group by department_id
      on conflict do nothing
    `;

    await tx`delete from core.user_permission_overrides where user_id=${id}::uuid`;
    for (const override of overrides) {
      await tx`
        insert into core.user_permission_overrides(user_id,permission_id,effect,reason,created_by,updated_at)
        select ${id}::uuid,p.id,${clean(override.effect)},${clean(override.reason)||reason},${actor.id}::uuid,now()
        from core.permissions p where p.code=${clean(override.permissionCode)} and p.is_active=true
      `;
    }

    await tx`update core.users set permission_version=permission_version+1,updated_at=now() where id=${id}::uuid`;
    await tx`delete from core.sessions where user_id=${id}::uuid`;
    return id;
  });

  const after = await userSnapshot(targetId);
  await sql`
    insert into core.permission_change_log(target_user_id,changed_by,change_type,before_data,after_data,reason,request_id,ip_address,user_agent)
    values(${targetId}::uuid,${actor.id}::uuid,${creating?'user_created':'user_access_updated'},${before ? sql.json(before) : null},${sql.json(after)},${reason},${requestId(request)},${requestIp(request)},${requestUserAgent(request)})
  `;
  await logSecurityEvent({ request,user:actor,systemCode:"core",pageCode:"settings",permissionCode:requiredPermission,action:creating?"user_created":"user_updated",entityType:"user",entityId:targetId,result:"success",beforeData:before,afterData:after,ipAddress:requestIp(request) });
  return { ok: true, userId: targetId, message: creating ? "تم إنشاء المستخدم وصلاحياته" : "تم تحديث المستخدم وصلاحياته" };
}


async function deleteUser(request: VercelRequest, actor: PermissionUser, body: Record<string, any>) {
  if (!hasPermission(actor, "settings.users.delete")) throw Object.assign(new Error("لا توجد صلاحية لحذف المستخدمين"), { status: 403 });
  const sql = getSql();
  const userId = clean(body.userId || body.id);
  const reason = clean(body.reason);
  if (!userId) throw Object.assign(new Error("المستخدم المطلوب حذفه غير محدد"), { status: 400 });
  if (!reason) throw Object.assign(new Error("سبب حذف الحساب مطلوب"), { status: 400 });
  if (userId === actor.id) throw Object.assign(new Error("لا يمكن حذف الحساب الحالي من نفس الجلسة"), { status: 403 });

  const before = await userSnapshot(userId);
  if (!before || before?.user?.deleted_at) throw Object.assign(new Error("المستخدم غير موجود"), { status: 404 });

  const targetAccess = await getEffectiveAccess(userId);
  if (targetAccess.permissions.includes("platform.superadmin")) {
    const candidates = await sql<{ id: string }[]>`
      select id::text from core.users
      where id<>${userId}::uuid and is_active=true and deleted_at is null
    `;
    let anotherSuperadminExists = false;
    for (const candidate of candidates) {
      const access = await getEffectiveAccess(candidate.id);
      if (access.permissions.includes("platform.superadmin")) {
        anotherSuperadminExists = true;
        break;
      }
    }
    if (!anotherSuperadminExists) {
      throw Object.assign(new Error("لا يمكن حذف آخر حساب مدير نظام فعال"), { status: 409 });
    }
  }

  await sql.begin(async (tx) => {
    await tx`delete from core.sessions where user_id=${userId}::uuid`;
    await tx`delete from core.user_permission_overrides where user_id=${userId}::uuid`;
    await tx`delete from core.user_system_branches where user_id=${userId}::uuid`;
    await tx`delete from core.user_system_departments where user_id=${userId}::uuid`;
    await tx`delete from core.user_systems where user_id=${userId}::uuid`;
    await tx`delete from core.user_roles where user_id=${userId}::uuid`;
    await tx`delete from core.user_branches where user_id=${userId}::uuid`;
    await tx`delete from core.user_departments where user_id=${userId}::uuid`;
    await tx`
      update core.users set
        employee_no=null,email=null,mobile=null,next_erp_user_id=null,password_hash=null,must_change_password=true,
        is_active=false,can_receive_leads=false,can_receive_tasks=false,
        disabled_at=coalesce(disabled_at,now()),disabled_by=${actor.id}::uuid,disabled_reason=${reason},
        deleted_at=now(),deleted_by=${actor.id}::uuid,deleted_reason=${reason},
        permission_version=permission_version+1,updated_at=now()
      where id=${userId}::uuid and deleted_at is null
    `;
  });

  const after = await userSnapshot(userId);
  await sql`
    insert into core.permission_change_log(target_user_id,changed_by,change_type,before_data,after_data,reason,request_id,ip_address,user_agent)
    values(${userId}::uuid,${actor.id}::uuid,'user_deleted',${sql.json(before)},${after ? sql.json(after) : null},${reason},${requestId(request)},${requestIp(request)},${requestUserAgent(request)})
  `;
  await logSecurityEvent({ request,user:actor,systemCode:"core",pageCode:"settings",permissionCode:"settings.users.delete",action:"user_deleted",entityType:"user",entityId:userId,result:"success",beforeData:before,afterData:after,reason,ipAddress:requestIp(request) });
  return { ok: true, message: "تم حذف الحساب وإزالة بيانات دخوله مع الاحتفاظ بالسجلات السابقة" };
}

async function saveRole(request: VercelRequest, actor: PermissionUser, body: Record<string, any>) {
  if (!hasPermission(actor, "settings.roles.manage")) throw Object.assign(new Error("لا توجد صلاحية لإدارة الأدوار"), { status: 403 });
  const sql = getSql();
  const id = clean(body.id);
  const code = safeRoleCode(body.code);
  const name = clean(body.name);
  const description = clean(body.description) || null;
  const permissionCodes = [...new Set(array(body.permissionCodes))].sort();
  if (!code || !name) throw Object.assign(new Error("كود الدور واسمه مطلوبان"), { status: 400 });
  if (["admin", "system_admin"].includes(code) && !hasPermission(actor, "platform.superadmin")) throw Object.assign(new Error("لا يمكن تعديل قالب مدير النظام"), { status: 403 });

  const before = id
    ? (await sql<any[]>`select jsonb_build_object('role',to_jsonb(r),'permissions',coalesce((select jsonb_agg(p.code order by p.code) from core.role_permissions rp join core.permissions p on p.id=rp.permission_id where rp.role_id=r.id),'[]'::jsonb)) as snapshot from core.roles r where r.id=${id}::uuid`)[0]?.snapshot
    : null;
  if (id && !before) throw Object.assign(new Error("الدور غير موجود"), { status: 404 });
  if (id && Boolean(before?.role?.is_system) && !hasPermission(actor, "platform.superadmin")) {
    throw Object.assign(new Error("لا يمكن تعديل قالب دور نظامي"), { status: 403 });
  }
  const previousPermissionCodes = array(before?.permissions).sort();
  const permissionsChanged = !id ? permissionCodes.length > 0 : JSON.stringify(previousPermissionCodes) !== JSON.stringify(permissionCodes);
  if (permissionsChanged && !hasPermission(actor, "settings.permissions.manage")) {
    throw Object.assign(new Error("تعديل صلاحيات قالب الدور يحتاج صلاحية إدارة الصلاحيات"), { status: 403 });
  }
  if (permissionsChanged && !await actorCanGrant(actor, permissionCodes, [], [])) {
    throw Object.assign(new Error("لا يمكنك منح الدور صلاحيات أعلى من صلاحياتك"), { status: 403 });
  }
  if (id && !hasPermission(actor, "platform.superadmin")) {
    const [selfUsesRole] = await sql<{ exists: boolean }[]>`
      select exists(
        select 1 from core.user_roles where user_id=${actor.id}::uuid and role_id=${id}::uuid
        union all
        select 1 from core.user_systems where user_id=${actor.id}::uuid and role_id=${id}::uuid
      ) as exists
    `;
    if (selfUsesRole?.exists) throw Object.assign(new Error("لا يمكن تعديل دورك الحالي من نفس الجلسة"), { status: 403 });
  }

  const roleId = await sql.begin(async (tx) => {
    const [role] = id
      ? await tx<any[]>`update core.roles set code=${code},name=${name},description_ar=${description},updated_at=now() where id=${id}::uuid returning id::text`
      : await tx<any[]>`insert into core.roles(code,name,description_ar,is_system,is_active) values(${code},${name},${description},false,true) returning id::text`;
    if (!role) throw Object.assign(new Error("الدور غير موجود"), { status: 404 });
    if (permissionsChanged) {
      await tx`delete from core.role_permissions where role_id=${role.id}::uuid`;
      if (permissionCodes.length) await tx`
        insert into core.role_permissions(role_id,permission_id)
        select ${role.id}::uuid,p.id from core.permissions p where p.code in ${tx(permissionCodes)} and p.is_active=true
      `;
    }
    await tx`
      update core.users set permission_version=permission_version+1,updated_at=now()
      where id in (select user_id from core.user_roles where role_id=${role.id}::uuid union select user_id from core.user_systems where role_id=${role.id}::uuid)
    `;
    await tx`
      delete from core.sessions where user_id in (select user_id from core.user_roles where role_id=${role.id}::uuid union select user_id from core.user_systems where role_id=${role.id}::uuid)
    `;
    return role.id;
  });
  const [after] = await sql<any[]>`select jsonb_build_object('role',to_jsonb(r),'permissions',coalesce((select jsonb_agg(p.code order by p.code) from core.role_permissions rp join core.permissions p on p.id=rp.permission_id where rp.role_id=r.id),'[]'::jsonb)) as snapshot from core.roles r where r.id=${roleId}::uuid`;
  const changeType = id ? "role_updated" : "role_created";
  await sql`insert into core.permission_change_log(target_role_id,changed_by,change_type,before_data,after_data,request_id,ip_address,user_agent) values(${roleId}::uuid,${actor.id}::uuid,${changeType},${before ? sql.json(before) : null},${sql.json(after?.snapshot)},${requestId(request)},${requestIp(request)},${requestUserAgent(request)})`;
  await logSecurityEvent({ request, user: actor, systemCode: "core", pageCode: "settings", permissionCode: permissionsChanged ? "settings.permissions.manage" : "settings.roles.manage", action: changeType, entityType: "role", entityId: roleId, result: "success", beforeData: before, afterData: after?.snapshot, ipAddress: requestIp(request) });
  return { ok: true, roleId, message: "تم حفظ الدور وقالب الصلاحيات" };
}

async function saveOrgItem(request: VercelRequest, actor: PermissionUser, body: Record<string, any>) {
  const sql=getSql(); const kind=clean(body.kind); const id=clean(body.id); const reason=clean(body.reason)||null;
  if(kind==='branch'){
    if(!hasPermission(actor,'settings.branches.manage'))throw Object.assign(new Error('لا توجد صلاحية لإدارة الفروع'),{status:403});
    const code=safeRoleCode(body.code),name=clean(body.name); if(!code||!name)throw Object.assign(new Error('كود الفرع واسمه مطلوبان'),{status:400});
    const [before]=id?await sql<any[]>`select to_jsonb(b) as snapshot from core.branches b where id=${id}::uuid`:[];
    const [row]=id?await sql<any[]>`update core.branches set code=${code},name=${name},sort_order=${Number(body.sortOrder)||0},is_active=${bool(body.isActive,true)},updated_at=now() where id=${id}::uuid returning id::text,code,name,is_active,sort_order`:await sql<any[]>`insert into core.branches(code,name,sort_order,is_active) values(${code},${name},${Number(body.sortOrder)||0},${bool(body.isActive,true)}) returning id::text,code,name,is_active,sort_order`;
    if(!row)throw Object.assign(new Error('الفرع غير موجود'),{status:404});
    if(id){await sql`update core.users set permission_version=permission_version+1,updated_at=now() where id in(select user_id from core.user_branches where branch_id=${row.id}::uuid union select user_id from core.user_system_branches where branch_id=${row.id}::uuid)`;await sql`delete from core.sessions where user_id in(select user_id from core.user_branches where branch_id=${row.id}::uuid union select user_id from core.user_system_branches where branch_id=${row.id}::uuid)`;}
    await sql`insert into core.permission_change_log(changed_by,change_type,before_data,after_data,reason,request_id,ip_address,user_agent) values(${actor.id}::uuid,${id?'branch_updated':'branch_created'},${before?.snapshot?sql.json(before.snapshot):null},${sql.json(row)},${reason},${requestId(request)},${requestIp(request)},${requestUserAgent(request)})`;
    await logSecurityEvent({request,user:actor,systemCode:'core',pageCode:'settings',permissionCode:'settings.branches.manage',action:id?'branch_updated':'branch_created',entityType:'branch',entityId:row.id,result:'success',afterData:row});
    return{ok:true,row,message:'تم حفظ الفرع'};
  }
  if(kind==='department'){
    if(!hasPermission(actor,'settings.departments.manage'))throw Object.assign(new Error('لا توجد صلاحية لإدارة الأقسام'),{status:403});
    const code=safeRoleCode(body.code),name=clean(body.name),systemCode=clean(body.systemCode); if(!code||!name||!validSystem(systemCode))throw Object.assign(new Error('بيانات القسم غير مكتملة'),{status:400});
    const [before]=id?await sql<any[]>`select to_jsonb(d) as snapshot from core.departments d where id=${id}::uuid`:[];
    const [row]=id?await sql<any[]>`update core.departments set code=${code},name=${name},system_code=${systemCode},is_active=${bool(body.isActive,true)},updated_at=now() where id=${id}::uuid returning id::text,code,name,system_code,is_active`:await sql<any[]>`insert into core.departments(code,name,system_code,is_active) values(${code},${name},${systemCode},${bool(body.isActive,true)}) returning id::text,code,name,system_code,is_active`;
    if(!row)throw Object.assign(new Error('القسم غير موجود'),{status:404});
    if(id){await sql`update core.users set permission_version=permission_version+1,updated_at=now() where id in(select user_id from core.user_departments where department_id=${row.id}::uuid union select user_id from core.user_system_departments where department_id=${row.id}::uuid)`;await sql`delete from core.sessions where user_id in(select user_id from core.user_departments where department_id=${row.id}::uuid union select user_id from core.user_system_departments where department_id=${row.id}::uuid)`;}
    await sql`insert into core.permission_change_log(changed_by,change_type,system_code,before_data,after_data,reason,request_id,ip_address,user_agent) values(${actor.id}::uuid,${id?'department_updated':'department_created'},${systemCode},${before?.snapshot?sql.json(before.snapshot):null},${sql.json(row)},${reason},${requestId(request)},${requestIp(request)},${requestUserAgent(request)})`;
    await logSecurityEvent({request,user:actor,systemCode:'core',pageCode:'settings',permissionCode:'settings.departments.manage',action:id?'department_updated':'department_created',entityType:'department',entityId:row.id,result:'success',afterData:row});
    return{ok:true,row,message:'تم حفظ القسم'};
  }
  throw Object.assign(new Error('نوع السجل غير صحيح'),{status:400});
}

export default async function handler(request: VercelRequest,response: VercelResponse){
  response.setHeader('Cache-Control','no-store');
  const actor=await requireUser(request,response); if(!actor)return;
  const resource=clean(request.query.resource)||'bootstrap';
  try{
    if(request.method==='GET'){
      if(resource==='bootstrap'){
        if(!canOpenAccessControl(actor))return response.status(403).json({ok:false,error:'لا توجد صلاحية لفتح المستخدمين والصلاحيات'});
        return response.status(200).json({ok:true,...await bootstrap()});
      }
      if(resource==='users'){
        if(!canReadUsers(actor))return response.status(403).json({ok:false,error:'لا توجد صلاحية لعرض المستخدمين'});
        return response.status(200).json({ok:true,users:await listUsers()});
      }
      if(resource==='user'){
        if(!canReadUsers(actor))return response.status(403).json({ok:false,error:'لا توجد صلاحية لعرض المستخدم'});
        const detail=await userDetail(clean(request.query.id)); if(!detail)return response.status(404).json({ok:false,error:'المستخدم غير موجود'});
        return response.status(200).json({ok:true,...detail});
      }
      if(resource==='permission_log'){
        if(!await requirePermissionForUser(request,response,actor,'settings.audit.view',{systemCode:'core',pageCode:'settings'}))return;
        const sql=getSql(); const rows=await sql<any[]>`select l.id,l.change_type,l.permission_code,l.system_code,l.before_data,l.after_data,l.reason,l.request_id,l.ip_address,l.user_agent,l.created_at,tu.full_name as target_user_name,tr.name as target_role_name,cu.full_name as changed_by_name from core.permission_change_log l left join core.users tu on tu.id=l.target_user_id left join core.roles tr on tr.id=l.target_role_id left join core.users cu on cu.id=l.changed_by order by l.created_at desc limit 500`;
        return response.status(200).json({ok:true,rows});
      }
      if(resource==='security_log'){
        if(!await requirePermissionForUser(request,response,actor,'settings.security.view',{systemCode:'core',pageCode:'settings'}))return;
        const sql=getSql(); const rows=await sql<any[]>`select id,user_id::text,user_email,user_role,system_code,page_code,permission_code,action,entity_type,entity_id,ip_address,user_agent,result,rejection_reason,request_id,created_at from audit.activity_log where result is not null or action in ('login','login_failed','user_created','user_updated','user_deleted') order by created_at desc limit 500`;
        return response.status(200).json({ok:true,rows});
      }
      return response.status(404).json({ok:false,error:'المورد غير موجود'});
    }
    if(request.method!=='POST')return response.status(405).json({ok:false,error:'Method not allowed'});
    const body=bodyObject(request),action=clean(body.action); let result;
    if(action==='save_user')result=await saveUser(request,actor,body);
    else if(action==='delete_user')result=await deleteUser(request,actor,body);
    else if(action==='save_role')result=await saveRole(request,actor,body);
    else if(action==='save_org_item')result=await saveOrgItem(request,actor,body);
    else throw Object.assign(new Error('الإجراء غير مدعوم'),{status:400});
    return response.status(200).json(result);
  }catch(error:any){
    console.error('Access control API failed',error);
    const status=Number(error?.status)|| (error?.code==='23505'?409:error?.code==='23503'?400:500);
    const message=error?.code==='23505'?'الكود أو البريد أو الجوال مستخدم بالفعل':clean(error?.message)||'تعذر تنفيذ عملية الصلاحيات';
    const attemptedAction=request.method==='POST'?clean(bodyObject(request).action):(clean(request.query.resource)||'read');
    await logSecurityEvent({request,user:actor,systemCode:'core',pageCode:'settings',permissionCode:null,action:`access_control_${attemptedAction||'unknown'}`,entityType:'access_control',result:status<500?'denied':'failure',reason:message,ipAddress:requestIp(request)}).catch(()=>undefined);
    return response.status(status).json({ok:false,error:message});
  }
}
