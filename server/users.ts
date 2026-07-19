import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin, requestIp } from "./_auth.js";
import { getSql } from "./_db.js";

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const currentUser = await requireAdmin(request, response);
  if (!currentUser) return;

  const sql = getSql();
  try {
    if (request.method === "GET") {
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
          coalesce(string_agg(distinct r.name, '، '), '') as roles,
          coalesce(string_agg(distinct d.name, '، '), '') as departments,
          coalesce(string_agg(distinct b.name, '، '), '') as branches
        from core.users u
        left join core.user_roles ur on ur.user_id = u.id
        left join core.roles r on r.id = ur.role_id
        left join core.user_departments ud on ud.user_id = u.id
        left join core.departments d on d.id = ud.department_id
        left join core.user_branches ub on ub.user_id = u.id
        left join core.branches b on b.id = ub.branch_id
        group by u.id
        order by u.created_at desc
      `;
      return response.status(200).json({ ok: true, users });
    }

    if (request.method === "POST") {
      const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body ?? {};
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

      const [targetRole] = await sql<{ code: string }[]>`select code from core.roles where id=${roleId}::uuid limit 1`;
      if (!targetRole) return response.status(400).json({ ok: false, error: "الدور المحدد غير صحيح" });
      if (targetRole.code === "system_admin" && !currentUser.roleCodes.includes("system_admin")) {
        return response.status(403).json({ ok: false, error: "منح دور مدير النظام متاح لمدير نظام حالي فقط" });
      }

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

        await tx`
          insert into audit.activity_log(user_id, system_code, action, entity_type, entity_id, after_data, ip_address)
          values (
            ${currentUser.id}::uuid,
            'core',
            'user_created',
            'user',
            ${user.id},
            ${tx.json({ fullName, employeeNo, email, mobile, roleId, departmentId, branchId, canReceiveLeads, canReceiveTasks })},
            ${requestIp(request)}
          )
        `;

        return user;
      });

      return response.status(201).json({ ok: true, user: created });
    }

    return response.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error: any) {
    console.error(error);
    if (error?.code === "23505") return response.status(409).json({ ok: false, error: "رقم الموظف أو البريد أو الجوال مستخدم بالفعل" });
    if (error?.code === "23503") return response.status(400).json({ ok: false, error: "القسم أو الفرع أو الدور المحدد غير صحيح" });
    return response.status(500).json({ ok: false, error: "تعذر حفظ بيانات المستخدم" });
  }
}
