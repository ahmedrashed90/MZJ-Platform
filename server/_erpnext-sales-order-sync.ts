import { ensureCrmSchema } from "./_crm-schema.js";
import { getSql } from "./_db.js";
import { ensureErpNextSalesOrderSchema, ensureErpNextUserMappingSchema } from "./_erpnext-integration-schema.js";
import { ensureOperationsSchema } from "./_operations-schema.js";
import { ensureActiveVehicleApprovalCycle, startFreshVehicleApprovalCycle } from "./_operations-approval-cycle.js";
import { ensureTrackingSchema } from "./_tracking-schema.js";
import { clean, dateValue, numberValue } from "./_tracking-utils.js";
import type { TrackingIngestResult } from "./integrations/tracking-orders.js";
import type { ErpNextVehiclePayload, NormalizedErpNextSalesOrder } from "./_erpnext-sales-order-normalizer.js";

type PlatformUserMapping = {
  id: string;
  full_name: string;
  next_erp_user_id: string | null;
  department_code: string | null;
  department_name: string | null;
  branch_code: string | null;
  branch_name: string | null;
};

type UserLinkStatus =
  | "linked"
  | "missing_user_id"
  | "user_not_mapped"
  | "department_not_configured"
  | "platform_branch_not_configured"
  | "unsupported_department";
type LinkWarning = { code: string; message: string; vin?: string; itemNo?: string };

function normalizeComparable(value: unknown) {
  return clean(value).toLocaleLowerCase("ar-SA").replace(/\s+/g, " ");
}

function serviceKeyFromDepartment(value: unknown) {
  const code = clean(value).toLowerCase();
  if (code.includes("finance") || code.includes("call_center") || code.includes("تمويل")) return "finance";
  if (code.includes("customer_service") || code.includes("service") || code.includes("خدم")) return "service";
  return "cash";
}


function isSupportedCrmDepartment(value: unknown) {
  const code = clean(value).toLowerCase();
  return ["cash_sales", "finance_sales"].includes(code)
    || code.includes("كاش")
    || code.includes("تمويل");
}
function paymentType(serviceKey: string) {
  if (serviceKey === "finance") return "تمويل";
  if (serviceKey === "service") return "خدمة عملاء";
  return "كاش";
}

function dateTimeForOrder(orderDate: string) {
  const normalized = dateValue(orderDate);
  return normalized ? `${normalized}T12:00:00+03:00` : new Date().toISOString();
}

function uniqueWarnings(warnings: LinkWarning[]) {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}|${warning.vin || ""}|${warning.itemNo || ""}|${warning.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function resolvePlatformUser(erpUserId: string): Promise<{
  status: UserLinkStatus;
  mapping: PlatformUserMapping | null;
  candidate: PlatformUserMapping | null;
}> {
  if (!erpUserId) return { status: "missing_user_id", mapping: null, candidate: null };
  const sql = getSql();
  const [candidate] = await sql<PlatformUserMapping[]>`
    select u.id::text,u.full_name,u.next_erp_user_id,
      dep.code as department_code,dep.name as department_name,
      br.code as branch_code,br.name as branch_name
    from core.users u
    left join lateral (
      select d.code,d.name
      from core.user_departments ud join core.departments d on d.id=ud.department_id
      where ud.user_id=u.id
      order by ud.is_primary desc,d.created_at,d.code
      limit 1
    ) dep on true
    left join lateral (
      select b.code,b.name
      from core.user_branches ub join core.branches b on b.id=ub.branch_id
      where ub.user_id=u.id
      order by ub.is_primary desc,b.created_at,b.code
      limit 1
    ) br on true
    where u.is_active=true and lower(trim(u.next_erp_user_id))=lower(trim(${erpUserId}))
    limit 1
  `;
  if (!candidate) return { status: "user_not_mapped", mapping: null, candidate: null };
  if (!clean(candidate.department_code)) return { status: "department_not_configured", mapping: null, candidate };
  if (!isSupportedCrmDepartment(candidate.department_code)) return { status: "unsupported_department", mapping: null, candidate };
  if (!clean(candidate.branch_code)) return { status: "platform_branch_not_configured", mapping: null, candidate };
  return { status: "linked", mapping: candidate, candidate };
}

async function ensureCrmContact(
  tx: any,
  name: string,
  phone: string,
  phoneNormalized: string,
  orderNo: string,
) {
  let [contact] = await tx`
    select *,id::text from crm.contacts where primary_phone_normalized=${phoneNormalized} limit 1 for update
  `;
  const metadata = { origin: "erpnext", lastSalesOrderNo: orderNo };
  if (!contact) {
    [contact] = await tx`
      insert into crm.contacts(contact_key,display_name,primary_phone,primary_phone_normalized,metadata)
      values(${`phone:${phoneNormalized}`},${name || "عميل NEXT ERP"},${phone || phoneNormalized},${phoneNormalized},${tx.json(metadata)})
      returning *,id::text
    `;
  } else {
    [contact] = await tx`
      update crm.contacts set
        display_name=coalesce(nullif(${name},''),display_name),
        primary_phone=coalesce(nullif(${phone},''),primary_phone),
        metadata=coalesce(metadata,'{}'::jsonb)||${tx.json(metadata)}::jsonb,
        updated_at=now()
      where id=${contact.id}::uuid
      returning *,id::text
    `;
  }

  await tx`
    insert into crm.contact_identities(contact_id,channel_code,external_id,participant_id,display_name,metadata)
    values(${contact.id}::uuid,'erpnext',${`customer:${phoneNormalized}`},${phoneNormalized},${name || null},${tx.json({ lastSalesOrderNo: orderNo })})
    on conflict(channel_code,external_id) do update set
      contact_id=excluded.contact_id,participant_id=excluded.participant_id,
      display_name=coalesce(excluded.display_name,crm.contact_identities.display_name),
      metadata=coalesce(crm.contact_identities.metadata,'{}'::jsonb)||excluded.metadata,
      updated_at=now()
  `;
  return contact;
}

async function linkCrmCustomer(input: {
  orderId: string;
  normalized: NormalizedErpNextSalesOrder;
  mapping: PlatformUserMapping;
  firstPayload: ErpNextVehiclePayload;
}) {
  const { normalized, mapping, firstPayload } = input;
  const sql = getSql();
  const saleAt = dateTimeForOrder(normalized.orderDate);
  const serviceKey = serviceKeyFromDepartment(mapping.department_code);
  const departmentCode = clean(mapping.department_code)
    || (serviceKey === "finance" ? "finance_sales" : serviceKey === "service" ? "customer_service" : "cash_sales");
  const branchCode = clean(mapping.branch_code) || null;
  const customerName = clean(normalized.actualCustomerName) || clean(normalized.accountingCustomerName) || "عميل NEXT ERP";
  const sourceMetadata = {
    origin: "erpnext-sales-order",
    salesOrderNo: normalized.orderNo,
    sourceInstanceKey: normalized.sourceInstanceKey,
    erpCreatedAt: normalized.erpCreatedAt,
    erpUserId: normalized.erpUserId,
    erpSalesPerson: normalized.erpSalesPerson,
    erpBranch: normalized.erpBranch,
    accountingCustomerName: normalized.accountingCustomerName,
    linkedAt: new Date().toISOString(),
  };

  return sql.begin(async (tx: any) => {
    const [integrationState] = await tx`
      select crm_lead_id::text,crm_created_by_integration,crm_previous_state
      from integrations.erpnext_sales_orders where id=${input.orderId}::uuid for update
    `;
    const matches = await tx`
      select l.*,l.id::text,l.contact_id::text,l.current_request_id::text,l.assigned_to::text,l.call_center_assigned_to::text,
        assigned.full_name as assigned_name
      from crm.leads l
      left join core.users assigned on assigned.id=l.assigned_to
      where l.is_deleted=false and (
        l.phone_normalized=${normalized.actualCustomerPhoneNormalized}
        or right(regexp_replace(coalesce(l.phone_normalized,l.phone,''),'\\D','','g'),9)=right(${normalized.actualCustomerPhoneNormalized},9)
      )
      order by (l.current_request_id is not null) desc,l.updated_at desc,l.created_at desc
      limit 3
      for update of l
    `;

    if (matches.length > 1) {
      return { status: "ambiguous_phone", leadId: null, created: false, message: "رقم الجوال مرتبط بأكثر من عميل في CRM" };
    }

    const existing = matches[0] || null;
    const contact = await ensureCrmContact(
      tx,
      customerName,
      normalized.actualCustomerPhone,
      normalized.actualCustomerPhoneNormalized,
      normalized.orderNo,
    );

    let lead: any;
    let created = false;
    if (!existing) {
      created = true;
      await tx`
        update integrations.erpnext_sales_orders
        set crm_created_by_integration=true,crm_previous_state=null,updated_at=now()
        where id=${input.orderId}::uuid
      `;
      [lead] = await tx`
        insert into crm.leads(
          contact_id,customer_name,phone,phone_normalized,source_code,source_name,platform_code,
          service_key,department_code,branch_code,status_code,status_label,payment_type,
          car_name,car_category,car_model,car_type,color,notes,extra_data,source_history,
          assigned_to,created_by,updated_by,registered_at,responsible_name_snapshot,completion_percent
        ) values (
          ${contact.id}::uuid,${customerName},${normalized.actualCustomerPhone},${normalized.actualCustomerPhoneNormalized},
          'next_erp','NEXT ERP','next_erp',${serviceKey},${departmentCode},${branchCode},null,'تم البيع',${paymentType(serviceKey)},
          ${clean(firstPayload.item?.type)||null},${clean(firstPayload.item?.category)||null},${clean(firstPayload.item?.model)||null},
          ${clean(firstPayload.item?.type)||null},${clean(firstPayload.item?.exteriorColor)||null},
          ${`تم إنشاء العميل تلقائيًا من طلب البيع ${normalized.orderNo} في NEXT ERP`},
          ${tx.json({ ...sourceMetadata, salesOrders: [normalized.orderNo] })},
          ${tx.json([{ source: "next_erp", at: saleAt, orderNo: normalized.orderNo }])},
          ${mapping.id}::uuid,${mapping.id}::uuid,${mapping.id}::uuid,${saleAt}::timestamptz,${mapping.full_name},100
        )
        returning *,id::text,contact_id::text,current_request_id::text,assigned_to::text,call_center_assigned_to::text
      `;

      await tx`
        insert into crm.service_requests(
          contact_id,lead_id,service_key,department_code,branch_code,status_label,request_state,source_code,
          classification_method,assigned_to,opened_at,closed_at,closed_by,closure_reason,metadata
        ) values(
          ${contact.id}::uuid,${lead.id}::uuid,${serviceKey},${departmentCode},${branchCode},'تم البيع','closed','next_erp',
          'erpnext_sales_order',${mapping.id}::uuid,${saleAt}::timestamptz,${saleAt}::timestamptz,${mapping.id}::uuid,'تم البيع',${tx.json(sourceMetadata)}
        )
      `;

      await tx`
        insert into crm.lead_events(
          lead_id,event_type,new_status,new_department,new_branch,actor_id,actor_name,actor_role,note,details,created_at
        ) values(
          ${lead.id}::uuid,'lead_created','تم البيع',${departmentCode},${branchCode},${mapping.id}::uuid,${mapping.full_name},'NEXT ERP',
          ${`تم إنشاء العميل وتحويله إلى تم البيع تلقائيًا من طلب ${normalized.orderNo}`},${tx.json(sourceMetadata)},${saleAt}::timestamptz
        )
      `;
    } else {
      const [originIntegrationState] = await tx`
        select crm_previous_state,crm_created_by_integration
        from integrations.erpnext_sales_orders
        where crm_lead_id=${existing.id}::uuid and id<>${input.orderId}::uuid
          and coalesce(is_cancelled,false)=false
        order by received_at asc,id asc
        limit 1
      `;
      const sameIntegrationCreatedLead = Boolean(
        integrationState?.crm_created_by_integration
        && clean(integrationState?.crm_lead_id) === clean(existing.id),
      ) || Boolean(originIntegrationState?.crm_created_by_integration);
      const inheritedPreviousState = integrationState?.crm_previous_state || originIntegrationState?.crm_previous_state || null;
      if (sameIntegrationCreatedLead) {
        await tx`
          update integrations.erpnext_sales_orders set
            crm_created_by_integration=true,crm_previous_state=null,updated_at=now()
          where id=${input.orderId}::uuid
        `;
      } else if (inheritedPreviousState && !integrationState?.crm_previous_state) {
        await tx`
          update integrations.erpnext_sales_orders set
            crm_previous_state=${tx.json(inheritedPreviousState)},crm_created_by_integration=false,updated_at=now()
          where id=${input.orderId}::uuid
        `;
      } else if (!integrationState?.crm_previous_state) {
        const [previousRequest] = existing.current_request_id ? await tx`
          select *,id::text from crm.service_requests where id=${existing.current_request_id}::uuid
        ` : [null];
        await tx`
          update integrations.erpnext_sales_orders set
            crm_previous_state=${tx.json({
              statusCode: existing.status_code || null,
              statusLabel: existing.status_label || null,
              departmentCode: existing.department_code || null,
              branchCode: existing.branch_code || null,
              serviceKey: existing.service_key || null,
              paymentType: existing.payment_type || null,
              assignedTo: existing.assigned_to || null,
              responsibleName: existing.responsible_name_snapshot || null,
              currentRequestId: existing.current_request_id || null,
              request: previousRequest || null,
            })},
            crm_created_by_integration=false,updated_at=now()
          where id=${input.orderId}::uuid
        `;
      }
      const oldStatus = clean(existing.status_label);
      const oldDepartment = clean(existing.department_code);
      const oldBranch = clean(existing.branch_code);
      const oldAssignedTo = clean(existing.assigned_to);
      const orders = Array.isArray(existing.extra_data?.salesOrders)
        ? existing.extra_data.salesOrders.map(clean).filter(Boolean)
        : [];
      if (!orders.includes(normalized.orderNo)) orders.push(normalized.orderNo);

      [lead] = await tx`
        update crm.leads set
          contact_id=${contact.id}::uuid,
          customer_name=coalesce(nullif(customer_name,''),${customerName}),
          phone=coalesce(nullif(phone,''),${normalized.actualCustomerPhone}),
          phone_normalized=${normalized.actualCustomerPhoneNormalized},
          service_key=${serviceKey},department_code=${departmentCode},branch_code=${branchCode},
          status_code=null,status_label='تم البيع',payment_type=${paymentType(serviceKey)},
          assigned_to=${mapping.id}::uuid,responsible_name_snapshot=${mapping.full_name},
          car_name=coalesce(nullif(car_name,''),${clean(firstPayload.item?.type)||null}),
          car_category=coalesce(nullif(car_category,''),${clean(firstPayload.item?.category)||null}),
          car_model=coalesce(nullif(car_model,''),${clean(firstPayload.item?.model)||null}),
          color=coalesce(nullif(color,''),${clean(firstPayload.item?.exteriorColor)||null}),
          extra_data=coalesce(extra_data,'{}'::jsonb)||${tx.json({ ...sourceMetadata, salesOrders: orders })}::jsonb,
          updated_by=${mapping.id}::uuid,updated_at=${saleAt}::timestamptz
        where id=${existing.id}::uuid
        returning *,id::text,contact_id::text,current_request_id::text,assigned_to::text,call_center_assigned_to::text
      `;

      if (existing.current_request_id) {
        await tx`
          update crm.service_requests set
            service_key=${serviceKey},department_code=${departmentCode},branch_code=${branchCode},status_label='تم البيع',
            request_state='closed',assigned_to=${mapping.id}::uuid,closed_at=${saleAt}::timestamptz,
            closed_by=${mapping.id}::uuid,closure_reason='تم البيع',metadata=coalesce(metadata,'{}'::jsonb)||${tx.json(sourceMetadata)}::jsonb,updated_at=now()
          where id=${existing.current_request_id}::uuid
        `;
        await tx`
          update crm.conversations set service_request_id=null,classification_state='closed',closed_at=${saleAt}::timestamptz,updated_at=now()
          where service_request_id=${existing.current_request_id}::uuid
        `;
        await tx`update crm.leads set current_request_id=null where id=${existing.id}::uuid`;
      }

      const changed = oldStatus !== "تم البيع"
        || oldDepartment !== departmentCode
        || oldBranch !== clean(branchCode)
        || oldAssignedTo !== mapping.id;
      if (changed) {
        await tx`
          insert into crm.lead_events(
            lead_id,event_type,old_status,new_status,old_department,new_department,old_branch,new_branch,
            actor_id,actor_name,actor_role,note,details,created_at
          ) values(
            ${existing.id}::uuid,'status_change',${oldStatus||null},'تم البيع',${oldDepartment||null},${departmentCode},${oldBranch||null},${branchCode},
            ${mapping.id}::uuid,${mapping.full_name},'NEXT ERP',${`تم تحويل العميل إلى تم البيع تلقائيًا من طلب ${normalized.orderNo}`},
            ${tx.json(sourceMetadata)},${saleAt}::timestamptz
          )
        `;
      }

      if (oldAssignedTo !== mapping.id || oldDepartment !== departmentCode || oldBranch !== clean(branchCode)) {
        await tx`
          insert into crm.ownership_events(
            contact_id,service_request_id,lead_id,previous_assigned_to,previous_assigned_name,new_assigned_to,new_assigned_name,
            previous_department_code,new_department_code,previous_branch_code,new_branch_code,actor_id,actor_name,actor_type,reason,metadata
          ) values(
            ${contact.id}::uuid,null,${existing.id}::uuid,${oldAssignedTo||null}::uuid,${existing.assigned_name||null},${mapping.id}::uuid,${mapping.full_name},
            ${oldDepartment||null},${departmentCode},${oldBranch||null},${branchCode},${mapping.id}::uuid,${mapping.full_name},'erpnext',
            ${`ربط المندوب وبياناته التنظيمية من طلب البيع ${normalized.orderNo}`},${tx.json(sourceMetadata)}
          )
        `;
      }
    }

    await tx`
      update integrations.erpnext_sales_orders
      set crm_lead_id=${lead.id}::uuid,crm_link_status=${created ? "created" : "updated"},updated_at=now()
      where id=${input.orderId}::uuid
    `;
    return {
      status: created ? "created" : "updated",
      leadId: lead.id,
      created,
      message: created ? "تم إنشاء عميل CRM بحالة تم البيع" : "تم تحديث عميل CRM إلى تم البيع",
    };
  });
}

async function upsertSalesOrderRecord(input: {
  normalized: NormalizedErpNextSalesOrder;
  userStatus: UserLinkStatus;
  mapping: PlatformUserMapping | null;
  trackingOrderId: string | null;
  warnings: LinkWarning[];
}) {
  const { normalized, userStatus, mapping, trackingOrderId, warnings } = input;
  const first: ErpNextVehiclePayload = normalized.payloads[0] || ({ orderNo: normalized.orderNo } as ErpNextVehiclePayload);
  const firstTotals = first.totals || {};
  const subtotalBeforeTax = numberValue(firstTotals.subtotalBeforeTax);
  const taxValue = normalized.payloads.reduce((sum, payload) => sum + numberValue(payload.totals?.carTaxValue), 0);
  const totalInclVat = numberValue(firstTotals.grandTotal || firstTotals.carTotalInclVAT);
  const registrationFee = normalized.payloads.reduce((sum, payload) => sum + numberValue(payload.totals?.registrationFee), 0);
  const sql = getSql();

  return sql.begin(async (tx: any) => {
    let [row] = await tx<any[]>`
      select *,id::text,platform_user_id::text,crm_lead_id::text,tracking_order_id::text
      from integrations.erpnext_sales_orders
      where source_instance_key=${normalized.sourceInstanceKey}
      limit 1 for update
    `;

    if (!row) {
      [row] = await tx<any[]>`
        select *,id::text,platform_user_id::text,crm_lead_id::text,tracking_order_id::text
        from integrations.erpnext_sales_orders
        where sales_order_no=${normalized.orderNo} and coalesce(is_cancelled,false)=false
          and (erp_created_at is null or source_instance_key like ${`next-erp:sales-order:${normalized.orderNo}:legacy:%`})
        order by received_at desc,updated_at desc
        limit 1 for update
      `;
    }

    if (row) {
      [row] = await tx<any[]>`
        update integrations.erpnext_sales_orders set
          source_instance_key=${normalized.sourceInstanceKey},erp_created_at=${normalized.erpCreatedAt === "legacy" ? null : normalized.erpCreatedAt}::timestamptz,
          erp_status=${normalized.erpStatus||null},erp_event=${normalized.erpEvent||null},erp_sales_person=${normalized.erpSalesPerson||null},
          accounting_customer_name=${normalized.accountingCustomerName||null},actual_customer_name=${normalized.actualCustomerName||null},
          actual_customer_phone=${normalized.actualCustomerPhone||null},actual_customer_phone_normalized=${normalized.actualCustomerPhoneNormalized||null},
          customer_vat=${normalized.customerVat||null},order_date=${dateValue(normalized.orderDate)},delivery_date=${dateValue(normalized.deliveryDate)},
          erp_user_id=${normalized.erpUserId||null},erp_branch=${normalized.erpBranch||null},platform_user_id=${mapping?.id||null}::uuid,
          platform_user_name=${mapping?.full_name||null},platform_department_code=${mapping?.department_code||null},
          platform_department_name=${mapping?.department_name||null},platform_branch_code=${mapping?.branch_code||null},
          platform_branch_name=${mapping?.branch_name||null},tracking_order_id=coalesce(${trackingOrderId||null}::uuid,tracking_order_id),
          subtotal_before_tax=${subtotalBeforeTax},tax_value=${taxValue},total_incl_vat=${totalInclVat},registration_fee=${registrationFee},
          user_link_status=${userStatus},warnings=${tx.json(warnings)},source_payload=${tx.json(normalized.rawBody)},received_at=now(),updated_at=now()
        where id=${row.id}::uuid
        returning *,id::text,platform_user_id::text,crm_lead_id::text,tracking_order_id::text
      `;
      return row;
    }

    [row] = await tx<any[]>`
      insert into integrations.erpnext_sales_orders(
        sales_order_no,source_instance_key,erp_created_at,erp_status,erp_event,erp_sales_person,accounting_customer_name,actual_customer_name,actual_customer_phone,
        actual_customer_phone_normalized,customer_vat,order_date,delivery_date,erp_user_id,erp_branch,
        platform_user_id,platform_user_name,platform_department_code,platform_department_name,platform_branch_code,platform_branch_name,
        tracking_order_id,subtotal_before_tax,tax_value,total_incl_vat,registration_fee,user_link_status,warnings,source_payload,received_at,updated_at
      ) values(
        ${normalized.orderNo},${normalized.sourceInstanceKey},${normalized.erpCreatedAt === "legacy" ? null : normalized.erpCreatedAt}::timestamptz,
        ${normalized.erpStatus||null},${normalized.erpEvent||null},${normalized.erpSalesPerson||null},${normalized.accountingCustomerName||null},
        ${normalized.actualCustomerName||null},${normalized.actualCustomerPhone||null},${normalized.actualCustomerPhoneNormalized||null},
        ${normalized.customerVat||null},${dateValue(normalized.orderDate)},${dateValue(normalized.deliveryDate)},${normalized.erpUserId||null},${normalized.erpBranch||null},
        ${mapping?.id||null}::uuid,${mapping?.full_name||null},${mapping?.department_code||null},${mapping?.department_name||null},
        ${mapping?.branch_code||null},${mapping?.branch_name||null},${trackingOrderId||null}::uuid,
        ${subtotalBeforeTax},${taxValue},${totalInclVat},${registrationFee},${userStatus},${tx.json(warnings)},${tx.json(normalized.rawBody)},now(),now()
      ) returning *,id::text,platform_user_id::text,crm_lead_id::text,tracking_order_id::text
    `;
    return row;
  });
}

async function linkOperationsVehicles(input: {
  orderId: string;
  normalized: NormalizedErpNextSalesOrder;
  mapping: PlatformUserMapping | null;
  trackingResults: TrackingIngestResult[];
  canApplySale: boolean;
  skipStatus: string;
  warnings: LinkWarning[];
}) {
  const { orderId, normalized, mapping, trackingResults, canApplySale, skipStatus, warnings } = input;
  const sql = getSql();
  let linked = 0;
  let changed = 0;
  let missing = 0;

  await sql.begin(async (tx: any) => {
    for (let index = 0; index < normalized.payloads.length; index += 1) {
      const payload = normalized.payloads[index];
      const item = payload.item || {};
      const totals = payload.totals || {};
      const trackingResult = trackingResults[index];
      const itemNo = clean(item.no) || String(index + 1);
      const vin = clean(item.vin).toUpperCase();
      const itemIdentity = clean(payload.sourceItemIdentity) || `${normalized.orderNo}:item:${vin || itemNo}`;

      let operationsVehicle: any = null;
      if (vin) {
        const matches = await tx`
          select *,id::text,location_id::text
          from operations.vehicles
          where is_deleted=false and upper(trim(vin))=upper(trim(${vin}))
          order by updated_at desc
          limit 2 for update
        `;
        if (matches.length > 1) {
          warnings.push({ code: "OPERATIONS_VIN_DUPLICATED", message: "رقم الهيكل مكرر في مخزون العمليات؛ لم يتم تعديل أي سيارة", vin, itemNo });
        } else {
          operationsVehicle = matches[0] || null;
        }
      }

      let appliedStatus: string | null = operationsVehicle ? clean(operationsVehicle.status_code) || null : null;
      let appliedAt: string | null = null;
      if (!vin) {
        missing += 1;
        warnings.push({ code: "VIN_MISSING", message: "رقم الهيكل غير موجود؛ تعذر ربط السيارة بمخزون العمليات", itemNo });
      } else if (!operationsVehicle) {
        missing += 1;
        if (!warnings.some((warning) => warning.code === "OPERATIONS_VIN_DUPLICATED" && warning.vin === vin)) {
          warnings.push({ code: "OPERATIONS_VEHICLE_NOT_FOUND", message: "رقم الهيكل غير موجود في مخزون العمليات", vin, itemNo });
        }
      } else {
        linked += 1;
        if (trackingResult?.vehicleId) {
          await tx`
            update tracking.order_vehicles
            set vehicle_id=${operationsVehicle.id}::uuid,updated_at=now()
            where id=${trackingResult.vehicleId}::uuid
          `;
        }

        if (canApplySale) {
          if (operationsVehicle.status_code === "delivered") {
            appliedStatus = "delivered";
            warnings.push({ code: "OPERATIONS_STATUS_PRESERVED", message: "السيارة مسجلة مباع تم التسليم؛ لم يتم إرجاع حالتها", vin, itemNo });
          } else if (operationsVehicle.status_code === "under_delivery") {
            await ensureActiveVehicleApprovalCycle(tx, operationsVehicle.id);
            appliedStatus = "under_delivery";
          } else {
            const oldStatus = clean(operationsVehicle.status_code);
            const actorName = mapping?.full_name || "NEXT ERP";
            const locationId = operationsVehicle.location_id || null;
            [operationsVehicle] = await tx`
              update operations.vehicles set
                status_code='under_delivery',updated_by=${mapping?.id||null}::uuid,updated_by_name=${actorName},
                state_note=${`مباع تحت التسليم — طلب البيع ${normalized.orderNo}`},updated_at=now(),version=version+1
              where id=${operationsVehicle.id}::uuid
              returning *,id::text,location_id::text
            `;
            appliedStatus = "under_delivery";
            appliedAt = new Date().toISOString();
            changed += 1;
            await tx`
              insert into operations.movements(
                vehicle_id,from_location_id,to_location_id,old_status,new_status,note,performed_by,movement_type,
                state_note,performed_by_name,performed_by_role,performed_by_branch,before_data,after_data
              ) values(
                ${operationsVehicle.id}::uuid,${locationId}::uuid,${locationId}::uuid,
                ${oldStatus||null},'under_delivery',${`تحديث تلقائي من طلب البيع ${normalized.orderNo} في NEXT ERP`},${mapping?.id||null}::uuid,'erpnext_sale',
                ${`فرع البيع في NEXT ERP: ${normalized.erpBranch||"—"}`},${actorName},'NEXT ERP',${mapping?.branch_name||mapping?.branch_code||null},
                ${tx.json({ statusCode: oldStatus, locationId, salesOrderNo: normalized.orderNo })},
                ${tx.json({ statusCode: "under_delivery", locationId, salesOrderNo: normalized.orderNo, salesBranch: normalized.erpBranch })}
              )
            `;
            await tx`
              insert into operations.vehicle_status_notes(vehicle_id,status_code,note,created_by,created_by_name)
              values(
                ${operationsVehicle.id}::uuid,'under_delivery',
                ${`تم ربط السيارة بطلب البيع ${normalized.orderNo} من NEXT ERP دون تغيير مكانها الحالي`},
                ${mapping?.id||null}::uuid,${actorName}
              )
            `;
            await startFreshVehicleApprovalCycle(tx, operationsVehicle.id);
          }
        }
      }

      await tx`
        insert into integrations.erpnext_sales_order_vehicles(
          sales_order_id,item_identity,item_no,vin,item_type,item_category,item_model,interior_color,exterior_color,dealer,
          qty,unit_price,item_value,total_incl_vat,tracking_vehicle_id,operations_vehicle_id,operations_status_code,operations_status_applied_at,raw_payload,updated_at
        ) values(
          ${orderId}::uuid,${itemIdentity},${itemNo||null},${vin||null},${clean(item.type)||null},${clean(item.category)||null},${clean(item.model)||null},
          ${clean(item.interiorColor)||null},${clean(item.exteriorColor)||null},${clean(item.dealer)||null},${numberValue(item.qty)||1},
          ${numberValue(item.unitPrice)},${numberValue(item.value)},${numberValue(totals.carTotalInclVAT)},${trackingResult?.vehicleId||null}::uuid,
          ${operationsVehicle?.id||null}::uuid,${appliedStatus},${appliedAt}::timestamptz,${tx.json(payload)},now()
        )
        on conflict(sales_order_id,item_identity) do update set
          item_no=excluded.item_no,vin=excluded.vin,item_type=excluded.item_type,item_category=excluded.item_category,item_model=excluded.item_model,
          interior_color=excluded.interior_color,exterior_color=excluded.exterior_color,dealer=excluded.dealer,qty=excluded.qty,
          unit_price=excluded.unit_price,item_value=excluded.item_value,total_incl_vat=excluded.total_incl_vat,
          tracking_vehicle_id=coalesce(excluded.tracking_vehicle_id,integrations.erpnext_sales_order_vehicles.tracking_vehicle_id),
          operations_vehicle_id=coalesce(excluded.operations_vehicle_id,integrations.erpnext_sales_order_vehicles.operations_vehicle_id),
          operations_status_code=coalesce(excluded.operations_status_code,integrations.erpnext_sales_order_vehicles.operations_status_code),
          operations_status_applied_at=coalesce(excluded.operations_status_applied_at,integrations.erpnext_sales_order_vehicles.operations_status_applied_at),
          raw_payload=excluded.raw_payload,updated_at=now()
      `;
    }

    const status = canApplySale
      ? (linked === normalized.payloads.length ? "linked" : linked > 0 ? "partial" : "not_linked")
      : skipStatus;
    await tx`
      update integrations.erpnext_sales_orders
      set operations_link_status=${status},warnings=${tx.json(uniqueWarnings(warnings))},updated_at=now()
      where id=${orderId}::uuid
    `;
  });

  return {
    status: canApplySale
      ? (linked === normalized.payloads.length ? "linked" : linked > 0 ? "partial" : "not_linked")
      : skipStatus,
    linked,
    changed,
    missing,
  };
}

export async function cancelErpNextSalesOrder(input: {
  normalized: NormalizedErpNextSalesOrder;
}) {
  await ensureCrmSchema();
  await ensureOperationsSchema();
  await ensureTrackingSchema();
  await ensureErpNextUserMappingSchema();
  await ensureErpNextSalesOrderSchema();

  const { normalized } = input;
  const sql = getSql();
  const warnings: LinkWarning[] = [];
  const cancellationReason = `تم إلغاء طلب البيع ${normalized.orderNo} من NEXT ERP`;
  const actorName = "NEXT ERP Integration";

  const result = await sql.begin(async (tx: any) => {
    let [order] = await tx<any[]>`
      select *,id::text,platform_user_id::text,crm_lead_id::text,tracking_order_id::text
      from integrations.erpnext_sales_orders
      where source_instance_key=${normalized.sourceInstanceKey}
      limit 1 for update
    `;

    if (!order) {
      [order] = await tx<any[]>`
        select *,id::text,platform_user_id::text,crm_lead_id::text,tracking_order_id::text
        from integrations.erpnext_sales_orders
        where sales_order_no=${normalized.orderNo} and coalesce(is_cancelled,false)=false
          and (
            ${normalized.erpCreatedAt === "legacy"}=true
            or erp_created_at=${normalized.erpCreatedAt === "legacy" ? null : normalized.erpCreatedAt}::timestamptz
            or erp_created_at is null
          )
        order by received_at desc,updated_at desc
        limit 1 for update
      `;
    }

    if (!order) {
      warnings.push({
        code: "ERP_CANCEL_ORDER_NOT_FOUND",
        message: `لم يتم العثور على نسخة طلب ${normalized.orderNo} داخل المنصة لإلغائها`,
      });
      return {
        found: false,
        alreadyCancelled: false,
        integrationOrderId: null,
        trackingCancelled: 0,
        operations: { linked: 0, returnedToAvailable: 0, preserved: 0 },
        crm: { status: "not_found", leadId: null, restored: false },
      };
    }

    if (order.is_cancelled) {
      return {
        found: true,
        alreadyCancelled: true,
        integrationOrderId: order.id,
        trackingCancelled: order.tracking_order_id ? 1 : 0,
        operations: { linked: 0, returnedToAvailable: 0, preserved: 0 },
        crm: { status: "already_cancelled", leadId: order.crm_lead_id || null, restored: false },
      };
    }

    [order] = await tx<any[]>`
      update integrations.erpnext_sales_orders set
        erp_status=coalesce(nullif(${normalized.erpStatus},''),'Cancelled'),erp_event=${normalized.erpEvent||"sales_order.cancelled"},
        is_cancelled=true,cancelled_at=now(),cancellation_reason=${cancellationReason},source_payload=${tx.json(normalized.rawBody)},updated_at=now()
      where id=${order.id}::uuid
      returning *,id::text,platform_user_id::text,crm_lead_id::text,tracking_order_id::text
    `;

    const trackingRows = await tx<any[]>`
      update tracking.orders set
        is_cancelled=true,cancelled_at=now(),cancellation_reason=${cancellationReason},cancellation_source='next_erp',updated_at=now()
      where coalesce(is_deleted,false)=false and (
        id=${order.tracking_order_id||null}::uuid
        or source_instance_key=${order.source_instance_key}
        or source_identity=${order.source_instance_key}
      )
      returning id::text
    `;

    const salesVehicles = await tx<any[]>`
      select sov.*,sov.id::text,sov.operations_vehicle_id::text,sov.tracking_vehicle_id::text
      from integrations.erpnext_sales_order_vehicles sov
      where sov.sales_order_id=${order.id}::uuid
      order by sov.created_at,sov.id
      for update
    `;

    let returnedToAvailable = 0;
    let preserved = 0;
    let linked = 0;

    for (const salesVehicle of salesVehicles) {
      await tx`
        update integrations.erpnext_sales_order_vehicles
        set is_cancelled=true,cancelled_at=now(),updated_at=now()
        where id=${salesVehicle.id}::uuid
      `;
      if (!salesVehicle.operations_vehicle_id) continue;
      linked += 1;

      const [newerActiveOrder] = await tx<any[]>`
        select so.id::text,so.sales_order_no,so.source_instance_key
        from integrations.erpnext_sales_order_vehicles other_vehicle
        join integrations.erpnext_sales_orders so on so.id=other_vehicle.sales_order_id
        where other_vehicle.operations_vehicle_id=${salesVehicle.operations_vehicle_id}::uuid
          and so.id<>${order.id}::uuid
          and coalesce(so.is_cancelled,false)=false
          and coalesce(other_vehicle.is_cancelled,false)=false
          and coalesce(so.erp_created_at,so.received_at)>coalesce(${order.erp_created_at}::timestamptz,${order.received_at}::timestamptz)
        order by coalesce(so.erp_created_at,so.received_at) desc
        limit 1
      `;
      if (newerActiveOrder) {
        preserved += 1;
        warnings.push({
          code: "OPERATIONS_NEWER_SALES_ORDER_PRESERVED",
          message: `لم تتغير السيارة لأن عليها طلب بيع أحدث: ${newerActiveOrder.sales_order_no}`,
          vin: clean(salesVehicle.vin),
          itemNo: clean(salesVehicle.item_no),
        });
        continue;
      }

      const [vehicle] = await tx<any[]>`
        select *,id::text,location_id::text
        from operations.vehicles
        where id=${salesVehicle.operations_vehicle_id}::uuid and is_deleted=false
        for update
      `;
      if (!vehicle) continue;

      const [activeApproval] = await tx<any[]>`
        select *,id::text from operations.vehicle_approvals
        where vehicle_id=${vehicle.id}::uuid and is_active=true
        order by cycle_no desc limit 1 for update
      `;

      if (vehicle.archived_at || clean(vehicle.status_code) === "delivered") {
        preserved += 1;
        warnings.push({
          code: "OPERATIONS_CANCEL_REVIEW_REQUIRED",
          message: vehicle.archived_at
            ? "السيارة مؤرشفة؛ تم تسجيل إلغاء طلب البيع دون إرجاع حالتها تلقائيًا"
            : "السيارة مباع تم التسليم؛ تم تسجيل إلغاء طلب البيع وتحتاج مراجعة إدارية",
          vin: clean(salesVehicle.vin),
          itemNo: clean(salesVehicle.item_no),
        });
        continue;
      }

      if (activeApproval) {
        const beforeApproval = { ...activeApproval };
        const [closedApproval] = await tx<any[]>`
          update operations.vehicle_approvals
          set is_active=false,pending_delivery=null,updated_at=now()
          where id=${activeApproval.id}::uuid
          returning *,id::text
        `;
        await tx`
          insert into operations.approval_events(
            approval_id,vehicle_id,cycle_no,approval_type,action,note,actor_id,actor_name,actor_role,before_data,after_data
          ) values(
            ${closedApproval.id}::uuid,${vehicle.id}::uuid,${closedApproval.cycle_no},'all','cancelled',${cancellationReason},
            ${order.platform_user_id||null}::uuid,${actorName},'NEXT ERP',${tx.json(beforeApproval)},${tx.json(closedApproval)}
          )
        `;
      }

      if (clean(vehicle.status_code) === "under_delivery") {
        const oldStatus = clean(vehicle.status_code);
        const locationId = vehicle.location_id || null;
        await tx`
          update operations.vehicles set
            status_code='available_for_sale',state_note=${cancellationReason},updated_by=${order.platform_user_id||null}::uuid,
            updated_by_name=${actorName},updated_at=now(),version=version+1
          where id=${vehicle.id}::uuid
        `;
        await tx`
          insert into operations.movements(
            vehicle_id,from_location_id,to_location_id,old_status,new_status,note,performed_by,movement_type,
            state_note,performed_by_name,performed_by_role,performed_by_branch,before_data,after_data
          ) values(
            ${vehicle.id}::uuid,${locationId}::uuid,${locationId}::uuid,${oldStatus},'available_for_sale',${cancellationReason},
            ${order.platform_user_id||null}::uuid,'erpnext_sale_cancelled',${cancellationReason},${actorName},'NEXT ERP',${order.platform_branch_name||order.platform_branch_code||null},
            ${tx.json({ statusCode: oldStatus, locationId, salesOrderNo: order.sales_order_no, sourceInstanceKey: order.source_instance_key })},
            ${tx.json({ statusCode: "available_for_sale", locationId, salesOrderNo: null, cancelledSalesOrderNo: order.sales_order_no })}
          )
        `;
        await tx`
          insert into operations.vehicle_status_notes(vehicle_id,status_code,note,created_by,created_by_name)
          values(${vehicle.id}::uuid,'available_for_sale',${cancellationReason},${order.platform_user_id||null}::uuid,${actorName})
        `;
        returnedToAvailable += 1;
      } else {
        preserved += 1;
      }
    }

    let crm = { status: "not_linked", leadId: order.crm_lead_id || null, restored: false };
    if (order.crm_lead_id) {
      const [lead] = await tx<any[]>`
        select *,id::text,current_request_id::text,assigned_to::text
        from crm.leads where id=${order.crm_lead_id}::uuid and is_deleted=false for update
      `;
      if (lead) {
        let effectivePreviousState = order.crm_previous_state;
        let effectiveCreatedByIntegration = Boolean(order.crm_created_by_integration);
        if (!effectivePreviousState && !effectiveCreatedByIntegration) {
          const [historicalOrigin] = await tx<any[]>`
            select crm_previous_state,crm_created_by_integration
            from integrations.erpnext_sales_orders
            where crm_lead_id=${lead.id}::uuid and id<>${order.id}::uuid
              and (crm_previous_state is not null or crm_created_by_integration=true)
            order by received_at asc
            limit 1
          `;
          effectivePreviousState = historicalOrigin?.crm_previous_state || null;
          effectiveCreatedByIntegration = Boolean(historicalOrigin?.crm_created_by_integration);
        }
        const activeOrders = await tx<any[]>`
          select sales_order_no,source_instance_key
          from integrations.erpnext_sales_orders
          where crm_lead_id=${lead.id}::uuid and coalesce(is_cancelled,false)=false and id<>${order.id}::uuid
          order by received_at desc
        `;
        const extraData = lead.extra_data && typeof lead.extra_data === "object" ? { ...lead.extra_data } : {};
        extraData.salesOrderInstances = activeOrders.map((activeOrder: any) => activeOrder.source_instance_key).filter(Boolean);
        extraData.salesOrders = [...new Set(activeOrders.map((activeOrder: any) => clean(activeOrder.sales_order_no)).filter(Boolean))];
        extraData.lastCancelledSalesOrder = {
          orderNo: order.sales_order_no,
          sourceInstanceKey: order.source_instance_key,
          cancelledAt: new Date().toISOString(),
        };

        let nextStatus = clean(lead.status_label);
        if (activeOrders.length > 0) {
          await tx`update crm.leads set extra_data=${tx.json(extraData)},updated_at=now() where id=${lead.id}::uuid`;
          crm = { status: "active_order_preserved", leadId: lead.id, restored: false };
        } else if (effectivePreviousState && typeof effectivePreviousState === "object") {
          const previous = effectivePreviousState as Record<string, any>;
          nextStatus = clean(previous.statusLabel) || "عميل جديد";
          const previousRequestId = clean(previous.currentRequestId);
          await tx`
            update crm.leads set
              status_code=${clean(previous.statusCode)||null},status_label=${nextStatus},department_code=${clean(previous.departmentCode)||lead.department_code||null},
              branch_code=${clean(previous.branchCode)||lead.branch_code||null},service_key=${clean(previous.serviceKey)||lead.service_key||null},
              payment_type=${clean(previous.paymentType)||lead.payment_type||null},assigned_to=${clean(previous.assignedTo)||null}::uuid,
              responsible_name_snapshot=${clean(previous.responsibleName)||null},current_request_id=${previousRequestId||null}::uuid,
              extra_data=${tx.json(extraData)},updated_by=${order.platform_user_id||null}::uuid,updated_at=now()
            where id=${lead.id}::uuid
          `;
          if (previousRequestId && previous.request && typeof previous.request === "object") {
            const requestState = previous.request as Record<string, any>;
            await tx`
              update crm.service_requests set
                service_key=${clean(requestState.service_key)||clean(previous.serviceKey)||lead.service_key||null},
                department_code=${clean(requestState.department_code)||clean(previous.departmentCode)||lead.department_code||null},
                branch_code=${clean(requestState.branch_code)||clean(previous.branchCode)||lead.branch_code||null},
                status_label=${clean(requestState.status_label)||nextStatus},request_state=${clean(requestState.request_state)||'open'},
                assigned_to=${clean(requestState.assigned_to)||clean(previous.assignedTo)||null}::uuid,
                closed_at=${requestState.closed_at||null}::timestamptz,closed_by=${clean(requestState.closed_by)||null}::uuid,
                closure_reason=${clean(requestState.closure_reason)||null},updated_at=now()
              where id=${previousRequestId}::uuid
            `;
          }
          crm = { status: "restored_previous_state", leadId: lead.id, restored: true };
        } else if (effectiveCreatedByIntegration) {
          nextStatus = "عميل جديد";
          await tx`
            update crm.leads set status_code=null,status_label='عميل جديد',current_request_id=null,extra_data=${tx.json(extraData)},
              updated_by=${order.platform_user_id||null}::uuid,updated_at=now()
            where id=${lead.id}::uuid
          `;
          crm = { status: "created_lead_reopened", leadId: lead.id, restored: true };
        } else {
          await tx`update crm.leads set extra_data=${tx.json(extraData)},updated_at=now() where id=${lead.id}::uuid`;
          crm = { status: "cancel_recorded", leadId: lead.id, restored: false };
        }

        await tx`
          insert into crm.lead_events(
            lead_id,event_type,old_status,new_status,old_department,new_department,old_branch,new_branch,
            actor_id,actor_name,actor_role,note,details,created_at
          ) values(
            ${lead.id}::uuid,'erpnext_sales_order_cancelled',${clean(lead.status_label)||null},${nextStatus||clean(lead.status_label)||null},
            ${clean(lead.department_code)||null},${clean(lead.department_code)||null},${clean(lead.branch_code)||null},${clean(lead.branch_code)||null},
            ${order.platform_user_id||null}::uuid,${actorName},'NEXT ERP',${cancellationReason},
            ${tx.json({ salesOrderNo: order.sales_order_no, sourceInstanceKey: order.source_instance_key, crmStatus: crm.status })},now()
          )
        `;
      }
    }

    await tx`
      update integrations.erpnext_sales_orders set
        crm_link_status=${crm.status},operations_link_status='cancelled',warnings=${tx.json(uniqueWarnings(warnings))},updated_at=now()
      where id=${order.id}::uuid
    `;

    return {
      found: true,
      alreadyCancelled: false,
      integrationOrderId: order.id,
      trackingCancelled: trackingRows.length,
      operations: { linked, returnedToAvailable, preserved },
      crm,
    };
  });

  return { ...result, warnings: uniqueWarnings(warnings) };
}

export async function syncErpNextSalesOrder(input: {
  normalized: NormalizedErpNextSalesOrder;
  trackingResults: TrackingIngestResult[];
}) {
  await ensureCrmSchema();
  await ensureOperationsSchema();
  await ensureTrackingSchema();
  await ensureErpNextUserMappingSchema();
  await ensureErpNextSalesOrderSchema();

  const { normalized, trackingResults } = input;
  const warnings: LinkWarning[] = normalized.warnings
    .filter((warning) => warning.code && warning.message)
    .map((warning) => ({
      code: warning.code || "NORMALIZATION_WARNING",
      message: warning.message || "تحذير في بيانات الطلب",
      itemNo: warning.itemNo,
    }));

  const userResolution = await resolvePlatformUser(normalized.erpUserId);
  const mapping = userResolution.mapping;
  if (userResolution.status === "missing_user_id") {
    warnings.push({ code: "ERP_USER_ID_MISSING", message: "مندوب البيع غير موجود في جدول Sales Team داخل طلب NEXT ERP" });
  } else if (userResolution.status === "user_not_mapped") {
    warnings.push({ code: "ERP_USER_NOT_MAPPED", message: `لا يوجد مستخدم في المنصة مربوط بمندوب NEXT ERP: ${normalized.erpUserId}` });
  } else if (userResolution.status === "department_not_configured") {
    warnings.push({ code: "PLATFORM_DEPARTMENT_MISSING", message: "المستخدم المربوط لا يملك قسمًا أساسيًا في المنصة" });
  } else if (userResolution.status === "unsupported_department") {
    warnings.push({ code: "PLATFORM_DEPARTMENT_UNSUPPORTED", message: `قسم المستخدم (${userResolution.candidate?.department_name || userResolution.candidate?.department_code || "غير محدد"}) غير صالح لربط عميل CRM` });
  } else if (userResolution.status === "platform_branch_not_configured") {
    warnings.push({ code: "PLATFORM_BRANCH_MISSING", message: "المستخدم المربوط لا يملك فرعًا أساسيًا في المنصة" });
  }

  const eligibleStatus = normalizeComparable(normalized.erpStatus) === "to deliver and bill";
  if (!eligibleStatus) {
    warnings.push({
      code: "ERP_STATUS_SKIPPED",
      message: `تم حفظ التراكينج فقط؛ حالة الطلب الحالية غير معتمدة لربط CRM والعمليات: ${normalized.erpStatus || "غير محددة"}`,
    });
  }

  const trackingOrderId = trackingResults.find((result) => result.orderId)?.orderId || null;
  const order = await upsertSalesOrderRecord({
    normalized,
    userStatus: userResolution.status,
    mapping,
    trackingOrderId,
    warnings,
  });
  const canApplyBusinessLink = eligibleStatus && userResolution.status === "linked" && Boolean(mapping) && !order.is_cancelled;
  if (order.is_cancelled) {
    warnings.push({ code: "ERP_INSTANCE_ALREADY_CANCELLED", message: "نسخة طلب البيع ملغاة بالفعل؛ لم يتم إعادة ربط CRM أو العمليات" });
  }

  let crm = {
    status: eligibleStatus ? userResolution.status : "skipped_status",
    leadId: null as string | null,
    created: false,
    message: eligibleStatus ? "لم يتم ربط CRM لعدم اكتمال ربط مستخدم NEXT ERP" : "لم يتم تشغيل ربط CRM بسبب حالة الطلب",
  };

  if (canApplyBusinessLink && !normalized.actualCustomerPhoneNormalized) {
    crm = {
      status: "missing_phone",
      leadId: null,
      created: false,
      message: "لم يتم ربط CRM لعدم وجود رقم جوال صالح للعميل الحقيقي",
    };
    warnings.push({
      code: "CRM_CUSTOMER_PHONE_MISSING",
      message: "رقم جوال العميل الحقيقي مفقود أو غير صالح؛ لم يتم إنشاء أو تعديل عميل CRM",
    });
  } else if (canApplyBusinessLink && mapping) {
    crm = await linkCrmCustomer({
      orderId: order.id,
      normalized,
      mapping,
      firstPayload: normalized.payloads[0],
    });
    if (crm.status === "ambiguous_phone") {
      warnings.push({ code: "CRM_PHONE_AMBIGUOUS", message: crm.message });
    }
  }

  const sql = getSql();
  await sql`
    update integrations.erpnext_sales_orders
    set crm_link_status=${crm.status},crm_lead_id=${crm.leadId||null}::uuid,warnings=${sql.json(uniqueWarnings(warnings))},updated_at=now()
    where id=${order.id}::uuid
  `;

  const operationsSkipStatus = !eligibleStatus ? "skipped_status" : userResolution.status;
  const operations = await linkOperationsVehicles({
    orderId: order.id,
    normalized,
    mapping,
    trackingResults,
    canApplySale: canApplyBusinessLink,
    skipStatus: operationsSkipStatus,
    warnings,
  });

  const finalWarnings = uniqueWarnings(warnings);
  await sql`
    update integrations.erpnext_sales_orders set
      crm_link_status=${crm.status},operations_link_status=${operations.status},warnings=${sql.json(finalWarnings)},updated_at=now()
    where id=${order.id}::uuid
  `;

  return {
    integrationOrderId: order.id,
    eligibleStatus,
    userLinkStatus: userResolution.status,
    platformUser: mapping ? {
      id: mapping.id,
      name: mapping.full_name,
      departmentCode: mapping.department_code,
      departmentName: mapping.department_name,
      branchCode: mapping.branch_code,
      branchName: mapping.branch_name,
    } : null,
    crm,
    operations,
    warnings: finalWarnings,
  };
}
