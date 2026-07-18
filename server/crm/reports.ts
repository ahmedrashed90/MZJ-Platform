import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clean, requireCrmPermission, requireCrmUser, sourceLabel, userScope } from "../_crm-utils.js";
import { getSql } from "../_db.js";

function norm(value: unknown) {
  return String(value ?? "").trim().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").toLowerCase();
}

function departmentLabel(code: string) {
  if (code === "finance_sales" || code === "call_center") return "مبيعات التمويل";
  if (code === "customer_service") return "خدمة العملاء";
  return "مبيعات الكاش";
}

function percent(num: number, den: number) {
  return den > 0 ? Math.round((num / den) * 10000) / 100 : 0;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const user = await requireCrmUser(request, response);
  if (!user) return;
  if (!(await requireCrmPermission(user, response, "crm.reports.view"))) return;
  const sql = getSql();
  const scope = userScope(user);
  const from = clean(request.query.from);
  const to = clean(request.query.to);
  const q = clean(request.query.q);
  const department = clean(request.query.department);
  const branch = clean(request.query.branch);
  const agent = clean(request.query.agent);
  const callCenter = clean(request.query.callCenter);
  const source = clean(request.query.source);

  const leads = await sql<any[]>`
    select l.id::text,l.customer_name,l.phone,l.phone_normalized,l.source_code,l.source_name,l.department_code,l.branch_code,
      l.status_label,l.car_name,l.notes,l.status_note,l.created_at,l.updated_at,l.assigned_to::text,l.call_center_assigned_to::text,
      sales.full_name as assigned_name,cc.full_name as call_center_name,b.name as branch_name,src.name as catalog_source_name
    from crm.leads l
    left join core.users sales on sales.id=l.assigned_to
    left join core.users cc on cc.id=l.call_center_assigned_to
    left join core.branches b on b.code=l.branch_code
    left join core.sources src on src.code=l.source_code
    where l.is_deleted=false
      and (
        ${scope.all}::boolean
        or (${scope.callCenterOnly}::boolean and l.call_center_assigned_to=${scope.userId}::uuid)
        or (not ${scope.callCenterOnly}::boolean and (l.assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid))
        or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
      )
      and (${from || null}::date is null or l.created_at::date >= ${from || null}::date)
      and (${to || null}::date is null or l.created_at::date <= ${to || null}::date)
      and (${department || null}::text is null or l.department_code=${department || null} or l.service_key=${department || null})
      and (${branch || null}::text is null or l.branch_code=${branch || null})
      and (${agent || null}::uuid is null or l.assigned_to=${agent || null}::uuid)
      and (${callCenter || null}::uuid is null or l.call_center_assigned_to=${callCenter || null}::uuid)
      and (${source || null}::text is null or l.source_code=${source || null})
      and (${q || null}::text is null or concat_ws(' ',l.customer_name,l.phone,l.phone_normalized,l.car_name,l.source_name,l.source_code,l.status_label,l.notes,sales.full_name,cc.full_name,b.name) ilike ${q ? `%${q}%` : null})
    order by l.updated_at desc
  `;

  for (const lead of leads) { lead.source_name = sourceLabel(lead.source_code, lead.catalog_source_name || lead.source_name); delete lead.catalog_source_name; }

  const [quality] = await sql<any[]>`select * from crm.report_quality_settings where id='default'`;
  const marketingNum = new Set<string>((quality?.marketing_numerator_statuses || ["مؤهل"]).map((value: unknown) => norm(value)));
  const marketingDenStatuses = new Set<string>((quality?.marketing_denominator_statuses || []).map((value: unknown) => norm(value)));
  const salesNum = new Set<string>((quality?.sales_numerator_statuses || ["تم البيع", "تم الانتهاء - إنشاء طلب البيع"]).map((value: unknown) => norm(value)));
  const salesDenStatuses = new Set<string>((quality?.sales_denominator_statuses || []).map((value: unknown) => norm(value)));

  const makeMetrics = (rows: any[]) => {
    const count = (set: Set<string>) => rows.filter((lead) => set.has(norm(lead.status_label))).length;
    const marketingDen = quality?.marketing_denominator_mode === "statuses" ? count(marketingDenStatuses) : rows.length;
    const salesDen = quality?.sales_denominator_mode === "all" ? rows.length : count(salesDenStatuses);
    return {
      total: rows.length,
      notQualified: rows.filter((lead) => norm(lead.status_label) === norm("غير مؤهل")).length,
      qualified: rows.filter((lead) => norm(lead.status_label).startsWith(norm("مؤهل"))).length,
      delayed: rows.filter((lead) => norm(lead.status_label) === norm("مؤجل")).length,
      potential: rows.filter((lead) => norm(lead.status_label) === norm("محتمل")).length,
      sold: count(salesNum),
      marketingQuality: percent(count(marketingNum), marketingDen),
      salesQuality: percent(count(salesNum), salesDen),
    };
  };

  const group = (key: (row: any) => string) => {
    const map = new Map<string, any[]>();
    for (const row of leads) {
      const name = key(row) || "غير محدد";
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(row);
    }
    return [...map.entries()]
      .map(([name, rows]) => ({ name, ...makeMetrics(rows), customers: rows }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ar"));
  };

  const sources = group((row) => sourceLabel(row.source_code, row.source_name));
  const departments = group((row) => `${departmentLabel(row.department_code)} - ${row.branch_name || row.branch_code || "بدون فرع"}`);
  const agents = group((row) => row.assigned_name || "غير موزع");
  const callCenterRows = group((row) => row.call_center_name || "غير موزع").filter((row) => row.name !== "غير موزع" || row.total > 0);
  const serviceRows = leads.filter((row) => row.department_code === "customer_service");
  const service = {
    name: "خدمة العملاء",
    ...makeMetrics(serviceRows),
    working: serviceRows.filter((row) => norm(row.status_label) === norm("جاري العمل")).length,
    done: serviceRows.filter((row) => [norm("تم الانتهاء"), norm("تم الإنتهاء")].includes(norm(row.status_label))).length,
    customers: serviceRows,
  };

  return response.status(200).json({
    ok: true,
    filters: { from, to, q, department, branch, agent, callCenter, source },
    totals: makeMetrics(leads),
    sources,
    departments,
    agents,
    callCenter: callCenterRows,
    service,
    customers: leads,
    quality,
  });
}
