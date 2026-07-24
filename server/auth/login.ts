import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSession, loadUserProfile, requestIp } from "../_auth.js";
import { logSecurityEvent } from "../_access-control.js";
import { getSql } from "../_db.js";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });

  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const identifier = clean(body.identifier);
  const password = clean(body.password);

  if (!identifier || !password) return response.status(400).json({ ok: false, error: "أدخل بيانات تسجيل الدخول" });

  try {
    const sql = getSql();
    const [user] = await sql<{
      id: string;
      employee_no: string | null;
      full_name: string;
      email: string | null;
      mobile: string | null;
      roles: string[] | null;
      role_codes: string[] | null;
      departments: string[] | null;
      department_codes: string[] | null;
      branches: string[] | null;
      branch_codes: string[] | null;
    }[]>`
      select
        u.id::text,
        u.employee_no,
        u.full_name,
        u.email,
        u.mobile,
        coalesce(array_agg(distinct r.name) filter (where r.id is not null), '{}') as roles,
        coalesce(array_agg(distinct r.code) filter (where r.id is not null), '{}') as role_codes,
        coalesce(array_agg(distinct d.name) filter (where d.id is not null), '{}') as departments,
        coalesce(array_agg(distinct d.code) filter (where d.id is not null), '{}') as department_codes,
        coalesce(array_agg(distinct b.name) filter (where b.id is not null), '{}') as branches,
        coalesce(array_agg(distinct b.code) filter (where b.id is not null), '{}') as branch_codes
      from core.users u
      left join core.user_roles ur on ur.user_id = u.id
      left join core.roles r on r.id = ur.role_id
      left join core.user_departments ud on ud.user_id = u.id
      left join core.departments d on d.id = ud.department_id
      left join core.user_branches ub on ub.user_id = u.id
      left join core.branches b on b.id = ub.branch_id
      where u.is_active = true
        and (
          lower(coalesce(u.email, '')) = lower(${identifier})
          or coalesce(u.mobile, '') = ${identifier}
          or coalesce(u.employee_no, '') = ${identifier}
        )
        and u.password_hash is not null
        and u.password_hash = crypt(${password}, u.password_hash)
      group by u.id
      limit 1
    `;

    if (!user) {
      await logSecurityEvent({ request, userEmail: identifier, systemCode: "core", pageCode: "login", action: "login_failed", result: "failure", reason: "INVALID_CREDENTIALS", ipAddress: requestIp(request) });
      return response.status(401).json({ ok: false, error: "بيانات تسجيل الدخول غير صحيحة" });
    }

    await sql`update core.users set last_login_at = now(), updated_at = now() where id = ${user.id}::uuid`;
    await createSession(request, response, user.id);
    const profile = await loadUserProfile(user.id);
    await logSecurityEvent({ request, user: profile, systemCode: "core", pageCode: "login", action: "login", result: "success", ipAddress: requestIp(request) });
    return response.status(200).json({ ok: true, user: profile });
  } catch (error) {
    console.error("Login failed", error);
    await logSecurityEvent({ request, userEmail: identifier, systemCode: "core", pageCode: "login", action: "login_failed", result: "failure", reason: "LOGIN_ERROR", ipAddress: requestIp(request) });
    return response.status(500).json({ ok: false, error: "تعذر تسجيل الدخول" });
  }
}
