import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, normalizePhone, parseBody, positiveInt, requireCrmUser, sourceLabel, userScope } from "../_crm-utils.js";
import { hasPermission } from "../../shared/access-control.js";
import { getSql } from "../_db.js";
import { ensureErpNextSalesOrderSchema } from "../_erpnext-integration-schema.js";
import { cancelErpNextSalesOrder, refreshCrmLeadSalesSnapshot } from "../_erpnext-sales-order-sync.js";

function scopeSql(scope: ReturnType<typeof userScope>, userId: string) {
  return {
    all: scope.all,
    includeAssigned: scope.includeAssigned,
    callCenterOnly: scope.callCenterOnly,
    userId,
    departmentCodes: scope.departmentCodes,
    branchCodes: scope.branchCodes,
  };
}

function canPurgeContact(user: any) {
  return hasPermission(user, "crm.contacts.purge");
}

function canManageSalesOrders(user: any) {
  return canPurgeContact(user);
}

function dateOrNull(value: unknown, label: string) {
  const normalized = clean(value);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error(`${label} غير صحيح`);
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) throw new Error(`${label} غير صحيح`);
  return normalized;
}

function nonNegativeNumber(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} يجب أن يكون رقمًا صحيحًا أكبر من أو يساوي صفر`);
  return Math.round(parsed * 100) / 100;
}

function positiveQuantity(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${label} يجب أن تكون واحدًا أو أكثر`);
  return Math.round(parsed * 100) / 100;
}

async function canAccessContact(contactId: string, user: any) {
  const sql = getSql();
  const scope = scopeSql(userScope(user), user.id);
  const [row] = await sql<{ allowed: boolean }[]>`
    select exists(
      select 1
      from crm.contacts c
      where c.id=${contactId}::uuid
        and (
          ${scope.all}::boolean
          or exists (
            select 1 from crm.leads l
            where l.contact_id=c.id and l.is_deleted=false
              and (
                (${scope.callCenterOnly}::boolean and l.call_center_assigned_to=${scope.userId}::uuid)
                or (${scope.includeAssigned}::boolean and not ${scope.callCenterOnly}::boolean and (l.assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid))
                or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
              )
          )
          or exists (
            select 1 from crm.conversations cv
            where cv.contact_id=c.id and ${scope.includeAssigned}::boolean and (cv.assigned_to=${scope.userId}::uuid or cv.call_center_assigned_to=${scope.userId}::uuid)
          )
        )
    ) as allowed
  `;
  return Boolean(row?.allowed);
}

async function listContacts(request: VercelRequest, response: VercelResponse, user: any) {
  const sql = getSql();
  const scope = scopeSql(userScope(user), user.id);
  const q = clean(request.query.q);
  const limit = positiveInt(request.query.limit, 60, 200);
  const offset = Math.max(0, Number(request.query.offset || 0) || 0);
  const like = q ? `%${q}%` : null;

  const rows = await sql<any[]>`
    select
      c.id::text,c.display_name,c.primary_phone,c.primary_phone_normalized,c.is_active,c.metadata,c.created_at,c.updated_at,
      coalesce(stats.leads_count,0)::int as leads_count,
      coalesce(stats.requests_count,0)::int as requests_count,
      coalesce(stats.open_requests_count,0)::int as open_requests_count,
      coalesce(stats.conversations_count,0)::int as conversations_count,
      latest.id::text as latest_lead_id,latest.customer_name,latest.status_label,latest.department_code,latest.branch_code,
      latest.service_key,latest.source_code,latest.source_name,latest.notes,latest.assigned_to::text,latest.call_center_assigned_to::text,
      sales.full_name as assigned_name,cc.full_name as call_center_name,
      activity.last_activity_at,
      coalesce(sales_stats.sales_orders_count,0)::int as sales_orders_count,
      coalesce(sales_stats.sold_vehicles_count,0)::int as sold_vehicles_count,
      coalesce(sales_stats.total_sales_amount,0)::float as total_sales_amount,
      sales_stats.last_sale_at
    from crm.contacts c
    left join lateral (
      select
        count(*) filter(where l.is_deleted=false)::int as leads_count,
        (select count(*) from crm.service_requests r where r.contact_id=c.id)::int as requests_count,
        (select count(*) from crm.service_requests r where r.contact_id=c.id and r.request_state='open')::int as open_requests_count,
        (select count(*) from crm.conversations cv where cv.contact_id=c.id)::int as conversations_count
      from crm.leads l where l.contact_id=c.id
    ) stats on true
    left join lateral (
      select l.* from crm.leads l
      where l.contact_id=c.id and l.is_deleted=false
      order by coalesce(l.updated_at,l.created_at) desc limit 1
    ) latest on true
    left join core.users sales on sales.id=latest.assigned_to
    left join core.users cc on cc.id=latest.call_center_assigned_to
    left join lateral (
      select
        count(distinct so.id) filter(where coalesce(so.is_cancelled,false)=false)::int as sales_orders_count,
        coalesce(sum(case when coalesce(so.is_cancelled,false)=false then coalesce(vehicle_stats.vehicle_qty,1) else 0 end),0)::int as sold_vehicles_count,
        coalesce(sum(case when coalesce(so.is_cancelled,false)=false then coalesce(so.total_incl_vat,0) else 0 end),0)::float as total_sales_amount,
        max(coalesce(so.order_date::timestamptz,so.erp_created_at,so.received_at)) filter(where coalesce(so.is_cancelled,false)=false) as last_sale_at
      from integrations.erpnext_sales_orders so
      join crm.leads sales_lead on sales_lead.id=so.crm_lead_id and sales_lead.contact_id=c.id
      left join lateral (
        select nullif(sum(greatest(coalesce(sov.qty,1),1)) filter(where coalesce(sov.is_cancelled,false)=false),0)::int as vehicle_qty
        from integrations.erpnext_sales_order_vehicles sov where sov.sales_order_id=so.id
      ) vehicle_stats on true
    ) sales_stats on true
    left join lateral (
      select greatest(
        coalesce((select max(coalesce(l.updated_at,l.created_at)) from crm.leads l where l.contact_id=c.id),'epoch'::timestamptz),
        coalesce((select max(coalesce(r.updated_at,r.created_at)) from crm.service_requests r where r.contact_id=c.id),'epoch'::timestamptz),
        coalesce((select max(coalesce(cv.last_message_at,cv.updated_at,cv.created_at)) from crm.conversations cv where cv.contact_id=c.id),'epoch'::timestamptz)
      ) as last_activity_at
    ) activity on true
    where (
      ${scope.all}::boolean
      or exists (
        select 1 from crm.leads l
        where l.contact_id=c.id and l.is_deleted=false
          and (
            (${scope.callCenterOnly}::boolean and l.call_center_assigned_to=${scope.userId}::uuid)
            or (${scope.includeAssigned}::boolean and not ${scope.callCenterOnly}::boolean and (l.assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid))
            or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
          )
      )
      or exists (
        select 1 from crm.conversations cv
        where cv.contact_id=c.id and ${scope.includeAssigned}::boolean and (cv.assigned_to=${scope.userId}::uuid or cv.call_center_assigned_to=${scope.userId}::uuid)
      )
    )
      and (
        ${like}::text is null
        or concat_ws(' ',c.display_name,c.primary_phone,c.primary_phone_normalized,latest.customer_name,latest.status_label,latest.notes) ilike ${like}
        or exists (
          select 1 from integrations.erpnext_sales_orders search_order
          join crm.leads search_lead on search_lead.id=search_order.crm_lead_id
          where search_lead.contact_id=c.id and search_order.sales_order_no ilike ${like}
        )
      )
    order by activity.last_activity_at desc,c.updated_at desc
    limit ${limit} offset ${offset}
  `;

  const [count] = await sql<{ total: number }[]>`
    select count(*)::int as total from crm.contacts c
    where (
      ${scope.all}::boolean
      or exists (
        select 1 from crm.leads l
        where l.contact_id=c.id and l.is_deleted=false
          and (
            (${scope.callCenterOnly}::boolean and l.call_center_assigned_to=${scope.userId}::uuid)
            or (${scope.includeAssigned}::boolean and not ${scope.callCenterOnly}::boolean and (l.assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid))
            or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
          )
      )
      or exists (
        select 1 from crm.conversations cv
        where cv.contact_id=c.id and ${scope.includeAssigned}::boolean and (cv.assigned_to=${scope.userId}::uuid or cv.call_center_assigned_to=${scope.userId}::uuid)
      )
    )
      and (
        ${like}::text is null
        or concat_ws(' ',c.display_name,c.primary_phone,c.primary_phone_normalized) ilike ${like}
        or exists (
          select 1 from crm.leads search_lead
          where search_lead.contact_id=c.id and search_lead.is_deleted=false
            and concat_ws(' ',search_lead.customer_name,search_lead.status_label,search_lead.notes) ilike ${like}
        )
        or exists (
          select 1 from integrations.erpnext_sales_orders search_order
          join crm.leads search_lead on search_lead.id=search_order.crm_lead_id
          where search_lead.contact_id=c.id and search_order.sales_order_no ilike ${like}
        )
      )
  `;

  const [summary] = await sql<any[]>`
    select
      count(*)::int as total_contacts,
      count(*) filter(where exists(select 1 from crm.service_requests r where r.contact_id=c.id and r.request_state='open'))::int as open_contacts,
      count(*) filter(where exists(select 1 from crm.service_requests r where r.contact_id=c.id and r.request_state='closed'))::int as completed_contacts,
      count(*) filter(where exists(select 1 from crm.conversations cv where cv.contact_id=c.id))::int as contacts_with_conversations,
      coalesce(sum(contact_sales.sales_orders_count),0)::int as total_sales_orders,
      coalesce(sum(contact_sales.sold_vehicles_count),0)::int as total_sold_vehicles
    from crm.contacts c
    left join (
      select
        sales_lead.contact_id,
        count(*)::int as sales_orders_count,
        coalesce(sum(coalesce(vehicle_stats.vehicle_qty,1)),0)::int as sold_vehicles_count
      from integrations.erpnext_sales_orders so
      join crm.leads sales_lead on sales_lead.id=so.crm_lead_id
      left join lateral (
        select nullif(sum(greatest(coalesce(sov.qty,1),1)) filter(where coalesce(sov.is_cancelled,false)=false),0)::int as vehicle_qty
        from integrations.erpnext_sales_order_vehicles sov
        where sov.sales_order_id=so.id
      ) vehicle_stats on true
      where coalesce(so.is_cancelled,false)=false
      group by sales_lead.contact_id
    ) contact_sales on contact_sales.contact_id=c.id
    where (
      ${scope.all}::boolean
      or exists(
        select 1 from crm.leads l where l.contact_id=c.id and l.is_deleted=false and (
          (${scope.callCenterOnly}::boolean and l.call_center_assigned_to=${scope.userId}::uuid)
          or (${scope.includeAssigned}::boolean and not ${scope.callCenterOnly}::boolean and (l.assigned_to=${scope.userId}::uuid or l.call_center_assigned_to=${scope.userId}::uuid))
          or (l.department_code=any(${scope.departmentCodes}::text[]) and (${scope.branchCodes.length === 0}::boolean or l.branch_code=any(${scope.branchCodes}::text[])))
        )
      )
      or exists (
        select 1 from crm.conversations cv
        where cv.contact_id=c.id and ${scope.includeAssigned}::boolean and (cv.assigned_to=${scope.userId}::uuid or cv.call_center_assigned_to=${scope.userId}::uuid)
      )
    )
  `;

  for (const row of rows) row.source_name = sourceLabel(row.source_code, row.source_name);
  return response.status(200).json({ ok: true, rows, total: Number(count?.total || 0), limit, offset, summary: summary || {}, canPurge: canPurgeContact(user) });
}

async function contactProfile(request: VercelRequest, response: VercelResponse, user: any, id: string) {
  if (!(await canAccessContact(id, user))) return response.status(404).json({ ok: false, error: "جهة الاتصال غير موجودة أو لا توجد صلاحية لعرضها" });
  const sql = getSql();
  const [contact] = await sql<any[]>`select *,id::text from crm.contacts where id=${id}::uuid limit 1`;
  if (!contact) return response.status(404).json({ ok: false, error: "جهة الاتصال غير موجودة" });

  const [identities, leads, requests, conversations, messages, events, ownership, salesOrders] = await Promise.all([
    sql<any[]>`select id::text,channel_code,external_id,participant_id,page_id,display_name,metadata,created_at,updated_at from crm.contact_identities where contact_id=${id}::uuid order by updated_at desc`,
    sql<any[]>`
      select l.*,l.id::text,l.contact_id::text,l.current_request_id::text,l.assigned_to::text,l.call_center_assigned_to::text,
        sales.full_name as assigned_name,cc.full_name as call_center_name,b.name as branch_name,src.name as catalog_source_name
      from crm.leads l
      left join core.users sales on sales.id=l.assigned_to
      left join core.users cc on cc.id=l.call_center_assigned_to
      left join core.branches b on b.code=l.branch_code
      left join core.sources src on src.code=l.source_code
      where l.contact_id=${id}::uuid
      order by l.is_deleted asc,coalesce(l.updated_at,l.created_at) desc
    `,
    sql<any[]>`
      select r.*,r.id::text,r.lead_id::text,r.conversation_id::text,r.assigned_to::text,r.call_center_assigned_to::text,
        sales.full_name as assigned_name,cc.full_name as call_center_name,b.name as branch_name
      from crm.service_requests r
      left join core.users sales on sales.id=r.assigned_to
      left join core.users cc on cc.id=r.call_center_assigned_to
      left join core.branches b on b.code=r.branch_code
      where r.contact_id=${id}::uuid order by r.opened_at desc
    `,
    sql<any[]>`
      select c.*,c.id::text,c.lead_id::text,c.service_request_id::text,c.assigned_to::text,c.call_center_assigned_to::text,
        sales.full_name as assigned_name,cc.full_name as call_center_name
      from crm.conversations c
      left join core.users sales on sales.id=c.assigned_to
      left join core.users cc on cc.id=c.call_center_assigned_to
      where c.contact_id=${id}::uuid order by coalesce(c.last_message_at,c.updated_at,c.created_at) desc
    `,
    sql<any[]>`
      select m.*,m.id::text,m.conversation_id::text,u.full_name as sent_by_name
      from crm.messages m
      join crm.conversations c on c.id=m.conversation_id
      left join core.users u on u.id=m.sent_by
      where c.contact_id=${id}::uuid
      order by m.created_at desc limit 200
    `,
    sql<any[]>`
      select e.*,e.id::text,e.lead_id::text
      from crm.lead_events e join crm.leads l on l.id=e.lead_id
      where l.contact_id=${id}::uuid order by e.created_at desc limit 500
    `,
    sql<any[]>`
      select o.*,o.id::text,o.lead_id::text,o.service_request_id::text,o.previous_assigned_to::text,o.new_assigned_to::text
      from crm.ownership_events o
      where o.contact_id=${id}::uuid order by o.created_at desc limit 300
    `,
    sql<any[]>`
      select
        so.id::text,so.sales_order_no,so.source_instance_key,so.erp_status,so.erp_event,so.erp_sales_person,
        so.accounting_customer_name,so.actual_customer_name,so.actual_customer_phone,so.order_date,so.delivery_date,
        so.erp_branch,so.platform_user_id::text,so.platform_user_name,so.platform_department_code,so.platform_department_name,
        so.platform_branch_code,so.platform_branch_name,so.crm_lead_id::text,so.tracking_order_id::text,
        so.subtotal_before_tax::float,so.tax_value::float,so.total_incl_vat::float,so.registration_fee::float,
        so.user_link_status,so.crm_link_status,so.operations_link_status,so.is_cancelled,so.cancelled_at,so.cancellation_reason,
        so.received_at,so.updated_at,
        coalesce(vehicle_stats.vehicle_qty,1)::int as vehicle_qty,
        coalesce(vehicle_stats.vehicles,'[]'::json) as vehicles
      from integrations.erpnext_sales_orders so
      join crm.leads l on l.id=so.crm_lead_id
      left join lateral (
        select
          nullif(sum(greatest(coalesce(sov.qty,1),1)) filter(where coalesce(sov.is_cancelled,false)=false),0)::int as vehicle_qty,
          coalesce(json_agg(json_build_object(
            'id',sov.id::text,'itemNo',sov.item_no,'vin',sov.vin,'itemType',sov.item_type,'itemCategory',sov.item_category,
            'itemModel',sov.item_model,'interiorColor',sov.interior_color,'exteriorColor',sov.exterior_color,'dealer',sov.dealer,
            'qty',sov.qty::float,'unitPrice',sov.unit_price::float,'itemValue',sov.item_value::float,'totalInclVat',sov.total_incl_vat::float,
            'operationsStatusCode',sov.operations_status_code,'isCancelled',sov.is_cancelled
          ) order by sov.created_at) filter(where sov.id is not null),'[]'::json) as vehicles
        from integrations.erpnext_sales_order_vehicles sov where sov.sales_order_id=so.id
      ) vehicle_stats on true
      where l.contact_id=${id}::uuid
      order by coalesce(so.order_date,so.received_at::date) desc,so.received_at desc
    `,
  ]);

  for (const lead of leads) {
    lead.source_name = sourceLabel(lead.source_code, lead.catalog_source_name || lead.source_name);
    delete lead.catalog_source_name;
  }
  const notes = leads.flatMap((lead) => clean(lead.notes) ? [{ leadId: lead.id, customerName: lead.customer_name, text: lead.notes, updatedAt: lead.updated_at }] : []);
  const activeSalesOrders = salesOrders.filter((order: any) => !order.is_cancelled);
  const salesSummary = {
    ordersCount: activeSalesOrders.length,
    allOrdersCount: salesOrders.length,
    cancelledOrdersCount: salesOrders.length - activeSalesOrders.length,
    soldVehiclesCount: activeSalesOrders.reduce((total: number, order: any) => total + Math.max(1, Number(order.vehicle_qty || 1)), 0),
    subtotalBeforeTax: activeSalesOrders.reduce((total: number, order: any) => total + Number(order.subtotal_before_tax || 0), 0),
    taxValue: activeSalesOrders.reduce((total: number, order: any) => total + Number(order.tax_value || 0), 0),
    registrationFee: activeSalesOrders.reduce((total: number, order: any) => total + Number(order.registration_fee || 0), 0),
    totalSalesAmount: activeSalesOrders.reduce((total: number, order: any) => total + Number(order.total_incl_vat || 0), 0),
    lastSaleAt: activeSalesOrders[0]?.order_date || activeSalesOrders[0]?.received_at || null,
  };
  return response.status(200).json({
    ok: true,
    contact,
    identities,
    leads,
    requests,
    conversations,
    messages,
    events,
    ownership,
    notes,
    salesOrders,
    salesSummary,
    canPurge: canPurgeContact(user),
    canManageSalesOrders: canManageSalesOrders(user),
  });
}

async function updateSalesOrder(request: VercelRequest, response: VercelResponse, user: any) {
  if (!canManageSalesOrders(user)) return response.status(403).json({ ok: false, error: "تعديل طلبات البيع متاح لمدير النظام أو مدير المبيعات فقط" });
  const body = parseBody(request);
  const contactId = clean(body.contactId || body.contact_id || request.query.contactId);
  const orderId = clean(body.orderId || body.order_id || request.query.id);
  if (!contactId || !orderId) return response.status(400).json({ ok: false, error: "بيانات طلب البيع غير مكتملة" });
  if (!(await canAccessContact(contactId, user))) return response.status(404).json({ ok: false, error: "جهة الاتصال غير موجودة أو لا توجد صلاحية لتعديلها" });

  let orderDate: string | null;
  let deliveryDate: string | null;
  let subtotalBeforeTax: number;
  let taxValue: number;
  let registrationFee: number;
  let totalInclVat: number;
  let vehicleUpdates: Array<{ id: string; qty: number; unitPrice: number; itemValue: number; totalInclVat: number }>;
  try {
    const orderInput = body.order && typeof body.order === "object" ? body.order : {};
    orderDate = dateOrNull(orderInput.orderDate ?? orderInput.order_date, "تاريخ الطلب");
    deliveryDate = dateOrNull(orderInput.deliveryDate ?? orderInput.delivery_date, "تاريخ التسليم");
    subtotalBeforeTax = nonNegativeNumber(orderInput.subtotalBeforeTax ?? orderInput.subtotal_before_tax, "القيمة قبل الضريبة");
    taxValue = nonNegativeNumber(orderInput.taxValue ?? orderInput.tax_value, "قيمة الضريبة");
    registrationFee = nonNegativeNumber(orderInput.registrationFee ?? orderInput.registration_fee, "رسوم التسجيل");
    totalInclVat = nonNegativeNumber(orderInput.totalInclVat ?? orderInput.total_incl_vat, "إجمالي الطلب");
    vehicleUpdates = (Array.isArray(body.vehicles) ? body.vehicles : []).map((vehicle: any, index: number) => ({
      id: clean(vehicle?.id),
      qty: positiveQuantity(vehicle?.qty, `كمية السيارة رقم ${index + 1}`),
      unitPrice: nonNegativeNumber(vehicle?.unitPrice ?? vehicle?.unit_price, `سعر السيارة رقم ${index + 1}`),
      itemValue: nonNegativeNumber(vehicle?.itemValue ?? vehicle?.item_value, `قيمة السيارة رقم ${index + 1}`),
      totalInclVat: nonNegativeNumber(vehicle?.totalInclVat ?? vehicle?.total_incl_vat, `إجمالي السيارة رقم ${index + 1}`),
    }));
    if (vehicleUpdates.some((vehicle) => !vehicle.id)) throw new Error("بيانات إحدى السيارات غير مكتملة");
  } catch (failure) {
    return response.status(400).json({ ok: false, error: failure instanceof Error ? failure.message : "بيانات التعديل غير صحيحة" });
  }

  const sql = getSql();
  const result = await sql.begin(async (tx: any) => {
    const [beforeOrder] = await tx<any[]>`
      select so.*,so.id::text,so.crm_lead_id::text
      from integrations.erpnext_sales_orders so
      join crm.leads l on l.id=so.crm_lead_id
      where so.id=${orderId}::uuid and l.contact_id=${contactId}::uuid
      limit 1 for update
    `;
    if (!beforeOrder) return null;
    if (beforeOrder.is_cancelled) return { cancelled: true, beforeOrder };

    const beforeVehicles = await tx<any[]>`
      select *,id::text from integrations.erpnext_sales_order_vehicles
      where sales_order_id=${orderId}::uuid
      order by created_at,id
      for update
    `;
    const allowedVehicleIds = new Set(beforeVehicles.map((vehicle: any) => clean(vehicle.id)));
    if (vehicleUpdates.some((vehicle) => !allowedVehicleIds.has(vehicle.id))) return { invalidVehicle: true, beforeOrder, beforeVehicles };

    const [afterOrder] = await tx<any[]>`
      update integrations.erpnext_sales_orders set
        order_date=${orderDate}::date,
        delivery_date=${deliveryDate}::date,
        subtotal_before_tax=${subtotalBeforeTax},
        tax_value=${taxValue},
        registration_fee=${registrationFee},
        total_incl_vat=${totalInclVat},
        updated_at=now()
      where id=${orderId}::uuid
      returning *,id::text,crm_lead_id::text
    `;

    for (const vehicle of vehicleUpdates) {
      await tx`
        update integrations.erpnext_sales_order_vehicles set
          qty=${vehicle.qty},
          unit_price=${vehicle.unitPrice},
          item_value=${vehicle.itemValue},
          total_incl_vat=${vehicle.totalInclVat},
          updated_at=now()
        where id=${vehicle.id}::uuid and sales_order_id=${orderId}::uuid
      `;
    }
    const afterVehicles = await tx<any[]>`
      select *,id::text from integrations.erpnext_sales_order_vehicles
      where sales_order_id=${orderId}::uuid
      order by created_at,id
    `;
    return { beforeOrder, beforeVehicles, afterOrder, afterVehicles };
  });

  if (!result) return response.status(404).json({ ok: false, error: "طلب البيع غير موجود داخل ملف العميل" });
  if ((result as any).cancelled) return response.status(409).json({ ok: false, error: "لا يمكن تعديل طلب بيع ملغي" });
  if ((result as any).invalidVehicle) return response.status(400).json({ ok: false, error: "إحدى السيارات لا تتبع طلب البيع المحدد" });

  await refreshCrmLeadSalesSnapshot((result as any).afterOrder.crm_lead_id);
  await audit(
    user,
    "sales_order_updated",
    "erpnext_sales_order",
    orderId,
    { order: (result as any).afterOrder, vehicles: (result as any).afterVehicles },
    { order: (result as any).beforeOrder, vehicles: (result as any).beforeVehicles },
  );
  return response.status(200).json({ ok: true, orderId, message: "تم تعديل طلب البيع وتحديث التقارير" });
}

async function deleteSalesOrder(request: VercelRequest, response: VercelResponse, user: any) {
  if (!canManageSalesOrders(user)) return response.status(403).json({ ok: false, error: "حذف طلبات البيع متاح لمدير النظام أو مدير المبيعات فقط" });
  const sql = getSql();
  const body = parseBody(request);
  const contactId = clean(body.contactId || body.contact_id || request.query.contactId);
  const orderId = clean(body.orderId || body.order_id || request.query.id);
  const confirmationHeader = request.headers["x-mzj-sales-order-delete-confirmation"];
  const confirmation = clean(body.confirmation ?? (Array.isArray(confirmationHeader) ? confirmationHeader[0] : confirmationHeader));
  if (!contactId || !orderId) return response.status(400).json({ ok: false, error: "بيانات طلب البيع غير مكتملة" });
  if (!(await canAccessContact(contactId, user))) return response.status(404).json({ ok: false, error: "جهة الاتصال غير موجودة أو لا توجد صلاحية لتعديلها" });

  const [order] = await sql<any[]>`
    select so.*,so.id::text,so.platform_user_id::text,so.crm_lead_id::text,so.tracking_order_id::text
    from integrations.erpnext_sales_orders so
    join crm.leads l on l.id=so.crm_lead_id
    where so.id=${orderId}::uuid and l.contact_id=${contactId}::uuid
    limit 1
  `;
  if (!order) return response.status(404).json({ ok: false, error: "طلب البيع غير موجود داخل ملف العميل" });
  if (!confirmation || confirmation !== clean(order.sales_order_no)) {
    return response.status(400).json({ ok: false, error: "اكتب رقم طلب البيع كاملًا لتأكيد الحذف" });
  }

  const cancellation = await cancelErpNextSalesOrder({
    mode: "crm_only",
    reason: `تم حذف طلب البيع ${order.sales_order_no} من صفحة جهات الاتصال`,
    actor: {
      id: user.id,
      name: user.fullName,
      role: Array.isArray(user.roles) ? user.roles.join("، ") : "CRM",
    },
    normalized: {
      orderNo: clean(order.sales_order_no),
      sourceInstanceKey: clean(order.source_instance_key),
      erpCreatedAt: order.erp_created_at ? new Date(order.erp_created_at).toISOString() : "legacy",
      erpStatus: "Cancelled",
      erpEvent: "crm.sales_order.deleted",
      rawBody: {
        action: "deleted_from_crm_contact",
        orderId,
        contactId,
        deletedBy: user.id,
      },
    } as any,
  });
  if (!(cancellation as any)?.found) return response.status(409).json({ ok: false, error: "تعذر تجهيز طلب البيع للحذف" });

  const [deleted] = await sql<any[]>`
    delete from integrations.erpnext_sales_orders
    where id=${orderId}::uuid
    returning *,id::text,crm_lead_id::text
  `;
  if (!deleted) return response.status(404).json({ ok: false, error: "تم حذف طلب البيع بالفعل" });
  let reopenedLead: any = null;
  if (["cancel_recorded", "already_cancelled"].includes(clean((cancellation as any)?.crm?.status)) && deleted.crm_lead_id) {
    [reopenedLead] = await sql<any[]>`
      update crm.leads set
        status_code=null,
        status_label='عميل جديد',
        sold_quantity=0,
        sold_at=null,
        updated_by=${user.id}::uuid,
        updated_at=now()
      where id=${deleted.crm_lead_id}::uuid
        and status_label='تم البيع'
        and not exists(
          select 1 from integrations.erpnext_sales_orders active_order
          where active_order.crm_lead_id=crm.leads.id and coalesce(active_order.is_cancelled,false)=false
        )
      returning id::text,status_code,status_label,sold_quantity
    `;
    if (reopenedLead) {
      await sql`
        insert into crm.lead_events(
          lead_id,event_type,old_status,new_status,actor_id,actor_name,actor_role,note,details,created_at
        ) values(
          ${deleted.crm_lead_id}::uuid,'sales_order_deleted','تم البيع','عميل جديد',${user.id}::uuid,${user.fullName},
          ${Array.isArray(user.roles) ? user.roles.join("، ") : null},${`تم حذف طلب البيع ${deleted.sales_order_no} من صفحة جهات الاتصال`},
          ${sql.json({ salesOrderNo: deleted.sales_order_no, contactId, orderId })},now()
        )
      `;
    }
  }
  await refreshCrmLeadSalesSnapshot(deleted.crm_lead_id);
  await audit(user, "sales_order_deleted", "erpnext_sales_order", orderId, {
    deleted: true,
    contactId,
    salesOrderNo: deleted.sales_order_no,
    cancellation,
    reopenedLead,
  }, order);
  return response.status(200).json({ ok: true, deleted: { id: orderId, salesOrderNo: deleted.sales_order_no }, message: "تم حذف طلب البيع وتحديث التقارير" });
}

async function purgeContact(request: VercelRequest, response: VercelResponse, user: any) {
  if (!canPurgeContact(user)) return response.status(403).json({ ok: false, error: "حذف ملف جهة الاتصال بالكامل متاح لمدير النظام أو مدير المبيعات فقط" });
  const sql = getSql();
  const body = parseBody(request);
  const id = clean(body.id || request.query.id);
  const confirmationHeader = request.headers["x-mzj-contact-purge-confirmation"];
  const confirmation = clean(body.confirmPhone ?? body.confirm_phone ?? (Array.isArray(confirmationHeader) ? confirmationHeader[0] : confirmationHeader));
  if (!id || !confirmation) return response.status(400).json({ ok: false, error: "اكتب رقم الجوال المسجل أو كلمة التأكيد الأساسية لحذف الملف بالكامل" });

  const [contact] = await sql<any[]>`select *,id::text from crm.contacts where id=${id}::uuid limit 1`;
  if (!contact) return response.status(404).json({ ok: false, error: "جهة الاتصال غير موجودة" });
  const storedPhone = normalizePhone(contact.primary_phone_normalized || contact.primary_phone);
  const hasStoredPhone = Boolean(storedPhone);
  if (hasStoredPhone) {
    const confirmPhone = normalizePhone(confirmation);
    if (!confirmPhone || storedPhone !== confirmPhone) return response.status(400).json({ ok: false, error: "رقم التأكيد لا يطابق رقم جهة الاتصال" });
  } else if (confirmation !== "2106") {
    return response.status(400).json({ ok: false, error: "كلمة التأكيد الأساسية غير صحيحة" });
  }

  const result = await sql.begin(async (tx) => {
    const [counts] = await tx<any[]>`
      select
        (select count(*) from crm.leads where contact_id=${id}::uuid)::int as leads,
        (select count(*) from crm.service_requests where contact_id=${id}::uuid)::int as requests,
        (select count(*) from crm.conversations where contact_id=${id}::uuid or lead_id in (select id from crm.leads where contact_id=${id}::uuid))::int as conversations,
        (select count(*) from crm.messages m join crm.conversations c on c.id=m.conversation_id where c.contact_id=${id}::uuid or c.lead_id in (select id from crm.leads where contact_id=${id}::uuid))::int as messages,
        (select count(*) from crm.manual_lead_requests where (${hasStoredPhone}::boolean and phone_normalized=${storedPhone}) or duplicate_lead_id in (select id from crm.leads where contact_id=${id}::uuid) or created_lead_id in (select id from crm.leads where contact_id=${id}::uuid))::int as manual_requests
    `;
    await tx`delete from crm.manual_lead_requests where (${hasStoredPhone}::boolean and phone_normalized=${storedPhone}) or duplicate_lead_id in (select id from crm.leads where contact_id=${id}::uuid) or created_lead_id in (select id from crm.leads where contact_id=${id}::uuid)`;
    await tx`delete from crm.automation_final_actions where contact_id=${id}::uuid or conversation_id in (select id from crm.conversations where contact_id=${id}::uuid or lead_id in (select id from crm.leads where contact_id=${id}::uuid)) or lead_id in (select id from crm.leads where contact_id=${id}::uuid) or service_request_id in (select id from crm.service_requests where contact_id=${id}::uuid) or session_id in (select id from crm.automation_sessions where contact_id=${id}::uuid or conversation_id in (select id from crm.conversations where contact_id=${id}::uuid or lead_id in (select id from crm.leads where contact_id=${id}::uuid)))`;
    await tx`delete from crm.automation_answers where session_id in (select id from crm.automation_sessions where contact_id=${id}::uuid or conversation_id in (select id from crm.conversations where contact_id=${id}::uuid or lead_id in (select id from crm.leads where contact_id=${id}::uuid))) or inbound_event_id in (select id from crm.automation_inbound_events where contact_id=${id}::uuid or conversation_id in (select id from crm.conversations where contact_id=${id}::uuid or lead_id in (select id from crm.leads where contact_id=${id}::uuid)))`;
    await tx`delete from crm.automation_outbound_messages where session_id in (select id from crm.automation_sessions where contact_id=${id}::uuid or conversation_id in (select id from crm.conversations where contact_id=${id}::uuid or lead_id in (select id from crm.leads where contact_id=${id}::uuid)))`;
    await tx`delete from crm.automation_inbound_events where contact_id=${id}::uuid or conversation_id in (select id from crm.conversations where contact_id=${id}::uuid or lead_id in (select id from crm.leads where contact_id=${id}::uuid))`;
    await tx`delete from crm.automation_sessions where contact_id=${id}::uuid or conversation_id in (select id from crm.conversations where contact_id=${id}::uuid or lead_id in (select id from crm.leads where contact_id=${id}::uuid))`;
    await tx`delete from crm.inbox_agent_logs where lead_id in (select id from crm.leads where contact_id=${id}::uuid) or conversation_id in (select id from crm.conversations where contact_id=${id}::uuid or lead_id in (select id from crm.leads where contact_id=${id}::uuid)) or (${hasStoredPhone}::boolean and customer_phone in (${contact.primary_phone},${contact.primary_phone_normalized},${storedPhone}))`;
    await tx`delete from crm.assignment_logs where lead_id in (select id from crm.leads where contact_id=${id}::uuid)`;
    await tx`delete from crm.background_events where contact_id=${id}::uuid or lead_id in (select id from crm.leads where contact_id=${id}::uuid) or conversation_id in (select id from crm.conversations where contact_id=${id}::uuid or lead_id in (select id from crm.leads where contact_id=${id}::uuid)) or service_request_id in (select id from crm.service_requests where contact_id=${id}::uuid)`;
    await tx`delete from crm.ownership_events where contact_id=${id}::uuid or lead_id in (select id from crm.leads where contact_id=${id}::uuid) or service_request_id in (select id from crm.service_requests where contact_id=${id}::uuid)`;
    await tx`delete from crm.conversations where contact_id=${id}::uuid or lead_id in (select id from crm.leads where contact_id=${id}::uuid)`;
    await tx`delete from crm.service_requests where contact_id=${id}::uuid`;
    await tx`delete from crm.leads where contact_id=${id}::uuid`;
    await tx`delete from crm.contacts where id=${id}::uuid`;
    return counts || { leads: 0, requests: 0, conversations: 0, messages: 0, manual_requests: 0 };
  });

  await audit(user, "contact_file_purged", "contact", id, { ...result, phone: storedPhone || null, confirmationMode: hasStoredPhone ? "phone" : "default_password" }, contact);
  return response.status(200).json({ ok: true, deleted: result });
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  response.setHeader("Cache-Control", "no-store");
  await ensureErpNextSalesOrderSchema();
  if (request.method === "GET") {
    const id = clean(request.query.id);
    return id ? contactProfile(request, response, user, id) : listContacts(request, response, user);
  }
  if (request.method === "PATCH") return updateSalesOrder(request, response, user);
  if (request.method === "DELETE") {
    if (clean(request.query.resource) === "sales_order") return deleteSalesOrder(request, response, user);
    return purgeContact(request, response, user);
  }
  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
