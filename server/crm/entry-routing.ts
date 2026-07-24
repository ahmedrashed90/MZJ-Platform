import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireCrmUser } from "../_crm-utils.js";
import { hasPermission } from "../_access-control.js";
import { getSql } from "../_db.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!hasPermission(user, "settings.crm.view")) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لمشاهدة إعدادات CRM" });
  if (request.method !== "GET") {
    return response.status(409).json({ ok: false, error: "رسائل واختيارات الفلو انتقلت إلى إعدادات الأوتوميشن. هذا التبويب مخصص لقواعد التوزيع فقط." });
  }
  const sql = getSql();
  const [rules, users] = await Promise.all([
    sql<any[]>`
      select r.id::text,r.name,r.department_code,r.branch_code,r.strategy,r.is_active,r.sort_order,
        count(m.user_id)::integer as member_count,
        count(m.user_id) filter(where m.is_active=true)::integer as active_member_count
      from crm.assignment_rules r
      left join crm.assignment_rule_members m on m.rule_id=r.id
      group by r.id order by r.sort_order,r.name
    `,
    sql<any[]>`select count(*)::integer as total,count(*) filter(where is_active=true and can_receive_leads=true)::integer as eligible from core.users`,
  ]);
  return response.status(200).json({ ok: true, rules, users: users[0] || { total: 0, eligible: 0 } });
}
