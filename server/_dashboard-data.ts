import { getSql } from "./_db.js";
import type { SessionUser } from "./_auth.js";
import { ensureOperationsSchema } from "./_operations-schema.js";
import { getOperationsDashboard } from "./_operations-service.js";
import type { DashboardData } from "../src/types.js";

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
    crm: {
      totalCustomers: null,
      openConversations: null,
      potentialCustomers: null,
      sold: null,
      cashSales: null,
      financeSales: null,
      customerService: null,
      newToday: null,
      newThisWeek: null,
      recentConversations: [],
      newCustomersSeries: [],
    },
    marketing: { campaigns: null, scheduled: null, delayed: null },
    tracking: { requests: null, inProgress: null, completed: null },
    operations: {
      inventory: {
        actualTotal: null,
        agency: null,
        availableForSale: null,
        underDelivery: null,
        hasNotes: null,
      },
      locations: locationNames.map(([key, name]) => ({
        key,
        name,
        actualTotal: null,
        underDelivery: null,
        availableForSale: null,
        reserved: null,
        delivered: null,
        hasNotes: null,
      })),
      approvals: { total: null, missingFinancial: null, missingAdministrative: null, completed: null },
      shortages: { total: null, multaqa: null, hall: null, qadisiyah: null },
      transfers: { total: null, requestReceived: null, vehicleReceived: null, vehicleSent: null, completed: null },
      salesTracking: { total: null, notStarted: null, inProgress: null, completed: null },
    },
  };
}

function asNumber(value: unknown): number {
  return Number(value ?? 0);
}

export async function getDashboardData(user: SessionUser): Promise<DashboardData> {
  let sql;
  try {
    sql = getSql();
  } catch {
    return emptyData();
  }

  try {
    const [crmRow] = await sql<{
      total_customers: number;
      open_conversations: number;
      potential_customers: number;
      sold: number;
      cash_sales: number;
      finance_sales: number;
      customer_service: number;
      new_today: number;
      new_this_week: number;
    }[]>`
      select
        (select count(*) from crm.leads where is_deleted = false) as total_customers,
        (select count(*) from crm.conversations where status = 'open') as open_conversations,
        (select count(*) from crm.leads where status_label = 'محتمل' and is_deleted = false) as potential_customers,
        (select count(*) from crm.leads where status_label in ('تم البيع', 'تم الانتهاء - إنشاء طلب البيع', 'تم الإنتهاء - إنشاء طلب البيع') and is_deleted = false) as sold,
        (select count(*) from crm.leads where department_code = 'cash_sales' and is_deleted = false) as cash_sales,
        (select count(*) from crm.leads where department_code = 'finance_sales' and is_deleted = false) as finance_sales,
        (select count(*) from crm.leads where department_code = 'customer_service' and is_deleted = false) as customer_service,
        (select count(*) from crm.leads where created_at::date = current_date and is_deleted = false) as new_today,
        (select count(*) from crm.leads where created_at >= date_trunc('week', now()) and is_deleted = false) as new_this_week
    `;

    const recent = await sql<{
      id: string;
      customer_name: string;
      preview_text: string;
      last_message_at: Date;
      unread_count: number;
      lead_id: string;
      department_code: string;
    }[]>`
      select c.id::text, coalesce(c.customer_name, l.customer_name, 'عميل') as customer_name,
             coalesce(c.preview_text, '') as preview_text,
             c.last_message_at, coalesce(c.unread_count, 0) as unread_count,
             coalesce(c.lead_id::text, '') as lead_id,
             coalesce(l.department_code, '') as department_code
      from crm.conversations c
      left join crm.leads l on l.id = c.lead_id and l.is_deleted = false
      order by c.last_message_at desc nulls last
      limit 5
    `;

    const series = await sql<{ label: string; value: number }[]>`
      select to_char(day, 'DD/MM') as label,
             count(l.id)::int as value
      from generate_series(current_date - interval '6 days', current_date, interval '1 day') day
      left join crm.leads l on l.created_at::date = day::date and l.is_deleted = false
      group by day
      order by day
    `;

    const [marketingRow] = await sql<{ campaigns: number; scheduled: number; delayed: number }[]>`
      select
        count(*)::int as campaigns,
        count(*) filter (where status = 'scheduled')::int as scheduled,
        count(*) filter (where due_at < now() and status not in ('completed','archived'))::int as delayed
      from marketing.campaigns
      where is_deleted = false
    `;

    const [trackingRow] = await sql<{ requests: number; in_progress: number; completed: number }[]>`
      select
        count(*) filter (where coalesce(is_archived,false)=false)::int as requests,
        count(*) filter (where coalesce(is_archived,false)=false and status = 'in_progress')::int as in_progress,
        count(*) filter (where coalesce(is_archived,false)=true)::int as completed
      from tracking.orders
      where coalesce(is_deleted,false)=false
    `;

    await ensureOperationsSchema();
    const operationsDashboard = await getOperationsDashboard(user);

    const [salesTrackingRow] = await sql<{
      total: number;
      not_started: number;
      in_progress: number;
      completed: number;
    }[]>`
      select
        count(*) filter (where coalesce(is_archived,false)=false)::int as total,
        count(*) filter (where coalesce(is_archived,false)=false and status = 'not_started')::int as not_started,
        count(*) filter (where coalesce(is_archived,false)=false and status = 'in_progress')::int as in_progress,
        count(*) filter (where coalesce(is_archived,false)=true)::int as completed
      from tracking.orders
      where coalesce(is_deleted,false)=false
    `;



    return {
      connected: true,
      generatedAt: new Date().toISOString(),
      crm: {
        totalCustomers: asNumber(crmRow?.total_customers),
        openConversations: asNumber(crmRow?.open_conversations),
        potentialCustomers: asNumber(crmRow?.potential_customers),
        sold: asNumber(crmRow?.sold),
        cashSales: asNumber(crmRow?.cash_sales),
        financeSales: asNumber(crmRow?.finance_sales),
        customerService: asNumber(crmRow?.customer_service),
        newToday: asNumber(crmRow?.new_today),
        newThisWeek: asNumber(crmRow?.new_this_week),
        recentConversations: recent.map((row) => ({
          id: row.id,
          customerName: row.customer_name,
          preview: row.preview_text,
          time: row.last_message_at ? new Date(row.last_message_at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }) : "",
          unreadCount: asNumber(row.unread_count),
          leadId: row.lead_id,
          department: row.department_code === "finance_sales" || row.department_code === "call_center" ? "finance" : row.department_code === "customer_service" ? "service" : "cash",
        })),
        newCustomersSeries: series.map((row) => ({ label: row.label, value: asNumber(row.value) })),
      },
      marketing: {
        campaigns: asNumber(marketingRow?.campaigns),
        scheduled: asNumber(marketingRow?.scheduled),
        delayed: asNumber(marketingRow?.delayed),
      },
      tracking: {
        requests: asNumber(trackingRow?.requests),
        inProgress: asNumber(trackingRow?.in_progress),
        completed: asNumber(trackingRow?.completed),
      },
      operations: {
        inventory: operationsDashboard.inventory,
        locations: operationsDashboard.locations,
        approvals: operationsDashboard.approvals,
        shortages: operationsDashboard.shortages,
        transfers: operationsDashboard.transfers,
        salesTracking: {
          total: asNumber(salesTrackingRow?.total),
          notStarted: asNumber(salesTrackingRow?.not_started),
          inProgress: asNumber(salesTrackingRow?.in_progress),
          completed: asNumber(salesTrackingRow?.completed),
        },
      },
    };
  } catch (error) {
    console.error("Dashboard query failed", error);
    return emptyData();
  }
}
