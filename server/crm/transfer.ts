import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, departmentCodeFromKey, departmentKey, isCrmManager, parseBody, requireCrmUser } from "../_crm-utils.js";
import { getSql } from "../_db.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "نقل العملاء متاح للإدارة فقط" });
  const body = parseBody(request);
  const leadIds = Array.isArray(body.leadIds) ? body.leadIds.map(clean).filter(Boolean) : [];
  const newAgentId = clean(body.newAgentId);
  if (!leadIds.length || !newAgentId) return response.status(400).json({ ok: false, error: "حدد العملاء والمندوب الجديد" });
  const sql = getSql();
  const [agent] = await sql<any[]>`
    select u.id::text,u.full_name,min(d.code) as department_code,min(b.code) as branch_code
    from core.users u
    left join core.user_departments ud on ud.user_id=u.id
    left join core.departments d on d.id=ud.department_id
    left join core.user_branches ub on ub.user_id=u.id
    left join core.branches b on b.id=ub.branch_id
    where u.id=${newAgentId}::uuid and u.is_active=true
    group by u.id
  `;
  if (!agent) return response.status(404).json({ ok: false, error: "المندوب الجديد غير موجود" });
  const targetKey = departmentKey(agent.department_code);
  const targetDepartment = departmentCodeFromKey(targetKey);
  const before = await sql<any[]>`select id::text,status_label,department_code,branch_code,assigned_to::text from crm.leads where id=any(${leadIds}::uuid[]) and is_deleted=false`;
  const rows = await sql<any[]>`
    update crm.leads set assigned_to=${newAgentId}::uuid,department_code=${targetDepartment},service_key=${targetKey},branch_code=${agent.branch_code||null},status_label='عميل جديد',updated_by=${user.id}::uuid,updated_at=now()
    where id=any(${leadIds}::uuid[]) and is_deleted=false returning id::text
  `;
  for (const old of before) {
    await sql`
      insert into crm.lead_events(lead_id,event_type,old_status,new_status,old_department,new_department,old_branch,new_branch,actor_id,actor_name,note,details)
      values (${old.id}::uuid,'bulk_transfer',${old.status_label},'عميل جديد',${old.department_code},${targetDepartment},${old.branch_code},${agent.branch_code||null},${user.id}::uuid,${user.fullName},'نقل العملاء من صفحة قاعدة البيانات',${sql.json({ newAgentId, newAgentName: agent.full_name })})
    `;
  }
  await audit(user, "leads_transferred", "lead", null, { leadIds, newAgentId, department: targetDepartment, branch: agent.branch_code });
  return response.status(200).json({ ok: true, count: rows.length, agent });
}
