import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, parseBody, requireCrmUser, sourceLabel, userScope } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import { requirePermissionForUser } from "../_access-control.js";
import { insertManualSale } from "../_crm-sales-history.js";
import { closeCurrentServiceRequest } from "../_crm-lifecycle.js";
import { emitCrmLeadNotification } from "../_notifications.js";

function positiveQuantity(value: unknown) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

function validSaleDate(value: unknown) {
  const text = clean(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

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
    select l.*,l.id::text,l.assigned_to::text,l.call_center_assigned_to::text,
      sales.full_name as assigned_name,cc.full_name as call_center_name,b.name as branch_name
    from crm.leads l
    left join core.users sales on sales.id=l.assigned_to
    left join core.users cc on cc.id=l.call_center_assigned_to
    left join core.branches b on b.code=l.branch_code
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
    with sale_rows as (
      select
        ('manual:'||st.id::text) as id,
        st.id::text as transaction_id,
        'manual'::text as source_type,
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

      union all

      select
        ('erpnext:'||so.id::text) as id,
        so.id::text as transaction_id,
        'erpnext'::text as source_type,
        so.sales_order_no as reference_no,
        coalesce(
          (so.order_date::timestamp at time zone 'Asia/Riyadh'),
          l.sold_at
        ) as sale_at,
        coalesce(vehicle_stats.quantity,1)::int as quantity,
        coalesce(so.total_incl_vat,0)::float as total_amount,
        so.platform_user_id::text as assigned_to,
        coalesce(so.platform_user_name,u.full_name,so.erp_sales_person,'غير موزع') as assigned_name,
        coalesce(so.platform_department_code,l.department_code) as department_code,
        coalesce(so.platform_branch_code,l.branch_code) as branch_code,
        coalesce(so.platform_branch_name,b.name,so.platform_branch_code,l.branch_code,'بدون فرع') as branch_name,
        l.car_name,
        l.car_category,
        so.received_at as created_at,
        so.updated_at
      from integrations.erpnext_sales_orders so
      join crm.leads l on l.id=so.crm_lead_id
      left join core.users u on u.id=so.platform_user_id
      left join core.branches b on b.code=coalesce(so.platform_branch_code,l.branch_code)
      left join lateral (
        select nullif(sum(greatest(coalesce(sov.qty,1),1)) filter(where coalesce(sov.is_cancelled,false)=false),0)::int as quantity
        from integrations.erpnext_sales_order_vehicles sov where sov.sales_order_id=so.id
      ) vehicle_stats on true
      where so.crm_lead_id=${leadId}::uuid and coalesce(so.is_cancelled,false)=false
    )
    select * from sale_rows order by sale_at desc,created_at desc,id desc limit 200
  `;
  return response.status(200).json({ ok: true, leadId, rows });
}

async function recordSale(request: VercelRequest, response: VercelResponse, user: any) {
  const allowed = await requirePermissionForUser(request, response, user, "crm.customer.status.update", { systemCode: "crm", pageCode: "database", action: "record_sale" });
  if (!allowed) return;

  const body = parseBody(request);
  const leadId = clean(body.leadId || body.lead_id || body.id);
  const saleAt = validSaleDate(body.saleAt ?? body.sale_at);
  const quantity = positiveQuantity(body.quantity ?? body.soldQuantity ?? body.sold_quantity);
  if (!leadId) return response.status(400).json({ ok: false, error: "رقم العميل مطلوب" });
  if (!saleAt) return response.status(400).json({ ok: false, error: "تاريخ عملية البيع غير صحيح" });

  const before = await loadLead(leadId);
  if (!before) return response.status(404).json({ ok: false, error: "العميل غير موجود" });
  if (!canAccessLead(user, before)) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لتسجيل بيع لهذا العميل" });
  if (!["cash_sales", "finance_sales", "wholesale", "wholesale_sales", "call_center"].includes(clean(before.department_code))) {
    return response.status(400).json({ ok: false, error: "تسجيل عمليات البيع متاح لعملاء المبيعات فقط" });
  }

  const sql = getSql();
  const result = await sql.begin(async (tx: any) => {
    const sale = await insertManualSale(tx, {
      leadId,
      saleAt,
      quantity,
      assignedTo: before.assigned_to || null,
      assignedName: before.assigned_name || before.responsible_name_snapshot || null,
      departmentCode: before.department_code || null,
      branchCode: before.branch_code || null,
      sourceCode: before.source_code || null,
      sourceName: sourceLabel(before.source_code, before.source_name),
      carName: before.car_name || null,
      carCategory: before.car_category || null,
      createdBy: user.id,
      updatedBy: user.id,
      sourceType: "manual",
      metadata: { recordedFrom: "crm_customer", actorName: user.fullName },
    });

    const [row] = await tx<any[]>`
      update crm.leads set
        status_code=null,
        status_label='تم البيع',
        sold_at=greatest(coalesce(sold_at,${sale.sale_at}::timestamptz),${sale.sale_at}::timestamptz),
        sold_quantity=case when sold_at is null or sold_at<=${sale.sale_at}::timestamptz then ${quantity} else sold_quantity end,
        updated_by=${user.id}::uuid,
        updated_at=now()
      where id=${leadId}::uuid and is_deleted=false
      returning *,id::text,assigned_to::text,call_center_assigned_to::text
    `;
    await tx`
      insert into crm.lead_events(
        lead_id,event_type,old_status,new_status,old_department,new_department,old_branch,new_branch,
        actor_id,actor_name,actor_role,note,details
      ) values(
        ${leadId}::uuid,'manual_sale_recorded',${before.status_label || null},'تم البيع',
        ${before.department_code || null},${before.department_code || null},${before.branch_code || null},${before.branch_code || null},
        ${user.id}::uuid,${user.fullName},${user.roles.join("، ") || null},'تسجيل عملية بيع مستقلة',
        ${tx.json({ saleId: sale.id, saleAt: sale.sale_at, quantity, source: "manual" })}
      )
    `;
    return { row, sale };
  });

  if (clean(before.status_label) !== "تم البيع") {
    await closeCurrentServiceRequest({ leadId, statusLabel: "تم البيع", actor: user, reason: "تم البيع" }).catch(() => undefined);
  }
  result.row.assigned_name = before.assigned_name || before.responsible_name_snapshot || null;
  result.row.call_center_name = before.call_center_name || before.call_center_name_snapshot || null;
  result.row.branch_name = before.branch_name || null;
  await audit(user, "manual_sale_recorded", "lead", leadId, result.sale, before);
  await emitCrmLeadNotification(user, "status", result.row, before).catch((error) => console.error("CRM sale notification failed", error));
  return response.status(201).json({ ok: true, row: result.row, sale: result.sale });
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "GET") return listHistory(request, response, user);
  if (request.method === "POST") return recordSale(request, response, user);
  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
