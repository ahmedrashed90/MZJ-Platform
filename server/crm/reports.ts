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

function reportBranchLabel(departmentCode: unknown, branchCode: unknown, branchName: unknown) {
  const department = String(departmentCode || "").trim().toLowerCase();
  const code = String(branchCode || "").trim().toLowerCase();
  const name = String(branchName || "").trim();
  if (["wholesale", "wholesale_sales"].includes(department) || ["wholesale", "wholesale_sales", "jumla", "jomla", "aljumla"].includes(code) || code.includes("wholesale")) return "فرع الجملة";
  if (name.startsWith("فرع ")) return name;
  if (code === "qadisiyah") return "فرع القادسية";
  if (code === "hall") return "فرع الصالة";
  if (code === "multaqa") return "فرع الملتقى";
  if (code === "online") return "فرع الاونلاين";
  if (name) return `فرع ${name}`;
  return code ? `فرع ${code}` : "بدون فرع";
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

function cleanList(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.flatMap((item) => String(item ?? "").split(",")).map((item) => clean(item)).filter(Boolean))];
}

function canonicalReportSourceCode(value: unknown) {
  const code = clean(value);
  if (["manual", "manual_entry", "manual-entry"].includes(code.toLowerCase())) return "branch";
  return code;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed" });
  const user = await requireCrmUser(request, response);
  if (!user) return;
  await ensureErpNextSalesOrderSchema();
  const sql = getSql();
  const scope = userScope(user);
  const leadReportSourceCodeSql = sql`
    case
      when lower(coalesce(l.source_code,'')) in ('manual','manual_entry','manual-entry') then 'branch'
      else l.source_code
    end
  `;
  const transactionReportSourceCodeSql = sql`
    case
      when lower(coalesce(st.source_code,l.source_code,'')) in ('manual','manual_entry','manual-entry') then 'branch'
      else coalesce(st.source_code,l.source_code)
    end
  `;
  const from = clean(request.query.from);
  const to = clean(request.query.to);
  const q = clean(request.query.q);
  const department = clean(request.query.department);
  const branch = clean(request.query.branch);
  const selectedAgentIds = cleanList(request.query.agent);
  const agent = selectedAgentIds.join(",");
  const callCenter = clean(request.query.callCenter);
  const source = canonicalReportSourceCode(request.query.source);
  const detailKind = clean(request.query.detailKind);
  const detailValue = clean(request.query.detailValue);
  const detailQ = clean(request.query.detailQ);
  const detailStatus = clean(request.query.detailStatus);
  const detailPage = boundedInt(request.query.detailPage, 1, 1, 100000);
  const detailPageSize = boundedInt(request.query.detailPageSize, 100, 10, 200);
  const summaryOnly = ["1", "true", "yes"].includes(clean(request.query.summaryOnly).toLowerCase());

  /*
   * NEXT ERP sales use the salesperson's primary CRM department/branch as the
   * reporting identity. Wholesale keeps its selected CRM branch, while historic
   * wholesale rows without a branch resolve to the master wholesale branch. This
   * prevents broad "allowed departments" memberships from
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
      current_effective.department_code as current_department_code,
      current_effective.branch_code as current_branch_code,
      coalesce(current_sales.full_name,l.responsible_name_snapshot) as current_assigned_name,
      current_branch.name as current_branch_name,
      (coalesce(current_effective.department_code,'')='call_center') as current_assigned_is_call_center,
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
      select b.code,b.name
      from core.branches b
      where b.is_active=true and (
        lower(coalesce(b.code,'')) in ('wholesale','wholesale_sales','jumla','jomla','aljumla')
        or lower(coalesce(b.code,'')) like '%wholesale%'
        or lower(coalesce(b.code,'')) like '%jumla%'
        or coalesce(b.name,'') ilike '%الجملة%'
      )
      order by case when coalesce(b.name,'') ilike '%الجملة%' then 0 else 1 end,b.sort_order,b.name
      limit 1
    ) wholesale_branch on true
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
              when primary_department.code in ('wholesale','wholesale_sales')
                then coalesce(nullif(l.branch_code,''),nullif(erp.platform_branch_code,''),primary_branch.code,wholesale_branch.code)
              when primary_department.code is not null
                then coalesce(primary_branch.code,nullif(l.branch_code,''),nullif(erp.platform_branch_code,''))
              else coalesce(nullif(erp.platform_branch_code,''),nullif(l.branch_code,''))
            end
          else coalesce(nullif(l.branch_code,''),nullif(erp.platform_branch_code,''))
        end as branch_code
    ) raw_effective on true
    left join core.branches raw_effective_branch on raw_effective_branch.code=raw_effective.branch_code
    left join core.branches raw_current_branch on raw_current_branch.code=l.branch_code
    left join lateral (
      select
        case
          when raw_effective.department_code in ('wholesale','wholesale_sales')
            or lower(coalesce(raw_effective.branch_code,'')) in ('wholesale','wholesale_sales','jumla','jomla','aljumla')
            or lower(coalesce(raw_effective.branch_code,'')) like '%wholesale%'
            or lower(coalesce(raw_effective.branch_code,'')) like '%jumla%'
            or coalesce(raw_effective_branch.name,'') ilike '%الجملة%'
          then 'wholesale'
          else raw_effective.department_code
        end as department_code,
        case
          when raw_effective.department_code in ('wholesale','wholesale_sales')
            or lower(coalesce(raw_effective.branch_code,'')) in ('wholesale','wholesale_sales','jumla','jomla','aljumla')
            or lower(coalesce(raw_effective.branch_code,'')) like '%wholesale%'
            or lower(coalesce(raw_effective.branch_code,'')) like '%jumla%'
            or coalesce(raw_effective_branch.name,'') ilike '%الجملة%'
          then coalesce(raw_effective.branch_code,wholesale_branch.code)
          else raw_effective.branch_code
        end as branch_code
    ) effective on true
    left join lateral (
      select
        case
          when l.department_code in ('wholesale','wholesale_sales')
            or lower(coalesce(l.branch_code,'')) in ('wholesale','wholesale_sales','jumla','jomla','aljumla')
            or lower(coalesce(l.branch_code,'')) like '%wholesale%'
            or lower(coalesce(l.branch_code,'')) like '%jumla%'
            or coalesce(raw_current_branch.name,'') ilike '%الجملة%'
          then 'wholesale'
          else l.department_code
        end as department_code,
        case
          when l.department_code in ('wholesale','wholesale_sales')
            or lower(coalesce(l.branch_code,'')) in ('wholesale','wholesale_sales','jumla','jomla','aljumla')
            or lower(coalesce(l.branch_code,'')) like '%wholesale%'
            or lower(coalesce(l.branch_code,'')) like '%jumla%'
            or coalesce(raw_current_branch.name,'') ilike '%الجملة%'
          then coalesce(nullif(l.branch_code,''),wholesale_branch.code)
          else nullif(l.branch_code,'')
        end as branch_code
    ) current_effective on true
    left join core.users sales on sales.id=actor.user_id
    left join core.users current_sales on current_sales.id=l.assigned_to
    left join core.branches current_branch on current_branch.code=current_effective.branch_code
    left join core.users cc on cc.id=l.call_center_assigned_to
    left join core.branches branch_row on branch_row.code=effective.branch_code
    left join core.sources src on src.code=(${leadReportSourceCodeSql})
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
  /*
   * crm.sales_transactions remains the canonical sold source. The selected CRM
   * branch is preserved for wholesale sales. Historic rows stored as cash sales
   * on the wholesale branch are normalised to the same wholesale identity so the
   * department/branch report does not split one team into two rows.
   */
  const wholesaleBranchFallbackSql = sql`
    (
      select branch_catalog.code
      from core.branches branch_catalog
      where branch_catalog.is_active=true and (
        lower(coalesce(branch_catalog.code,'')) in ('wholesale','wholesale_sales','jumla','jomla','aljumla')
        or lower(coalesce(branch_catalog.code,'')) like '%wholesale%'
        or lower(coalesce(branch_catalog.code,'')) like '%jumla%'
        or coalesce(branch_catalog.name,'') ilike '%الجملة%'
      )
      order by case when coalesce(branch_catalog.name,'') ilike '%الجملة%' then 0 else 1 end,branch_catalog.sort_order,branch_catalog.name
      limit 1
    )
  `;
  const transactionRawDepartmentCodeSql = sql`
    coalesce(nullif(st.department_code,''),nullif(l.department_code,''))
  `;
  const transactionWholesaleIdentitySql = sql`
    (
      case
        -- A sale transaction owns its attribution. The customer's current department
        -- is only a legacy fallback when the transaction has no department snapshot.
        when nullif(st.department_code,'') is not null
          then nullif(st.department_code,'') in ('wholesale','wholesale_sales')
        else (
          l.department_code in ('wholesale','wholesale_sales')
          or lower(coalesce(nullif(st.branch_code,''),assigned_primary_branch.code,nullif(l.branch_code,''),'')) in ('wholesale','wholesale_sales','jumla','jomla','aljumla')
          or lower(coalesce(nullif(st.branch_code,''),assigned_primary_branch.code,nullif(l.branch_code,''),'')) like '%wholesale%'
          or lower(coalesce(nullif(st.branch_code,''),assigned_primary_branch.code,nullif(l.branch_code,''),'')) like '%jumla%'
          or exists(
            select 1
            from core.branches transaction_branch
            where transaction_branch.code=coalesce(nullif(st.branch_code,''),assigned_primary_branch.code,nullif(l.branch_code,''))
              and coalesce(transaction_branch.name,'') ilike '%الجملة%'
          )
        )
      end
    )
  `;
  const transactionDepartmentCodeSql = sql`
    case
      when ${transactionWholesaleIdentitySql} then 'wholesale'
      else ${transactionRawDepartmentCodeSql}
    end
  `;
  const transactionBranchCodeSql = sql`
    case
      when ${transactionWholesaleIdentitySql}
        then coalesce(nullif(st.branch_code,''),nullif(l.branch_code,''),assigned_primary_branch.code,${wholesaleBranchFallbackSql})
      else coalesce(nullif(st.branch_code,''),assigned_primary_branch.code,nullif(l.branch_code,''))
    end
  `;
  const currentLeadWholesaleIdentitySql = sql`
    (
      l.department_code in ('wholesale','wholesale_sales')
      or lower(coalesce(l.branch_code,'')) in ('wholesale','wholesale_sales','jumla','jomla','aljumla')
      or lower(coalesce(l.branch_code,'')) like '%wholesale%'
      or lower(coalesce(l.branch_code,'')) like '%jumla%'
      or exists(
        select 1
        from core.branches current_lead_branch
        where current_lead_branch.code=l.branch_code
          and coalesce(current_lead_branch.name,'') ilike '%الجملة%'
      )
    )
  `;
  const currentLeadDepartmentCodeSql = sql`
    case when ${currentLeadWholesaleIdentitySql} then 'wholesale' else l.department_code end
  `;
  const currentLeadBranchCodeSql = sql`
    case
      when ${currentLeadWholesaleIdentitySql} then coalesce(nullif(l.branch_code,''),${wholesaleBranchFallbackSql})
      else nullif(l.branch_code,'')
    end
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
      or (${department || null}='cash' and (${transactionDepartmentCodeSql}) in ('cash_sales','wholesale','wholesale_sales'))
      or (${department || null}='finance' and (${transactionDepartmentCodeSql}) in ('finance_sales','call_center'))
      or (${department || null}='service' and (${transactionDepartmentCodeSql})='customer_service')
      or (${department || null}='call_center' and (${transactionDepartmentCodeSql})='call_center')
      or (${department || null}='wholesale' and (${transactionDepartmentCodeSql}) in ('wholesale','wholesale_sales'))
      or (${department || null} in ('cash_sales','finance_sales','customer_service') and (${transactionDepartmentCodeSql})=${department || null})
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
    and (${selectedAgentIds.length === 0}::boolean or l.current_assigned_to=any(${selectedAgentIds}::uuid[]))
    and (${callCenter || null}::uuid is null or l.call_center_assigned_to=${callCenter || null}::uuid)
    and (${source || null}::text is null or (${leadReportSourceCodeSql})=${source || null})
    and (${q || null}::text is null or concat_ws(' ',l.customer_name,l.phone,l.phone_normalized,l.car_name,l.source_name,l.source_code,l.status_label,l.notes,l.report_assigned_name,l.report_call_center_name,l.report_branch_name) ilike ${q ? `%${q}%` : null})
  `;

  if (detailKind) {
    if (!["source", "department_branch", "agent", "service"].includes(detailKind)) return response.status(400).json({ ok: false, error: "نوع تقرير العملاء غير صحيح" });
    const detailOffset = (detailPage - 1) * detailPageSize;

    const detailMatch = sql`
      (
        (${detailKind}='source' and l.report_department_code<>'customer_service' and coalesce((${leadReportSourceCodeSql}),'__none__')=${detailValue})
        or (${detailKind}='department_branch' and (coalesce(l.report_department_code,'__none__') || '|' || coalesce(l.report_branch_code,'__none__'))=${detailValue})
        or (${detailKind}='agent' and coalesce(l.current_assigned_to::text,'__none__')=${detailValue})
        or (${detailKind}='service' and l.report_department_code='customer_service')
      )
    `;

    /*
     * The sold drill-down is transaction-based end to end. The selected month
     * arrives as its first/last calendar day in `from`/`to`, so only sales whose
     * canonical sale_at falls inside that exact period are returned. Source,
     * department and branch attribution also come from the same sale transaction
     * identity used by the report totals; the lead's current status/update date
     * never decides whether a sold customer belongs to the selected month.
     */
    if (detailStatus === "تم البيع" && Boolean(from || to) && ["source", "department_branch"].includes(detailKind)) {
      const soldDetailMatchSql = detailKind === "source"
        ? sql`
            (${transactionDepartmentCodeSql})<>'customer_service'
            and coalesce((${transactionReportSourceCodeSql}),'__none__')=${detailValue}
          `
        : sql`
            (coalesce((${transactionDepartmentCodeSql}),'__none__') || '|' || coalesce((${transactionBranchCodeSql}),'__none__'))=${detailValue}
          `;

      const soldDetailRows = await sql<any[]>`
        with effective_leads as (${effectiveLeads}),
        in_period_sales as (
          select
            st.lead_id,
            coalesce(sum(greatest(coalesce(st.quantity,1),1)),0)::int as sold_quantity,
            max(st.sale_at) as last_sale_at
          from crm.sales_transactions st
          join effective_leads l on l.id=st.lead_id and l.is_deleted=false
          left join lateral (
            select b.code,b.name
            from core.user_system_branches usb
            join core.branches b on b.id=usb.branch_id and b.is_active=true
            where usb.user_id=coalesce(st.assigned_to,l.assigned_to) and usb.system_code='crm'
            order by usb.is_primary desc,b.sort_order,b.name
            limit 1
          ) assigned_primary_branch on true
          where coalesce(st.is_cancelled,false)=false
            and (${from || null}::date is null or ${manualSaleDateSql}>=${from || null}::date)
            and (${to || null}::date is null or ${manualSaleDateSql}<=${to || null}::date)
            and (
              ${scope.all}::boolean
              or (${scope.includeAssigned}::boolean and st.assigned_to=${scope.userId}::uuid)
              or ((${transactionDepartmentCodeSql})=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or (${transactionBranchCodeSql})=any(${scope.branchCodes}::text[])))
            )
            and ${transactionDepartmentFilterSql}
            and (${branch || null}::text is null or (${transactionBranchCodeSql})=${branch || null})
            and (${selectedAgentIds.length === 0}::boolean or st.assigned_to=any(${selectedAgentIds}::uuid[]))
            and (${callCenter || null}::uuid is null or l.call_center_assigned_to=${callCenter || null}::uuid)
            and (${source || null}::text is null or (${transactionReportSourceCodeSql})=${source || null})
            and (${q || null}::text is null or concat_ws(' ',st.source_reference,l.customer_name,l.phone,st.assigned_name,l.report_assigned_name,assigned_primary_branch.name,${transactionBranchCodeSql},${transactionDepartmentCodeSql},st.source_name,l.source_name) ilike ${q ? `%${q}%` : null})
            and ${soldDetailMatchSql}
          group by st.lead_id
        )
        select
          l.id::text,l.customer_name,l.phone,l.phone_normalized,l.source_code,l.source_name,
          l.report_department_code as department_code,l.report_branch_code as branch_code,
          'تم البيع'::text as status_label,l.car_name,l.notes,l.status_note,s.sold_quantity,s.last_sale_at as sold_at,l.registered_at,l.created_at,l.updated_at,
          l.report_assigned_to::text as assigned_to,l.call_center_assigned_to::text,
          l.report_assigned_name as assigned_name,l.report_call_center_name as call_center_name,
          l.report_branch_name as branch_name,l.catalog_source_name,l.source_report_group,
          (count(*) over())::int as total_count
        from in_period_sales s
        join effective_leads l on l.id=s.lead_id
        where (${detailQ || null}::text is null or concat_ws(' ',l.customer_name,l.phone,l.phone_normalized,l.car_name,l.source_name,l.source_code,l.notes,l.status_note,l.report_assigned_name,l.report_call_center_name,l.report_branch_name) ilike ${detailQ ? `%${detailQ}%` : null})
        order by s.last_sale_at desc,l.updated_at desc,coalesce(l.registered_at,l.created_at) desc
        limit ${detailPageSize} offset ${detailOffset}
      `;
      const detailTotal = Number(soldDetailRows[0]?.total_count || 0);
      for (const lead of soldDetailRows) {
        lead.source_code = canonicalReportSourceCode(lead.source_code);
        lead.source_name = sourceLabel(lead.source_code, lead.catalog_source_name || lead.source_name);
        lead.sold_quantity = Math.max(1, Number(lead.sold_quantity || 1));
        delete lead.catalog_source_name;
        delete lead.total_count;
      }
      return response.status(200).json({ ok: true, rows: soldDetailRows, total: detailTotal, page: detailPage, pageSize: detailPageSize });
    }

    // Sold representative drill-down follows the sale transaction owner, not the
    // customer's current CRM owner. This keeps the detail list aligned with the
    // representative sold totals and lets the same customer appear under different
    // salespeople for their own independent sale transactions.
    if (detailKind === "agent" && detailStatus === "تم البيع") {
      const soldAgentDetailRows = await sql<any[]>`
        with effective_leads as (${effectiveLeads}),
        agent_sale_rows as (
          select
            st.lead_id,
            greatest(coalesce(st.quantity,1),1)::int as quantity,
            coalesce(st.total_amount,0)::float as total_sales_amount,
            st.source_reference as reference_no,
            st.sale_at,
            st.assigned_to::text as assigned_to,
            (${transactionDepartmentCodeSql}) as department_code,
            (${transactionBranchCodeSql}) as branch_code,
            coalesce(transaction_branch.name,(${transactionBranchCodeSql}),'بدون فرع') as branch_name,
            coalesce(st.assigned_name,sold_user.full_name,'غير موزع') as assigned_name
          from crm.sales_transactions st
          join effective_leads l on l.id=st.lead_id and l.is_deleted=false
          left join core.users sold_user on sold_user.id=st.assigned_to
          left join lateral (
            select b.code,b.name
            from core.user_system_branches usb
            join core.branches b on b.id=usb.branch_id and b.is_active=true
            where usb.user_id=coalesce(st.assigned_to,l.assigned_to) and usb.system_code='crm'
            order by usb.is_primary desc,b.sort_order,b.name
            limit 1
          ) assigned_primary_branch on true
          left join core.branches transaction_branch on transaction_branch.code=(${transactionBranchCodeSql})
          where coalesce(st.is_cancelled,false)=false
            and coalesce(st.assigned_to::text,'__none__')=${detailValue}
            and (${from || null}::date is null or ${manualSaleDateSql}>=${from || null}::date)
            and (${to || null}::date is null or ${manualSaleDateSql}<=${to || null}::date)
            and (
              ${scope.all}::boolean
              or (${scope.includeAssigned}::boolean and st.assigned_to=${scope.userId}::uuid)
              or ((${transactionDepartmentCodeSql})=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or (${transactionBranchCodeSql})=any(${scope.branchCodes}::text[])))
            )
            and ${transactionDepartmentFilterSql}
            and (${branch || null}::text is null or (${transactionBranchCodeSql})=${branch || null})
            and (${selectedAgentIds.length === 0}::boolean or st.assigned_to=any(${selectedAgentIds}::uuid[]))
            and (${callCenter || null}::uuid is null or l.call_center_assigned_to=${callCenter || null}::uuid)
            and (${source || null}::text is null or (${transactionReportSourceCodeSql})=${source || null})
            and (${q || null}::text is null or concat_ws(' ',st.source_reference,l.customer_name,l.phone,st.assigned_name,sold_user.full_name,transaction_branch.name,${transactionBranchCodeSql},${transactionDepartmentCodeSql},st.source_name,l.source_name) ilike ${q ? `%${q}%` : null})
        ),
        agent_sales as (
          select
            lead_id,
            coalesce(sum(quantity),0)::int as sold_quantity,
            coalesce(sum(total_sales_amount),0)::float as total_sales_amount,
            string_agg(distinct reference_no, ', ' order by reference_no) filter(where nullif(reference_no,'') is not null) as sales_order_numbers,
            max(sale_at) as last_sale_at,
            (array_agg(assigned_to order by sale_at desc))[1] as assigned_to,
            (array_agg(department_code order by sale_at desc))[1] as department_code,
            (array_agg(branch_code order by sale_at desc))[1] as branch_code,
            (array_agg(branch_name order by sale_at desc))[1] as branch_name,
            (array_agg(assigned_name order by sale_at desc))[1] as assigned_name
          from agent_sale_rows
          group by lead_id
        )
        select
          l.id::text,l.customer_name,l.phone,l.phone_normalized,l.source_code,l.source_name,
          s.department_code,s.branch_code,
          'تم البيع'::text as status_label,l.car_name,l.notes,
          concat_ws(' · ',nullif(l.status_note,''),case when s.sales_order_numbers is not null then 'طلبات البيع: '||s.sales_order_numbers end) as status_note,
          s.sold_quantity,s.last_sale_at as sold_at,l.registered_at,l.created_at,coalesce(l.updated_at,l.created_at) as updated_at,
          s.assigned_to,s.assigned_name,
          l.call_center_assigned_to::text,l.report_call_center_name as call_center_name,
          s.branch_name,l.catalog_source_name,l.source_report_group,
          s.sales_order_numbers,s.total_sales_amount,s.last_sale_at,
          (count(*) over())::int as total_count
        from agent_sales s
        join effective_leads l on l.id=s.lead_id
        where (${detailQ || null}::text is null or concat_ws(' ',l.customer_name,l.phone,l.phone_normalized,l.car_name,l.source_name,l.source_code,l.notes,l.status_note,s.assigned_name,s.branch_name,s.sales_order_numbers) ilike ${detailQ ? `%${detailQ}%` : null})
        order by s.last_sale_at desc,coalesce(l.registered_at,l.created_at) desc,coalesce(l.updated_at,l.created_at) desc
        limit ${detailPageSize} offset ${detailOffset}
      `;
      const detailTotal = Number(soldAgentDetailRows[0]?.total_count || 0);
      for (const lead of soldAgentDetailRows) {
        lead.source_code = canonicalReportSourceCode(lead.source_code);
        lead.source_name = sourceLabel(lead.source_code, lead.catalog_source_name || lead.source_name);
        lead.sold_quantity = Math.max(1, Number(lead.sold_quantity || 1));
        delete lead.catalog_source_name;
        delete lead.total_count;
      }
      return response.status(200).json({ ok: true, rows: soldAgentDetailRows, total: detailTotal, page: detailPage, pageSize: detailPageSize });
    }

    // Non-sold representative drill-down continues to follow the customer's
    // current CRM owner. Only sold details use the transaction salesperson above.
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
          left join lateral (
            select b.code,b.name
            from core.user_system_branches usb
            join core.branches b on b.id=usb.branch_id and b.is_active=true
            where usb.user_id=coalesce(st.assigned_to,l.assigned_to) and usb.system_code='crm'
            order by usb.is_primary desc,b.sort_order,b.name
            limit 1
          ) assigned_primary_branch on true
          where coalesce(st.is_cancelled,false)=false
            and coalesce(l.current_assigned_to::text,'__none__')=${detailValue}
            and (${from || null}::date is null or ${manualSaleDateSql}>=${from || null}::date)
            and (${to || null}::date is null or ${manualSaleDateSql}<=${to || null}::date)
            and ${scopeSql}
            and ${currentLeadDepartmentFilterSql}
            and (${branch || null}::text is null or (${transactionBranchCodeSql})=${branch || null})
            and (${selectedAgentIds.length === 0}::boolean or l.current_assigned_to=any(${selectedAgentIds}::uuid[]))
            and (${callCenter || null}::uuid is null or l.call_center_assigned_to=${callCenter || null}::uuid)
            and (${source || null}::text is null or (${transactionReportSourceCodeSql})=${source || null})
            and (${q || null}::text is null or concat_ws(' ',st.source_reference,l.customer_name,l.phone,l.current_assigned_name,assigned_primary_branch.name,${transactionBranchCodeSql},l.current_department_code,st.source_name,l.source_name) ilike ${q ? `%${q}%` : null})
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
            and (${selectedAgentIds.length === 0}::boolean or l.current_assigned_to=any(${selectedAgentIds}::uuid[]))
            and (${callCenter || null}::uuid is null or l.call_center_assigned_to=${callCenter || null}::uuid)
            and (${source || null}::text is null or (${leadReportSourceCodeSql})=${source || null})
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
          and (${detailStatus || null}::text is distinct from 'تم البيع' or result_rows.last_sale_at is not null)
        order by last_sale_at desc nulls last,coalesce(registered_at,created_at) desc,updated_at desc
        limit ${detailPageSize} offset ${detailOffset}
      `;
      const detailTotal = Number(agentDetailRows[0]?.total_count || 0);
      for (const lead of agentDetailRows) {
        lead.source_code = canonicalReportSourceCode(lead.source_code);
        lead.source_name = sourceLabel(lead.source_code, lead.catalog_source_name || lead.source_name);
        lead.sold_quantity = lead.sold_quantity == null ? null : Math.max(1, Number(lead.sold_quantity || 1));
        delete lead.catalog_source_name;
        delete lead.total_count;
      }
      return response.status(200).json({ ok: true, rows: agentDetailRows, total: detailTotal, page: detailPage, pageSize: detailPageSize });
    }

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
      lead.source_code = canonicalReportSourceCode(lead.source_code);
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
    lead.source_code = canonicalReportSourceCode(lead.source_code);
    lead.source_name = sourceLabel(lead.source_code, lead.catalog_source_name || lead.source_name);
    lead.sold_quantity = norm(lead.status_label) === norm("تم البيع") ? Math.max(1, Number(lead.sold_quantity || 1)) : null;
    delete lead.catalog_source_name;
  }

  /*
   * Canonical sold metric: every report reads only crm.sales_transactions.
   * The transaction snapshot owns the sale date, quantity, representative and
   * department. A missing historic branch snapshot is resolved consistently from
   * the representative's primary CRM branch, then the linked lead branch.
   * ERP orders and lead sold_quantity are never added as parallel fallbacks.
   */
  const salesFacts = await sql<any[]>`
    select
      st.id::text as order_id,
      st.source_reference as sales_order_no,
      st.lead_id::text as lead_id,
      greatest(coalesce(st.quantity,1),1)::int as quantity,
      coalesce(st.total_amount,0)::float as total_amount,
      (${transactionReportSourceCodeSql}) as source_code,
      coalesce(src.name,st.source_name,l.source_name) as source_name,
      coalesce(src.report_group,'other') as source_report_group,
      (${transactionDepartmentCodeSql}) as department_code,
      (${transactionBranchCodeSql}) as branch_code,
      st.assigned_to::text as assigned_to,
      coalesce(st.assigned_name,u.full_name,'غير موزع') as assigned_name,
      coalesce(b.name,(${transactionBranchCodeSql}),'بدون فرع') as branch_name,
      l.assigned_to::text as current_assigned_to,
      coalesce(current_sales.full_name,l.responsible_name_snapshot,'غير موزع') as current_assigned_name,
      (${currentLeadDepartmentCodeSql}) as current_department_code,
      (${currentLeadBranchCodeSql}) as current_branch_code,
      coalesce(current_branch.name,(${currentLeadBranchCodeSql}),'بدون فرع') as current_branch_name,
      false as assigned_is_call_center,
      st.sale_at
    from crm.sales_transactions st
    left join crm.leads l on l.id=st.lead_id and l.is_deleted=false
    left join lateral (
      select branch_row.code,branch_row.name
      from core.user_system_branches usb
      join core.branches branch_row on branch_row.id=usb.branch_id and branch_row.is_active=true
      where usb.user_id=coalesce(st.assigned_to,l.assigned_to) and usb.system_code='crm'
      order by usb.is_primary desc,branch_row.sort_order,branch_row.name
      limit 1
    ) assigned_primary_branch on true
    left join core.sources src on src.code=(${transactionReportSourceCodeSql})
    left join core.users u on u.id=st.assigned_to
    left join core.branches b on b.code=(${transactionBranchCodeSql})
    left join core.users current_sales on current_sales.id=l.assigned_to
    left join core.branches current_branch on current_branch.code=(${currentLeadBranchCodeSql})
    where coalesce(st.is_cancelled,false)=false
      and (${from || null}::date is null or ${manualSaleDateSql} >= ${from || null}::date)
      and (${to || null}::date is null or ${manualSaleDateSql} <= ${to || null}::date)
      and (
        ${scope.all}::boolean
        or (${scope.includeAssigned}::boolean and st.assigned_to=${scope.userId}::uuid)
        or ((${transactionDepartmentCodeSql})=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or (${transactionBranchCodeSql})=any(${scope.branchCodes}::text[])))
      )
      and ${transactionDepartmentFilterSql}
      and (${branch || null}::text is null or (${transactionBranchCodeSql})=${branch || null})
      and (${selectedAgentIds.length === 0}::boolean or st.assigned_to=any(${selectedAgentIds}::uuid[]))
      and (${callCenter || null}::uuid is null or l.call_center_assigned_to=${callCenter || null}::uuid)
      and (${source || null}::text is null or (${transactionReportSourceCodeSql})=${source || null})
      and (${q || null}::text is null or concat_ws(' ',st.source_reference,l.customer_name,l.phone,st.assigned_name,u.full_name,b.name,${transactionBranchCodeSql},${transactionDepartmentCodeSql},st.source_name,l.source_name) ilike ${q ? `%${q}%` : null})
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
      .sort((a, b) => b.sold - a.sold || b.total - a.total || a.name.localeCompare(b.name, "ar"));
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
  const departmentContext = new Map<string, { departmentCode: string; branchCode: string; branchName: string }>();
  for (const row of [...salesRows, ...salesOnlyFacts]) {
    const key = `${row.department_code || "__none__"}|${row.branch_code || "__none__"}`;
    if (!departmentContext.has(key)) departmentContext.set(key, { departmentCode: String(row.department_code || ""), branchCode: String(row.branch_code || ""), branchName: String(row.branch_name || "") });
  }
  const departments = group(salesRows, salesOnlyFacts, "department_branch", (row) => `${row.department_code || "__none__"}|${row.branch_code || "__none__"}`, (row) => `${departmentLabel(row.department_code)} - ${reportBranchLabel(row.department_code, row.branch_code, row.branch_name)}`, (fact) => `${fact.department_code || "__none__"}|${fact.branch_code || "__none__"}`, (fact) => `${departmentLabel(fact.department_code)} - ${reportBranchLabel(fact.department_code, fact.branch_code, fact.branch_name)}`)
    .map((row) => {
      const context = departmentContext.get(row.detailValue);
      const [departmentCode = "", branchCode = ""] = String(row.detailValue || "").split("|");
      const normalizedDepartmentCode = context?.departmentCode || (departmentCode === "__none__" ? "" : departmentCode);
      const normalizedBranchCode = context?.branchCode || (branchCode === "__none__" ? "" : branchCode);
      const department = departmentLabel(normalizedDepartmentCode);
      const branch = reportBranchLabel(normalizedDepartmentCode, normalizedBranchCode, context?.branchName || "");
      return { ...row, name: `${department} - ${branch}`, department, branch };
    })
    .filter((row) => !(norm(row.department) === norm("قسم الجملة") && norm(row.branch) === norm("فرع القادسية")));

  /*
   * Representative identity is profile data, not a historical sales dimension.
   * Keep sold metrics attributed to crm.sales_transactions exactly as-is, while
   * rendering each representative with only their primary CRM department/branch.
   * This prevents old transactions or cross-system access from adding extra
   * departments/branches to the representative row.
   */
  const agentIds = [...new Set([
    ...salesRows.map((row) => String(row.current_assigned_to || "").trim()),
    ...salesOnlyFacts.map((fact) => String(fact.assigned_to || "").trim()),
  ].filter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))];

  const agentIdentityRows = agentIds.length ? await sql<any[]>`
    select
      u.id::text as user_id,
      primary_department.code as department_code,
      primary_department.name as department_name,
      primary_branch.code as branch_code,
      primary_branch.name as branch_name
    from core.users u
    left join lateral (
      select d.code,d.name
      from core.user_system_departments usd
      join core.departments d on d.id=usd.department_id and d.system_code='crm' and d.is_active=true
      where usd.user_id=u.id and usd.system_code='crm' and usd.is_primary=true
      order by d.created_at,d.code
      limit 1
    ) primary_department on true
    left join lateral (
      select b.code,b.name
      from core.user_system_branches usb
      join core.branches b on b.id=usb.branch_id and b.is_active=true
      where usb.user_id=u.id and usb.system_code='crm' and usb.is_primary=true
      order by b.sort_order,b.name
      limit 1
    ) primary_branch on true
    where u.id=any(${agentIds}::uuid[])
  ` : [];

  const agentIdentity = new Map<string, { department: string; branch: string }>();
  for (const item of agentIdentityRows) {
    agentIdentity.set(String(item.user_id), {
      department: String(item.department_name || item.department_code || "").trim(),
      branch: String(item.branch_name || item.branch_code || "").trim(),
    });
  }

  // Fallback only to the customer's current CRM ownership; never to sale-history context.
  const currentAgentContext = new Map<string, { department: string; branch: string }>();
  for (const item of salesRows) {
    const key = String(item.current_assigned_to || "__none__");
    const current = currentAgentContext.get(key) || { department: "", branch: "" };
    if (!current.department && item.current_department_code) current.department = departmentLabel(item.current_department_code);
    if (!current.branch) current.branch = String(item.current_branch_name || item.current_branch_code || "").trim();
    currentAgentContext.set(key, current);
  }

  const agents = group(salesRows, salesOnlyFacts, "agent", (row) => row.current_assigned_to || "__none__", (row) => row.current_assigned_name || "غير موزع", (fact) => fact.assigned_to || "__none__", (fact) => fact.assigned_name || "غير موزع")
    .map((row) => {
      const key = String(row.detailValue || "__none__");
      const identity = agentIdentity.get(key);
      const fallback = currentAgentContext.get(key);
      return {
        ...row,
        department: identity?.department || fallback?.department || "غير محدد",
        branch: identity?.branch || fallback?.branch || "بدون فرع",
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
