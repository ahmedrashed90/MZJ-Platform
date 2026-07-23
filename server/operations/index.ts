import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { ensureTrackingSchema } from "../_tracking-schema.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { ensureMarketingSchema } from "../_marketing-schema.js";
import { ensureErpNextSalesOrderSchema } from "../_erpnext-integration-schema.js";
import { tryArchiveEligibleVehicle } from "../_operations-auto-archive.js";
import { closeActiveVehicleApprovalCycle, ensureActiveVehicleApprovalCycle, startFreshVehicleApprovalCycle } from "../_operations-approval-cycle.js";
import {
  hasPermission,
  isSystemAdmin,
  primaryBranch,
  primaryRole,
  requireOperationsPermission,
  requireOperationsUser,
} from "../_operations-auth.js";
import {
  boolValue,
  clean,
  intValue,
  OperationError,
  parseBody,
  requestId,
  sendOperationError,
} from "../_operations-utils.js";

type QueryRequest = Pick<VercelRequest, "query">;

function pageValues(request: QueryRequest) {
  const page = Math.max(1, intValue(request.query.page, 1));
  const pageSize = Math.min(200, Math.max(10, intValue(request.query.pageSize, 50)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function actor(user: Awaited<ReturnType<typeof requireOperationsUser>>) {
  if (!user) throw new Error("AUTH_REQUIRED");
  return {
    id: user.id,
    name: user.fullName,
    role: primaryRole(user),
    branch: primaryBranch(user),
    email: user.email,
  };
}

function accessScope(sql: ReturnType<typeof getSql>, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>, alias = "l") {
  if (isSystemAdmin(user) || user.branchCodes.length === 0) return sql`true`;
  if (alias === "sl") return sql`coalesce(sl.branch_code,sl.code) in ${sql(user.branchCodes)}`;
  if (alias === "dl") return sql`coalesce(dl.branch_code,dl.code) in ${sql(user.branchCodes)}`;
  if (alias === "tl") return sql`coalesce(tl.branch_code,tl.code) in ${sql(user.branchCodes)}`;
  return sql`coalesce(l.branch_code,l.code) in ${sql(user.branchCodes)}`;
}

function hasBranchAccess(
  user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>,
  branchCode?: string | null,
  locationCode?: string | null,
) {
  if (isSystemAdmin(user) || user.branchCodes.length === 0) return true;
  const candidates = [branchCode, locationCode].map((value) => clean(value)).filter(Boolean);
  return candidates.some((value) => user.branchCodes.includes(value));
}

function assertBranchAccess(
  user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>,
  branchCode?: string | null,
  locationCode?: string | null,
  message = "لا تملك صلاحية تنفيذ الإجراء على هذا الفرع",
) {
  if (!hasBranchAccess(user, branchCode, locationCode)) throw new OperationError(403, "FORBIDDEN", message);
}

async function loadMeta(sql: ReturnType<typeof getSql>, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const [locations, statuses, checkItems] = await Promise.all([
    sql<any[]>`select id::text,code,name,branch_code,is_agency,sort_order from operations.locations where is_active=true order by sort_order,name`,
    sql<any[]>`
      select code,name,sort_order,is_actual_stock,is_delivery_status,is_terminal
      from (
        select distinct on (lower(trim(name))) code,name,sort_order,is_actual_stock,is_delivery_status,is_terminal
        from operations.vehicle_statuses
        where is_active=true and nullif(trim(name),'') is not null
        order by lower(trim(name)),case when code in ('available_for_sale','reserved','has_notes','under_delivery','delivered') then 0 else 1 end,sort_order,code
      ) deduped
      order by sort_order,name
    `,
    sql<any[]>`select code,name,sort_order from operations.check_item_definitions where is_active=true order by sort_order`,
  ]);
  return {
    ok: true,
    locations,
    statuses,
    checkItems,
    permissions: {
      canCreateVehicle: hasPermission(user, "operations.vehicle.create"),
      canEditVehicle: hasPermission(user, "operations.vehicle.edit"),
      canDeleteVehicle: hasPermission(user, "operations.vehicle.delete"),
      canArchiveVehicle: hasPermission(user, "operations.vehicle.archive"),
      canImport: hasPermission(user, "operations.vehicle.import"),
      canExport: hasPermission(user, "operations.vehicle.export"),
      canMove: hasPermission(user, "operations.movement.create"),
      canCreateTransfer: hasPermission(user, "operations.transfer.create"),
      canManagePhotoRequests: hasPermission(user, "operations.transfer.create"),
      canApproveFinancial: hasPermission(user, "operations.approval.financial"),
      canApproveAdministrative: hasPermission(user, "operations.approval.administrative"),
      canManageSettings: hasPermission(user, "operations.settings.manage"),
      isSystemAdmin: isSystemAdmin(user),
    },
  };
}

async function listVehicles(sql: ReturnType<typeof getSql>, request: VercelRequest, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const search = clean(request.query.search);
  const location = clean(request.query.location);
  const status = clean(request.query.status);
  const model = clean(request.query.model);
  const agent = clean(request.query.agent);
  const archived = boolValue(request.query.archived);
  const all = boolValue(request.query.all);
  const activeOnly = !archived && !all;
  const { page, pageSize, offset } = pageValues(request);
  const pattern = `%${search}%`;
  const scope = accessScope(sql, user, "l");

  const [countRow] = await sql<{ total: number }[]>`
    select count(*)::int as total
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    where v.is_deleted=false
      and (${all}=true or ${activeOnly}=false or (v.archived_at is null and v.is_inventory_active=true))
      and (${all}=true or ${archived}=false or v.archived_at is not null)
      and (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern})
      and (${location}='' or l.code=${location})
      and (${status}='' or v.status_code=${status})
      and (${model}='' or coalesce(v.model_year,'')=${model})
      and (${agent}='' or coalesce(v.agent_name,'') ilike ${`%${agent}%`})
      and ${scope}
  `;

  const rows = await sql<any[]>`
    select
      v.id::text,v.vin,v.car_name,v.statement,v.agent_name,v.exterior_color,v.interior_color,v.model_year,v.plate_no,v.batch_no,
      v.location_id::text,l.code as location_code,l.name as location_name,l.branch_code,
      v.status_code,coalesce(s.name,v.status_code) as status_name,v.source_type,v.has_notes,v.notes,v.state_note,v.shortage_note,
      v.archived_at,v.archive_reason,v.created_by_name,v.updated_by_name,v.created_at,v.updated_at,v.version,
      coalesce(a.financial_approved,false) as financial_approved,
      coalesce(a.administrative_approved,false) as administrative_approved,
      coalesce(a.financial_note,'') as financial_note,coalesce(a.administrative_note,'') as administrative_note,
      coalesce(tr.active_orders,0)::int as tracking_active_orders,tr.order_id::text as tracking_order_id,tr.sales_order_no as tracking_order_no,
      tr.status as tracking_status,coalesce(tr.progress,0)::int as tracking_progress,
      coalesce(req.active_requests,0)::int as active_transfer_requests
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join operations.vehicle_statuses s on s.code=v.status_code
    left join lateral (
      select va.* from operations.vehicle_approvals va where va.vehicle_id=v.id and va.is_active=true order by va.cycle_no desc limit 1
    ) a on true
    left join lateral (
      select count(*) over() as active_orders,o.id as order_id,o.sales_order_no,o.status,
        case when count(vs.id)=0 then 0 else round(100.0*count(vs.id) filter(where vs.status='completed')/count(vs.id)) end as progress
      from tracking.order_vehicles ov
      join tracking.orders o on o.id=ov.order_id and coalesce(o.is_deleted,false)=false and coalesce(o.is_archived,false)=false
      left join tracking.vehicle_stages vs on vs.vehicle_id=ov.id
      where (ov.vehicle_id=v.id or (ov.vehicle_id is null and ov.vin=v.vin))
      group by o.id,o.sales_order_no,o.status,o.updated_at
      order by case when o.status='in_progress' then 0 when o.status='not_started' then 1 else 2 end,o.updated_at desc
      limit 1
    ) tr on true
    left join lateral (
      select count(distinct r.id)::int as active_requests
      from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id
      where rv.vehicle_id=v.id and r.is_deleted=false and r.cancelled_at is null and r.status<>'completed'
    ) req on true
    where v.is_deleted=false
      and (${all}=true or ${activeOnly}=false or (v.archived_at is null and v.is_inventory_active=true))
      and (${all}=true or ${archived}=false or v.archived_at is not null)
      and (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern})
      and (${location}='' or l.code=${location})
      and (${status}='' or v.status_code=${status})
      and (${model}='' or coalesce(v.model_year,'')=${model})
      and (${agent}='' or coalesce(v.agent_name,'') ilike ${`%${agent}%`})
      and ${scope}
    order by v.updated_at desc,v.vin
    limit ${pageSize} offset ${offset}
  `;
  return { ok: true, rows, total: Number(countRow?.total || 0), page, pageSize };
}

async function vehicleDetail(sql: ReturnType<typeof getSql>, id: string, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const scope = accessScope(sql, user, "l");
  const [vehicle] = await sql<any[]>`
    select v.*,v.id::text,v.location_id::text,l.code as location_code,l.name as location_name,l.branch_code,
      coalesce(s.name,v.status_code) as status_name
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join operations.vehicle_statuses s on s.code=v.status_code
    where v.id=${id}::uuid and v.is_deleted=false and ${scope}
  `;
  if (!vehicle) throw new OperationError(404, "VEHICLE_NOT_FOUND", "السيارة غير موجودة أو لا تملك صلاحية عرضها");

  const [checks, checkHistory, approvals, approvalEvents, movements, transfers, tracking, salesOrders, archiveEvents, notes] = await Promise.all([
    sql<any[]>`
      select d.code,d.name,d.sort_order,coalesce(v.status,'unknown') as status,v.note,v.updated_by_name,v.updated_at
      from operations.check_item_definitions d left join operations.vehicle_check_values v on v.item_code=d.code and v.vehicle_id=${id}::uuid
      where d.is_active=true order by d.sort_order
    `,
    sql<any[]>`select * from operations.vehicle_check_history where vehicle_id=${id}::uuid order by created_at desc limit 100`,
    sql<any[]>`select *,id::text from operations.vehicle_approvals where vehicle_id=${id}::uuid order by cycle_no desc,created_at desc`,
    sql<any[]>`select * from operations.approval_events where vehicle_id=${id}::uuid order by created_at desc limit 100`,
    sql<any[]>`
      select m.*,m.id::text,m.batch_id::text,m.transfer_request_id::text,fl.name as from_location_name,tl.name as to_location_name
      from operations.movements m left join operations.locations fl on fl.id=m.from_location_id left join operations.locations tl on tl.id=m.to_location_id
      where m.vehicle_id=${id}::uuid order by m.created_at desc limit 150
    `,
    sql<any[]>`
      select r.id::text,r.request_no,r.request_kind,r.status,r.requested_by_name,r.requested_at,r.completed_at,r.cancelled_at,
        sl.name as source_location_name,dl.name as destination_location_name
      from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id
      left join operations.locations sl on sl.id=r.source_location_id left join operations.locations dl on dl.id=r.destination_location_id
      where rv.vehicle_id=${id}::uuid order by r.requested_at desc
    `,
    sql<any[]>`
      select o.id::text,o.sales_order_no,o.status,o.is_archived,o.created_at,o.updated_at,
        case when count(vs.id)=0 then 0 else round(100.0*count(vs.id) filter(where vs.status='completed')/count(vs.id)) end::int as progress
      from tracking.order_vehicles ov join tracking.orders o on o.id=ov.order_id and coalesce(o.is_deleted,false)=false
      left join tracking.vehicle_stages vs on vs.vehicle_id=ov.id
      where ov.vehicle_id=${id}::uuid or (ov.vehicle_id is null and ov.vin=${vehicle.vin})
      group by o.id order by o.updated_at desc
    `,
    sql<any[]>`
      select so.id::text,so.sales_order_no,so.erp_status,so.erp_event,so.erp_sales_person,so.accounting_customer_name,so.actual_customer_name,
        so.actual_customer_phone,so.customer_vat,so.order_date,so.delivery_date,so.erp_user_id,so.erp_branch,
        so.platform_user_id::text,so.platform_user_name,so.platform_department_code,so.platform_department_name,so.platform_branch_code,so.platform_branch_name,
        so.crm_lead_id::text,so.tracking_order_id::text,so.subtotal_before_tax,so.tax_value,so.total_incl_vat,so.registration_fee,
        so.user_link_status,so.crm_link_status,so.operations_link_status,so.warnings,so.received_at,so.updated_at,
        sov.id::text as sales_order_vehicle_id,sov.item_no,sov.vin,sov.item_type,sov.item_category,sov.item_model,
        sov.interior_color,sov.exterior_color,sov.dealer,sov.qty,sov.unit_price,sov.item_value,sov.total_incl_vat as vehicle_total_incl_vat,
        sov.tracking_vehicle_id::text,sov.operations_status_code,sov.operations_status_applied_at
      from integrations.erpnext_sales_order_vehicles sov
      join integrations.erpnext_sales_orders so on so.id=sov.sales_order_id
      where sov.operations_vehicle_id=${id}::uuid
      order by so.order_date desc nulls last,so.updated_at desc
    `,
    sql<any[]>`select * from operations.vehicle_archive_events where vehicle_id=${id}::uuid order by created_at desc`,
    sql<any[]>`select * from operations.vehicle_status_notes where vehicle_id=${id}::uuid order by created_at desc`,
  ]);
  return { ok: true, vehicle: { ...vehicle, checks, checkHistory, approvals, approvalEvents, movements, transfers, tracking, salesOrders, archiveEvents, statusNotes: notes } };
}

async function listMovements(sql: ReturnType<typeof getSql>, request: VercelRequest, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const { page, pageSize, offset } = pageValues(request);
  const search = clean(request.query.search);
  const from = clean(request.query.from);
  const to = clean(request.query.to);
  const status = clean(request.query.status);
  const userSearch = clean(request.query.user);
  const dateFrom = clean(request.query.dateFrom);
  const dateTo = clean(request.query.dateTo);
  const timeFrom = clean(request.query.timeFrom);
  const timeTo = clean(request.query.timeTo);
  const pattern = `%${search}%`;
  const scope = accessScope(sql, user, "tl");
  const rows = await sql<any[]>`
    select m.id::text,m.batch_id::text,m.transfer_request_id::text,tr.request_no,m.created_at,m.movement_type,m.old_status,m.new_status,
      coalesce(os.name,m.old_status) as old_status_name,coalesce(ns.name,m.new_status) as new_status_name,
      m.note,m.state_note,coalesce(m.shortage_note,v.shortage_note) as shortage_note,m.performed_by_name,m.performed_by_role,m.performed_by_branch,
      v.id::text as vehicle_id,v.vin,v.car_name,v.statement,v.agent_name,v.interior_color,v.exterior_color,v.model_year,v.plate_no,v.batch_no,v.notes as vehicle_notes,
      fl.code as from_location_code,fl.name as from_location_name,tl.code as to_location_code,tl.name as to_location_name,
      coalesce(checks.sensor_status,'unknown') as sensor_status,coalesce(checks.camera_status,'unknown') as camera_status,
      coalesce(checks.ac_status,'unknown') as ac_status,coalesce(checks.radio_status,'unknown') as radio_status,
      coalesce(checks.screen_status,'unknown') as screen_status,coalesce(checks.remote_status,'unknown') as remote_status,
      coalesce(checks.mats_status,'unknown') as mats_status,coalesce(checks.extinguisher_status,'unknown') as extinguisher_status,
      coalesce(checks.safety_bag_status,'unknown') as safety_bag_status,coalesce(checks.spare_tire_status,'unknown') as spare_tire_status,
      coalesce(approval.financial_approved,false) as financial_approved,coalesce(approval.administrative_approved,false) as administrative_approved
    from operations.movements m join operations.vehicles v on v.id=m.vehicle_id
    left join operations.locations fl on fl.id=m.from_location_id
    left join operations.locations tl on tl.id=m.to_location_id
    left join operations.vehicle_statuses os on os.code=m.old_status
    left join operations.vehicle_statuses ns on ns.code=m.new_status
    left join operations.transfer_requests tr on tr.id=m.transfer_request_id
    left join lateral (
      select
        max(status) filter(where item_code='sensor') as sensor_status,
        max(status) filter(where item_code='camera') as camera_status,
        max(status) filter(where item_code='ac') as ac_status,
        max(status) filter(where item_code='radio') as radio_status,
        max(status) filter(where item_code='screen') as screen_status,
        max(status) filter(where item_code='remote') as remote_status,
        max(status) filter(where item_code='mats') as mats_status,
        max(status) filter(where item_code='extinguisher') as extinguisher_status,
        max(status) filter(where item_code='safety_bag') as safety_bag_status,
        max(status) filter(where item_code='spare_tire') as spare_tire_status
      from operations.vehicle_check_values cv where cv.vehicle_id=v.id
    ) checks on true
    left join lateral (
      select financial_approved,administrative_approved from operations.vehicle_approvals va
      where va.vehicle_id=v.id and va.is_active=true order by va.cycle_no desc,va.created_at desc limit 1
    ) approval on true
    where (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern} or coalesce(m.note,'') ilike ${pattern})
      and (${from}='' or fl.code=${from}) and (${to}='' or tl.code=${to})
      and (${status}='' or m.new_status=${status})
      and (${userSearch}='' or coalesce(m.performed_by_name,'') ilike ${`%${userSearch}%`})
      and (${dateFrom}='' or m.created_at::date>=nullif(${dateFrom}::text,'')::date)
      and (${dateTo}='' or m.created_at::date<=nullif(${dateTo}::text,'')::date)
      and (${timeFrom}='' or m.created_at::time>=nullif(${timeFrom}::text,'')::time)
      and (${timeTo}='' or m.created_at::time<=nullif(${timeTo}::text,'')::time)
      and ${scope}
    order by m.created_at desc,m.id desc limit ${pageSize} offset ${offset}
  `;
  const [count] = await sql<{ total: number }[]>`
    select count(*)::int as total from operations.movements m join operations.vehicles v on v.id=m.vehicle_id
    left join operations.locations fl on fl.id=m.from_location_id left join operations.locations tl on tl.id=m.to_location_id
    where (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern} or coalesce(m.note,'') ilike ${pattern})
      and (${from}='' or fl.code=${from}) and (${to}='' or tl.code=${to}) and (${status}='' or m.new_status=${status})
      and (${userSearch}='' or coalesce(m.performed_by_name,'') ilike ${`%${userSearch}%`})
      and (${dateFrom}='' or m.created_at::date>=nullif(${dateFrom}::text,'')::date) and (${dateTo}='' or m.created_at::date<=nullif(${dateTo}::text,'')::date)
      and (${timeFrom}='' or m.created_at::time>=nullif(${timeFrom}::text,'')::time) and (${timeTo}='' or m.created_at::time<=nullif(${timeTo}::text,'')::time)
      and ${scope}
  `;
  return { ok: true, rows, total: Number(count?.total || 0), page, pageSize };
}

async function listTransfers(sql: ReturnType<typeof getSql>, request: QueryRequest, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const { page, pageSize, offset } = pageValues(request);
  const status = clean(request.query.status);
  const kind = clean(request.query.kind) || "transfer";
  const search = clean(request.query.search);
  const completedRaw = clean(request.query.completed);
  const hasCompletedFilter = completedRaw !== "";
  const completed = boolValue(request.query.completed);
  const pattern = `%${search}%`;
  const isAdmin = isSystemAdmin(user) || user.branchCodes.length === 0;
  const branches = user.branchCodes.length ? user.branchCodes : ["__none__"];
  const where = sql`
    r.is_deleted=false and r.request_kind=${kind}
    and (${status}='' or r.status=${status})
    and (${hasCompletedFilter}=false or (${completed}=true and r.status='completed') or (${completed}=false and r.status<>'completed'))
    and (${search}='' or coalesce(r.request_no,'') ilike ${pattern} or coalesce(r.requested_by_name,'') ilike ${pattern} or exists(
      select 1 from operations.transfer_request_vehicles rx join operations.vehicles vx on vx.id=rx.vehicle_id
      where rx.transfer_request_id=r.id and (vx.vin ilike ${pattern} or coalesce(vx.car_name,'') ilike ${pattern} or coalesce(vx.statement,'') ilike ${pattern})
    ))
    and (${isAdmin}=true or r.source_branch_code in ${sql(branches)} or r.destination_branch_code in ${sql(branches)} or r.requested_by=${user.id}::uuid)
  `;
  const [count] = await sql<{ total: number }[]>`select count(*)::int as total from operations.transfer_requests r where ${where}`;
  const rows = await sql<any[]>`
    select r.id::text,r.request_no,r.request_kind,r.status,r.note,r.requested_by::text,r.requested_by_name,r.requested_by_role,r.requested_by_branch,
      r.source_branch_code,r.destination_branch_code,r.requested_at,r.completed_at,r.cancelled_at,r.cancellation_reason,r.version,
      sl.code as source_location_code,sl.name as source_location_name,dl.code as destination_location_code,dl.name as destination_location_name,
      coalesce(cars.vehicles_count,0)::int as vehicles_count,coalesce(cars.vehicles,'[]'::json) as vehicles,
      coalesce(events.events,'[]'::json) as events
    from operations.transfer_requests r
    left join operations.locations sl on sl.id=r.source_location_id
    left join operations.locations dl on dl.id=r.destination_location_id
    left join lateral (
      select count(*)::int as vehicles_count,
        json_agg(json_build_object(
          'vehicle_id',v.id::text,'vin',v.vin,'car_name',v.car_name,'statement',v.statement,'model_year',v.model_year,
          'interior_color',v.interior_color,'exterior_color',v.exterior_color,
          'source_location_id',rv.source_location_id::text,'source_status',rv.source_status,
          'current_location_name',cl.name,'current_status_name',coalesce(cs.name,v.status_code)
        ) order by v.vin) as vehicles
      from operations.transfer_request_vehicles rv
      join operations.vehicles v on v.id=rv.vehicle_id
      left join operations.locations cl on cl.id=v.location_id
      left join operations.vehicle_statuses cs on cs.code=v.status_code
      where rv.transfer_request_id=r.id
    ) cars on true
    left join lateral (
      select json_agg(json_build_object(
        'id',e.id::text,'stage',e.stage,'action',e.action,'note',e.note,'actor_name',e.actor_name,
        'actor_role',e.actor_role,'actor_branch',e.actor_branch,'created_at',e.created_at
      ) order by e.created_at) as events
      from operations.transfer_request_events e where e.transfer_request_id=r.id
    ) events on true
    where ${where}
    order by r.requested_at desc limit ${pageSize} offset ${offset}
  `;
  return { ok: true, rows, total: Number(count?.total || 0), page, pageSize };
}

async function listApprovals(sql: ReturnType<typeof getSql>, request: VercelRequest, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const filter = clean(request.query.filter);
  const search = clean(request.query.search);
  const pattern = `%${search}%`;
  const scope = accessScope(sql, user, "l");
  const rows = await sql<any[]>`
    select a.id::text,a.vehicle_id::text,a.cycle_no,a.financial_approved,a.administrative_approved,a.financial_note,a.administrative_note,
      a.financial_approved_by_name,a.administrative_approved_by_name,a.financial_approved_at,a.administrative_approved_at,a.pending_delivery,a.updated_at,
      v.vin,v.car_name,v.statement,v.model_year,v.status_code,l.code as location_code,l.name as location_name,
      dl.name as pending_destination_name
    from operations.vehicle_approvals a
    join operations.vehicles v on v.id=a.vehicle_id
    left join operations.locations l on l.id=v.location_id
    left join operations.locations dl on dl.id=nullif(a.pending_delivery->>'destinationLocationId','')::uuid
    where a.is_active=true and v.is_deleted=false and v.archived_at is null
      and (v.status_code='under_delivery' or a.pending_delivery is not null)
      and (${filter}='' or (${filter}='missing_financial' and a.financial_approved=false) or (${filter}='missing_administrative' and a.administrative_approved=false) or (${filter}='completed' and a.financial_approved=true and a.administrative_approved=true))
      and (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern}) and ${scope}
    order by a.updated_at desc
  `;
  return { ok: true, rows };
}

async function dashboardVehicles(sql: ReturnType<typeof getSql>, request: VercelRequest, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const { page, pageSize, offset } = pageValues(request);
  const location = clean(request.query.location);
  const metric = clean(request.query.metric);
  const search = clean(request.query.search);
  const pattern = `%${search}%`;
  const scope = accessScope(sql, user, "l");
  const condition = metric === "actual_total"
    ? sql`v.archived_at is null and v.is_inventory_active=true and coalesce(s.is_actual_stock,true)`
    : metric === "under_delivery"
      ? sql`v.archived_at is null and v.is_inventory_active=true and v.status_code='under_delivery'`
      : metric === "available_for_sale"
        ? sql`v.archived_at is null and v.is_inventory_active=true and v.status_code='available_for_sale'`
        : metric === "reserved"
          ? sql`v.archived_at is null and v.is_inventory_active=true and v.status_code='reserved'`
          : metric === "delivered"
            ? sql`v.status_code='delivered'`
            : metric === "has_notes"
              ? sql`v.archived_at is null and v.is_inventory_active=true and (v.status_code='has_notes' or v.has_notes=true)`
              : sql`v.archived_at is null and v.is_inventory_active=true`;
  const base = sql`
    v.is_deleted=false
    and (${location}='' or l.code=${location}) and ${condition}
    and (${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern} or coalesce(v.statement,'') ilike ${pattern})
    and ${scope}
  `;
  const [count] = await sql<{ total: number }[]>`select count(*)::int as total from operations.vehicles v left join operations.locations l on l.id=v.location_id left join operations.vehicle_statuses s on s.code=v.status_code where ${base}`;
  const rows = await sql<any[]>`
    select v.id::text,v.vin,v.car_name,v.statement,v.agent_name,v.model_year,v.interior_color,v.exterior_color,v.plate_no,v.batch_no,
      v.notes,v.shortage_note,l.name as location_name,coalesce(s.name,v.status_code) as status_name
    from operations.vehicles v left join operations.locations l on l.id=v.location_id left join operations.vehicle_statuses s on s.code=v.status_code
    where ${base} order by v.vin limit ${pageSize} offset ${offset}
  `;
  return { ok: true, rows, total: Number(count?.total || 0), page, pageSize };
}

async function dashboardShortages(sql: ReturnType<typeof getSql>, request: VercelRequest, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const { page, pageSize, offset } = pageValues(request);
  const location = clean(request.query.location);
  const search = clean(request.query.search);
  const pattern = `%${search}%`;
  const unrestricted = isSystemAdmin(user) || user.branchCodes.length === 0;
  const branches = user.branchCodes.length ? user.branchCodes : ["__none__"];
  const base = sql`
    with combinations as (
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
        and l.code in ('warehouse','hall','multaqa','qadisiyah')
        and regexp_replace(coalesce(v.statement,''), '[[:space:]]+', '', 'g') !~* '(حساس|كاميرا|شاشة|مسجل|ريموت|فرشات|طفاية|شنطةسلامة|اسبير|إسبير)'
      group by coalesce(nullif(trim(v.car_name),''),'—'),coalesce(nullif(trim(v.statement),''),'—'),coalesce(nullif(trim(v.model_year),''),'—'),coalesce(nullif(trim(v.exterior_color),''),'—'),coalesce(nullif(trim(v.interior_color),''),'—')
    ), expanded as (
      select c.*,target.location_code,target.location_name,target.location_qty,
        c.warehouse_qty+c.hall_qty+c.multaqa_qty+c.qadisiyah_qty as total_qty
      from combinations c
      cross join lateral (values
        ('multaqa','الملتقى',c.multaqa_qty),
        ('hall','الصالة',c.hall_qty),
        ('qadisiyah','القادسية',c.qadisiyah_qty)
      ) as target(location_code,location_name,location_qty)
      where target.location_qty=0
        and c.warehouse_qty+c.hall_qty+c.multaqa_qty+c.qadisiyah_qty>0
        and (${location}='' or target.location_code=${location})
        and (${unrestricted}=true or target.location_code in ${sql(branches)})
        and (${search}='' or c.car_name ilike ${pattern} or c.statement ilike ${pattern} or c.model_year ilike ${pattern} or c.exterior_color ilike ${pattern} or c.interior_color ilike ${pattern})
    )
  `;
  const [count] = await sql<{ total: number }[]>`${base} select count(*)::int as total from expanded`;
  const rows = await sql<any[]>`${base}
    select concat(location_code,':',md5(concat_ws('|',car_name,statement,model_year,exterior_color,interior_color))) as id,
      location_code,location_name,car_name,statement,model_year,exterior_color,interior_color,
      warehouse_qty,hall_qty,multaqa_qty,qadisiyah_qty,total_qty
    from expanded
    order by location_name,car_name,statement,model_year,exterior_color,interior_color
    limit ${pageSize} offset ${offset}
  `;
  return { ok: true, rows, total: Number(count?.total || 0), page, pageSize };
}

async function dashboardRequests(sql: ReturnType<typeof getSql>, request: VercelRequest, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const kind = clean(request.query.kind) || "transfer";
  const search = clean(request.query.search);
  const pattern = `%${search}%`;
  if (kind === "photo") {
    const isAdmin = isSystemAdmin(user) || user.branchCodes.length === 0;
    const branches = user.branchCodes.length ? user.branchCodes : ["__none__"];
    const where = sql`
      r.is_deleted=false
      and (${search}='' or coalesce(r.request_no,'') ilike ${pattern} or coalesce(r.requested_by_name,'') ilike ${pattern} or exists(
        select 1 from operations.photography_request_vehicles px join operations.vehicles pv on pv.id=px.vehicle_id
        where px.request_id=r.id and pv.vin ilike ${pattern}
      ))
      and (${isAdmin}=true or r.requested_by_branch in ${sql(branches)} or r.requested_by=${user.id}::uuid)
    `;
    const [count] = await sql<{ total: number }[]>`select count(*)::int as total from operations.photography_requests r where ${where}`;
    const rows = await sql<any[]>`
      select r.id::text,r.request_no,r.status,r.requested_by_name as creator_name,r.requested_at,r.photography_date,r.note,
        coalesce(json_agg(json_build_object('vin',v.vin,'car_name',v.car_name,'statement',v.statement) order by v.vin) filter(where v.id is not null),'[]') as vehicles
      from operations.photography_requests r left join operations.photography_request_vehicles rv on rv.request_id=r.id left join operations.vehicles v on v.id=rv.vehicle_id
      where ${where}
      group by r.id order by r.requested_at desc limit 500
    `;
    return { ok: true, rows, total: Number(count?.total || 0) };
  }
  return listTransfers(sql, { query: { ...request.query, kind: "transfer", pageSize: "200" } }, user);
}

async function createVehicle(sql: ReturnType<typeof getSql>, body: Record<string, any>, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const vin = clean(body.vin);
  const locationId = clean(body.locationId);
  const statusCode = clean(body.statusCode) || "available_for_sale";
  if (!vin || !locationId) throw new OperationError(400, "VALIDATION_ERROR", "رقم الهيكل والمكان مطلوبان", { fieldErrors: { vin: !vin ? "مطلوب" : "", locationId: !locationId ? "مطلوب" : "" } });
  const who = actor(user);
  return sql.begin(async (tx) => {
    const [valid] = await tx<any[]>`select l.id::text as location_id,l.code as location_code,l.branch_code,s.code as status_code from operations.locations l cross join operations.vehicle_statuses s where l.id=${locationId}::uuid and l.is_active=true and s.code=${statusCode} and s.is_active=true`;
    if (!valid) throw new OperationError(400, "VALIDATION_ERROR", "المكان أو الحالة غير صحيحة");
    assertBranchAccess(user, valid.branch_code, valid.location_code, "لا تملك صلاحية إضافة سيارة في هذا الفرع");
    const [row] = await tx<any[]>`
      insert into operations.vehicles(vin,car_name,statement,agent_name,exterior_color,interior_color,model_year,plate_no,batch_no,location_id,status_code,source_type,notes,state_note,shortage_note,has_notes,created_by,created_by_name,updated_by,updated_by_name)
      values (${vin},${clean(body.carName)||null},${clean(body.statement)||null},${clean(body.agentName)||null},${clean(body.exteriorColor)||null},${clean(body.interiorColor)||null},${clean(body.modelYear)||null},${clean(body.plateNo)||null},${clean(body.batchNo)||null},${locationId}::uuid,${statusCode},${clean(body.sourceType)||null},${clean(body.notes)||null},${clean(body.stateNote)||null},${clean(body.shortageNote)||null},${statusCode==='has_notes' || Boolean(clean(body.notes))},${who.id}::uuid,${who.name},${who.id}::uuid,${who.name})
      returning *,id::text
    `;
    await tx`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data) values (${who.id}::uuid,'operations','vehicle_created','vehicle',${row.id},${tx.json(row)})`;
    return { ok: true, vehicle: row, message: "تمت إضافة السيارة" };
  });
}

async function updateVehicle(sql: ReturnType<typeof getSql>, body: Record<string, any>, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const id = clean(body.id);
  if (!id) throw new OperationError(400, "VALIDATION_ERROR", "معرف السيارة مطلوب");
  const who = actor(user);
  return sql.begin(async (tx) => {
    const [before] = await tx<any[]>`
      select v.*,v.id::text,l.branch_code,l.code as location_code,l.name as location_name
      from operations.vehicles v left join operations.locations l on l.id=v.location_id
      where v.id=${id}::uuid and v.is_deleted=false and v.archived_at is null for update of v
    `;
    if (!before) throw new OperationError(404, "VEHICLE_NOT_FOUND", "السيارة غير موجودة");
    assertBranchAccess(user, before.branch_code, before.location_code, "لا تملك صلاحية تعديل سيارة في هذا الفرع");
    const vin = clean(body.vin) || before.vin;
    if (vin !== before.vin && !isSystemAdmin(user)) throw new OperationError(403, "FORBIDDEN", "تغيير رقم الهيكل متاح لمدير النظام فقط");
    const locationId = clean(body.locationId) || before.location_id;
    const statusCode = clean(body.statusCode) || before.status_code;
    if (String(locationId) !== String(before.location_id)) {
      throw new OperationError(400, "INVALID_STATUS_TRANSITION", "تغيير المكان يجب أن يتم من تبويب الحركة أو طلبات النقل");
    }
    const [validStatus] = await tx<any[]>`select code,name from operations.vehicle_statuses where code=${statusCode} and is_active=true`;
    if (!validStatus) throw new OperationError(400, "INVALID_STATUS_TRANSITION", "الحالة الجديدة غير صحيحة");
    if (statusCode === "has_notes" && !clean(body.stateNote) && !clean(body.notes)) {
      throw new OperationError(400, "VALIDATION_ERROR", "ملاحظات الحالة مطلوبة عند اختيار حالة بها ملاحظات");
    }

    const [detailsRow] = await tx<any[]>`
      update operations.vehicles set vin=${vin},car_name=${clean(body.carName)||null},statement=${clean(body.statement)||null},agent_name=${clean(body.agentName)||null},
        exterior_color=${clean(body.exteriorColor)||null},interior_color=${clean(body.interiorColor)||null},model_year=${clean(body.modelYear)||null},plate_no=${clean(body.plateNo)||null},batch_no=${clean(body.batchNo)||null},
        source_type=${clean(body.sourceType)||null},notes=${clean(body.notes)||null},state_note=${clean(body.stateNote)||null},shortage_note=${clean(body.shortageNote)||null},
        has_notes=${statusCode==='has_notes' || Boolean(clean(body.notes))},updated_by=${who.id}::uuid,updated_by_name=${who.name},updated_at=now(),version=version+1
      where id=${id}::uuid returning *,id::text
    `;

    let row = detailsRow;
    let pendingApproval = false;
    if (statusCode !== before.status_code) {
      if (statusCode === "delivered") {
        const approval = await ensureActiveVehicleApprovalCycle(tx, id);
        const approvalsComplete = Boolean(approval?.financial_approved && approval?.administrative_approved);
        if (!approvalsComplete) {
          const pending: PendingDeliveryPayload = {
            destinationLocationId: String(before.location_id),
            note: clean(body.notes),
            stateNote: clean(body.stateNote) || clean(body.notes),
            shortageNote: clean(body.shortageNote),
            checks: [],
            requestedBy: who,
            requestedAt: new Date().toISOString(),
          };
          await tx`update operations.vehicle_approvals set pending_delivery=${tx.json(pending)},updated_at=now() where id=${approval.id}::uuid`;
          pendingApproval = true;
        }
      }

      if (!pendingApproval) {
        if (statusCode === "under_delivery") await startFreshVehicleApprovalCycle(tx, id);
        else if (!['under_delivery','delivered'].includes(statusCode) && before.status_code === 'under_delivery') await closeActiveVehicleApprovalCycle(tx, id);

        const movementBatchNo = requestId("MB").toUpperCase();
        const [batch] = await tx<any[]>`
          insert into operations.movement_batches(batch_no,destination_location_id,new_status,general_note,requested_count,performed_by,performed_by_name,performed_by_role,performed_by_branch)
          values (${movementBatchNo},${before.location_id}::uuid,${statusCode},${clean(body.notes)||null},1,${who.id}::uuid,${who.name},${who.role},${who.branch}) returning id::text,batch_no
        `;
        const movementResult = await persistVehicleMovement(tx, {
          vehicle: { ...detailsRow, status_code: before.status_code, location_id: before.location_id, vin },
          destination: { id: before.location_id, code: before.location_code, name: before.location_name, branch_code: before.branch_code },
          newStatus: statusCode,
          raw: { note: clean(body.notes), stateNote: clean(body.stateNote) || (statusCode === 'has_notes' ? clean(body.notes) : ''), shortageNote: clean(body.shortageNote), checks: [] },
          generalNote: clean(body.notes),
          who,
          batchId: batch.id,
          movementType: "vehicle_management",
        });
        row = movementResult.vehicle;
        if (statusCode === "delivered") await closeActiveVehicleApprovalCycle(tx, id);
      }
    }

    await tx`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data) values (${who.id}::uuid,'operations','vehicle_updated','vehicle',${id},${tx.json(before)},${tx.json(row)})`;
    return {
      ok: true,
      vehicle: row,
      pendingApproval,
      message: pendingApproval ? "تم تحديث بيانات السيارة وإرسال حالة مباع تم التسليم للموافقات" : "تم تحديث بيانات السيارة",
    };
  });
}

async function deleteVehicle(sql: ReturnType<typeof getSql>, body: Record<string, any>, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>, idempotencyId: string) {
  const id = clean(body.id);
  const reason = clean(body.reason);
  const confirmVin = clean(body.confirmVin);
  if (!id || !reason || !confirmVin) throw new OperationError(400, "VALIDATION_ERROR", "السيارة وسبب المسح وتأكيد رقم الهيكل مطلوبة");
  const who = actor(user);
  return sql.begin(async (tx) => {
    const [vehicle] = await tx<any[]>`
      select v.*,v.id::text,l.branch_code,l.code as location_code
      from operations.vehicles v left join operations.locations l on l.id=v.location_id
      where v.id=${id}::uuid and v.is_deleted=false for update
    `;
    if (!vehicle) throw new OperationError(404, "VEHICLE_NOT_FOUND", "السيارة غير موجودة");
    assertBranchAccess(user, vehicle.branch_code, vehicle.location_code, "لا تملك صلاحية مسح سيارة في هذا الفرع");
    if (confirmVin !== vehicle.vin) throw new OperationError(400, "CONFIRMATION_MISMATCH", "رقم الهيكل المكتوب لا يطابق السيارة المطلوب مسحها");

    const trackingVehicles = await tx<any[]>`select id::text,order_id::text from tracking.order_vehicles where vehicle_id=${id}::uuid or vin=${vehicle.vin}`;
    const trackingVehicleIds = trackingVehicles.map((row) => row.id).filter(Boolean);
    const trackingOrderIds = [...new Set(trackingVehicles.map((row) => row.order_id).filter(Boolean))];
    const transferRows = await tx<any[]>`select transfer_request_id::text as id from operations.transfer_request_vehicles where vehicle_id=${id}::uuid`;
    const transferIds = [...new Set(transferRows.map((row) => row.id).filter(Boolean))];
    const photoRows = await tx<any[]>`select request_id::text as id from operations.photography_request_vehicles where vehicle_id=${id}::uuid`;
    const photoIds = [...new Set(photoRows.map((row) => row.id).filter(Boolean))];
    const movementRows = await tx<any[]>`select batch_id::text as id from operations.movements where vehicle_id=${id}::uuid and batch_id is not null`;
    const movementBatchIds = [...new Set(movementRows.map((row) => row.id).filter(Boolean))];

    await tx`
      insert into operations.vehicle_deletion_audit(vehicle_internal_id,vin,vehicle_snapshot,reason,deleted_by,deleted_by_name,deleted_by_email,deleted_by_role,request_id)
      values (${id}::uuid,${vehicle.vin},${tx.json(vehicle)},${reason},${who.id}::uuid,${who.name},${who.email},${who.role},${idempotencyId})
    `;

    await tx`delete from operations.approval_events where vehicle_id=${id}::uuid`;
    await tx`delete from operations.vehicle_approvals where vehicle_id=${id}::uuid`;
    await tx`delete from operations.vehicle_status_notes where vehicle_id=${id}::uuid`;
    await tx`delete from operations.vehicle_check_history where vehicle_id=${id}::uuid`;
    await tx`delete from operations.vehicle_check_values where vehicle_id=${id}::uuid`;
    await tx`delete from operations.vehicle_shortages where vehicle_id=${id}::uuid`;
    await tx`delete from operations.vehicle_archive_events where vehicle_id=${id}::uuid`;
    await tx`delete from operations.event_outbox where vehicle_id=${id}::uuid or vin=${vehicle.vin}`;
    await tx`delete from operations.movements where vehicle_id=${id}::uuid`;

    await tx`delete from operations.transfer_request_vehicles where vehicle_id=${id}::uuid`;
    if (transferIds.length) {
      await tx`delete from operations.transfer_request_events e where e.transfer_request_id in ${tx(transferIds)} and not exists (select 1 from operations.transfer_request_vehicles rv where rv.transfer_request_id=e.transfer_request_id)`;
      await tx`delete from operations.transfer_requests r where r.id in ${tx(transferIds)} and not exists (select 1 from operations.transfer_request_vehicles rv where rv.transfer_request_id=r.id)`;
    }

    await tx`delete from operations.photography_request_vehicles where vehicle_id=${id}::uuid`;
    if (photoIds.length) {
      await tx`delete from operations.photography_requests r where r.id in ${tx(photoIds)} and not exists (select 1 from operations.photography_request_vehicles rv where rv.request_id=r.id)`;
    }

    if (trackingVehicleIds.length) {
      await tx`delete from tracking.sms_messages where vehicle_id in ${tx(trackingVehicleIds)}`;
      await tx`delete from tracking.order_vehicles where id in ${tx(trackingVehicleIds)}`;
    }
    if (trackingOrderIds.length) {
      await tx`delete from tracking.sms_messages where order_id in ${tx(trackingOrderIds)}`;
      await tx`delete from tracking.orders o where o.id in ${tx(trackingOrderIds)} and not exists (select 1 from tracking.order_vehicles ov where ov.order_id=o.id)`;
    }

    if (movementBatchIds.length) {
      await tx`update operations.movement_batches b set requested_count=(select count(*)::int from operations.movements m where m.batch_id=b.id) where b.id in ${tx(movementBatchIds)}`;
      await tx`delete from operations.movement_batches b where b.id in ${tx(movementBatchIds)} and not exists (select 1 from operations.movements m where m.batch_id=b.id)`;
    }

    await tx`delete from operations.vehicles where id=${id}::uuid`;
    await tx`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data) values (${who.id}::uuid,'operations','vehicle_deleted','vehicle',${vehicle.vin},${tx.json(vehicle)},${tx.json({ reason, requestId: idempotencyId, deletedCompletely: true })})`;
    return { ok: true, message: "تم مسح السيارة وكل بياناتها المرتبطة نهائيًا" };
  });
}

async function archiveVehicle(sql: ReturnType<typeof getSql>, body: Record<string, any>, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const id = clean(body.id);
  const reason = clean(body.reason);
  if (!id || !reason) throw new OperationError(400, "VALIDATION_ERROR", "سبب الأرشفة مطلوب");
  const who = actor(user);
  return sql.begin(async (tx) => {
    const [v] = await tx<any[]>`
      select v.*,v.id::text,l.branch_code,l.code as location_code
      from operations.vehicles v
      left join operations.locations l on l.id=v.location_id
      where v.id=${id}::uuid and v.is_deleted=false
      for update of v
    `;
    if (!v) throw new OperationError(404, "VEHICLE_NOT_FOUND", "السيارة غير موجودة");
    assertBranchAccess(user, v.branch_code, v.location_code, "لا تملك صلاحية أرشفة سيارة في هذا الفرع");

    const archive = await tryArchiveEligibleVehicle(tx, id, who, { reason, action: "archived" });
    if (archive.archived) return { ok: true, message: "تمت أرشفة السيارة", vehicle: archive.vehicle };
    if (archive.reason === "already_archived") throw new OperationError(409, "CONFLICT", "السيارة مؤرشفة بالفعل");
    if (archive.reason === "approvals_incomplete") throw new OperationError(409, "APPROVALS_REQUIRED", "لا يمكن الأرشفة قبل اكتمال الموافقة المالية والإدارية");
    if (archive.reason === "active_transfer") throw new OperationError(409, "CONFLICT", "لا يمكن الأرشفة لوجود طلب نقل جاري أو غير مكتمل");
    if (archive.reason === "tracking_incomplete") throw new OperationError(409, "VEHICLE_NOT_ELIGIBLE", "لا يمكن الأرشفة قبل اكتمال التراكينج بنسبة 100%");
    throw new OperationError(404, "VEHICLE_NOT_FOUND", "السيارة غير موجودة");
  });
}

type MovementActor = ReturnType<typeof actor>;

type PendingDeliveryPayload = {
  destinationLocationId: string;
  note?: string;
  stateNote?: string;
  shortageNote?: string;
  checks?: Array<{ itemCode: string; status: string; note?: string }>;
  requestedBy?: MovementActor;
  requestedAt?: string;
};

async function persistVehicleMovement(
  tx: any,
  input: {
    vehicle: any;
    destination: any;
    newStatus: string;
    raw: Record<string, any>;
    generalNote?: string | null;
    who: MovementActor;
    batchId: string;
    movementType?: string;
  },
) {
  const { vehicle, destination, newStatus, raw, generalNote, who, batchId } = input;
  const before = { ...vehicle };
  const [movement] = await tx`
    insert into operations.movements(vehicle_id,from_location_id,to_location_id,old_status,new_status,note,state_note,shortage_note,performed_by,performed_by_name,performed_by_role,performed_by_branch,batch_id,movement_type,before_data)
    values (${vehicle.id}::uuid,${vehicle.location_id},${destination.id}::uuid,${vehicle.status_code},${newStatus},${clean(raw.note)||clean(generalNote)||null},${clean(raw.stateNote)||null},${clean(raw.shortageNote)||null},${who.id}::uuid,${who.name},${who.role},${who.branch},${batchId}::uuid,${input.movementType || 'direct'},${tx.json(before)}) returning id::text
  `;
  const [updated] = await tx`
    update operations.vehicles set location_id=${destination.id}::uuid,status_code=${newStatus},state_note=${clean(raw.stateNote)||null},shortage_note=${clean(raw.shortageNote)||null},
      has_notes=${newStatus==='has_notes'},updated_by=${who.id}::uuid,updated_by_name=${who.name},updated_at=now(),version=version+1
    where id=${vehicle.id}::uuid returning *,id::text
  `;
  await tx`update operations.movements set after_data=${tx.json(updated)} where id=${movement.id}::uuid`;
  if (clean(raw.stateNote)) await tx`insert into operations.vehicle_status_notes(vehicle_id,status_code,note,movement_id,created_by,created_by_name) values (${vehicle.id}::uuid,${newStatus},${clean(raw.stateNote)},${movement.id}::uuid,${who.id}::uuid,${who.name})`;
  if (vehicle.location_id && Array.isArray(raw.checks)) {
    for (const check of raw.checks) {
      const itemCode = clean(check.itemCode);
      if (!itemCode) continue;
      const [old] = await tx`select status,note from operations.vehicle_check_values where vehicle_id=${vehicle.id}::uuid and item_code=${itemCode}`;
      await tx`
        insert into operations.vehicle_check_values(vehicle_id,item_code,status,note,updated_by,updated_by_name,updated_at)
        values (${vehicle.id}::uuid,${itemCode},${clean(check.status)||'unknown'},${clean(check.note)||null},${who.id}::uuid,${who.name},now())
        on conflict(vehicle_id,item_code) do update set status=excluded.status,note=excluded.note,updated_by=excluded.updated_by,updated_by_name=excluded.updated_by_name,updated_at=now()
      `;
      await tx`insert into operations.vehicle_check_history(vehicle_id,item_code,old_status,new_status,note,movement_id,changed_by,changed_by_name) values (${vehicle.id}::uuid,${itemCode},${old?.status||null},${clean(check.status)||'unknown'},${clean(check.note)||null},${movement.id}::uuid,${who.id}::uuid,${who.name})`;
    }
  }
  try {
    await tx.savepoint(async (eventTx: any) => {
      await eventTx`insert into operations.event_outbox(event_type,entity_type,entity_id,vehicle_id,vin,actor_id,actor_name,destination_branch,title,description,metadata) values ('operations.vehicle.moved','vehicle',${vehicle.id},${vehicle.id}::uuid,${vehicle.vin},${who.id}::uuid,${who.name},${destination.branch_code},'تم تحريك سيارة',${`${vehicle.vin} إلى ${destination.name}`},${eventTx.json({ movementId: movement.id, batchId })})`;
    });
  } catch (outboxError) {
    console.error('Operations movement outbox failed', { vehicleId: vehicle.id, outboxError });
  }
  return { vehicle: updated, movement };
}

async function moveVehicles(sql: ReturnType<typeof getSql>, body: Record<string, any>, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const items = Array.isArray(body.items) ? body.items : [];
  const destinationLocationId = clean(body.destinationLocationId);
  const newStatus = clean(body.newStatus);
  if (!items.length || !destinationLocationId || !newStatus) throw new OperationError(400, "VALIDATION_ERROR", "اختر سيارة واحدة على الأقل والمكان والحالة الجديدة");
  const vehicleIds = [...new Set(items.map((item: any) => clean(item.vehicleId)).filter(Boolean))];
  if (vehicleIds.length !== items.length) throw new OperationError(400, "VALIDATION_ERROR", "لا يمكن اختيار السيارة نفسها أكثر من مرة");
  const [destination] = await sql<any[]>`select id::text,code,name,branch_code from operations.locations where id=${destinationLocationId}::uuid and is_active=true`;
  const [status] = await sql<any[]>`select code,name from operations.vehicle_statuses where code=${newStatus} and is_active=true`;
  if (!destination) throw new OperationError(400, "INVALID_DESTINATION_LOCATION", "المكان الجديد غير صحيح");
  if (!status) throw new OperationError(400, "INVALID_STATUS_TRANSITION", "الحالة الجديدة غير صحيحة");
  assertBranchAccess(user, destination.branch_code, destination.code, "الحركة المباشرة متاحة فقط إلى موقع داخل الفروع المسموح بها؛ استخدم طلب نقل للانتقال إلى فرع آخر");
  const who = actor(user);
  const movementBatchNo = requestId("MB").toUpperCase();
  return sql.begin(async (tx) => {
    let batch: any = null;
    async function ensureBatch() {
      if (batch) return batch;
      [batch] = await tx<any[]>`
        insert into operations.movement_batches(batch_no,destination_location_id,new_status,general_note,requested_count,performed_by,performed_by_name,performed_by_role,performed_by_branch)
        values (${movementBatchNo},${destinationLocationId}::uuid,${newStatus},${clean(body.note)||null},${vehicleIds.length},${who.id}::uuid,${who.name},${who.role},${who.branch}) returning id::text,batch_no
      `;
      return batch;
    }

    const moved: any[] = [];
    const pendingApprovals: any[] = [];
    for (const raw of items) {
      const vehicleId = clean(raw.vehicleId);
      const [v] = await tx<any[]>`
        select v.*,v.id::text,l.branch_code,l.code as location_code
        from operations.vehicles v left join operations.locations l on l.id=v.location_id
        where v.id=${vehicleId}::uuid and v.is_deleted=false and v.archived_at is null for update of v
      `;
      if (!v) throw new OperationError(404, "VEHICLE_NOT_FOUND", `السيارة ${vehicleId} غير موجودة`);
      assertBranchAccess(user, v.branch_code, v.location_code, `لا تملك صلاحية تحريك السيارة ${v.vin}`);
      if (String(v.location_id) === destinationLocationId && v.status_code === newStatus) throw new OperationError(409, "CONFLICT", `السيارة ${v.vin} موجودة بالفعل في المكان والحالة المختارين`);
      if (newStatus === "has_notes" && !clean(raw.stateNote)) throw new OperationError(400, "VALIDATION_ERROR", `ملاحظات الحالة مطلوبة للسيارة ${v.vin}`);

      if (newStatus === "delivered") {
        const approval = await ensureActiveVehicleApprovalCycle(tx, vehicleId);
        const approvalsComplete = Boolean(approval?.financial_approved && approval?.administrative_approved);
        if (!approvalsComplete) {
          const pending: PendingDeliveryPayload = {
            destinationLocationId,
            note: clean(raw.note) || clean(body.note),
            stateNote: clean(raw.stateNote),
            shortageNote: clean(raw.shortageNote),
            checks: Array.isArray(raw.checks) ? raw.checks : [],
            requestedBy: who,
            requestedAt: new Date().toISOString(),
          };
          const [updatedApproval] = await tx<any[]>`update operations.vehicle_approvals set pending_delivery=${tx.json(pending)},updated_at=now() where id=${approval.id}::uuid returning *,id::text`;
          pendingApprovals.push({ vehicleId, vin: v.vin, approvalId: updatedApproval.id });
          continue;
        }
      }

      if (newStatus === "under_delivery" && v.status_code !== "under_delivery") await startFreshVehicleApprovalCycle(tx, vehicleId);
      if (!['under_delivery','delivered'].includes(newStatus) && v.status_code === 'under_delivery') await closeActiveVehicleApprovalCycle(tx, vehicleId);

      const activeBatch = await ensureBatch();
      const result = await persistVehicleMovement(tx, { vehicle: v, destination, newStatus, raw, generalNote: clean(body.note), who, batchId: activeBatch.id });
      if (newStatus === "delivered") await closeActiveVehicleApprovalCycle(tx, vehicleId);
      moved.push({ vehicleId, vin: v.vin, movementId: result.movement.id });
    }

    const parts: string[] = [];
    if (moved.length) parts.push(`تم تنفيذ الحركة على ${moved.length} سيارة`);
    if (pendingApprovals.length) parts.push(`تم إرسال ${pendingApprovals.length} سيارة للموافقات المالية والإدارية`);
    return { ok: true, batchId: batch?.id || null, moved, pendingApprovals, message: parts.join("، ") || "لم يتم تنفيذ أي حركة" };
  });
}

async function createTransfer(sql: ReturnType<typeof getSql>, body: Record<string, any>, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const vehicleIds = [...new Set((Array.isArray(body.vehicleIds) ? body.vehicleIds : []).map(clean).filter(Boolean))];
  const destinationLocationId = clean(body.destinationLocationId);
  if (!vehicleIds.length || !destinationLocationId) throw new OperationError(400, "VALIDATION_ERROR", "اختر السيارات والمكان المستهدف");
  const who = actor(user);
  return sql.begin(async (tx) => {
    const [destination] = await tx<any[]>`select id::text,code,name,branch_code from operations.locations where id=${destinationLocationId}::uuid and is_active=true`;
    if (!destination) throw new OperationError(400, "INVALID_DESTINATION_LOCATION", "المكان المستهدف غير صحيح");
    const cars: any[] = [];
    for (const vehicleId of vehicleIds) {
      const [v] = await tx<any[]>`select v.*,v.id::text,l.branch_code,l.code as location_code from operations.vehicles v left join operations.locations l on l.id=v.location_id where v.id=${vehicleId}::uuid and v.is_deleted=false and v.archived_at is null for update of v`;
      if (!v) throw new OperationError(404, "VEHICLE_NOT_FOUND", "إحدى السيارات غير موجودة");
      if (String(v.location_id) === destinationLocationId) throw new OperationError(400, "INVALID_DESTINATION_LOCATION", `السيارة ${v.vin} موجودة بالفعل في المكان المستهدف`);
      const [active] = await tx<any[]>`select r.request_no from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id where rv.vehicle_id=${vehicleId}::uuid and r.is_deleted=false and r.cancelled_at is null and r.status<>'completed' limit 1`;
      if (active) throw new OperationError(409, "DUPLICATE_ACTIVE_REQUEST", `السيارة ${v.vin} مرتبطة بطلب نقل نشط ${active.request_no}`);
      if (!isSystemAdmin(user) && user.branchCodes.length && !user.branchCodes.includes(v.branch_code || v.location_code)) throw new OperationError(403, "FORBIDDEN", `لا تملك صلاحية إنشاء طلب للسيارة ${v.vin}`);
      cars.push(v);
    }
    const source = cars[0];
    if (cars.some((vehicle) => String(vehicle.location_id) !== String(source.location_id))) {
      throw new OperationError(400, "INVALID_SOURCE_LOCATION", "يجب أن تكون كل سيارات طلب النقل في المكان المصدر نفسه");
    }
    const [sequence] = await tx<{ n: number }[]>`select nextval('operations.transfer_request_no_seq')::bigint as n`;
    const requestNo = `TR-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(sequence?.n || 1).padStart(6,'0')}`;
    const [request] = await tx<any[]>`
      insert into operations.transfer_requests(request_no,department_code,transfer_type,request_kind,source_location_id,destination_location_id,status,requested_by,requested_by_name,requested_by_role,requested_by_branch,source_branch_code,destination_branch_code,note)
      values (${requestNo},'operations','transfer','transfer',${source.location_id},${destinationLocationId}::uuid,'request_received',${who.id}::uuid,${who.name},${who.role},${who.branch},${source.branch_code||source.location_code||null},${destination.branch_code||destination.code||null},${clean(body.note)||null}) returning *,id::text
    `;
    for (const v of cars) await tx`insert into operations.transfer_request_vehicles(transfer_request_id,vehicle_id,source_location_id,source_status) values (${request.id}::uuid,${v.id}::uuid,${v.location_id},${v.status_code})`;
    try {
      await tx.savepoint(async (eventTx) => {
        await eventTx`insert into operations.transfer_request_events(transfer_request_id,stage,action,note,actor_id,actor_name,actor_role,actor_branch,after_data) values (${request.id}::uuid,'request_received','created',${clean(body.note)||null},${who.id}::uuid,${who.name},${who.role},${who.branch},${eventTx.json({ requestNo, vehicleIds })})`;
      });
    } catch (eventError) {
      console.error('Operations transfer create event failed', { requestId: request.id, eventError });
    }
    try {
      await tx.savepoint(async (eventTx) => {
        await eventTx`insert into operations.event_outbox(event_type,entity_type,entity_id,actor_id,actor_name,source_branch,destination_branch,title,description,metadata) values ('operations.transfer_request.created','transfer_request',${request.id},${who.id}::uuid,${who.name},${request.source_branch_code},${request.destination_branch_code},'طلب نقل جديد',${requestNo},${eventTx.json({ vehicleIds })})`;
      });
    } catch (outboxError) {
      console.error('Operations transfer create outbox failed', { requestId: request.id, outboxError });
    }
    return { ok: true, request, message: "تم إنشاء طلب النقل" };
  });
}

const transferOrder = ["request_received", "vehicle_sent", "vehicle_received", "completed"];

async function transferAction(sql: ReturnType<typeof getSql>, body: Record<string, any>, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const id = clean(body.id);
  const action = clean(body.transferAction);
  const reason = clean(body.reason);
  const who = actor(user);
  if (!id || !action) throw new OperationError(400, "VALIDATION_ERROR", "الطلب والإجراء مطلوبان");
  return sql.begin(async (tx) => {
    const [r] = await tx<any[]>`select *,id::text from operations.transfer_requests where id=${id}::uuid and is_deleted=false for update`;
    if (!r) throw new OperationError(404, "CONFLICT", "طلب النقل غير موجود");
    if (r.cancelled_at) throw new OperationError(409, "CONFLICT", "طلب النقل ملغي");
    const items = await tx<any[]>`select rv.*,v.id::text,v.vin,v.car_name,v.statement,v.location_id,v.status_code from operations.transfer_request_vehicles rv join operations.vehicles v on v.id=rv.vehicle_id where rv.transfer_request_id=${id}::uuid order by v.vin`;
    async function archiveEligibleItems() {
      const archivedVehicleIds: string[] = [];
      for (const item of items) {
        const archive = await tryArchiveEligibleVehicle(tx, item.id, who);
        if (archive.archived) archivedVehicleIds.push(item.id);
      }
      return archivedVehicleIds;
    }
    if (action === "delete") {
      if (!isSystemAdmin(user) && r.requested_by !== user.id && !hasPermission(user, "operations.transfer.delete")) throw new OperationError(403, "FORBIDDEN", "الحذف متاح لمنشئ الطلب أو صاحب الصلاحية فقط");
      const [events] = await tx<{ count: number }[]>`select count(*)::int as count from operations.transfer_request_events where transfer_request_id=${id}::uuid and action<>'created'`;
      if (r.status !== "request_received" || Number(events?.count || 0) > 0) throw new OperationError(409, "CONFLICT", "لا يمكن حذف الطلب بعد بدء التنفيذ. استخدم الإلغاء.");
      await tx`update operations.transfer_requests set is_deleted=true,deleted_at=now(),deleted_by=${who.id}::uuid,updated_at=now() where id=${id}::uuid`;
      try {
        await tx.savepoint(async (eventTx) => {
          await eventTx`insert into operations.transfer_request_events(transfer_request_id,stage,action,note,actor_id,actor_name,actor_role,actor_branch,before_data) values (${id}::uuid,${r.status},'deleted',${reason||null},${who.id}::uuid,${who.name},${who.role},${who.branch},${eventTx.json({ request:r,items })})`;
        });
      } catch (eventError) {
        console.error('Operations transfer delete event failed', { requestId: id, eventError });
      }
      const autoArchivedVehicleIds = await archiveEligibleItems();
      return { ok: true, autoArchivedVehicleIds, message: "تم حذف طلب النقل قبل بدء التنفيذ" };
    }
    if (action === "cancel") {
      if (!reason) throw new OperationError(400, "VALIDATION_ERROR", "سبب الإلغاء مطلوب");
      if (!isSystemAdmin(user) && r.requested_by !== user.id && !hasPermission(user, "operations.transfer.cancel")) throw new OperationError(403, "FORBIDDEN", "لا توجد لديك صلاحية إلغاء طلب النقل");
      await tx`update operations.transfer_requests set cancelled_at=now(),cancelled_by=${who.id}::uuid,cancellation_reason=${reason},updated_at=now(),version=version+1 where id=${id}::uuid`;
      try {
        await tx.savepoint(async (eventTx) => {
          await eventTx`insert into operations.transfer_request_events(transfer_request_id,stage,action,note,actor_id,actor_name,actor_role,actor_branch,before_data) values (${id}::uuid,${r.status},'cancelled',${reason},${who.id}::uuid,${who.name},${who.role},${who.branch},${eventTx.json(r)})`;
        });
      } catch (eventError) {
        console.error('Operations transfer cancel event failed', { requestId: id, eventError });
      }
      const autoArchivedVehicleIds = await archiveEligibleItems();
      return { ok: true, autoArchivedVehicleIds, message: "تم إلغاء طلب النقل مع الحفاظ على السجل" };
    }
    const currentIndex = transferOrder.indexOf(r.status);
    const next = clean(body.nextStatus) || transferOrder[currentIndex + 1];
    if (!next || transferOrder.indexOf(next) !== currentIndex + 1) throw new OperationError(409, "CONFLICT", "يجب تنفيذ مراحل طلب النقل بالترتيب");
    const stagePermission: Record<string, string> = { vehicle_sent: "operations.transfer.send_vehicle", vehicle_received: "operations.transfer.receive_vehicle", completed: "operations.transfer.complete" };
    if (stagePermission[next] && !hasPermission(user, stagePermission[next])) throw new OperationError(403, "FORBIDDEN", "لا توجد لديك صلاحية تنفيذ هذه المرحلة");
    if (next === "vehicle_sent" && !isSystemAdmin(user) && user.branchCodes.length && !user.branchCodes.includes(r.source_branch_code)) throw new OperationError(403, "FORBIDDEN", "مرحلة إرسال السيارة خاصة بالفرع المصدر");
    if (next === "vehicle_received" && !isSystemAdmin(user) && user.branchCodes.length && !user.branchCodes.includes(r.destination_branch_code)) throw new OperationError(403, "FORBIDDEN", "مرحلة استلام السيارة خاصة بالفرع المستهدف");
    if (next === "vehicle_received") {
      for (const v of items) {
        const [locked] = await tx<any[]>`select *,id::text from operations.vehicles where id=${v.id}::uuid for update`;
        const [movement] = await tx<any[]>`
          insert into operations.movements(vehicle_id,from_location_id,to_location_id,old_status,new_status,note,performed_by,performed_by_name,performed_by_role,performed_by_branch,transfer_request_id,movement_type,before_data)
          values (${v.id}::uuid,${locked.location_id},${r.destination_location_id},${locked.status_code},${locked.status_code},${clean(body.note)||null},${who.id}::uuid,${who.name},${who.role},${who.branch},${id}::uuid,'transfer',${tx.json(locked)}) returning id::text
        `;
        const [updated] = await tx<any[]>`update operations.vehicles set location_id=${r.destination_location_id},updated_by=${who.id}::uuid,updated_by_name=${who.name},updated_at=now(),version=version+1 where id=${v.id}::uuid returning *,id::text`;
        await tx`update operations.movements set after_data=${tx.json(updated)} where id=${movement.id}::uuid`;
      }
    }
    await tx`update operations.transfer_requests set status=${next},completed_at=case when ${next}='completed' then now() else completed_at end,updated_at=now(),version=version+1 where id=${id}::uuid`;
    try {
      await tx.savepoint(async (eventTx) => {
        await eventTx`insert into operations.transfer_request_events(transfer_request_id,stage,action,note,actor_id,actor_name,actor_role,actor_branch,before_data,after_data) values (${id}::uuid,${next},'stage_completed',${clean(body.note)||null},${who.id}::uuid,${who.name},${who.role},${who.branch},${eventTx.json(r)},${eventTx.json({ status: next })})`;
      });
    } catch (eventError) {
      console.error('Operations transfer stage event failed', { requestId: id, next, eventError });
    }
    try {
      await tx.savepoint(async (eventTx) => {
        await eventTx`insert into operations.event_outbox(event_type,entity_type,entity_id,actor_id,actor_name,source_branch,destination_branch,title,description,metadata) values (${`operations.transfer_request.${next}`},'transfer_request',${id},${who.id}::uuid,${who.name},${r.source_branch_code},${r.destination_branch_code},'تحديث طلب نقل',${r.request_no},${eventTx.json({ status: next })})`;
      });
    } catch (outboxError) {
      console.error('Operations transfer stage outbox failed', { requestId: id, next, outboxError });
    }
    const autoArchivedVehicleIds = next === "completed" ? await archiveEligibleItems() : [];
    return { ok: true, autoArchivedVehicleIds, message: next === "completed" ? "تم إنهاء طلب النقل" : "تم تحديث مرحلة طلب النقل" };
  });
}

async function approvalAction(sql: ReturnType<typeof getSql>, body: Record<string, any>, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const vehicleId = clean(body.vehicleId);
  const type = clean(body.approvalType);
  const action = clean(body.approvalAction);
  const note = clean(body.note);
  if (!vehicleId || !["financial", "administrative"].includes(type) || !["approve", "revert", "note", "reset"].includes(action)) throw new OperationError(400, "VALIDATION_ERROR", "بيانات إجراء الموافقة غير مكتملة");
  if (type === "financial" && !hasPermission(user, "operations.approval.financial")) throw new OperationError(403, "FORBIDDEN", "لا توجد لديك صلاحية الموافقة المالية");
  if (type === "administrative" && !hasPermission(user, "operations.approval.administrative")) throw new OperationError(403, "FORBIDDEN", "لا توجد لديك صلاحية الموافقة الإدارية");
  const who = actor(user);
  return sql.begin(async (tx) => {
    const [v] = await tx<any[]>`
      select v.*,v.id::text,l.branch_code,l.code as location_code
      from operations.vehicles v left join operations.locations l on l.id=v.location_id
      where v.id=${vehicleId}::uuid and v.is_deleted=false for update of v
    `;
    if (!v) throw new OperationError(404, "VEHICLE_NOT_FOUND", "السيارة غير موجودة");
    assertBranchAccess(user, v.branch_code, v.location_code, "لا تملك صلاحية تنفيذ موافقة على سيارة في هذا الفرع");
    let a = await ensureActiveVehicleApprovalCycle(tx, vehicleId);
    if (v.status_code !== "under_delivery" && !a.pending_delivery) throw new OperationError(409, "VEHICLE_NOT_ELIGIBLE", "الموافقات متاحة للسيارات مباع تحت التسليم أو المنتظرة للتسليم النهائي");
    const before = { ...a };
    if (action === "reset") {
      if (!isSystemAdmin(user) && !hasPermission(user, "operations.approval.financial") && !hasPermission(user, "operations.approval.administrative")) throw new OperationError(403, "FORBIDDEN", "لا توجد لديك صلاحية مسح الموافقات");
      [a] = await tx<any[]>`update operations.vehicle_approvals set financial_approved=false,administrative_approved=false,financial_approved_by=null,administrative_approved_by=null,financial_approved_by_name=null,administrative_approved_by_name=null,financial_approved_at=null,administrative_approved_at=null,pending_delivery=null,updated_at=now() where id=${a.id}::uuid returning *,id::text`;
    } else if (type === "financial") {
      [a] = await tx<any[]>`
        update operations.vehicle_approvals set financial_approved=${action==='approve' ? true : action==='revert' ? false : a.financial_approved},
          financial_note=${note||a.financial_note||null},financial_approved_by=${action==='approve' ? who.id : action==='revert' ? null : a.financial_approved_by},
          financial_approved_by_name=${action==='approve' ? who.name : action==='revert' ? null : a.financial_approved_by_name},
          financial_approved_at=${action==='approve' ? sql`now()` : action==='revert' ? null : a.financial_approved_at},updated_at=now()
        where id=${a.id}::uuid returning *,id::text
      `;
    } else {
      [a] = await tx<any[]>`
        update operations.vehicle_approvals set administrative_approved=${action==='approve' ? true : action==='revert' ? false : a.administrative_approved},
          administrative_note=${note||a.administrative_note||null},administrative_approved_by=${action==='approve' ? who.id : action==='revert' ? null : a.administrative_approved_by},
          administrative_approved_by_name=${action==='approve' ? who.name : action==='revert' ? null : a.administrative_approved_by_name},
          administrative_approved_at=${action==='approve' ? sql`now()` : action==='revert' ? null : a.administrative_approved_at},updated_at=now()
        where id=${a.id}::uuid returning *,id::text
      `;
    }
    await tx`insert into operations.approval_events(approval_id,vehicle_id,cycle_no,approval_type,action,note,actor_id,actor_name,actor_role,before_data,after_data) values (${a.id}::uuid,${vehicleId}::uuid,${a.cycle_no},${type},${action},${note||null},${who.id}::uuid,${who.name},${who.role},${tx.json(before)},${tx.json(a)})`;

    let delivered = false;
    if (a.financial_approved && a.administrative_approved && a.pending_delivery) {
      const pending = a.pending_delivery as PendingDeliveryPayload;
      const destinationLocationId = clean(pending.destinationLocationId);
      const [destination] = await tx<any[]>`select id::text,code,name,branch_code from operations.locations where id=${destinationLocationId}::uuid and is_active=true`;
      if (!destination) throw new OperationError(409, "INVALID_DESTINATION_LOCATION", "المكان المطلوب للتسليم النهائي لم يعد متاحًا");
      const requestedBy = pending.requestedBy || who;
      const movementWho: MovementActor = {
        id: clean(requestedBy.id) || who.id,
        name: clean(requestedBy.name) || who.name,
        role: clean(requestedBy.role) || who.role,
        branch: clean(requestedBy.branch) || who.branch,
        email: clean(requestedBy.email) || who.email,
      };
      const movementBatchNo = requestId("MB").toUpperCase();
      const [batch] = await tx<any[]>`
        insert into operations.movement_batches(batch_no,destination_location_id,new_status,general_note,requested_count,performed_by,performed_by_name,performed_by_role,performed_by_branch)
        values (${movementBatchNo},${destination.id}::uuid,'delivered',${clean(pending.note)||null},1,${movementWho.id}::uuid,${movementWho.name},${movementWho.role},${movementWho.branch}) returning id::text,batch_no
      `;
      await persistVehicleMovement(tx, {
        vehicle: v,
        destination,
        newStatus: "delivered",
        raw: {
          note: pending.note,
          stateNote: pending.stateNote,
          shortageNote: pending.shortageNote,
          checks: Array.isArray(pending.checks) ? pending.checks : [],
        },
        generalNote: pending.note,
        who: movementWho,
        batchId: batch.id,
        movementType: "approved_delivery",
      });
      [a] = await tx<any[]>`update operations.vehicle_approvals set pending_delivery=null,is_active=false,updated_at=now() where id=${a.id}::uuid returning *,id::text`;
      delivered = true;
    }
    const autoArchive = await tryArchiveEligibleVehicle(tx, vehicleId, who);
    return {
      ok: true,
      approval: a,
      delivered,
      autoArchived: autoArchive.archived,
      message: autoArchive.archived
        ? "تم تحديث الموافقات وأرشفة السيارة تلقائيًا"
        : delivered
          ? "اكتملت الموافقتان وتم تسليم السيارة نهائيًا"
          : "تم تحديث الموافقات",
    };
  });
}

async function saveOperationSetting(sql: ReturnType<typeof getSql>, body: Record<string, any>, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const kind = clean(body.kind);
  const who = actor(user);
  if (kind === "location") {
    const id = clean(body.id);
    const code = clean(body.code).toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
    const name = clean(body.name);
    if (!code || !name) throw new OperationError(400, "VALIDATION_ERROR", "كود المكان واسمه مطلوبان");
    const [row] = id ? await sql<any[]>`
      update operations.locations set code=${code},name=${name},branch_code=${clean(body.branchCode)||null},is_agency=${boolValue(body.isAgency)},is_active=${body.isActive === undefined ? true : boolValue(body.isActive)},sort_order=${intValue(body.sortOrder,0)} where id=${id}::uuid returning *,id::text
    ` : await sql<any[]>`
      insert into operations.locations(code,name,branch_code,is_agency,is_active,sort_order) values (${code},${name},${clean(body.branchCode)||null},${boolValue(body.isAgency)},${body.isActive === undefined ? true : boolValue(body.isActive)},${intValue(body.sortOrder,0)}) returning *,id::text
    `;
    await sql`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data) values (${who.id}::uuid,'operations','operation_location_saved','location',${row.id},${sql.json(row)})`;
    return { ok: true, row, message: "تم حفظ إعداد المكان" };
  }
  if (kind === "status") {
    const code = clean(body.code).toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
    const name = clean(body.name);
    if (!code || !name) throw new OperationError(400, "VALIDATION_ERROR", "كود الحالة واسمها مطلوبان");
    const [row] = await sql<any[]>`
      insert into operations.vehicle_statuses(code,name,sort_order,is_actual_stock,is_delivery_status,is_terminal,is_active)
      values (${code},${name},${intValue(body.sortOrder,0)},${boolValue(body.isActualStock)},${boolValue(body.isDeliveryStatus)},${boolValue(body.isTerminal)},${body.isActive === undefined ? true : boolValue(body.isActive)})
      on conflict(code) do update set name=excluded.name,sort_order=excluded.sort_order,is_actual_stock=excluded.is_actual_stock,is_delivery_status=excluded.is_delivery_status,is_terminal=excluded.is_terminal,is_active=excluded.is_active
      returning *
    `;
    await sql`insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data) values (${who.id}::uuid,'operations','operation_status_saved','vehicle_status',${row.code},${sql.json(row)})`;
    return { ok: true, row, message: "تم حفظ إعداد الحالة" };
  }
  throw new OperationError(400, "VALIDATION_ERROR", "نوع الإعداد غير مدعوم");
}

async function importVehicles(sql: ReturnType<typeof getSql>, body: Record<string, any>, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const mode = clean(body.mode);
  if (!rows.length || !["replace", "add", "update"].includes(mode)) throw new OperationError(400, "IMPORT_VALIDATION_FAILED", "ملف الاستيراد أو وضع الاستيراد غير صحيح");
  const who = actor(user);
  const unrestricted = isSystemAdmin(user) || user.branchCodes.length === 0;
  const allowedBranches = user.branchCodes.length ? user.branchCodes : ["__all__"];
  return sql.begin(async (tx) => {
    const report: any = { total: rows.length, inserted: 0, updated: 0, skipped: 0, failed: 0, errors: [], warnings: [] };
    const vins = new Set<string>();
    const normalized = rows.map((raw: any, index: number) => ({
      row: index + 2,
      vin: clean(raw.vin || raw["رقم الهيكل"] || raw["الهيكل"]),
      carName: clean(raw.carName || raw["السيارة"]), statement: clean(raw.statement || raw["البيان"]), agentName: clean(raw.agentName || raw["الوكيل"]),
      exteriorColor: clean(raw.exteriorColor || raw["خارجي"] || raw["اللون الخارجي"]), interiorColor: clean(raw.interiorColor || raw["داخلي"] || raw["اللون الداخلي"]),
      modelYear: clean(raw.modelYear || raw["موديل"]), plateNo: clean(raw.plateNo || raw["اللوحة"]), batchNo: clean(raw.batchNo || raw["اسم الدفعة بالتاريخ"]),
      locationCode: clean(raw.locationCode || raw["المكان"]), statusCode: clean(raw.statusCode || raw["الحالة"]), notes: clean(raw.notes || raw["ملاحظات في السيارة"]),
    }));
    for (const row of normalized) {
      if (!row.vin) { report.failed++; report.errors.push({ row: row.row, error: "رقم الهيكل مطلوب" }); continue; }
      if (vins.has(row.vin)) { report.failed++; report.errors.push({ row: row.row, vin: row.vin, error: "رقم الهيكل مكرر داخل الملف" }); continue; }
      vins.add(row.vin);
      const [existing] = await tx<any[]>`
        select v.*,v.id::text,l.branch_code,l.code as location_code
        from operations.vehicles v left join operations.locations l on l.id=v.location_id
        where v.vin=${row.vin} and v.is_deleted=false
      `;
      const [location] = row.locationCode ? await tx<any[]>`
        select id::text,code as location_code,branch_code
        from operations.locations where (code=${row.locationCode} or name=${row.locationCode}) and is_active=true limit 1
      ` : [null];
      const [status] = row.statusCode ? await tx<any[]>`select code from operations.vehicle_statuses where code=${row.statusCode} or name=${row.statusCode} limit 1` : [null];
      if (!existing && mode === "update") { report.skipped++; report.warnings.push({ row: row.row, vin: row.vin, warning: "غير موجودة؛ وضع التحديث لا يضيف سيارات" }); continue; }
      if (!existing && !location) { report.failed++; report.errors.push({ row: row.row, vin: row.vin, error: "المكان غير صحيح" }); continue; }
      if (!existing && !hasBranchAccess(user, location?.branch_code, location?.location_code)) { report.failed++; report.errors.push({ row: row.row, vin: row.vin, error: "لا تملك صلاحية الاستيراد إلى هذا الفرع" }); continue; }
      if (existing && !hasBranchAccess(user, existing.branch_code, existing.location_code)) { report.failed++; report.errors.push({ row: row.row, vin: row.vin, error: "لا تملك صلاحية تحديث سيارة في هذا الفرع" }); continue; }
      if (existing && mode === "add") { report.skipped++; report.warnings.push({ row: row.row, vin: row.vin, warning: "موجودة بالفعل؛ وضع الإضافة لا يعدل السيارات الحالية" }); continue; }
      try {
        await tx.savepoint(async (rowTx) => {
          if (!existing) {
            await rowTx`insert into operations.vehicles(vin,car_name,statement,agent_name,exterior_color,interior_color,model_year,plate_no,batch_no,location_id,status_code,notes,has_notes,is_inventory_active,created_by,created_by_name,updated_by,updated_by_name) values (${row.vin},${row.carName||null},${row.statement||null},${row.agentName||null},${row.exteriorColor||null},${row.interiorColor||null},${row.modelYear||null},${row.plateNo||null},${row.batchNo||null},${location.id}::uuid,${status?.code||'available_for_sale'},${row.notes||null},${Boolean(row.notes)},true,${who.id}::uuid,${who.name},${who.id}::uuid,${who.name})`;
          } else {
            await rowTx`
              update operations.vehicles set car_name=coalesce(nullif(${row.carName},''),car_name),statement=coalesce(nullif(${row.statement},''),statement),agent_name=coalesce(nullif(${row.agentName},''),agent_name),
                exterior_color=coalesce(nullif(${row.exteriorColor},''),exterior_color),interior_color=coalesce(nullif(${row.interiorColor},''),interior_color),model_year=coalesce(nullif(${row.modelYear},''),model_year),
                plate_no=coalesce(nullif(${row.plateNo},''),plate_no),batch_no=coalesce(nullif(${row.batchNo},''),batch_no),notes=coalesce(nullif(${row.notes},''),notes),
                is_inventory_active=true,updated_by=${who.id}::uuid,updated_by_name=${who.name},updated_at=now(),version=version+1
              where id=${existing.id}::uuid
            `;
          }
        });
        if (!existing) report.inserted++;
        else {
          if (row.locationCode || row.statusCode) report.warnings.push({ row: row.row, vin: row.vin, warning: "تم تجاهل المكان والحالة للسيارة الموجودة؛ التغيير يتم من تبويب الحركة" });
          report.updated++;
        }
      } catch (error: any) {
        report.failed++; report.errors.push({ row: row.row, vin: row.vin, error: clean(error?.message) || "تعذر حفظ الصف" });
      }
    }
    if (mode === "replace" && vins.size) {
      const vinList = [...vins];
      const [deactivated] = await tx<{ count: number }[]>`
        with updated as (
          update operations.vehicles v set is_inventory_active=false,updated_at=now()
          from operations.locations l
          where l.id=v.location_id and v.is_deleted=false and v.archived_at is null and v.vin not in ${tx(vinList)} and v.is_inventory_active=true
            and (${unrestricted}=true or coalesce(l.branch_code,l.code) in ${tx(allowedBranches)})
          returning 1
        ) select count(*)::int as count from updated
      `;
      report.deactivated = Number(deactivated?.count || 0);
    }
    const [batch] = await tx<any[]>`insert into operations.import_batches(mode,file_name,total_rows,inserted_rows,updated_rows,skipped_rows,failed_rows,report,imported_by,imported_by_name) values (${mode},${clean(body.fileName)||null},${report.total},${report.inserted},${report.updated},${report.skipped},${report.failed},${tx.json(report)},${who.id}::uuid,${who.name}) returning id::text`;
    return { ok: true, batchId: batch.id, report, message: "تم تنفيذ الاستيراد وحفظ التقرير" };
  });
}


async function listPhotographyRequests(sql: ReturnType<typeof getSql>, request: VercelRequest, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const search = clean(request.query.search);
  const status = clean(request.query.status);
  const pattern = `%${search}%`;
  const unrestricted = isSystemAdmin(user) || user.branchCodes.length === 0;
  const rows = await sql<any[]>`
    select r.id::text,r.request_no,r.status,r.requested_by::text,r.requested_by_name,r.requested_by_branch,r.requested_at,r.photography_date,r.note,r.completed_at,
      coalesce(json_agg(json_build_object('vehicle_id',v.id::text,'vin',v.vin,'car_name',v.car_name,'statement',v.statement,'location_name',l.name,'branch_code',coalesce(l.branch_code,l.code)) order by v.vin) filter(where v.id is not null),'[]') as vehicles,
      coalesce((select json_agg(json_build_object('id',e.id::text,'status',e.status,'actor_name',e.actor_name,'note',e.note,'created_at',e.created_at) order by e.created_at desc) from operations.photography_request_events e where e.request_id=r.id),'[]') as events
    from operations.photography_requests r
    left join operations.photography_request_vehicles rv on rv.request_id=r.id
    left join operations.vehicles v on v.id=rv.vehicle_id
    left join operations.locations l on l.id=v.location_id
    where r.is_deleted=false
      and (${unrestricted}=true or r.requested_by_branch in ${sql(user.branchCodes.length ? user.branchCodes : ['__none__'])} or coalesce(l.branch_code,l.code) in ${sql(user.branchCodes.length ? user.branchCodes : ['__none__'])})
      and (${status}='' or r.status=${status})
      and (${search}='' or coalesce(r.request_no,'') ilike ${pattern} or coalesce(r.requested_by_name,'') ilike ${pattern} or coalesce(v.vin,'') ilike ${pattern})
    group by r.id order by r.requested_at desc
  `;
  const requestStatuses = await sql<any[]>`select code,name,is_terminal,is_active,sort_order from marketing_native.request_statuses where is_active=true order by sort_order,name`;
  return { ok: true, rows, requestStatuses };
}

async function photographyRequestAction(sql: ReturnType<typeof getSql>, body: Record<string, unknown>, user: NonNullable<Awaited<ReturnType<typeof requireOperationsUser>>>) {
  const id = clean(body.id);
  const status = clean(body.status);
  const [statusDefinition] = await sql<any[]>`select code,is_terminal from marketing_native.request_statuses where code=${status} and is_active=true`;
  if (!statusDefinition) throw new OperationError(400, 'VALIDATION_ERROR', 'حالة طلب التصوير غير صحيحة');
  const [request] = await sql<any[]>`select r.id::text,r.request_no,r.requested_by_branch from operations.photography_requests r where r.id=${id}::uuid and r.is_deleted=false`;
  if (!request) throw new OperationError(404, 'NOT_FOUND', 'طلب التصوير غير موجود');
  if (!isSystemAdmin(user) && user.branchCodes.length && request.requested_by_branch && !user.branchCodes.includes(request.requested_by_branch)) {
    const [accessible] = await sql<any[]>`select 1 from operations.photography_request_vehicles rv join operations.vehicles v on v.id=rv.vehicle_id join operations.locations l on l.id=v.location_id where rv.request_id=${id}::uuid and coalesce(l.branch_code,l.code) in ${sql(user.branchCodes)} limit 1`;
    if (!accessible) throw new OperationError(403, 'FORBIDDEN', 'لا تملك صلاحية تحديث هذا الطلب');
  }
  const who = actor(user);
  const [row] = await sql<any[]>`update operations.photography_requests set status=${status},photography_date=coalesce(${clean(body.photographyDate)||null}::date,photography_date),note=coalesce(${clean(body.note)||null},note),completed_at=case when ${Boolean(statusDefinition.is_terminal)} then coalesce(completed_at,now()) else null end where id=${id}::uuid returning id::text,request_no,status,photography_date,note,completed_at`;
  await sql`insert into operations.photography_request_events(request_id,status,actor_id,actor_name,note,details) values(${id}::uuid,${status},${who.id}::uuid,${who.name},${clean(body.note)||null},${sql.json({ requestNo: request.request_no })})`;
  return { ok: true, row, message: 'تم تحديث طلب التصوير المشترك مع التسويق' };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const traceId = requestId("ops");
  response.setHeader("Cache-Control", "no-store");
  try {
    await ensureTrackingSchema();
    await ensureOperationsSchema();
    await ensureMarketingSchema();
    await ensureErpNextSalesOrderSchema();
    const user = await requireOperationsUser(request, response);
    if (!user) return;
    const sql = getSql();
    const resource = clean(request.query.resource) || "meta";

    if (request.method === "GET") {
      if (resource === "meta") return response.status(200).json(await loadMeta(sql, user));
      if (resource === "vehicles") return response.status(200).json(await listVehicles(sql, request, user));
      if (resource === "vehicle") return response.status(200).json(await vehicleDetail(sql, clean(request.query.id), user));
      if (resource === "movements") return response.status(200).json(await listMovements(sql, request, user));
      if (resource === "transfers") return response.status(200).json(await listTransfers(sql, request, user));
      if (resource === "approvals") return response.status(200).json(await listApprovals(sql, request, user));
      if (resource === "dashboard_vehicles") return response.status(200).json(await dashboardVehicles(sql, request, user));
      if (resource === "dashboard_shortages") return response.status(200).json(await dashboardShortages(sql, request, user));
      if (resource === "dashboard_requests") return response.status(200).json(await dashboardRequests(sql, request, user));
      if (resource === "photography_requests") return response.status(200).json(await listPhotographyRequests(sql, request, user));
      return response.status(404).json({ ok: false, code: "VALIDATION_ERROR", error: "المورد المطلوب غير موجود", requestId: traceId });
    }

    if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed", requestId: traceId });
    const body = parseBody(request.body);
    const action = clean(body.action);
    let result: unknown;
    if (action === "create_vehicle") {
      if (!requireOperationsPermission(user, "operations.vehicle.create", response)) return;
      result = await createVehicle(sql, body, user);
    } else if (action === "update_vehicle") {
      if (!requireOperationsPermission(user, "operations.vehicle.edit", response)) return;
      result = await updateVehicle(sql, body, user);
    } else if (action === "delete_vehicle") {
      if (!requireOperationsPermission(user, "operations.vehicle.delete", response)) return;
      result = await deleteVehicle(sql, body, user, traceId);
    } else if (action === "archive_vehicle") {
      if (!requireOperationsPermission(user, "operations.vehicle.archive", response)) return;
      result = await archiveVehicle(sql, body, user);
    } else if (action === "move_vehicles") {
      if (!requireOperationsPermission(user, "operations.movement.create", response)) return;
      result = await moveVehicles(sql, body, user);
    } else if (action === "create_transfer") {
      if (!requireOperationsPermission(user, "operations.transfer.create", response)) return;
      result = await createTransfer(sql, body, user);
    } else if (action === "transfer_action") {
      result = await transferAction(sql, body, user);
    } else if (action === "approval_action") {
      result = await approvalAction(sql, body, user);
    } else if (action === "photography_request_action") {
      if (!requireOperationsPermission(user, "operations.transfer.create", response)) return;
      result = await photographyRequestAction(sql, body, user);
    } else if (action === "save_setting") {
      if (!requireOperationsPermission(user, "operations.settings.manage", response)) return;
      result = await saveOperationSetting(sql, body, user);
    } else if (action === "import_vehicles") {
      if (!requireOperationsPermission(user, "operations.vehicle.import", response)) return;
      result = await importVehicles(sql, body, user);
    } else {
      throw new OperationError(400, "VALIDATION_ERROR", "الإجراء غير مدعوم");
    }
    return response.status(200).json({ ...(result as object), requestId: traceId });
  } catch (error) {
    console.error("Operations API failed", { traceId, method: request.method, resource: request.query.resource, error });
    if (response.headersSent) return;
    return sendOperationError(response, error, traceId);
  }
}
