import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clean, requireCrmUser, sourceLabel, userScope } from "../_crm-utils.js";
import { getSql } from "../_db.js";

const DEFAULT_SUMMARY_CARDS = ["marketing", "total", "notContacted", "waste", "qualified", "potential", "sold", "sales"];

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

function setOf(value: unknown, fallback: string[] = []) {
  const values = Array.isArray(value) ? value : fallback;
  return new Set(values.map(norm).filter(Boolean));
}

function boundedInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const user = await requireCrmUser(request, response);
  if (!user) return;
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
  const detailKind = clean(request.query.detailKind);
  const detailValue = clean(request.query.detailValue);
  const detailQ = clean(request.query.detailQ);
  const detailPage = boundedInt(request.query.detailPage, 1, 1, 100000);
  const detailPageSize = boundedInt(request.query.detailPageSize, 100, 10, 200);

  if (detailKind) {
    if (!["source", "department_branch", "agent", "service"].includes(detailKind)) return response.status(400).json({ ok: false, error: "نوع تقرير العملاء غير صحيح" });
    const detailOffset = (detailPage - 1) * detailPageSize;
    const [countRow] = await sql<{ count: number }[]>`
      select count(*)::int as count
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
        and (${from || null}::date is null or (coalesce(l.registered_at,l.created_at) at time zone 'Asia/Riyadh')::date >= ${from || null}::date)
        and (${to || null}::date is null or (coalesce(l.registered_at,l.created_at) at time zone 'Asia/Riyadh')::date <= ${to || null}::date)
        and (
          ${department || null}::text is null
          or (${department || null}='call_center' and l.call_center_assigned_to is not null)
          or (${department || null}<>'call_center' and (l.department_code=${department || null} or l.service_key=${department || null}))
        )
        and (${branch || null}::text is null or l.branch_code=${branch || null})
        and (${agent || null}::uuid is null or l.assigned_to=${agent || null}::uuid)
        and (${callCenter || null}::uuid is null or l.call_center_assigned_to=${callCenter || null}::uuid)
        and (${source || null}::text is null or l.source_code=${source || null})
        and (${q || null}::text is null or concat_ws(' ',l.customer_name,l.phone,l.phone_normalized,l.car_name,l.source_name,l.source_code,l.status_label,l.notes,sales.full_name,cc.full_name,b.name) ilike ${q ? `%${q}%` : null})
        and (${detailQ || null}::text is null or concat_ws(' ',l.customer_name,l.phone,l.phone_normalized,l.car_name,l.source_name,l.source_code,l.status_label,l.notes,l.status_note,sales.full_name,cc.full_name,b.name) ilike ${detailQ ? `%${detailQ}%` : null})
        and (
          (${detailKind}='source' and coalesce(l.source_code,'__none__')=${detailValue})
          or (${detailKind}='department_branch' and (coalesce(l.department_code,'__none__') || '|' || coalesce(l.branch_code,'__none__'))=${detailValue})
          or (${detailKind}='agent' and coalesce(l.assigned_to::text,'__none__')=${detailValue})
          or (${detailKind}='service' and l.department_code='customer_service')
        )
    `;
    const detailRows = await sql<any[]>`
      select l.id::text,l.customer_name,l.phone,l.phone_normalized,l.source_code,l.source_name,l.department_code,l.branch_code,
        l.status_label,l.car_name,l.notes,l.status_note,l.registered_at,l.created_at,l.updated_at,l.assigned_to::text,l.call_center_assigned_to::text,
        sales.full_name as assigned_name,cc.full_name as call_center_name,b.name as branch_name,src.name as catalog_source_name,
        coalesce(src.report_group,'other') as source_report_group
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
        and (${from || null}::date is null or (coalesce(l.registered_at,l.created_at) at time zone 'Asia/Riyadh')::date >= ${from || null}::date)
        and (${to || null}::date is null or (coalesce(l.registered_at,l.created_at) at time zone 'Asia/Riyadh')::date <= ${to || null}::date)
        and (
          ${department || null}::text is null
          or (${department || null}='call_center' and l.call_center_assigned_to is not null)
          or (${department || null}<>'call_center' and (l.department_code=${department || null} or l.service_key=${department || null}))
        )
        and (${branch || null}::text is null or l.branch_code=${branch || null})
        and (${agent || null}::uuid is null or l.assigned_to=${agent || null}::uuid)
        and (${callCenter || null}::uuid is null or l.call_center_assigned_to=${callCenter || null}::uuid)
        and (${source || null}::text is null or l.source_code=${source || null})
        and (${q || null}::text is null or concat_ws(' ',l.customer_name,l.phone,l.phone_normalized,l.car_name,l.source_name,l.source_code,l.status_label,l.notes,sales.full_name,cc.full_name,b.name) ilike ${q ? `%${q}%` : null})
        and (${detailQ || null}::text is null or concat_ws(' ',l.customer_name,l.phone,l.phone_normalized,l.car_name,l.source_name,l.source_code,l.status_label,l.notes,l.status_note,sales.full_name,cc.full_name,b.name) ilike ${detailQ ? `%${detailQ}%` : null})
        and (
          (${detailKind}='source' and coalesce(l.source_code,'__none__')=${detailValue})
          or (${detailKind}='department_branch' and (coalesce(l.department_code,'__none__') || '|' || coalesce(l.branch_code,'__none__'))=${detailValue})
          or (${detailKind}='agent' and coalesce(l.assigned_to::text,'__none__')=${detailValue})
          or (${detailKind}='service' and l.department_code='customer_service')
        )
      order by coalesce(l.registered_at,l.created_at) desc,l.updated_at desc
      limit ${detailPageSize} offset ${detailOffset}
    `;
    for (const lead of detailRows) {
      lead.source_name = sourceLabel(lead.source_code, lead.catalog_source_name || lead.source_name);
      delete lead.catalog_source_name;
    }
    return response.status(200).json({ ok: true, rows: detailRows, total: Number(countRow?.count || 0), page: detailPage, pageSize: detailPageSize });
  }

  const leads = await sql<any[]>`
    select l.id::text,l.customer_name,l.phone,l.phone_normalized,l.source_code,l.source_name,l.department_code,l.branch_code,
      l.status_label,l.car_name,l.notes,l.status_note,l.registered_at,l.created_at,l.updated_at,l.assigned_to::text,l.call_center_assigned_to::text,
      sales.full_name as assigned_name,cc.full_name as call_center_name,b.name as branch_name,src.name as catalog_source_name,
      coalesce(src.report_group,'other') as source_report_group
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
      and (${from || null}::date is null or (coalesce(l.registered_at,l.created_at) at time zone 'Asia/Riyadh')::date >= ${from || null}::date)
      and (${to || null}::date is null or (coalesce(l.registered_at,l.created_at) at time zone 'Asia/Riyadh')::date <= ${to || null}::date)
      and (
        ${department || null}::text is null
        or (${department || null}='call_center' and l.call_center_assigned_to is not null)
        or (${department || null}<>'call_center' and (l.department_code=${department || null} or l.service_key=${department || null}))
      )
      and (${branch || null}::text is null or l.branch_code=${branch || null})
      and (${agent || null}::uuid is null or l.assigned_to=${agent || null}::uuid)
      and (${callCenter || null}::uuid is null or l.call_center_assigned_to=${callCenter || null}::uuid)
      and (${source || null}::text is null or l.source_code=${source || null})
      and (${q || null}::text is null or concat_ws(' ',l.customer_name,l.phone,l.phone_normalized,l.car_name,l.source_name,l.source_code,l.status_label,l.notes,sales.full_name,cc.full_name,b.name) ilike ${q ? `%${q}%` : null})
    order by coalesce(l.registered_at,l.created_at) desc,l.updated_at desc
  `;

  for (const lead of leads) {
    lead.source_name = sourceLabel(lead.source_code, lead.catalog_source_name || lead.source_name);
    delete lead.catalog_source_name;
  }

  const [storedQuality] = await sql<any[]>`select * from crm.report_quality_settings where id='default'`;
  const quality = storedQuality || {};
  const marketingNum = setOf(quality.marketing_numerator_statuses, ["مؤهل"]);
  const marketingDenStatuses = setOf(quality.marketing_denominator_statuses);
  const salesNum = setOf(quality.sales_numerator_statuses, ["تم البيع"]);
  const salesDenStatuses = setOf(quality.sales_denominator_statuses, ["مؤهل", "مؤجل", "لم يتم الرد", "غير مؤهل", "تم البيع"]);
  const qualifiedStatuses = setOf(quality.qualified_statuses, ["مؤهل"]);
  const totalStatuses = setOf(quality.total_statuses);
  const notContactedStatuses = setOf(quality.not_contacted_statuses, ["عميل جديد"]);
  const summaryCards = (Array.isArray(quality.summary_cards) ? quality.summary_cards : DEFAULT_SUMMARY_CARDS).filter((value: unknown) => DEFAULT_SUMMARY_CARDS.concat(["delayed"]).includes(String(value)));

  const makeMetrics = (rows: any[]) => {
    const count = (set: Set<string>) => rows.reduce((total, lead) => total + (set.has(norm(lead.status_label)) ? 1 : 0), 0);
    const marketingDen = quality.marketing_denominator_mode === "statuses" ? count(marketingDenStatuses) : rows.length;
    const salesDen = quality.sales_denominator_mode === "all" ? rows.length : count(salesDenStatuses);
    const total = quality.total_mode === "statuses" ? count(totalStatuses) : rows.length;
    return {
      total,
      notContacted: count(notContactedStatuses),
      notQualified: rows.filter((lead) => norm(lead.status_label) === norm("غير مؤهل")).length,
      qualified: count(qualifiedStatuses),
      delayed: rows.filter((lead) => norm(lead.status_label) === norm("مؤجل")).length,
      potential: rows.filter((lead) => norm(lead.status_label) === norm("لم يتم الرد")).length,
      sold: count(salesNum),
      marketingQuality: percent(count(marketingNum), marketingDen),
      salesQuality: percent(count(salesNum), salesDen),
    };
  };

  const group = (rows: any[], detailKind: string, key: (row: any) => string, label: (row: any) => string) => {
    const map = new Map<string, any[]>();
    for (const row of rows) {
      const value = key(row) || "__none__";
      if (!map.has(value)) map.set(value, []);
      map.get(value)!.push(row);
    }
    return [...map.entries()]
      .map(([detailValue, groupedRows]) => ({ name: label(groupedRows[0]) || "غير محدد", ...makeMetrics(groupedRows), detailKind, detailValue }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ar"));
  };

  const sourceRows = group(leads, "source", (row) => row.source_code || "__none__", (row) => sourceLabel(row.source_code, row.source_name));
  const sourceGroup = (groupName: string) => group(leads.filter((row) => row.source_report_group === groupName), "source", (row) => row.source_code || "__none__", (row) => sourceLabel(row.source_code, row.source_name));
  const salesRows = leads.filter((row) => row.department_code !== "customer_service");
  const departments = group(salesRows, "department_branch", (row) => `${row.department_code || "__none__"}|${row.branch_code || "__none__"}`, (row) => `${departmentLabel(row.department_code)} - ${row.branch_name || row.branch_code || "بدون فرع"}`);
  const agents = group(salesRows, "agent", (row) => row.assigned_to || "__none__", (row) => row.assigned_name || "غير موزع");
  const serviceRows = leads.filter((row) => row.department_code === "customer_service");
  const service = {
    name: "خدمة العملاء",
    ...makeMetrics(serviceRows),
    working: serviceRows.filter((row) => norm(row.status_label) === norm("جاري العمل")).length,
    done: serviceRows.filter((row) => [norm("تم الانتهاء"), norm("تم الإنتهاء")].includes(norm(row.status_label))).length,
    detailKind: "service",
    detailValue: "customer_service",
  };

  return response.status(200).json({
    ok: true,
    filters: { from, to, q, department, branch, agent, callCenter, source },
    totals: makeMetrics(leads),
    digitalSources: sourceGroup("digital"),
    directSources: sourceGroup("direct"),
    otherSources: sourceGroup("other"),
    sources: sourceRows,
    departments,
    agents,
    service,
    quality: { ...quality, summary_cards: summaryCards },
  });
}
