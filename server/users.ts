import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { requireAnyPermission, requirePermission, requestIp } from "./_auth.js";
import { ensureAccessControlSchema } from "./_access-control-schema.js";
import { getSql } from "./_db.js";
import { assertGrantablePermissions } from "./_permissions.js";

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function parseBody(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, any>;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body || "{}"); } catch { return {}; }
  }
  return {};
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  await ensureAccessControlSchema();
  const sql = getSql();

  try {
    if (request.method === "GET") {
      const currentUser = await requireAnyPermission(request, response, [
        "settings.users.view",
        "settings.users.create",
        "settings.users.update",
        "settings.users.disable",
        "settings.permissions.manage",
      ]);
      if (!currentUser) return;
      const users = await sql`
        select
          u.id::text,
          u.employee_no,
          u.full_name,
          u.email,
          u.mobile,
          u.is_active,
          u.can_receive_leads,
          u.can_receive_tasks,
          u.last_login_at,
          u.created_at,
          u.permission_version,
          coalesce(string_agg(distinct r.name, '، '), '') as roles,
          coalesce(string_agg(distinct d.name, '، '), '') as departments,
          coalesce(string_agg(distinct b.name, '، '), '') as branches,
          coalesce(string_agg(distinct case when us.is_enabled then s.name_ar end, '، '), '') as systems
        from core.users u
        left join core.user_roles ur on ur.user_id = u.id
        left join core.roles r on r.id = ur.role_id
        left join core.user_departments ud on ud.user_id = u.id
        left join core.departments d on d.id = ud.department_id
        left join core.user_branches ub on ub.user_id = u.id
        left join core.branches b on b.id = ub.branch_id
        left join core.user_systems us on us.user_id=u.id
        left join core.systems s on s.code=us.system_code
        group by u.id
        order by u.created_at desc
      `;
      return response.status(200).json({ ok: true, users });
    }

    if (request.method === "POST") {
      const currentUser = await requirePermission(request, response, "settings.users.create");
      if (!currentUser) return;
      const body = parseBody(request);
      const fullName = cleanText(body.fullName);
      const employeeNo = cleanText(body.employeeNo) || null;
      const email = cleanText(body.email).toLowerCase() || null;
      const mobile = cleanText(body.mobile) || null;
      const password = cleanText(body.password);
      const roleId = cleanText(body.roleId) || null;
      const departmentId = cleanText(body.departmentId) || null;
      const branchId = cleanText(body.branchId) || null;
      const canReceiveLeads = body.canReceiveLeads === true;
      const canReceiveTasks = body.canReceiveTasks === true;

      if (!fullName) return response.status(400).json({ ok: false, error: "اسم المستخدم مطلوب" });
      if (!email && !mobile) return response.status(400).json({ ok: false, error: "البريد أو رقم الجوال مطلوب" });
      if (password.length < 10) return response.status(400).json({ ok: false, error: "كلمة المرور المؤقتة يجب ألا تقل عن 10 أحرف" });
      if (!roleId) return response.status(400).json({ ok: false, error: "اختر دور المستخدم" });

      const [role] = await sql<{ code: string }[]>`select code from core.roles where id=${roleId}::uuid limit 1`;
      if (!role) return response.status(400).json({ ok: false, error: "الدور المحدد غير صحيح" });
      const [department] = departmentId ? await sql<{ system_code: string }[]>`select system_code from core.departments where id=${departmentId}::uuid limit 1` : [];
      const roleSystems: Record<string, string[]> = {
        admin: ["crm", "marketing", "operations", "tracking"],
        sales_manager: ["crm"], branch_manager: ["crm"], call_center_agent: ["crm"], customer_service_agent: ["crm"], sales_user: ["crm"],
        marketing_user: ["marketing"], marketing_executive: ["marketing"],
        operations_user: ["operations"], operations_admin: ["operations"], operations_manager: ["operations"], accounts_manager: ["operations"],
        tracking_user: ["tracking"],
      };
      const inferredSystems = Array.from(new Set([...(roleSystems[role.code] || []), department?.system_code].filter((value): value is string => Boolean(value) && ["crm", "marketing", "operations", "tracking"].includes(String(value)))));
      const rolePermissionRows = await sql<{ code: string }[]>`
        select p.code from core.role_permissions rp join core.permissions p on p.id=rp.permission_id and p.is_active=true
        where rp.role_id=${roleId}::uuid
      `;
      await assertGrantablePermissions(currentUser, Array.from(new Set([
        ...rolePermissionRows.map((row) => row.code),
        ...inferredSystems.map((systemCode) => `system.${systemCode}.access`),
      ])));

      const created = await sql.begin(async (tx) => {
        const [user] = await tx`
          insert into core.users (
            employee_no, full_name, email, mobile, password_hash,
            must_change_password, can_receive_leads, can_receive_tasks
          ) values (
            ${employeeNo}, ${fullName}, ${email}, ${mobile},
            crypt(${password}, gen_salt('bf')), true,
            ${canReceiveLeads}, ${canReceiveTasks}
          )
          returning id::text, employee_no, full_name, email, mobile, is_active,
                    can_receive_leads, can_receive_tasks, created_at
        `;

        await tx`insert into core.user_roles(user_id, role_id) values (${user.id}::uuid, ${roleId}::uuid)`;
        if (departmentId) await tx`insert into core.user_departments(user_id, department_id, is_primary) values (${user.id}::uuid, ${departmentId}::uuid, true)`;
        if (branchId) await tx`insert into core.user_branches(user_id, branch_id, is_primary) values (${user.id}::uuid, ${branchId}::uuid, true)`;

        for (const inferredSystem of inferredSystems) {
          await tx`
            insert into core.user_systems(user_id, system_code, is_enabled, role_id, data_scope)
            values (${user.id}::uuid, ${inferredSystem}, true, ${roleId}::uuid, ${["admin", "sales_manager", "operations_manager"].includes(role.code) ? "all" : "assigned"})
            on conflict (user_id, system_code) do update set is_enabled=true, role_id=excluded.role_id, data_scope=excluded.data_scope, updated_at=now()
          `;
        }

        const requestId = cleanText(request.headers["x-request-id"]) || randomUUID();
        const userAgent = cleanText(request.headers["user-agent"]).slice(0, 500) || null;
        const afterData = { fullName, employeeNo, email, mobile, roleId, departmentId, branchId, canReceiveLeads, canReceiveTasks, inferredSystems };
        await tx`
          insert into audit.activity_log(user_id, system_code, page_code, permission_code, action, entity_type, entity_id, after_data, ip_address, user_agent, request_id)
          values (
            ${currentUser.id}::uuid, 'core', 'users', 'settings.users.create', 'user_created', 'user', ${user.id},
            ${tx.json(afterData)}, ${requestIp(request)}, ${userAgent}, ${requestId}
          )
        `;
        await tx`
          insert into core.permission_change_log(target_user_id, changed_by, change_type, new_value, request_id, ip_address, user_agent)
          values (${user.id}::uuid, ${currentUser.id}::uuid, 'user_created', ${tx.json(afterData)}, ${requestId}, ${requestIp(request)}, ${userAgent})
        `;
        return user;
      });

      return response.status(201).json({ ok: true, user: created });
    }

    if (request.method === "PUT" || request.method === "PATCH") {
      const body = parseBody(request);
      const userId = cleanText(body.userId);
      if (!userId) return response.status(400).json({ ok: false, error: "معرف المستخدم مطلوب" });
      const action = cleanText(body.action) || "update";
      const permissionCode = action === "status" ? "settings.users.disable" : "settings.users.update";
      const currentUser = await requirePermission(request, response, permissionCode);
      if (!currentUser) return;
      if (userId === currentUser.id && action === "status" && body.isActive === false) {
        return response.status(400).json({ ok: false, error: "لا يمكنك تعطيل حسابك الحالي" });
      }

      const [before] = await sql<any[]>`select id::text, employee_no, full_name, email, mobile, is_active, can_receive_leads, can_receive_tasks from core.users where id=${userId}::uuid limit 1`;
      if (!before) return response.status(404).json({ ok: false, error: "المستخدم غير موجود" });

      const requestId = cleanText(request.headers["x-request-id"]) || randomUUID();
      const userAgent = cleanText(request.headers["user-agent"]).slice(0, 500) || null;
      let after: any;
      await sql.begin(async (tx) => {
        if (action === "status") {
          const isActive = body.isActive === true;
          [after] = await tx`update core.users set is_active=${isActive}, permission_version=permission_version+1, updated_at=now() where id=${userId}::uuid returning id::text, employee_no, full_name, email, mobile, is_active, can_receive_leads, can_receive_tasks`;
          if (!isActive) await tx`delete from core.sessions where user_id=${userId}::uuid`;
        } else {
          const fullName = cleanText(body.fullName) || before.full_name;
          const employeeNo = body.employeeNo === undefined ? before.employee_no : cleanText(body.employeeNo) || null;
          const email = body.email === undefined ? before.email : cleanText(body.email).toLowerCase() || null;
          const mobile = body.mobile === undefined ? before.mobile : cleanText(body.mobile) || null;
          const canReceiveLeads = body.canReceiveLeads === undefined ? before.can_receive_leads : body.canReceiveLeads === true;
          const canReceiveTasks = body.canReceiveTasks === undefined ? before.can_receive_tasks : body.canReceiveTasks === true;
          [after] = await tx`
            update core.users set employee_no=${employeeNo}, full_name=${fullName}, email=${email}, mobile=${mobile},
              can_receive_leads=${canReceiveLeads}, can_receive_tasks=${canReceiveTasks}, updated_at=now()
            where id=${userId}::uuid
            returning id::text, employee_no, full_name, email, mobile, is_active, can_receive_leads, can_receive_tasks
          `;
        }
        await tx`
          insert into audit.activity_log(user_id, system_code, page_code, permission_code, action, entity_type, entity_id, before_data, after_data, ip_address, user_agent, request_id)
          values (${currentUser.id}::uuid, 'core', 'users', ${permissionCode}, ${action === "status" ? "user_status_changed" : "user_updated"}, 'user', ${userId}, ${tx.json(before)}, ${tx.json(after)}, ${requestIp(request)}, ${userAgent}, ${requestId})
        `;
        await tx`
          insert into core.permission_change_log(target_user_id, changed_by, change_type, old_value, new_value, request_id, ip_address, user_agent)
          values (${userId}::uuid, ${currentUser.id}::uuid, ${action === "status" ? "user_status_changed" : "user_updated"}, ${tx.json(before)}, ${tx.json(after)}, ${requestId}, ${requestIp(request)}, ${userAgent})
        `;
      });
      return response.status(200).json({ ok: true, user: after });
    }

    return response.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error: any) {
    console.error(error);
    if (error?.code === "23505") return response.status(409).json({ ok: false, error: "رقم الموظف أو البريد أو الجوال مستخدم بالفعل" });
    if (error?.code === "23503") return response.status(400).json({ ok: false, error: "القسم أو الفرع أو الدور المحدد غير صحيح" });
    return response.status(500).json({ ok: false, error: "تعذر حفظ بيانات المستخدم" });
  }
}
