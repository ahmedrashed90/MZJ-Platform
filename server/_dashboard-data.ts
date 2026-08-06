import { getSql } from "./_db.js";
import type { DashboardData } from "../src/types.js";
import type { SessionUser } from "./_auth.js";
import { canAccessSystem } from "../shared/system-access.js";
import { getSystemAccess } from "./_access-control.js";
import { getTrackingCountSummary } from "./_tracking-counts.js";
import { ensureCrmSchema } from "./_crm-schema.js";
import { operationsApprovalVisibilityScope, operationsRequestAccessScope, operationsRequestHasActiveVehicle } from "./_operations-query-scope.js";
import { operationsInventoryMetricCondition } from "./_operations-inventory-metrics.js";

const locationNames = [
  ["warehouse", "المستودع"],
  ["agency", "الوكالة"],
  ["hall", "الصالة"],
  ["qadisiyah", "القادسية"],
  ["multaqa", "الملتقى"],
] as const;

function emptyData(range: { from: string; to: string }): DashboardData {
  return {
    connected: false,
    generatedAt: new Date().toISOString(),
    range,
    sectionErrors: {},
    crm: { totalCustomers: null, openConversations: null, openCashConversations: null, openFinanceConversations: null, openServiceConversations: null, noAnswerCustomers: null, sold: null, cashSold: null, financeSold: null, cashSales: null, financeSales: null, customerService: null, newToday: null, newThisWeek: null, recentConversations: [], newCustomersSeries: [] },
    marketing: { campaigns: null, agendas: null, scheduled: null, delayed: null },
    tracking: { requests: null, inProgress: null, completed: null },
    operations: {
      inventory: { actualTotal: null, agency: null, availableForSale: null, reserved: null, reservedByLocation: [], underDelivery: null, delivered: null, hasNotes: null },
      locations: locationNames.map(([key, name]) => ({ key, name, actualTotal: null, underDelivery: null, availableForSale: null, reserved: null, delivered: null, hasNotes: null })),
      approvals: { total: null, missingFinancial: null, missingAdministrative: null, completed: null, recentNotes: [] },
      shortages: { total: null, multaqa: null, hall: null, qadisiyah: null },
      transfers: { total: null, transferTotal: null, photographyTotal: null, requestReceived: null, vehicleReceived: null, vehicleSent: null, completed: null },
      salesTracking: { total: null, notStarted: null, inProgress: null, completed: null },
    },
  };
}

function asNumber(value: unknown): number { return Number(value ?? 0); }
function errorText(error: unknown) { return error instanceof Error ? error.message : "تعذر تحميل القسم"; }

export async function getDashboardData(user: SessionUser, range: { from: string; to: string }): Promise<DashboardData> {
  const data = emptyData(range);
  const { from, to } = range;
  let sql: ReturnType<typeof getSql>;
  try {
    sql = getSql();
    await sql`select 1`;
    data.connected = true;
  } catch (error) {
    console.error("Dashboard database health check failed", error);
    return data;
  }

  if (canAccessSystem(user, "crm")) {
    try {
      await ensureCrmSchema();
      const crmAccess = getSystemAccess(user, "crm");
      const crmAll = crmAccess.dataScope === "all";
      const crmAssigned = ["self","assigned","created_by_me","workflow_assigned"].includes(crmAccess.dataScope);
      const crmBranches = crmAccess.branchCodes.length ? crmAccess.branchCodes : ["__none__"];
      const crmDepartments = crmAccess.departmentCodes.length ? crmAccess.departmentCodes : ["__none__"];
      const [[row], recent, series] = await Promise.all([
        sql<any[]>`with scoped_leads as (
          select * from crm.leads l
          where l.is_deleted=false
            and (coalesce(l.registered_at,l.created_at) at time zone 'Asia/Riyadh')::date between ${from}::date and ${to}::date
            and (${crmAll}=true or (${crmAssigned}=true and (l.assigned_to=${user.id}::uuid or l.call_center_assigned_to=${user.id}::uuid or l.created_by=${user.id}::uuid)) or (l.branch_code in ${sql(crmBranches)} and l.department_code in ${sql(crmDepartments)}))
        ), scoped_manual_sold as (
          select
            coalesce(st.department_code,l.department_code) as department_code,
            greatest(coalesce(st.quantity,1),1)::int as quantity
          from crm.sales_transactions st
          join crm.leads l on l.id=st.lead_id and l.is_deleted=false
          where coalesce(st.is_cancelled,false)=false
            and (st.sale_at at time zone 'Asia/Riyadh')::date between ${from}::date and ${to}::date
            and (${crmAll}=true or (${crmAssigned}=true and (st.assigned_to=${user.id}::uuid or l.call_center_assigned_to=${user.id}::uuid or l.created_by=${user.id}::uuid)) or (coalesce(st.branch_code,l.branch_code) in ${sql(crmBranches)} and coalesce(st.department_code,l.department_code) in ${sql(crmDepartments)}))
        ), scoped_erp_sold as (
          select
            coalesce(nullif(so.platform_department_code,''),sold_lead.department_code) as department_code,
            sum(coalesce(vehicle_stats.quantity,1))::int as quantity
          from integrations.erpnext_sales_orders so
          join crm.leads sold_lead on sold_lead.id=so.crm_lead_id and sold_lead.is_deleted=false
          left join lateral (
            select nullif(sum(greatest(coalesce(sov.qty,1),1)) filter(where coalesce(sov.is_cancelled,false)=false),0)::int as quantity
            from integrations.erpnext_sales_order_vehicles sov where sov.sales_order_id=so.id
          ) vehicle_stats on true
          where coalesce(so.is_cancelled,false)=false
            and coalesce(so.order_date,(so.received_at at time zone 'Asia/Riyadh')::date) between ${from}::date and ${to}::date
            and (
              ${crmAll}=true
              or (${crmAssigned}=true and (so.platform_user_id=${user.id}::uuid or sold_lead.call_center_assigned_to=${user.id}::uuid or sold_lead.created_by=${user.id}::uuid))
              or (coalesce(so.platform_branch_code,sold_lead.branch_code) in ${sql(crmBranches)} and coalesce(so.platform_department_code,sold_lead.department_code) in ${sql(crmDepartments)})
            )
          group by coalesce(nullif(so.platform_department_code,''),sold_lead.department_code)
        )
        select
          count(*)::int as total_customers,
          count(*) filter(where status_label='لم يتم الرد')::int as no_answer_customers,
          (
            coalesce((select sum(quantity) from scoped_erp_sold),0)
            + coalesce((select sum(quantity) from scoped_manual_sold),0)
          )::int as sold,
          (
            coalesce((select sum(quantity) from scoped_erp_sold where department_code in ('cash_sales','wholesale','wholesale_sales')),0)
            + coalesce((select sum(quantity) from scoped_manual_sold where department_code in ('cash_sales','wholesale','wholesale_sales')),0)
          )::int as cash_sold,
          (
            coalesce((select sum(quantity) from scoped_erp_sold where department_code in ('finance_sales','call_center')),0)
            + coalesce((select sum(quantity) from scoped_manual_sold where department_code in ('finance_sales','call_center')),0)
          )::int as finance_sold,
          count(*) filter(where department_code in ('cash_sales','wholesale','wholesale_sales'))::int as cash_sales,
          count(*) filter(where department_code in ('finance_sales','call_center'))::int as finance_sales,
          count(*) filter(where department_code='customer_service')::int as customer_service,
          count(*) filter(where (coalesce(registered_at,created_at) at time zone 'Asia/Riyadh')::date=(now() at time zone 'Asia/Riyadh')::date)::int as new_today,
          count(*) filter(where (coalesce(registered_at,created_at) at time zone 'Asia/Riyadh')::date>=date_trunc('week',now() at time zone 'Asia/Riyadh')::date)::int as new_this_week,
          (select count(*) from crm.conversations c join scoped_leads l on l.id=c.lead_id where c.status='open' and c.closed_at is null and coalesce(c.classification_state,'')<>'closed')::int as open_conversations,
          (select count(*) from crm.conversations c join scoped_leads l on l.id=c.lead_id where c.status='open' and c.closed_at is null and coalesce(c.classification_state,'')<>'closed' and coalesce(nullif(l.department_code,''),nullif(c.department_code,'')) in ('cash_sales','wholesale','wholesale_sales'))::int as open_cash_conversations,
          (select count(*) from crm.conversations c join scoped_leads l on l.id=c.lead_id where c.status='open' and c.closed_at is null and coalesce(c.classification_state,'')<>'closed' and coalesce(nullif(l.department_code,''),nullif(c.department_code,'')) in ('finance_sales','call_center'))::int as open_finance_conversations,
          (select count(*) from crm.conversations c join scoped_leads l on l.id=c.lead_id where c.status='open' and c.closed_at is null and coalesce(c.classification_state,'')<>'closed' and coalesce(nullif(l.department_code,''),nullif(c.department_code,''))='customer_service')::int as open_service_conversations
        from scoped_leads`,
        sql<any[]>`select c.id::text,coalesce(c.customer_name,l.customer_name,'عميل') as customer_name,coalesce(c.preview_text,'') as preview_text,c.last_message_at,coalesce(c.unread_count,0) as unread_count,coalesce(c.lead_id::text,'') as lead_id,coalesce(l.department_code,'') as department_code
          from crm.conversations c join crm.leads l on l.id=c.lead_id and l.is_deleted=false
          where (coalesce(c.last_message_at,c.updated_at) at time zone 'Asia/Riyadh')::date between ${from}::date and ${to}::date
            and (${crmAll}=true or (${crmAssigned}=true and (l.assigned_to=${user.id}::uuid or l.call_center_assigned_to=${user.id}::uuid or l.created_by=${user.id}::uuid)) or (l.branch_code in ${sql(crmBranches)} and l.department_code in ${sql(crmDepartments)}))
          order by c.last_message_at desc nulls last limit 5`,
        sql<any[]>`select to_char(day,'DD/MM') as label,count(l.id)::int as value
          from generate_series(${from}::date,${to}::date,interval '1 day') day
          left join crm.leads l on (coalesce(l.registered_at,l.created_at) at time zone 'Asia/Riyadh')::date=day::date and l.is_deleted=false
            and (${crmAll}=true or (${crmAssigned}=true and (l.assigned_to=${user.id}::uuid or l.call_center_assigned_to=${user.id}::uuid or l.created_by=${user.id}::uuid)) or (l.branch_code in ${sql(crmBranches)} and l.department_code in ${sql(crmDepartments)}))
          group by day order by day`,
      ]);
      data.crm = {
        totalCustomers: asNumber(row?.total_customers), openConversations: asNumber(row?.open_conversations), openCashConversations: asNumber(row?.open_cash_conversations), openFinanceConversations: asNumber(row?.open_finance_conversations), openServiceConversations: asNumber(row?.open_service_conversations), noAnswerCustomers: asNumber(row?.no_answer_customers), sold: asNumber(row?.sold), cashSold: asNumber(row?.cash_sold), financeSold: asNumber(row?.finance_sold), cashSales: asNumber(row?.cash_sales), financeSales: asNumber(row?.finance_sales), customerService: asNumber(row?.customer_service), newToday: asNumber(row?.new_today), newThisWeek: asNumber(row?.new_this_week),
        recentConversations: recent.map((item) => ({ id: item.id, customerName: item.customer_name, preview: item.preview_text, time: item.last_message_at ? new Date(item.last_message_at).toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" }) : "", unreadCount: asNumber(item.unread_count), leadId: item.lead_id, department: item.department_code === "finance_sales" || item.department_code === "call_center" ? "finance" : item.department_code === "customer_service" ? "service" : "cash" })),
        newCustomersSeries: series.map((item) => ({ label: item.label, value: asNumber(item.value) })),
      };
    } catch (error) { data.sectionErrors!.crm = errorText(error); console.error("Dashboard CRM query failed", error); }
  }

  if (canAccessSystem(user, "marketing")) {
    try {
      const marketingAccess = getSystemAccess(user, "marketing");
      const marketingAll = marketingAccess.dataScope === "all";
      const [[campaignRow], [agendaRow]] = await Promise.all([
        sql<any[]>`select count(*)::int as campaigns,count(*) filter(where status='scheduled')::int as scheduled,count(*) filter(where due_at<now() and status not in ('completed','archived'))::int as delayed
          from marketing.campaigns c
          where is_deleted=false
            and coalesce(c.campaign_date,(c.created_at at time zone 'Asia/Riyadh')::date) between ${from}::date and ${to}::date
            and (${marketingAll}=true or c.created_by=${user.id}::uuid or exists(select 1 from marketing.tasks t where t.campaign_id=c.id and (t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid)))`,
        sql<any[]>`select count(*)::int as agendas
          from marketing.agendas a
          where a.archived_at is null
            and coalesce(a.publish_start,(a.created_at at time zone 'Asia/Riyadh')::date) between ${from}::date and ${to}::date
            and (${marketingAll}=true or a.created_by=${user.id}::uuid or exists(select 1 from marketing.tasks t where t.source_type='agenda' and t.source_id=a.id and (t.assigned_to=${user.id}::uuid or t.paired_content_user_id=${user.id}::uuid)))`,
      ]);
      data.marketing = { campaigns: asNumber(campaignRow?.campaigns), agendas: asNumber(agendaRow?.agendas), scheduled: asNumber(campaignRow?.scheduled), delayed: asNumber(campaignRow?.delayed) };
    } catch (error) { data.sectionErrors!.marketing = errorText(error); console.error("Dashboard marketing query failed", error); }
  }

  if (canAccessSystem(user, "tracking")) {
    try {
      // The unified dashboard must mirror the Tracking system counters exactly,
      // so these figures intentionally use the canonical all-active-orders count
      // rather than the dashboard date range used by the other dashboard cards.
      const counts = await getTrackingCountSummary(sql, user);
      data.tracking = { requests: counts.total, inProgress: counts.inProgress, completed: counts.completed };
      data.operations.salesTracking = {
        total: counts.total,
        notStarted: counts.notStarted,
        inProgress: counts.inProgress,
        completed: counts.completed,
      };
    } catch (error) { data.sectionErrors!.tracking = errorText(error); console.error("Dashboard tracking query failed", error); }
  }

  if (canAccessSystem(user, "operations")) {
  try {
    const operationsAccess = getSystemAccess(user, "operations");
    const globalOperationsAccess = operationsAccess.dataScope === "all";
    const operationBranches = operationsAccess.branchCodes.length ? operationsAccess.branchCodes : ["__none__"];
    const operationStatusUnrestricted = !operationsAccess.vehicleStatusCodes?.length;
    const operationStatusCodes = operationsAccess.vehicleStatusCodes?.length ? operationsAccess.vehicleStatusCodes : ["__none__"];
    const canSeeMultaqa = globalOperationsAccess || operationBranches.includes("multaqa");
    const canSeeHall = globalOperationsAccess || operationBranches.includes("hall");
    const canSeeQadisiyah = globalOperationsAccess || operationBranches.includes("qadisiyah");
    const approvalVisibilityScope = operationsApprovalVisibilityScope(sql, user);
    const requestAccessScope = operationsRequestAccessScope(sql, user);
    const requestHasActiveVehicle = operationsRequestHasActiveVehicle(sql, user);
    const [locations, [inventory], [approval], [shortage], [transfer]] = await Promise.all([
      sql<any[]>`select l.code as key,l.name,
        count(v.id) filter(where ${operationsInventoryMetricCondition(sql, "actual_total")})::int as actual_total,
        count(v.id) filter(where ${operationsInventoryMetricCondition(sql, "under_delivery")})::int as under_delivery,
        count(v.id) filter(where ${operationsInventoryMetricCondition(sql, "available_for_sale")})::int as available_for_sale,
        count(v.id) filter(where ${operationsInventoryMetricCondition(sql, "reserved")})::int as reserved,
        count(v.id) filter(where ${operationsInventoryMetricCondition(sql, "delivered")})::int as delivered,
        count(v.id) filter(where ${operationsInventoryMetricCondition(sql, "has_notes")})::int as has_notes
        from operations.locations l
        left join operations.vehicles v on v.location_id=l.id
          and (${operationStatusUnrestricted}=true or v.status_code in ${sql(operationStatusCodes)})
        left join operations.vehicle_statuses s on s.code=v.status_code
        where l.is_active=true and (${globalOperationsAccess}=true or l.code in ${sql(operationBranches)} or l.branch_code in ${sql(operationBranches)})
        group by l.code,l.name,l.sort_order order by l.sort_order`,
      sql<any[]>`select
        count(*) filter(where ${operationsInventoryMetricCondition(sql, "actual_total")} and coalesce(l.code,'')<>'agency')::int as branch_actual_total,
        count(*) filter(where ${operationsInventoryMetricCondition(sql, "actual_total")} and l.code='agency')::int as agency,
        count(*) filter(where ${operationsInventoryMetricCondition(sql, "available_for_sale")})::int as available_for_sale,
        count(*) filter(where ${operationsInventoryMetricCondition(sql, "reserved")} and coalesce(l.code,'')<>'agency')::int as reserved,
        count(*) filter(where ${operationsInventoryMetricCondition(sql, "under_delivery")})::int as under_delivery,
        count(*) filter(where ${operationsInventoryMetricCondition(sql, "delivered")})::int as delivered,
        count(*) filter(where ${operationsInventoryMetricCondition(sql, "has_notes")})::int as has_notes
        from operations.vehicles v left join operations.locations l on l.id=v.location_id left join operations.vehicle_statuses s on s.code=v.status_code
        where (${globalOperationsAccess}=true or l.code in ${sql(operationBranches)} or l.branch_code in ${sql(operationBranches)})
          and (${operationStatusUnrestricted}=true or v.status_code in ${sql(operationStatusCodes)})`,
      sql<any[]>`with visible_approvals as (
          select a.id::text,a.financial_approved,a.administrative_approved,a.financial_note,a.administrative_note,a.updated_at,
            v.vin,coalesce(nullif(trim(v.car_name),''),'—') as car_name
          from operations.vehicle_approvals a
          join operations.vehicles v on v.id=a.vehicle_id
          left join operations.locations l on l.id=v.location_id
          where ${approvalVisibilityScope}
        )
        select
          count(*)::int as total,
          count(*) filter(where financial_approved=false)::int as missing_financial,
          count(*) filter(where administrative_approved=false)::int as missing_administrative,
          count(*) filter(where financial_approved=true and administrative_approved=true)::int as completed,
          coalesce((
            select json_agg(json_build_object(
              'id',note_row.id,
              'vin',note_row.vin,
              'carName',note_row.car_name,
              'financialNote',coalesce(note_row.financial_note,''),
              'administrativeNote',coalesce(note_row.administrative_note,''),
              'updatedAt',note_row.updated_at
            ) order by note_row.updated_at desc)
            from (
              select * from visible_approvals
              where nullif(trim(coalesce(financial_note,'')),'') is not null
                 or nullif(trim(coalesce(administrative_note,'')),'') is not null
              order by updated_at desc
              limit 3
            ) note_row
          ),'[]'::json) as recent_notes
        from visible_approvals`,
      sql<any[]>`with combinations as (
          select
            coalesce(nullif(trim(v.car_name),''),'—') as car_name,
            coalesce(nullif(trim(v.statement),''),'—') as statement,
            coalesce(nullif(trim(v.model_year),''),'—') as model_year,
            coalesce(nullif(trim(v.exterior_color),''),'—') as exterior_color,
            coalesce(nullif(trim(v.interior_color),''),'—') as interior_color,
            count(*) filter(where l.code='warehouse')::int as warehouse_qty,
            count(*) filter(where l.code='hall')::int as hall_qty,
            count(*) filter(where l.code='multaqa')::int as multaqa_qty,
            count(*) filter(where l.code='qadisiyah')::int as qadisiyah_qty
          from operations.vehicles v
          join operations.locations l on l.id=v.location_id
          where v.is_deleted=false and v.archived_at is null and v.is_inventory_active=true
            and v.status_code in ('available_for_sale','reserved','has_notes')
            and (${operationStatusUnrestricted}=true or v.status_code in ${sql(operationStatusCodes)})
            and l.code in ('warehouse','hall','multaqa','qadisiyah')
            and regexp_replace(coalesce(v.statement,''), '[[:space:]]+', '', 'g') !~* '(حساس|كاميرا|شاشة|مسجل|ريموت|فرشات|طفاية|شنطةسلامة|اسبير|إسبير)'
          group by coalesce(nullif(trim(v.car_name),''),'—'),coalesce(nullif(trim(v.statement),''),'—'),coalesce(nullif(trim(v.model_year),''),'—'),coalesce(nullif(trim(v.exterior_color),''),'—'),coalesce(nullif(trim(v.interior_color),''),'—')
        ), shortages as (
          select *,warehouse_qty+hall_qty+multaqa_qty+qadisiyah_qty as total_qty
          from combinations
        )
        select
          (count(*) filter(where multaqa_qty=0 and total_qty>0 and ${canSeeMultaqa}=true)
           + count(*) filter(where hall_qty=0 and total_qty>0 and ${canSeeHall}=true)
           + count(*) filter(where qadisiyah_qty=0 and total_qty>0 and ${canSeeQadisiyah}=true))::int as total,
          count(*) filter(where multaqa_qty=0 and total_qty>0 and ${canSeeMultaqa}=true)::int as multaqa,
          count(*) filter(where hall_qty=0 and total_qty>0 and ${canSeeHall}=true)::int as hall,
          count(*) filter(where qadisiyah_qty=0 and total_qty>0 and ${canSeeQadisiyah}=true)::int as qadisiyah
        from shortages`,
      sql<any[]>`select
          count(*)::int as total,
          count(*) filter(where r.request_kind='transfer')::int as transfer_total,
          count(*) filter(where r.request_kind='photography')::int as photography_total,
          count(*) filter(where r.status='request_received')::int as request_received,
          count(*) filter(where r.status='vehicle_received')::int as vehicle_received,
          count(*) filter(where r.status='vehicle_sent')::int as vehicle_sent,
          count(*) filter(where r.status='completed')::int as completed
        from operations.transfer_requests r
        where r.is_deleted=false
          and ${requestAccessScope}
          and (r.cancelled_at is not null or ${requestHasActiveVehicle})
          and (r.requested_at at time zone 'Asia/Riyadh')::date between ${from}::date and ${to}::date`,
    ]);
    data.operations.locations = locations.map((item) => ({ key: item.key, name: item.name, actualTotal: asNumber(item.actual_total), underDelivery: asNumber(item.under_delivery), availableForSale: asNumber(item.available_for_sale), reserved: asNumber(item.reserved), delivered: asNumber(item.delivered), hasNotes: asNumber(item.has_notes) }));
    const branchActualTotal = asNumber(inventory?.branch_actual_total);
    const agencyActualTotal = asNumber(inventory?.agency);
    data.operations.inventory = {
      actualTotal: branchActualTotal + agencyActualTotal,
      agency: agencyActualTotal,
      availableForSale: asNumber(inventory?.available_for_sale),
      reserved: asNumber(inventory?.reserved),
      reservedByLocation: data.operations.locations.filter((item) => item.key !== "agency").map((item) => ({ key: item.key, name: item.name, value: item.reserved })),
      underDelivery: asNumber(inventory?.under_delivery), delivered: asNumber(inventory?.delivered), hasNotes: asNumber(inventory?.has_notes),
    };
    if (!data.operations.locations.length) data.operations.locations = emptyData(range).operations.locations;
    data.operations.approvals = {
      total: asNumber(approval?.total),
      missingFinancial: asNumber(approval?.missing_financial),
      missingAdministrative: asNumber(approval?.missing_administrative),
      completed: asNumber(approval?.completed),
      recentNotes: (Array.isArray(approval?.recent_notes) ? approval.recent_notes : []).map((item: any) => ({
        id: String(item?.id || ""),
        vin: String(item?.vin || ""),
        carName: String(item?.carName || "—"),
        financialNote: String(item?.financialNote || ""),
        administrativeNote: String(item?.administrativeNote || ""),
        updatedAt: String(item?.updatedAt || ""),
      })),
    };
    data.operations.shortages = { total: asNumber(shortage?.total), multaqa: asNumber(shortage?.multaqa), hall: asNumber(shortage?.hall), qadisiyah: asNumber(shortage?.qadisiyah) };
    data.operations.transfers = { total: asNumber(transfer?.total), transferTotal: asNumber(transfer?.transfer_total), photographyTotal: asNumber(transfer?.photography_total), requestReceived: asNumber(transfer?.request_received), vehicleReceived: asNumber(transfer?.vehicle_received), vehicleSent: asNumber(transfer?.vehicle_sent), completed: asNumber(transfer?.completed) };
  } catch (error) { data.sectionErrors!.operations = errorText(error); console.error("Dashboard operations query failed", error); }
  }

  data.generatedAt = new Date().toISOString();
  return data;
}
