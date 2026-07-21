import { getSql } from "./_db.js";
import type { DashboardData } from "../src/types.js";
import type { SessionUser } from "./_auth.js";

const locationNames = [
  ["warehouse", "المستودع"],
  ["agency", "الوكالة"],
  ["hall", "الصالة"],
  ["qadisiyah", "القادسية"],
  ["multaqa", "الملتقى"],
] as const;

function emptyData(): DashboardData {
  return {
    connected: false,
    generatedAt: new Date().toISOString(),
    sectionErrors: {},
    crm: { totalCustomers: null, openConversations: null, noAnswerCustomers: null, sold: null, cashSales: null, financeSales: null, customerService: null, newToday: null, newThisWeek: null, recentConversations: [], newCustomersSeries: [] },
    marketing: { campaigns: null, scheduled: null, delayed: null },
    tracking: { requests: null, inProgress: null, completed: null },
    operations: {
      inventory: { actualTotal: null, agency: null, availableForSale: null, reserved: null, underDelivery: null, delivered: null, hasNotes: null },
      locations: locationNames.map(([key, name]) => ({ key, name, actualTotal: null, underDelivery: null, availableForSale: null, reserved: null, delivered: null, hasNotes: null })),
      approvals: { total: null, missingFinancial: null, missingAdministrative: null, completed: null },
      shortages: { total: null, multaqa: null, hall: null, qadisiyah: null },
      transfers: { total: null, transferTotal: null, photographyTotal: null, requestReceived: null, vehicleReceived: null, vehicleSent: null, completed: null },
      salesTracking: { total: null, notStarted: null, inProgress: null, completed: null },
    },
  };
}

function asNumber(value: unknown): number { return Number(value ?? 0); }
function errorText(error: unknown) { return error instanceof Error ? error.message : "تعذر تحميل القسم"; }

export async function getDashboardData(user: SessionUser): Promise<DashboardData> {
  const data = emptyData();
  let sql: ReturnType<typeof getSql>;
  try {
    sql = getSql();
    await sql`select 1`;
    data.connected = true;
  } catch (error) {
    console.error("Dashboard database health check failed", error);
    return data;
  }

  try {
    const [[row], recent, series] = await Promise.all([
      sql<any[]>`select
        (select count(*) from crm.leads where is_deleted=false) as total_customers,
        (select count(*) from crm.conversations where status='open') as open_conversations,
        (select count(*) from crm.leads where status_label='لم يتم الرد' and is_deleted=false) as no_answer_customers,
        (select count(*) from crm.leads where status_label='تم البيع' and is_deleted=false) as sold,
        (select count(*) from crm.leads where department_code='cash_sales' and is_deleted=false) as cash_sales,
        (select count(*) from crm.leads where department_code in ('finance_sales','call_center') and is_deleted=false) as finance_sales,
        (select count(*) from crm.leads where department_code='customer_service' and is_deleted=false) as customer_service,
        (select count(*) from crm.leads where (coalesce(registered_at,created_at) at time zone 'Asia/Riyadh')::date=(now() at time zone 'Asia/Riyadh')::date and is_deleted=false) as new_today,
        (select count(*) from crm.leads where (coalesce(registered_at,created_at) at time zone 'Asia/Riyadh')::date>=date_trunc('week',now() at time zone 'Asia/Riyadh')::date and is_deleted=false) as new_this_week`,
      sql<any[]>`select c.id::text,coalesce(c.customer_name,l.customer_name,'عميل') as customer_name,coalesce(c.preview_text,'') as preview_text,c.last_message_at,coalesce(c.unread_count,0) as unread_count,coalesce(c.lead_id::text,'') as lead_id,coalesce(l.department_code,'') as department_code from crm.conversations c left join crm.leads l on l.id=c.lead_id and l.is_deleted=false order by c.last_message_at desc nulls last limit 5`,
      sql<any[]>`select to_char(day,'DD/MM') as label,count(l.id)::int as value from generate_series((now() at time zone 'Asia/Riyadh')::date-interval '6 days',(now() at time zone 'Asia/Riyadh')::date,interval '1 day') day left join crm.leads l on (coalesce(l.registered_at,l.created_at) at time zone 'Asia/Riyadh')::date=day::date and l.is_deleted=false group by day order by day`,
    ]);
    data.crm = {
      totalCustomers: asNumber(row?.total_customers), openConversations: asNumber(row?.open_conversations), noAnswerCustomers: asNumber(row?.no_answer_customers), sold: asNumber(row?.sold), cashSales: asNumber(row?.cash_sales), financeSales: asNumber(row?.finance_sales), customerService: asNumber(row?.customer_service), newToday: asNumber(row?.new_today), newThisWeek: asNumber(row?.new_this_week),
      recentConversations: recent.map((item) => ({ id: item.id, customerName: item.customer_name, preview: item.preview_text, time: item.last_message_at ? new Date(item.last_message_at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }) : "", unreadCount: asNumber(item.unread_count), leadId: item.lead_id, department: item.department_code === "finance_sales" || item.department_code === "call_center" ? "finance" : item.department_code === "customer_service" ? "service" : "cash" })),
      newCustomersSeries: series.map((item) => ({ label: item.label, value: asNumber(item.value) })),
    };
  } catch (error) { data.sectionErrors!.crm = errorText(error); console.error("Dashboard CRM query failed", error); }

  try {
    const [row] = await sql<any[]>`select count(*)::int as campaigns,count(*) filter(where status='scheduled')::int as scheduled,count(*) filter(where due_at<now() and status not in ('completed','archived'))::int as delayed from marketing.campaigns where is_deleted=false`;
    data.marketing = { campaigns: asNumber(row?.campaigns), scheduled: asNumber(row?.scheduled), delayed: asNumber(row?.delayed) };
  } catch (error) { data.sectionErrors!.marketing = errorText(error); console.error("Dashboard marketing query failed", error); }

  try {
    const [row] = await sql<any[]>`select count(*) filter(where coalesce(is_archived,false)=false)::int as requests,count(*) filter(where coalesce(is_archived,false)=false and status='in_progress')::int as in_progress,count(*) filter(where status='completed' or coalesce(is_archived,false)=true)::int as completed from tracking.orders where coalesce(is_deleted,false)=false`;
    data.tracking = { requests: asNumber(row?.requests), inProgress: asNumber(row?.in_progress), completed: asNumber(row?.completed) };
    data.operations.salesTracking = { total: asNumber(row?.requests), notStarted: 0, inProgress: asNumber(row?.in_progress), completed: asNumber(row?.completed) };
    const [st] = await sql<any[]>`select count(*) filter(where coalesce(is_archived,false)=false and status='not_started')::int as not_started from tracking.orders where coalesce(is_deleted,false)=false`;
    data.operations.salesTracking.notStarted = asNumber(st?.not_started);
  } catch (error) { data.sectionErrors!.tracking = errorText(error); console.error("Dashboard tracking query failed", error); }

  try {
    const globalOperationsAccess = user.roleCodes.includes("system_admin") || user.roleCodes.includes("admin") || user.branchCodes.length === 0;
    const operationBranches = user.branchCodes.length ? user.branchCodes : ["__none__"];
    const [locations, [inventory], [approval], [shortage], [transfer], [photo]] = await Promise.all([
      sql<any[]>`select l.code as key,l.name,
        count(v.id) filter(where v.is_deleted=false and v.archived_at is null and v.is_inventory_active=true and coalesce(s.is_actual_stock,true))::int as actual_total,
        count(v.id) filter(where v.is_deleted=false and v.archived_at is null and v.is_inventory_active=true and v.status_code='under_delivery')::int as under_delivery,
        count(v.id) filter(where v.is_deleted=false and v.archived_at is null and v.is_inventory_active=true and v.status_code='available_for_sale')::int as available_for_sale,
        count(v.id) filter(where v.is_deleted=false and v.archived_at is null and v.is_inventory_active=true and v.status_code='reserved')::int as reserved,
        count(v.id) filter(where v.is_deleted=false and v.status_code='delivered')::int as delivered,
        count(v.id) filter(where v.is_deleted=false and v.archived_at is null and v.is_inventory_active=true and (v.status_code='has_notes' or v.has_notes=true))::int as has_notes
        from operations.locations l left join operations.vehicles v on v.location_id=l.id left join operations.vehicle_statuses s on s.code=v.status_code
        where l.is_active=true and (${globalOperationsAccess}=true or coalesce(l.branch_code,l.code) in ${sql(operationBranches)})
        group by l.code,l.name,l.sort_order order by l.sort_order`,
      sql<any[]>`select
        count(*) filter(where v.is_deleted=false and v.archived_at is null and v.is_inventory_active=true and coalesce(s.is_actual_stock,true))::int as actual_total,
        count(*) filter(where v.is_deleted=false and v.archived_at is null and v.is_inventory_active=true and l.is_agency=true)::int as agency,
        count(*) filter(where v.is_deleted=false and v.archived_at is null and v.is_inventory_active=true and v.status_code='available_for_sale')::int as available_for_sale,
        count(*) filter(where v.is_deleted=false and v.archived_at is null and v.is_inventory_active=true and v.status_code='reserved')::int as reserved,
        count(*) filter(where v.is_deleted=false and v.archived_at is null and v.is_inventory_active=true and v.status_code='under_delivery')::int as under_delivery,
        count(*) filter(where v.is_deleted=false and v.status_code='delivered')::int as delivered,
        count(*) filter(where v.is_deleted=false and v.archived_at is null and v.is_inventory_active=true and (v.status_code='has_notes' or v.has_notes=true))::int as has_notes
        from operations.vehicles v left join operations.locations l on l.id=v.location_id left join operations.vehicle_statuses s on s.code=v.status_code
        where (${globalOperationsAccess}=true or coalesce(l.branch_code,l.code) in ${sql(operationBranches)})`,
      sql<any[]>`select count(*)::int as total,count(*) filter(where a.financial_approved=false)::int as missing_financial,count(*) filter(where a.administrative_approved=false)::int as missing_administrative,count(*) filter(where a.financial_approved=true and a.administrative_approved=true)::int as completed
        from operations.vehicle_approvals a join operations.vehicles v on v.id=a.vehicle_id left join operations.locations l on l.id=v.location_id
        where a.is_active=true and (${globalOperationsAccess}=true or coalesce(l.branch_code,l.code) in ${sql(operationBranches)})`,
      sql<any[]>`select count(*) filter(where s.is_resolved=false)::int as total,count(*) filter(where s.is_resolved=false and l.code='multaqa')::int as multaqa,count(*) filter(where s.is_resolved=false and l.code='hall')::int as hall,count(*) filter(where s.is_resolved=false and l.code='qadisiyah')::int as qadisiyah
        from operations.vehicle_shortages s join operations.vehicles v on v.id=s.vehicle_id left join operations.locations l on l.id=v.location_id
        where (${globalOperationsAccess}=true or coalesce(l.branch_code,l.code) in ${sql(operationBranches)})`,
      sql<any[]>`select count(*) filter(where r.is_deleted=false)::int as total,count(*) filter(where r.is_deleted=false and r.status='request_received')::int as request_received,count(*) filter(where r.is_deleted=false and r.status='vehicle_received')::int as vehicle_received,count(*) filter(where r.is_deleted=false and r.status='vehicle_sent')::int as vehicle_sent,count(*) filter(where r.is_deleted=false and r.status='completed')::int as completed
        from operations.transfer_requests r
        where (${globalOperationsAccess}=true or r.source_branch_code in ${sql(operationBranches)} or r.destination_branch_code in ${sql(operationBranches)} or r.requested_by=${user.id}::uuid)`,
      sql<any[]>`select count(*) filter(where r.is_deleted=false)::int as total from operations.photography_requests r
        where (${globalOperationsAccess}=true or r.requested_by_branch in ${sql(operationBranches)} or r.requested_by=${user.id}::uuid)`,
    ]);
    data.operations.inventory = { actualTotal: asNumber(inventory?.actual_total), agency: asNumber(inventory?.agency), availableForSale: asNumber(inventory?.available_for_sale), reserved: asNumber(inventory?.reserved), underDelivery: asNumber(inventory?.under_delivery), delivered: asNumber(inventory?.delivered), hasNotes: asNumber(inventory?.has_notes) };
    data.operations.locations = locations.map((item) => ({ key: item.key, name: item.name, actualTotal: asNumber(item.actual_total), underDelivery: asNumber(item.under_delivery), availableForSale: asNumber(item.available_for_sale), reserved: asNumber(item.reserved), delivered: asNumber(item.delivered), hasNotes: asNumber(item.has_notes) }));
    if (!data.operations.locations.length) data.operations.locations = emptyData().operations.locations;
    data.operations.approvals = { total: asNumber(approval?.total), missingFinancial: asNumber(approval?.missing_financial), missingAdministrative: asNumber(approval?.missing_administrative), completed: asNumber(approval?.completed) };
    data.operations.shortages = { total: asNumber(shortage?.total), multaqa: asNumber(shortage?.multaqa), hall: asNumber(shortage?.hall), qadisiyah: asNumber(shortage?.qadisiyah) };
    data.operations.transfers = { total: asNumber(transfer?.total) + asNumber(photo?.total), transferTotal: asNumber(transfer?.total), photographyTotal: asNumber(photo?.total), requestReceived: asNumber(transfer?.request_received), vehicleReceived: asNumber(transfer?.vehicle_received), vehicleSent: asNumber(transfer?.vehicle_sent), completed: asNumber(transfer?.completed) };
  } catch (error) { data.sectionErrors!.operations = errorText(error); console.error("Dashboard operations query failed", error); }

  data.generatedAt = new Date().toISOString();
  return data;
}
