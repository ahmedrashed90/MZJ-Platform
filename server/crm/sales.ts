import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clean, requireCrmUser, userScope } from "../_crm-utils.js";
import { getSql } from "../_db.js";

function canAccessLead(user: any, lead: any) {
  const scope = userScope(user);
  return scope.all
    || lead.assigned_to === user.id
    || lead.call_center_assigned_to === user.id
    || (scope.departmentCodes.includes(lead.department_code) && (!scope.branchCodes.length || scope.branchCodes.includes(lead.branch_code)));
}

async function loadLead(id: string) {
  const sql = getSql();
  const [lead] = await sql<any[]>`
    select l.*,l.id::text,l.assigned_to::text,l.call_center_assigned_to::text
    from crm.leads l
    where l.id=${id}::uuid and l.is_deleted=false
  `;
  return lead;
}

async function listHistory(request: VercelRequest, response: VercelResponse, user: any) {
  const leadId = clean(request.query.leadId || request.query.id);
  if (!leadId) return response.status(400).json({ ok: false, error: "رقم العميل مطلوب" });
  const lead = await loadLead(leadId);
  if (!lead) return response.status(404).json({ ok: false, error: "العميل غير موجود" });
  if (!canAccessLead(user, lead)) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لعرض سجل مبيعات هذا العميل" });

  const sql = getSql();
  const rows = await sql<any[]>`
    select
      ('sale:'||st.id::text) as id,
      st.id::text as transaction_id,
      st.source_type,
      st.source_reference as reference_no,
      st.sale_at,
      st.quantity::int,
      coalesce(st.total_amount,0)::float as total_amount,
      st.assigned_to::text,
      coalesce(st.assigned_name,u.full_name,'غير موزع') as assigned_name,
      st.department_code,
      st.branch_code,
      coalesce(b.name,st.branch_code,'بدون فرع') as branch_name,
      st.car_name,
      st.car_category,
      st.created_at,
      st.updated_at
    from crm.sales_transactions st
    left join core.users u on u.id=st.assigned_to
    left join core.branches b on b.code=st.branch_code
    where st.lead_id=${leadId}::uuid and coalesce(st.is_cancelled,false)=false
    order by st.sale_at desc,st.created_at desc,st.id desc
    limit 200
  `;
  return response.status(200).json({ ok: true, leadId, rows });
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "GET") return listHistory(request, response, user);
  if (request.method === "POST") {
    return response.status(405).json({ ok: false, error: "تم البيع يتم تسجيله تلقائيًا فقط بعد مطابقة طلب NEXT ERP برقم الجوال" });
  }
  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
