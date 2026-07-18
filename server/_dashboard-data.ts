import { getSql } from "./_db.js";
import type { SessionUser } from "./_auth.js";
import { userScope } from "./_crm-utils.js";
import { hasPermission } from "./_permissions.js";
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

function canReadAllSystemData(user: SessionUser, systemCode: string, pagePermission: string) {
  return hasPermission(user, `system.${systemCode}.access`)
    && hasPermission(user, pagePermission)
    && user.dataScopes?.[systemCode] === "all";
}

export async function getDashboardData(user: SessionUser): Promise<DashboardData> {
  let sql;
  try {
    sql = getSql();
  } catch {
    return emptyData();
  }

  const result = emptyData();
  result.connected = true;
  result.generatedAt = new Date().toISOString();

  if (hasPermission(user, "system.crm.access") && hasPermission(user, "crm.dashboard.view")) {
    try {
      const scope = userScope(user);
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
          count(*) filter (where l.is_deleted = false)::int as total_customers,
          (
            select count(*)::int
            from crm.conversations c
            left join crm.leads cl on cl.id = c.lead_id
            where c.status = 'open'
              and (
                ${scope.all}::boolean
                or c.assigned_to = ${scope.userId}::uuid
                or c.call_center_assigned_to = ${scope.userId}::uuid
                or (${scope.callCenterOnly}::boolean and cl.call_center_assigned_to = ${scope.userId}::uuid)
                or (not ${scope.callCenterOnly}::boolean and (cl.assigned_to = ${scope.userId}::uuid or cl.call_center_assigned_to = ${scope.userId}::uuid))
                or (cl.department_code = any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or cl.branch_code = any(${scope.branchCodes}::text[])))
              )
          ) as open_conversations,
          count(*) filter (where l.status_label = 'محتمل' and l.is_deleted = false)::int as potential_customers,
          count(*) filter (where l.status_label in ('تم البيع', 'تم الانتهاء - إنشاء طلب البيع', 'تم الإنتهاء - إنشاء طلب البيع') and l.is_deleted = false)::int as sold,
          count(*) filter (where l.department_code = 'cash_sales' and l.is_deleted = false)::int as cash_sales,
          count(*) filter (where l.department_code = 'finance_sales' and l.is_deleted = false)::int as finance_sales,
          count(*) filter (where l.department_code = 'customer_service' and l.is_deleted = false)::int as customer_service,
          count(*) filter (where l.created_at::date = current_date and l.is_deleted = false)::int as new_today,
          count(*) filter (where l.created_at >= date_trunc('week', now()) and l.is_deleted = false)::int as new_this_week
        from crm.leads l
        where (
          ${scope.all}::boolean
          or (${scope.callCenterOnly}::boolean and l.call_center_assigned_to = ${scope.userId}::uuid)
          or (not ${scope.callCenterOnly}::boolean and (l.assigned_to = ${scope.userId}::uuid or l.call_center_assigned_to = ${scope.userId}::uuid))
          or (l.department_code = any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code = any(${scope.branchCodes}::text[])))
        )
      `;

      const recent = await sql<{
        id: string;
        customer_name: string;
        preview_text: string;
        last_message_at: Date;
        unread_count: number;
      }[]>`
        select c.id::text,
               coalesce(c.customer_name, l.customer_name, 'عميل') as customer_name,
               coalesce(c.preview_text, '') as preview_text,
               c.last_message_at,
               coalesce(c.unread_count, 0) as unread_count
        from crm.conversations c
        left join crm.leads l on l.id = c.lead_id
        where (
          ${scope.all}::boolean
          or c.assigned_to = ${scope.userId}::uuid
          or c.call_center_assigned_to = ${scope.userId}::uuid
          or (${scope.callCenterOnly}::boolean and l.call_center_assigned_to = ${scope.userId}::uuid)
          or (not ${scope.callCenterOnly}::boolean and (l.assigned_to = ${scope.userId}::uuid or l.call_center_assigned_to = ${scope.userId}::uuid))
          or (l.department_code = any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code = any(${scope.branchCodes}::text[])))
        )
        order by c.last_message_at desc nulls last
        limit 5
      `;

      const series = await sql<{ label: string; value: number }[]>`
        select to_char(day, 'DD/MM') as label,
               count(l.id)::int as value
        from generate_series(current_date - interval '6 days', current_date, interval '1 day') day
        left join crm.leads l
          on l.created_at::date = day::date
         and l.is_deleted = false
         and (
           ${scope.all}::boolean
           or (${scope.callCenterOnly}::boolean and l.call_center_assigned_to = ${scope.userId}::uuid)
           or (not ${scope.callCenterOnly}::boolean and (l.assigned_to = ${scope.userId}::uuid or l.call_center_assigned_to = ${scope.userId}::uuid))
           or (l.department_code = any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code = any(${scope.branchCodes}::text[])))
         )
        group by day
        order by day
      `;

      result.crm = {
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
        })),
        newCustomersSeries: series.map((row) => ({ label: row.label, value: asNumber(row.value) })),
      };
    } catch (error) {
      console.error("CRM dashboard query failed", error);
    }
  }

  // The current unified source contains placeholder shells for these systems.
  // Until their real per-resource query models are present, aggregate queries are fail-closed
  // and run only for an explicit `all` scope to avoid reading data outside the user's scope.
  if (canReadAllSystemData(user, "marketing", "marketing.dashboard.view")) {
    try {
      const [marketingRow] = await sql<{ campaigns: number; scheduled: number; delayed: number }[]>`
        select
          count(*)::int as campaigns,
          count(*) filter (where status = 'scheduled')::int as scheduled,
          count(*) filter (where due_at < now() and status not in ('completed','archived'))::int as delayed
        from marketing.campaigns
        where is_deleted = false
      `;
      result.marketing = {
        campaigns: asNumber(marketingRow?.campaigns),
        scheduled: asNumber(marketingRow?.scheduled),
        delayed: asNumber(marketingRow?.delayed),
      };
    } catch (error) {
      console.error("Marketing dashboard query failed", error);
    }
  }

  if (canReadAllSystemData(user, "tracking", "tracking.orders.view")) {
    try {
      const [trackingRow] = await sql<{ requests: number; in_progress: number; completed: number }[]>`
        select
          count(*)::int as requests,
          count(*) filter (where status = 'in_progress')::int as in_progress,
          count(*) filter (where status = 'completed')::int as completed
        from tracking.orders
        where is_archived = false
      `;
      result.tracking = {
        requests: asNumber(trackingRow?.requests),
        inProgress: asNumber(trackingRow?.in_progress),
        completed: asNumber(trackingRow?.completed),
      };
    } catch (error) {
      console.error("Tracking dashboard query failed", error);
    }
  }

  if (canReadAllSystemData(user, "operations", "operations.dashboard.view")) {
    try {
      const locations = await sql<{
        key: string;
        name: string;
        actual_total: number;
        under_delivery: number;
        available_for_sale: number;
        reserved: number;
        delivered: number;
        has_notes: number;
      }[]>`
        select
          l.code as key,
          l.name,
          count(v.id) filter (where v.is_deleted = false)::int as actual_total,
          count(v.id) filter (where v.status_code = 'under_delivery' and v.is_deleted = false)::int as under_delivery,
          count(v.id) filter (where v.status_code = 'available_for_sale' and v.is_deleted = false)::int as available_for_sale,
          count(v.id) filter (where v.status_code = 'reserved' and v.is_deleted = false)::int as reserved,
          count(v.id) filter (where v.status_code = 'delivered' and v.is_deleted = false)::int as delivered,
          count(v.id) filter (where v.has_notes = true and v.is_deleted = false)::int as has_notes
        from operations.locations l
        left join operations.vehicles v on v.location_id = l.id
        where l.is_active = true
        group by l.code, l.name, l.sort_order
        order by l.sort_order
      `;

      const [inventoryRow] = await sql<{
        actual_total: number;
        agency: number;
        available_for_sale: number;
        under_delivery: number;
        has_notes: number;
      }[]>`
        select
          count(*) filter (where is_deleted = false)::int as actual_total,
          count(*) filter (where source_type = 'agency' and is_deleted = false)::int as agency,
          count(*) filter (where status_code = 'available_for_sale' and is_deleted = false)::int as available_for_sale,
          count(*) filter (where status_code = 'under_delivery' and is_deleted = false)::int as under_delivery,
          count(*) filter (where has_notes = true and is_deleted = false)::int as has_notes
        from operations.vehicles
      `;

      const [approvalRow] = await sql<{
        total: number;
        missing_financial: number;
        missing_administrative: number;
        completed: number;
      }[]>`
        select
          count(*)::int as total,
          count(*) filter (where financial_approved = false)::int as missing_financial,
          count(*) filter (where administrative_approved = false)::int as missing_administrative,
          count(*) filter (where financial_approved = true and administrative_approved = true)::int as completed
        from operations.vehicle_approvals
      `;

      const [shortageRow] = await sql<{
        total: number;
        multaqa: number;
        hall: number;
        qadisiyah: number;
      }[]>`
        select
          count(*) filter (where s.is_resolved = false)::int as total,
          count(*) filter (where s.is_resolved = false and l.code = 'multaqa')::int as multaqa,
          count(*) filter (where s.is_resolved = false and l.code = 'hall')::int as hall,
          count(*) filter (where s.is_resolved = false and l.code = 'qadisiyah')::int as qadisiyah
        from operations.vehicle_shortages s
        join operations.vehicles v on v.id = s.vehicle_id
        left join operations.locations l on l.id = v.location_id
      `;

      const [transferRow] = await sql<{
        total: number;
        request_received: number;
        vehicle_received: number;
        vehicle_sent: number;
        completed: number;
      }[]>`
        select
          count(*)::int as total,
          count(*) filter (where status = 'request_received')::int as request_received,
          count(*) filter (where status = 'vehicle_received')::int as vehicle_received,
          count(*) filter (where status = 'vehicle_sent')::int as vehicle_sent,
          count(*) filter (where status = 'completed')::int as completed
        from operations.transfer_requests
      `;

      const [salesTrackingRow] = await sql<{
        total: number;
        not_started: number;
        in_progress: number;
        completed: number;
      }[]>`
        select
          count(*)::int as total,
          count(*) filter (where status = 'not_started')::int as not_started,
          count(*) filter (where status = 'in_progress')::int as in_progress,
          count(*) filter (where status = 'completed')::int as completed
        from tracking.orders
        where is_archived = false
      `;

      const fallbackLocations = emptyData().operations.locations;
      const normalizedLocations = fallbackLocations.map((base) => {
        const found = locations.find((item) => item.key === base.key || item.name === base.name);
        return found
          ? {
              key: found.key,
              name: found.name,
              actualTotal: asNumber(found.actual_total),
              underDelivery: asNumber(found.under_delivery),
              availableForSale: asNumber(found.available_for_sale),
              reserved: asNumber(found.reserved),
              delivered: asNumber(found.delivered),
              hasNotes: asNumber(found.has_notes),
            }
          : base;
      });

      result.operations = {
        inventory: {
          actualTotal: asNumber(inventoryRow?.actual_total),
          agency: asNumber(inventoryRow?.agency),
          availableForSale: asNumber(inventoryRow?.available_for_sale),
          underDelivery: asNumber(inventoryRow?.under_delivery),
          hasNotes: asNumber(inventoryRow?.has_notes),
        },
        locations: normalizedLocations,
        approvals: {
          total: asNumber(approvalRow?.total),
          missingFinancial: asNumber(approvalRow?.missing_financial),
          missingAdministrative: asNumber(approvalRow?.missing_administrative),
          completed: asNumber(approvalRow?.completed),
        },
        shortages: {
          total: asNumber(shortageRow?.total),
          multaqa: asNumber(shortageRow?.multaqa),
          hall: asNumber(shortageRow?.hall),
          qadisiyah: asNumber(shortageRow?.qadisiyah),
        },
        transfers: {
          total: asNumber(transferRow?.total),
          requestReceived: asNumber(transferRow?.request_received),
          vehicleReceived: asNumber(transferRow?.vehicle_received),
          vehicleSent: asNumber(transferRow?.vehicle_sent),
          completed: asNumber(transferRow?.completed),
        },
        salesTracking: {
          total: asNumber(salesTrackingRow?.total),
          notStarted: asNumber(salesTrackingRow?.not_started),
          inProgress: asNumber(salesTrackingRow?.in_progress),
          completed: asNumber(salesTrackingRow?.completed),
        },
      };
    } catch (error) {
      console.error("Operations dashboard query failed", error);
    }
  }

  return result;
}
