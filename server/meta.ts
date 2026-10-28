import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser } from "./_auth.js";
import { getSql } from "./_db.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const user = await requireUser(request, response);
  if (!user) return;

  const sql = getSql();
  try {
    const [departments, branches, roles] = await Promise.all([
      sql`select id::text, code, name, system_code from core.departments where is_active = true order by system_code, name`,
      sql`select id::text, code, name from core.branches where is_active = true order by sort_order, name`,
      sql`
        select id::text, code, name
        from (
          select distinct on (lower(trim(name))) id, code, name, created_at
          from core.roles
          order by lower(trim(name)),
            case code
              when 'admin' then 1
              when 'sales_manager' then 2
              when 'branch_manager' then 3
              when 'finance_manager' then 4
              when 'operations_manager' then 5
              when 'call_center_agent' then 6
              when 'sales_user' then 7
              when 'marketing_user' then 8
              when 'operations_user' then 9
              when 'tracking_user' then 10
              when 'system_admin' then 11
              else 100
            end,
            created_at,
            code
        ) unique_roles
        order by name
      `,
    ]);
    return response.status(200).json({ ok: true, departments, branches, roles });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: "تعذر تحميل بيانات الإعدادات" });
  }
}
