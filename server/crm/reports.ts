import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clean, requireCrmUser, sourceLabel, userScope } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import { ensureErpNextSalesOrderSchema } from "../_erpnext-integration-schema.js";

const DEFAULT_SUMMARY_CARDS = ["marketing", "total", "notContacted", "waste", "qualified", "potential", "sold", "sales"];

function norm(value: unknown) {
  return String(value ?? "").trim().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").toLowerCase();
}

function departmentLabel(code: string) {
  if (code === "finance_sales" || code === "call_center") return "مبيعات التمويل";
  if (code === "customer_service") return "خدمة العملاء";
  if (code === "wholesale" || code === "wholesale_sales") return "قسم الجملة";
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
  await ensureErpNextSalesOrderSchema();
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
  const detailStatus = clean(request.query.detailStatus);
  const detailPage = boundedInt(request.query.detailPage, 1, 1, 100000);
  const detailPageSize = boundedInt(request.query.detailPageSize, 100, 10, 200);
  const summaryOnly = ["1", "true", "yes"].includes(clean(request.query.summaryOnly).toLowerCase());

  /*
   * NEXT ERP sales use the salesperson's primary CRM department/branch as the
   * reporting identity. This keeps branchless departments (for example wholesale)
   * visible in reports and prevents broad "allowed departments" memberships from
   * incorrectly classifying a sales manager as a call-center agent.
   */
  const effectiveLeads = sql`
    select
      l.*,
      actor.user_id as report_assigned_to,
      effective.department_code as report_department_code,
      effective.branch_code as report_branch_code,
      coalesce(sales.full_name,erp.platform_user_name,l.responsible_name_snapshot) as report_assigned_name,
      l.assigned_to as current_assigned_to,
      l.department_code as current_department_code,
      l.branch_code as current_branch_code,
      coalesce(current_sales.full_name,l.responsible_name_snapshot) as current_assigned_name,
      current_branch.name as current_branch_name,
      (coalesce(l.department_code,'')='call_center') as current_assigned_is_call_center,
      cc.full_name as report_call_center_name,
      branch_row.name as report_branch_name,
      src.name as catalog_source_name,
      coalesce(src.report_group,'other') as source_report_group,
      (coalesce(primary_department.code,'')='call_center') as assigned_is_call_center,
      exists(select 1 from integrations.erpnext_sales_orders active_so where active_so.crm_lead_id=l.id and coalesce(active_so.is_cancelled,false)=false) as has_active_erp_order
    from crm.leads l
    left join lateral (
      select so.platform_user_id,so.platform_user_name,so.platform_department_code,so.platform_branch_code
      from integrations.erpnext_sales_orders so
      where so.crm_lead_id=l.id and coalesce(so.is_cancelled,false)=false
      order by so.updated_at desc,so.received_at desc
      limit 1
    ) erp on true
    left join lateral (
      select coalesce(erp.platform_user_id,l.assigned_to) as user_id
    ) actor on true
    left join lateral (
      select d.code,d.name
      from core.user_system_departments usd
      join core.departments d on d.id=usd.department_id and d.system_code='crm' and d.is_active=true
      where usd.user_id=actor.user_id and usd.system_code='crm'
      order by usd.is_primary desc,d.created_at,d.code
      limit 1
    ) primary_department on true
    left join lateral (
      select b.code,b.name
      from core.user_system_branches usb
      join core.branches b on b.id=usb.branch_id and b.is_active=true
      where usb.user_id=actor.user_id and usb.system_code='crm'
      order by usb.is_primary desc,b.sort_order,b.name
      limit 1
    ) primary_branch on true
    left join lateral (
      select
        case
          when lower(coalesce(l.source_code,'')) in ('next_erp','next erp') and actor.user_id is not null
            then coalesce(primary_department.code,erp.platform_department_code,l.department_code)
          else coalesce(l.department_code,erp.platform_department_code)
        end as department_code,
        case
          when lower(coalesce(l.source_code,'')) in ('next_erp','next erp') and actor.user_id is not null
            then case
              when primary_department.code in ('wholesale','wholesale_sales') then null
              when primary_department.code is not null then primary_branch.code
              else erp.platform_branch_code
            end
          else coalesce(l.branch_code,erp.platform_branch_code)
        end as branch_code
    ) effective on true
    left join core.users sales on sales.id=actor.user_id
    left join core.users current_sales on current_sales.id=l.assigned_to
    left join core.branches current_branch on current_branch.code=l.branch_code
    left join core.users cc on cc.id=l.call_center_assigned_to
    left join core.branches branch_row on branch_row.code=effective.branch_code
    left join core.sources src on src.code=l.source_code
  `;

  const scopeSql = sql`
    (
      ${scope.all}::boolean
      or (${scope.includeAssigned}::boolean and ${scope.callCenterOnly}::boolean and l.call_center_assigned_to=${scope.userId}::uuid)
      or (${scope.includeAssigned}::boolean and not ${scope.callCenterOnly}::boolean and (l.current_assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid))
      or (l.current_department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.current_branch_code=any(${scope.branchCodes}::text[])))
    )
  `;

  const reportDateSql = sql`
    (
      case
        when l.status_label='تم البيع' then (l.sold_at at time zone 'Asia/Riyadh')::date
        else (coalesce(l.updated_at,l.created_at) at time zone 'Asia/Riyadh')::date
      end
    )
  `;
  const salesOrderTimestampSql = sql`
    coalesce(
      (so.order_date::timestamp at time zone 'Asia/Riyadh'),
      l.sold_at
    )
  `;
  const salesOrderDateSql = sql`
    (${salesOrderTimestampSql} at time zone 'Asia/Riyadh')::date
  `;
  const manualSaleDateSql = sql`
    (st.sale_at at time zone 'Asia/Riyadh')::date
  `;

  const leadDepartmentFilterSql = sql`
    (
      ${department || null}::text is null
      or (${department || null}='cash' and l.report_department_code in ('cash_sales','wholesale','wholesale_sales'))
      or (${department || null}='finance' and l.report_department_code in ('finance_sales','call_center'))
      or (${department || null}='service' and l.report_department_code='customer_service')
      or (${department || null}='call_center' and l.call_center_assigned_to is not null)
      or (${department || null}='wholesale' and l.report_department_code in ('wholesale','wholesale_sales'))
      or (${department || null} in ('cash_sales','finance_sales','customer_service') and l.report_department_code=${department || null})
      or l.service_key=${department || null}
    )
  `;
  const salesFactDepartmentFilterSql = sql`
    (
      ${department || null}::text is null
      or (${department || null}='cash' and coalesce(so.platform_department_code,primary_department.code,l.department_code) in ('cash_sales','wholesale','wholesale_sales'))
      or (${department || null}='finance' and coalesce(so.platform_department_code,primary_department.code,l.department_code) in ('finance_sales','call_center'))
      or (${department || null}='service' and coalesce(so.platform_department_code,primary_department.code,l.department_code)='customer_service')
      or (${department || null}='call_center' and l.call_center_assigned_to is not null)
      or (${department || null}='wholesale' and coalesce(so.platform_department_code,primary_department.code,l.department_code) in ('wholesale','wholesale_sales'))
      or (${department || null} in ('cash_sales','finance_sales','customer_service') and coalesce(so.platform_department_code,primary_department.code,l.department_code)=${department || null})
      or l.service_key=${department || null}
    )
  `;
  const transactionDepartmentFilterSql = sql`
    (
      ${department || null}::text is null
      or (${department || null}='cash' and st.department_code in ('cash_sales','wholesale','wholesale_sales'))
      or (${department || null}='finance' and st.department_code in ('finance_sales','call_center'))
      or (${department || null}='service' and st.department_code='customer_service')
      or (${department || null}='call_center' and st.department_code='call_center')
      or (${department || null}='wholesale' and st.department_code in ('wholesale','wholesale_sales'))
      or (${department || null} in ('cash_sales','finance_sales','customer_service') and st.department_code=${department || null})
    )
  `;

  const currentLeadDepartmentFilterSql = sql`
    (
      ${department || null}::text is null
      or (${department || null}='cash' and l.current_department_code in ('cash_sales','wholesale','wholesale_sales'))
      or (${department || null}='finance' and l.current_department_code in ('finance_sales','call_center'))
      or (${department || null}='service' and l.current_department_code='customer_service')
      or (${department || null}='call_center' and l.call_center_assigned_to is not null)
      or (${department || null}='wholesale' and l.current_department_code in ('wholesale','wholesale_sales'))
      or (${department || null} in ('cash_sales','finance_sales','customer_service') and l.current_department_code=${department || null})
      or l.service_key=${department || null}
    )
  `;

  const filtersSql = sql`
    ${scopeSql}
    and (${from || null}::date is null or ${reportDateSql} >= ${from || null}::date)
    and (${to || null}::date is null or ${reportDateSql} <= ${to || null}::date)
    and ${leadDepartmentFilterSql}
    and (${branch || null}::text is null or l.report_branch_code=${branch || null})
    and (${agent || null}::uuid is null or l.current_assigned_to=${agent || null}::uuid)
    and (${callCenter || null}::uuid is null or l.call_center_assigned_to=${callCenter || null}::uuid)
    and (${source || null}::text is null or l.source_code=${source || null})
    and (${q || null}::text is null or concat_ws(' ',l.customer_name,l.phone,l.phone_normalized,l.car_name,l.source_name,l.source_code,l.status_label,l.notes,l.report_assigned_name,l.report_call_center_name,l.report_branch_name) ilike ${q ? `%${q}%` : null})
  `;

  if (detailKind) {
    if (!["source", "department_branch", "agent", "service"].includes(detailKind)) return response.status(400).json({ ok: false, error: "نوع تقرير العملاء غير صحيح" });
    const detailOffset = (detailPage - 1) * detailPageSize;

    // Representative drill-down follows the customer's current CRM owner.
    // Sale history is aggregated per current customer, so transferred customers
    // disappear from the previous representative and appear for the new one.
    if (detailKind === "agent") {
      const agentDetailRows = await sql<any[]>`
        with effective_leads as (${effectiveLeads}),
        agent_sale_rows as (
          select
            st.lead_id,
            greatest(coalesce(st.quantity,1),1)::int as quantity,
            coalesce(st.total_amount,0)::float as total_sales_amount,
            st.source_reference as reference_no,
            st.sale_at
          from crm.sales_transactions st
          join effective_leads l on l.id=st.lead_id and l.is_deleted=false
          where coalesce(st.is_cancelled,false)=false
            and coalesce(l.current_assigned_to::text,'__none__')=${detailValue}
            and (${from || null}::date is null or ${manualSaleDateSql}>=${from || null}::date)
            and (${to || null}::date is null or ${manualSaleDateSql}<=${to || null}::date)
            and ${scopeSql}
            and ${currentLeadDepartmentFilterSql}
            and (${branch || null}::text is null or l.current_branch_code=${branch || null})
            and (${agent || null}::uuid is null or l.current_assigned_to=${agent || null}::uuid)
            and (${callCenter || null}::uuid is null or l.call_center_assigned_to=${callCenter || null}::uuid)
            and (${source || null}::text is null or coalesce(st.source_code,l.source_code)=${source || null})
            and (${q || null}::text is null or concat_ws(' ',st.source_reference,l.customer_name,l.phone,l.current_assigned_name,l.current_branch_name,l.current_department_code,st.source_name,l.source_name) ilike ${q ? `%${q}%` : null})
        ),
        agent_sales as (
          select
            lead_id,
            coalesce(sum(quantity),0)::int as sold_quantity,
            coalesce(sum(total_sales_amount),0)::float as total_sales_amount,
            string_agg(distinct reference_no, ', ' order by reference_no) filter(where nullif(reference_no,'') is not null) as sales_order_numbers,
            max(sale_at) as last_sale_at
          from agent_sale_rows
          group by lead_id
        ),
        current_agent_ids as (
          select l.id
          from effective_leads l
          where l.is_deleted=false
            and coalesce(l.current_assigned_to::text,'__none__')=${detailValue}
            and ${scopeSql}
            and (${from || null}::date is null or ${reportDateSql} >= ${from || null}::date)
            and (${to || null}::date is null or ${reportDateSql} <= ${to || null}::date)
            and ${currentLeadDepartmentFilterSql}
            and (${branch || null}::text is null or l.current_branch_code=${branch || null})
            and (${agent || null}::uuid is null or l.current_assigned_to=${agent || null}::uuid)
            and (${callCenter || null}::uuid is null or l.call_center_assigned_to=${callCenter || null}::uuid)
            and (${source || null}::text is null or l.source_code=${source || null})
            and (${q || null}::text is null or concat_ws(' ',l.customer_name,l.phone,l.phone_normalized,l.car_name,l.source_name,l.source_code,l.status_label,l.notes,l.current_assigned_name,l.report_call_center_name,l.current_branch_name) ilike ${q ? `%${q}%` : null})
        ),
        combined_ids as (
          select id from current_agent_ids
          union
          select lead_id from agent_sales
        ),
        result_rows as (
          select
            l.id::text,l.customer_name,l.phone,l.phone_normalized,l.source_code,l.source_name,
            l.current_department_code as department_code,
            l.current_branch_code as branch_code,
            l.status_label,l.car_name,l.notes,
            concat_ws(' · ',nullif(l.status_note,''),case when s.sales_order_numbers is not null then 'طلبات البيع: '||s.sales_order_numbers end) as status_note,
            case when s.lead_id is not null then s.sold_quantity else null end::int as sold_quantity,
            coalesce(s.last_sale_at,l.sold_at) as sold_at,l.registered_at,l.created_at,coalesce(l.updated_at,l.created_at) as updated_at,
            l.current_assigned_name as assigned_name,
            l.call_center_assigned_to::text,l.report_call_center_name as call_center_name,
            l.current_branch_name as branch_name,l.catalog_source_name,l.source_report_group,
            s.sales_order_numbers,s.total_sales_amount,s.last_sale_at
          from combined_ids ids
          join effective_leads l on l.id=ids.id
          left join agent_sales s on s.lead_id=l.id
          where (${detailQ || null}::text is null or concat_ws(' ',l.customer_name,l.phone,l.phone_normalized,l.car_name,l.source_name,l.source_code,l.status_label,l.notes,l.status_note,l.current_assigned_name,l.report_call_center_name,l.current_branch_name,s.sales_order_numbers) ilike ${detailQ ? `%${detailQ}%` : null})
        )
        select result_rows.*,(count(*) over())::int as total_count
        from result_rows
        where (${detailStatus || null}::text is null or result_rows.status_label=${detailStatus || null})
        order by last_sale_at desc nulls last,coalesce(registered_at,created_at) desc,updated_at desc
        limit ${detailPageSize} offset ${detailOffset}
      `;
      const detailTotal = Number(agentDetailRows[0]?.total_count || 0);
      for (const lead of agentDetailRows) {
        lead.source_name = sourceLabel(lead.source_code, lead.catalog_source_name || lead.source_name);
        lead.sold_quantity = lead.sold_quantity == null ? null : Math.max(1, Number(lead.sold_quantity || 1));
        delete lead.catalog_source_name;
        delete lead.total_count;
      }
      return response.status(200).json({ ok: true, rows: agentDetailRows, total: detailTotal, page: detailPage, pageSize: detailPageSize });
    }
    const detailMatch = sql`
      (
        (${detailKind}='source' and l.report_department_code<>'customer_service' and coalesce(l.source_code,'__none__')=${detailValue})
        or (${detailKind}='department_branch' and (coalesce(l.report_department_code,'__none__') || '|' || coalesce(l.report_branch_code,'__none__'))=${detailValue})
        or (${detailKind}='agent' and coalesce(l.current_assigned_to::text,'__none__')=${detailValue})
        or (${detailKind}='service' and l.report_department_code='customer_service')
      )
    `;
    const [countRow] = await sql<{ count: number }[]>`
      with effective_leads as (${effectiveLeads})
      select count(*)::int as count
      from effective_leads l
      where l.is_deleted=false
        and ${filtersSql}
        and (${detailQ || null}::text is null or concat_ws(' ',l.customer_name,l.phone,l.phone_normalized,l.car_name,l.source_name,l.source_code,l.status_label,l.notes,l.status_note,l.report_assigned_name,l.report_call_center_name,l.report_branch_name) ilike ${detailQ ? `%${detailQ}%` : null})
        and (${detailStatus || null}::text is null or l.status_label=${detailStatus || null})
        and ${detailMatch}
    `;
    const detailRows = await sql<any[]>`
      with effective_leads as (${effectiveLeads})
      select l.id::text,l.customer_name,l.phone,l.phone_normalized,l.source_code,l.source_name,
        l.report_department_code as department_code,l.report_branch_code as branch_code,
        l.status_label,l.car_name,l.notes,l.status_note,l.sold_quantity,l.sold_at,l.registered_at,l.created_at,l.updated_at,
        l.report_assigned_to::text as assigned_to,l.call_center_assigned_to::text,
        l.report_assigned_name as assigned_name,l.report_call_center_name as call_center_name,
        l.report_branch_name as branch_name,l.catalog_source_name,l.source_report_group
      from effective_leads l
      where l.is_deleted=false
        and ${filtersSql}
        and (${detailQ || null}::text is null or concat_ws(' ',l.customer_name,l.phone,l.phone_normalized,l.car_name,l.source_name,l.source_code,l.status_label,l.notes,l.status_note,l.report_assigned_name,l.report_call_center_name,l.report_branch_name) ilike ${detailQ ? `%${detailQ}%` : null})
        and (${detailStatus || null}::text is null or l.status_label=${detailStatus || null})
        and ${detailMatch}
      order by coalesce(l.registered_at,l.created_at) desc,l.updated_at desc
      limit ${detailPageSize} offset ${detailOffset}
    `;
    for (const lead of detailRows) {
      lead.source_name = sourceLabel(lead.source_code, lead.catalog_source_name || lead.source_name);
      lead.sold_quantity = norm(lead.status_label) === norm("تم البيع") ? Math.max(1, Number(lead.sold_quantity || 1)) : null;
      delete lead.catalog_source_name;
    }
    return response.status(200).json({ ok: true, rows: detailRows, total: Number(countRow?.count || 0), page: detailPage, pageSize: detailPageSize });
  }

  const leads = await sql<any[]>`
    with effective_leads as (${effectiveLeads})
    select l.id::text,l.customer_name,l.phone,l.phone_normalized,l.source_code,l.source_name,
      l.report_department_code as department_code,l.report_branch_code as branch_code,
      l.status_label,l.car_name,l.notes,l.status_note,l.sold_quantity,l.sold_at,l.registered_at,l.created_at,l.updated_at,
      l.report_assigned_to::text as assigned_to,l.call_center_assigned_to::text,
      l.assigned_is_call_center,l.has_active_erp_order,l.report_assigned_name as assigned_name,l.report_call_center_name as call_center_name,
      l.report_branch_name as branch_name,l.catalog_source_name,l.source_report_group,
      l.current_assigned_to::text,l.current_assigned_name,l.current_department_code,l.current_branch_code,l.current_branch_name,l.current_assigned_is_call_center
    from effective_leads l
    where l.is_deleted=false
      and ${filtersSql}
    order by coalesce(l.registered_at,l.created_at) desc,l.updated_at desc
  `;

  for (const lead of leads) {
    lead.source_name = sourceLabel(lead.source_code, lead.catalog_source_name || lead.source_name);
    lead.sold_quantity = norm(lead.status_label) === norm("تم البيع") ? Math.max(1, Number(lead.sold_quantity || 1)) : null;
    delete lead.catalog_source_name;
  }

  /*
   * Canonical sold metric: every report reads only crm.sales_transactions.
   * The transaction snapshot owns the sale date, quantity, representative,
   * department and branch. Leads are joined only for customer/search context.
   * ERP orders and lead sold_quantity are never added as parallel fallbacks.
   */
  const salesFacts = await sql<any[]>`
    select
      st.id::text as order_id,
      st.source_reference as sales_order_no,
      st.lead_id::text as lead_id,
      greatest(coalesce(st.quantity,1),1)::int as quantity,
      coalesce(st.total_amount,0)::float as total_amount,
      coalesce(st.source_code,l.source_code) as source_code,
      coalesce(src.name,st.source_name,l.source_name) as source_name,
      coalesce(src.report_group,'other') as source_report_group,
      st.department_code as department_code,
      case when st.department_code in ('wholesale','wholesale_sales') then null else st.branch_code end as branch_code,
      st.assigned_to::text as assigned_to,
      coalesce(st.assigned_name,u.full_name,'غير موزع') as assigned_name,
      coalesce(b.name,st.branch_code,'بدون فرع') as branch_name,
      l.assigned_to::text as current_assigned_to,
      coalesce(current_sales.full_name,l.responsible_name_snapshot,'غير موزع') as current_assigned_name,
      l.department_code as current_department_code,
      l.branch_code as current_branch_code,
      coalesce(current_branch.name,l.branch_code,'بدون فرع') as current_branch_name,
      false as assigned_is_call_center,
      st.sale_at
    from crm.sales_transactions st
    left join crm.leads l on l.id=st.lead_id and l.is_deleted=false
    left join core.sources src on src.code=coalesce(st.source_code,l.source_code)
    left join core.users u on u.id=st.assigned_to
    left join core.branches b on b.code=st.branch_code
    left join core.users current_sales on current_sales.id=l.assigned_to
    left join core.branches current_branch on current_branch.code=l.branch_code
    where coalesce(st.is_cancelled,false)=false
      and (${from || null}::date is null or ${manualSaleDateSql} >= ${from || null}::date)
      and (${to || null}::date is null or ${manualSaleDateSql} <= ${to || null}::date)
      and (
        ${scope.all}::boolean
        or (${scope.includeAssigned}::boolean and st.assigned_to=${scope.userId}::uuid)
        or (st.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or st.branch_code=any(${scope.branchCodes}::text[])))
      )
      and ${transactionDepartmentFilterSql}
      and (${branch || null}::text is null or st.branch_code=${branch || null})
      and (${agent || null}::uuid is null or st.assigned_to=${agent || null}::uuid)
      and (${callCenter || null}::uuid is null or l.call_center_assigned_to=${callCenter || null}::uuid)
      and (${source || null}::text is null or coalesce(st.source_code,l.source_code)=${source || null})
      and (${q || null}::text is null or concat_ws(' ',st.source_reference,l.customer_name,l.phone,st.assigned_name,u.full_name,b.name,st.department_code,st.source_name,l.source_name) ilike ${q ? `%${q}%` : null})
  `;

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

  const makeMetrics = (rows: any[], facts: any[] = []) => {
    const count = (set: Set<string>) => new Set(
      rows.filter((lead) => set.has(norm(lead.status_label))).map((lead) => String(lead.id || "")).filter(Boolean),
    ).size;
    const rowLeadIds = new Set(rows.map((lead) => String(lead.id || "")).filter(Boolean));
    const factOnlyLeadIds = new Set(facts.map((fact) => String(fact.lead_id || "")).filter((id) => id && !rowLeadIds.has(id)));
    const factOnlySoldCustomers = factOnlyLeadIds.size;
    const statusCountWithFactOnlySales = (set: Set<string>) => count(set) + (set.has(norm("تم البيع")) ? factOnlySoldCustomers : 0);
    const distinctCustomers = rowLeadIds.size + factOnlySoldCustomers;
    const soldCount = facts.reduce(
      (total, fact) => total + Math.max(1, Number(fact.quantity || 1)),
      0,
    );
    const marketingDen = quality.marketing_denominator_mode === "statuses" ? statusCountWithFactOnlySales(marketingDenStatuses) : distinctCustomers;
    const salesDen = quality.sales_denominator_mode === "all" ? distinctCustomers : statusCountWithFactOnlySales(salesDenStatuses);
    const total = quality.total_mode === "statuses" ? statusCountWithFactOnlySales(totalStatuses) : distinctCustomers;
    return {
      total,
      notContacted: count(notContactedStatuses),
      notQualified: rows.filter((lead) => norm(lead.status_label) === norm("غير مؤهل")).length,
      qualified: count(qualifiedStatuses),
      delayed: rows.filter((lead) => norm(lead.status_label) === norm("مؤجل")).length,
      potential: rows.filter((lead) => norm(lead.status_label) === norm("لم يتم الرد")).length,
      sold: soldCount,
      salesAmount: facts.reduce((total, fact) => total + Number(fact.total_amount || 0), 0),
      marketingQuality: percent(statusCountWithFactOnlySales(marketingNum), marketingDen),
      salesQuality: percent(statusCountWithFactOnlySales(salesNum), salesDen),
    };
  };

  const reportRows = leads.filter((row) => row.department_code !== "customer_service");
  const reportFacts = salesFacts.filter((fact) => fact.department_code !== "customer_service");

  if (summaryOnly) {
    return response.status(200).json({
      ok: true,
      filters: { from, to, q, department, branch, agent, callCenter, source },
      totals: makeMetrics(reportRows, reportFacts),
      quality: { ...quality, summary_cards: summaryCards },
    });
  }

  const group = (
    rows: any[],
    facts: any[],
    detailKindName: string,
    rowKey: (row: any) => string,
    rowLabel: (row: any) => string,
    factKey: (fact: any) => string,
    factLabel: (fact: any) => string,
  ) => {
    const map = new Map<string, { rows: any[]; facts: any[]; name: string }>();
    for (const row of rows) {
      const value = rowKey(row) || "__none__";
      if (!map.has(value)) map.set(value, { rows: [], facts: [], name: rowLabel(row) || "غير محدد" });
      map.get(value)!.rows.push(row);
    }
    for (const fact of facts) {
      const value = factKey(fact) || "__none__";
      if (!map.has(value)) map.set(value, { rows: [], facts: [], name: factLabel(fact) || "غير محدد" });
      map.get(value)!.facts.push(fact);
    }
    return [...map.entries()]
      .map(([groupDetailValue, grouped]) => ({ name: grouped.name, ...makeMetrics(grouped.rows, grouped.facts), detailKind: detailKindName, detailValue: groupDetailValue }))
      .sort((a, b) => b.total - a.total || b.sold - a.sold || a.name.localeCompare(b.name, "ar"));
  };

  const sourceRows = group(reportRows, reportFacts, "source", (row) => row.source_code || "__none__", (row) => sourceLabel(row.source_code, row.source_name), (fact) => fact.source_code || "__none__", (fact) => sourceLabel(fact.source_code, fact.source_name));
  const sourceGroup = (groupName: string) => {
    const groupRows = reportRows.filter((row) => row.source_report_group === groupName);
    const groupFacts = reportFacts.filter((fact) => fact.source_report_group === groupName);
    return {
      rows: group(groupRows, groupFacts, "source", (row) => row.source_code || "__none__", (row) => sourceLabel(row.source_code, row.source_name), (fact) => fact.source_code || "__none__", (fact) => sourceLabel(fact.source_code, fact.source_name)),
      summary: makeMetrics(groupRows, groupFacts),
    };
  };
  const digitalSources = sourceGroup("digital");
  const directSources = sourceGroup("direct");
  const otherSources = sourceGroup("other");
  const salesRows = reportRows.filter((row) => row.current_assigned_is_call_center !== true);
  const salesOnlyFacts = reportFacts.filter((fact) => fact.department_code !== "customer_service");
  const departments = group(salesRows, salesOnlyFacts, "department_branch", (row) => `${row.department_code || "__none__"}|${row.branch_code || "__none__"}`, (row) => `${departmentLabel(row.department_code)} - ${row.branch_name || row.branch_code || "بدون فرع"}`, (fact) => `${fact.department_code || "__none__"}|${fact.branch_code || "__none__"}`, (fact) => `${departmentLabel(fact.department_code)} - ${fact.branch_name || fact.branch_code || "بدون فرع"}`);

  const agentContext = new Map<string, { departments: Set<string>; branches: Set<string> }>();
  const rememberAgentContext = (item: any) => {
    const isSaleFact = Boolean(item.order_id);
    const key = String(isSaleFact ? (item.assigned_to || "__none__") : (item.current_assigned_to || "__none__"));
    if (!agentContext.has(key)) agentContext.set(key, { departments: new Set<string>(), branches: new Set<string>() });
    const context = agentContext.get(key)!;
    const departmentCode = isSaleFact ? item.department_code : item.current_department_code;
    if (departmentCode) context.departments.add(departmentLabel(departmentCode));
    const branchName = isSaleFact
      ? (item.branch_name || item.branch_code)
      : (item.current_branch_name || item.current_branch_code);
    if (branchName) context.branches.add(String(branchName));
  };
  salesRows.forEach(rememberAgentContext);
  salesOnlyFacts.forEach(rememberAgentContext);
  const agents = group(salesRows, salesOnlyFacts, "agent", (row) => row.current_assigned_to || "__none__", (row) => row.current_assigned_name || "غير موزع", (fact) => fact.assigned_to || "__none__", (fact) => fact.assigned_name || "غير موزع")
    .map((row) => {
      const context = agentContext.get(String(row.detailValue || "__none__"));
      return {
        ...row,
        department: context ? [...context.departments].sort((a, b) => a.localeCompare(b, "ar")).join("، ") : "غير محدد",
        branch: context ? [...context.branches].sort((a, b) => a.localeCompare(b, "ar")).join("، ") || "بدون فرع" : "بدون فرع",
      };
    })
    .sort((a, b) => Number(b.sold || 0) - Number(a.sold || 0) || Number(b.total || 0) - Number(a.total || 0) || a.name.localeCompare(b.name, "ar"));

  const serviceRows = leads.filter((row) => row.department_code === "customer_service");
  const serviceFacts = salesFacts.filter((fact) => fact.department_code === "customer_service");
  const serviceDone = serviceRows.filter((row) => [norm("تم الانتهاء"), norm("تم الإنتهاء")].includes(norm(row.status_label))).length;
  const service = {
    name: "خدمة العملاء",
    ...makeMetrics(serviceRows, serviceFacts),
    working: serviceRows.filter((row) => norm(row.status_label) === norm("جاري العمل")).length,
    done: serviceDone,
    quality: serviceRows.length ? Math.round((serviceDone / serviceRows.length) * 100) : 0,
    detailKind: "service",
    detailValue: "customer_service",
  };

  return response.status(200).json({
    ok: true,
    filters: { from, to, q, department, branch, agent, callCenter, source },
    totals: makeMetrics(reportRows, reportFacts),
    digitalSources: digitalSources.rows,
    directSources: directSources.rows,
    otherSources: otherSources.rows,
    sources: sourceRows,
    departments,
    agents,
    service,
    sectionSummaries: {
      digitalSources: digitalSources.summary,
      directSources: directSources.summary,
      otherSources: otherSources.summary,
      departments: makeMetrics(salesRows, salesOnlyFacts),
      agents: makeMetrics(salesRows, salesOnlyFacts),
    },
    quality: { ...quality, summary_cards: summaryCards },
  });
}
