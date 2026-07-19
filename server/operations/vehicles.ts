import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { SessionUser } from "../_auth.js";
import { hasPermission, isSystemAdmin } from "../_auth.js";
import { bodyOf, clean, normalizeVin, permittedLocationIds } from "../_operations-auth.js";
import { getSql } from "../_db.js";
import { audit, bool, objectValue, OperationsError, outbox, pageParams, stringOrNull } from "./common.js";
import { applyApprovalStatusTransition,assertApprovalStatusTransition } from "./approval-flow.js";

function trackingState(row: any) {
  if (!row.tracking_order_id) return "no_request";
  if (row.tracking_deleted) return "deleted";
  if (row.tracking_cancelled) return "cancelled";
  if (row.tracking_rejected) return "rejected";
  if (Number(row.tracking_progress || 0) >= 100 || row.tracking_status === "completed" || row.tracking_archived) return "completed";
  if (Number(row.tracking_progress || 0) > 0 || row.tracking_status === "in_progress") return "in_progress";
  return "not_started";
}

function mapVehicle(row: any) {
  return {
    ...row,
    tracking_state: trackingState(row),
    tracking_sync_state: "available",
    tracking_progress: Number(row.tracking_progress || 0),
    check_items: row.check_items || {},
    movements_count: Number(row.movements_count || 0),
    requests_count: Number(row.requests_count || 0),
    shortages_count: Number(row.shortages_count || 0),
    version: Number(row.version || 1),
  };
}

export async function reconcileTrackingLinks() {
  const sql = getSql();
  await sql`
    with unique_matches as (
      select ov.id as tracking_vehicle_id,(array_agg(v.id order by v.id))[1] as vehicle_id,count(*)::int as matches
      from tracking.order_vehicles ov
      join operations.vehicles v
        on upper(regexp_replace(trim(ov.vin),'\\s+','','g'))=upper(regexp_replace(trim(v.vin),'\\s+','','g'))
       and coalesce(v.is_deleted,false)=false
      where ov.operations_vehicle_id is null
      group by ov.id
      having count(*)=1
    )
    update tracking.order_vehicles ov
    set operations_vehicle_id=m.vehicle_id,updated_at=now()
    from unique_matches m
    where ov.id=m.tracking_vehicle_id and ov.operations_vehicle_id is null
  `.catch(() => undefined);
  await sql`
    insert into operations.vehicle_tracking_links(vehicle_id,tracking_order_id,tracking_vehicle_id,legacy_vin,match_method,match_status)
    select ov.operations_vehicle_id,ov.order_id,ov.id,ov.vin,'vin_exact','matched'
    from tracking.order_vehicles ov
    where ov.operations_vehicle_id is not null
    on conflict do nothing
  `.catch(() => undefined);
}

async function vehicleRows(request: VercelRequest, user: SessionUser) {
  const sql = getSql();
  const allowed = await permittedLocationIds(user);
  const all = isSystemAdmin(user);
  const search = clean(request.query.search);
  const locationId = clean(request.query.locationId);
  const statusCode = clean(request.query.statusCode);
  const modelYear = clean(request.query.modelYear);
  const agentName = clean(request.query.agentName);
  const archived = clean(request.query.archived) || "hide";
  const suggestion = clean(request.query.suggest) === "1";
  const { page, pageSize, offset } = pageParams(request.query as Record<string, unknown>, suggestion ? 20 : 30, suggestion ? 20 : 200);
  const canonicalSearch = normalizeVin(search);
  const pattern = `%${search}%`;
  const vinPattern = `%${canonicalSearch}%`;

  const [countRow] = await sql<{ total: number }[]>`
    select count(*)::int as total
    from operations.vehicles v
    where coalesce(v.is_deleted,false)=false
      and (${all} or v.location_id=any(${allowed}::uuid[]))
      and (${locationId}='' or v.location_id=${locationId || null}::uuid)
      and (${statusCode}='' or v.status_code=${statusCode})
      and (${modelYear}='' or coalesce(v.model_year,'')=${modelYear})
      and (${agentName}='' or coalesce(v.agent_name,'')=${agentName})
      and ((${archived}='only' and v.archived_at is not null) or (${archived}='all') or (${archived}<>'only' and ${archived}<>'all' and v.archived_at is null))
      and (${search}='' or upper(regexp_replace(v.vin,'\\s+','','g')) like ${vinPattern} or coalesce(v.car_name,'') ilike ${pattern}
        or coalesce(v.statement,'') ilike ${pattern} or coalesce(v.plate_no,'') ilike ${pattern})
  `;

  const rows = await sql<any[]>`
    select
      v.id::text,v.vin,v.car_name,v.statement,v.agent_name,v.interior_color,v.exterior_color,v.model_year,v.plate_no,
      v.batch_no,v.location_id::text,l.name as location_name,l.code as location_code,l.branch_id::text,b.name as branch_name,
      v.place_notes,v.notes,v.status_note,v.booking_shortage_location_notes,v.status_code,st.name as status_name,
      st.counts_in_inventory,st.is_final,st.requires_approvals,v.source_type,v.has_notes,v.archived_at,v.archive_reason,
      v.created_at,v.updated_at,v.version,cu.full_name as created_by_name,uu.full_name as updated_by_name,
      coalesce(a.financial_approved,false) as financial_approved,
      coalesce(a.administrative_approved,false) as administrative_approved,
      a.financial_approved_at,a.administrative_approved_at,
      coalesce((select jsonb_object_agg(ci.item_code,ci.is_present) from operations.vehicle_check_items ci where ci.vehicle_id=v.id),'{}'::jsonb) as check_items,
      coalesce((select count(*) from operations.movements m where m.vehicle_id=v.id),0)::int as movements_count,
      coalesce((select count(*) from operations.transfer_request_vehicles rv join operations.transfer_requests r on r.id=rv.transfer_request_id where rv.vehicle_id=v.id and r.deleted_at is null),0)::int as requests_count,
      coalesce((select count(*) from operations.vehicle_shortages s where s.vehicle_id=v.id and s.is_resolved=false),0)::int as shortages_count,
      tr.tracking_order_id::text,tr.tracking_vehicle_id::text,tr.request_no as tracking_order_no,tr.status as tracking_status,
      tr.progress as tracking_progress,tr.current_stage as tracking_current_stage,tr.created_at as tracking_created_at,
      tr.updated_at as tracking_updated_at,tr.completed_at as tracking_completed_at,tr.is_deleted as tracking_deleted,
      tr.is_cancelled as tracking_cancelled,tr.is_rejected as tracking_rejected,tr.is_archived as tracking_archived
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join core.branches b on b.id=l.branch_id
    left join operations.vehicle_statuses st on st.code=v.status_code
    left join operations.vehicle_approvals a on a.vehicle_id=v.id
    left join core.users cu on cu.id=v.created_by
    left join core.users uu on uu.id=v.updated_by
    left join operations.tracking_vehicle_read_model tr on tr.vehicle_id=v.id and tr.display_rank=1
    where coalesce(v.is_deleted,false)=false
      and (${all} or v.location_id=any(${allowed}::uuid[]))
      and (${locationId}='' or v.location_id=${locationId || null}::uuid)
      and (${statusCode}='' or v.status_code=${statusCode})
      and (${modelYear}='' or coalesce(v.model_year,'')=${modelYear})
      and (${agentName}='' or coalesce(v.agent_name,'')=${agentName})
      and ((${archived}='only' and v.archived_at is not null) or (${archived}='all') or (${archived}<>'only' and ${archived}<>'all' and v.archived_at is null))
      and (${search}='' or upper(regexp_replace(v.vin,'\\s+','','g')) like ${vinPattern} or coalesce(v.car_name,'') ilike ${pattern}
        or coalesce(v.statement,'') ilike ${pattern} or coalesce(v.plate_no,'') ilike ${pattern})
    order by case when ${canonicalSearch}<>'' and upper(v.vin)=${canonicalSearch} then 0 else 1 end,v.updated_at desc,v.vin
    limit ${pageSize} offset ${offset}
  `;
  const total = Number(countRow?.total || 0);
  return { vehicles: rows.map(mapVehicle), pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) } };
}

export async function listVehicles(request: VercelRequest, response: VercelResponse, user: SessionUser) {
  const result = await vehicleRows(request, user);
  return response.status(200).json({ ok: true, ...result });
}

export async function getVehicle(request: VercelRequest, response: VercelResponse, user: SessionUser) {
  const id = clean(request.query.id);
  if (!id) return response.status(400).json({ ok: false, error: "معرف السيارة مطلوب" });
  const sql = getSql();
  const allowed = await permittedLocationIds(user);
  const all = isSystemAdmin(user);
  const [row] = await sql<any[]>`
    select
      v.*,v.id::text,v.location_id::text,l.name as location_name,l.code as location_code,l.branch_id::text,b.name as branch_name,
      st.name as status_name,st.counts_in_inventory,st.is_final,st.requires_approvals,
      coalesce(a.financial_approved,false) as financial_approved,coalesce(a.administrative_approved,false) as administrative_approved,
      a.financial_approved_at,a.administrative_approved_at,a.financial_note,a.administrative_note,
      fu.full_name as financial_approved_by_name,au.full_name as administrative_approved_by_name,
      cu.full_name as created_by_name,uu.full_name as updated_by_name,
      tr.tracking_order_id::text,tr.tracking_vehicle_id::text,tr.request_no as tracking_order_no,tr.status as tracking_status,
      tr.progress as tracking_progress,tr.current_stage as tracking_current_stage,tr.created_at as tracking_created_at,
      tr.updated_at as tracking_updated_at,tr.completed_at as tracking_completed_at,tr.is_deleted as tracking_deleted,
      tr.is_cancelled as tracking_cancelled,tr.is_rejected as tracking_rejected,tr.is_archived as tracking_archived
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id left join core.branches b on b.id=l.branch_id
    left join operations.vehicle_statuses st on st.code=v.status_code left join operations.vehicle_approvals a on a.vehicle_id=v.id
    left join core.users fu on fu.id=a.financial_approved_by left join core.users au on au.id=a.administrative_approved_by
    left join core.users cu on cu.id=v.created_by left join core.users uu on uu.id=v.updated_by
    left join operations.tracking_vehicle_read_model tr on tr.vehicle_id=v.id and tr.display_rank=1
    where v.id=${id}::uuid and coalesce(v.is_deleted,false)=false and (${all} or v.location_id=any(${allowed}::uuid[]))
  `;
  if (!row) return response.status(404).json({ ok: false, error: "السيارة غير موجودة أو خارج نطاق صلاحيتك" });
  const [checks, checkHistory, movements, approvals, requests, shortages, notes, trackingHistory, archive, auditRows] = await Promise.all([
    sql<any[]>`
      select d.code,d.name,coalesce(i.is_present,false) as is_present,i.note,i.updated_at,u.full_name as updated_by_name
      from operations.check_item_definitions d
      left join operations.vehicle_check_items i on i.item_code=d.code and i.vehicle_id=${id}::uuid
      left join core.users u on u.id=i.updated_by where d.is_active=true order by d.sort_order
    `,
    sql<any[]>`
      select h.id::text,h.item_code,d.name as item_name,h.old_value,h.new_value,h.note,h.changer_name,h.created_at
      from operations.vehicle_check_history h left join operations.check_item_definitions d on d.code=h.item_code
      where h.vehicle_id=${id}::uuid order by h.created_at desc limit 200
    `,
    sql<any[]>`
      select m.id::text,m.created_at,m.movement_type,m.from_location_id::text,fl.name as from_location_name,
        m.to_location_id::text,tl.name as to_location_name,m.old_status,os.name as old_status_name,m.new_status,ns.name as new_status_name,
        m.note,m.status_note,m.place_note,m.shortage_note,m.performer_name,m.performer_role,m.performer_branch,
        m.request_id::text,r.request_no,m.batch_id::text
      from operations.movements m
      left join operations.locations fl on fl.id=m.from_location_id left join operations.locations tl on tl.id=m.to_location_id
      left join operations.vehicle_statuses os on os.code=m.old_status left join operations.vehicle_statuses ns on ns.code=m.new_status
      left join operations.transfer_requests r on r.id=m.request_id
      where m.vehicle_id=${id}::uuid order by m.created_at desc limit 300
    `,
    sql<any[]>`select id::text,approval_type,action,performer_name,performer_role,performer_branch,note,created_at from operations.vehicle_approval_history where vehicle_id=${id}::uuid order by created_at desc`,
    sql<any[]>`
      select r.id::text,r.request_no,r.transfer_type,r.status,r.photography_date,r.notes,r.requested_at,r.completed_at,r.cancelled_at,r.cancellation_reason
      from operations.transfer_requests r join operations.transfer_request_vehicles rv on rv.transfer_request_id=r.id
      where rv.vehicle_id=${id}::uuid order by r.requested_at desc limit 100
    `,
    sql<any[]>`select id::text,shortage_type,note,is_resolved,created_at,resolved_at from operations.vehicle_shortages where vehicle_id=${id}::uuid order by created_at desc`,
    sql<any[]>`select id::text,note_type,note,creator_name,created_at from operations.vehicle_notes where vehicle_id=${id}::uuid order by created_at desc limit 300`,
    sql<any[]>`
      select tracking_order_id::text,tracking_vehicle_id::text,request_no,status,progress,current_stage,created_at,updated_at,completed_at,is_deleted,is_cancelled,is_rejected,is_archived
      from operations.tracking_vehicle_read_model where vehicle_id=${id}::uuid order by updated_at desc
    `,
    sql<any[]>`select a.id::text,a.reason,a.archived_by_name,a.archived_at,a.tracking_order_id::text from operations.vehicle_archives a where a.vehicle_id=${id}::uuid limit 1`,
    hasPermission(user,"operations.audit.view") ? sql<any[]>`
      select id::text,actor_name,actor_role,actor_branch,action,entity_type,reason,is_override,created_at
      from operations.audit_events where (entity_type='vehicle' and entity_id=${id}) order by created_at desc limit 200
    ` : Promise.resolve([]),
  ]);
  const vehicle = mapVehicle({ ...row, check_items: Object.fromEntries(checks.map((item: any) => [item.code, item.is_present])) });
  return response.status(200).json({ ok: true, vehicle: { ...vehicle, checks, checkHistory, movements, approvals, requests, shortages, notes, trackingHistory, archive: archive[0] || null, audit: auditRows } });
}

async function validateLocationAndStatus(tx: any, user: SessionUser, locationId: string, statusCode: string) {
  const allowed = await permittedLocationIds(user);
  if (!isSystemAdmin(user) && !allowed.includes(locationId)) throw new OperationsError(403,"LOCATION_SCOPE","المكان خارج نطاق الفروع المسموح بها للمستخدم");
  const [location] = await tx<any[]>`select l.id::text,l.code,l.name,l.branch_id::text from operations.locations l where l.id=${locationId}::uuid and l.is_active=true`;
  const [status] = await tx<any[]>`select code,name,is_final,requires_approvals from operations.vehicle_statuses where code=${statusCode} and is_active=true`;
  if (!location) throw new OperationsError(400,"LOCATION","المكان المختار غير صحيح");
  if (!status) throw new OperationsError(400,"STATUS","الحالة المختارة غير صحيحة");
  return { location, status };
}

async function writeNoteHistory(tx: any, user: SessionUser, vehicleId: string, noteType: string, note: string | null, movementId?: string | null) {
  if (!note) return;
  await tx`
    insert into operations.vehicle_notes(vehicle_id,note_type,note,movement_id,created_by,creator_name)
    values (${vehicleId}::uuid,${noteType},${note},${movementId || null}::uuid,${user.id}::uuid,${user.fullName})
  `;
}

async function writeChecks(tx: any, user: SessionUser, vehicle: any, checksInput: Record<string, unknown>, movementId?: string | null) {
  if (!Object.keys(checksInput).length) return;
  if (!hasPermission(user,"operations.checks.update")) throw new OperationsError(403,"CHECK_PERMISSION","ليس لديك صلاحية تعديل التشيك");
  if (vehicle.location_code !== "agency") throw new OperationsError(400,"CHECK_LOCATION","يظهر ويتم تعديل التشيك فقط عندما يكون المكان الحالي للسيارة هو الوكالة");
  const validItems = await tx<{ code: string }[]>`select code from operations.check_item_definitions where is_active=true`;
  const valid = new Set(validItems.map((item) => item.code));
  for (const [code,value] of Object.entries(checksInput)) {
    if (!valid.has(code)) throw new OperationsError(400,"CHECK_ITEM",`عنصر التشيك غير صحيح: ${code}`);
    const [old] = await tx<any[]>`select is_present,note from operations.vehicle_check_items where vehicle_id=${vehicle.id}::uuid and item_code=${code} for update`;
    const next = bool(value);
    if (old && Boolean(old.is_present) === next) continue;
    await tx`
      insert into operations.vehicle_check_items(vehicle_id,item_code,is_present,updated_by,updated_at)
      values (${vehicle.id}::uuid,${code},${next},${user.id}::uuid,now())
      on conflict(vehicle_id,item_code) do update set is_present=excluded.is_present,updated_by=excluded.updated_by,updated_at=now()
    `;
    await tx`
      insert into operations.vehicle_check_history(vehicle_id,item_code,old_value,new_value,movement_id,changed_by,changer_name)
      values (${vehicle.id}::uuid,${code},${old ? Boolean(old.is_present) : null},${next},${movementId || null}::uuid,${user.id}::uuid,${user.fullName})
    `;
  }
}

export async function saveVehicle(request: VercelRequest, response: VercelResponse, user: SessionUser) {
  const body = bodyOf(request);
  const id = clean(body.id);
  const creating = !id;
  const permission = creating ? "operations.vehicles.create" : "operations.vehicles.update";
  if (!hasPermission(user,permission)) return response.status(403).json({ ok: false, error: "ليس لديك صلاحية حفظ السيارة" });
  const vin = normalizeVin(body.vin);
  const locationId = clean(body.locationId);
  const statusCode = clean(body.statusCode) || "available_for_sale";
  const statusNote = stringOrNull(body.statusNote);
  if (!vin) return response.status(400).json({ ok: false, error: "رقم الهيكل VIN مطلوب ويُحفظ كنص" });
  if (!locationId) return response.status(400).json({ ok: false, error: "مكان السيارة مطلوب" });
  if (statusCode === "has_notes" && !statusNote) return response.status(400).json({ ok: false, error: "ملاحظات الحالة إلزامية عند اختيار بها ملاحظات" });
  const sql = getSql();
  try {
    const vehicle = await sql.begin(async (tx) => {
      const { location, status } = await validateLocationAndStatus(tx,user,locationId,statusCode);
      const checks = objectValue(body.checks);
      if (creating) {
        assertApprovalStatusTransition({id:"",vin,status_code:null,financial_approved:false,administrative_approved:false},statusCode);
        const [created] = await tx<any[]>`
          insert into operations.vehicles(
            vin,car_name,statement,agent_name,interior_color,exterior_color,model_year,plate_no,batch_no,location_id,
            status_code,status_note,source_type,notes,place_notes,booking_shortage_location_notes,has_notes,created_by,updated_by
          ) values (
            ${vin},${stringOrNull(body.carName)},${stringOrNull(body.statement)},${stringOrNull(body.agentName)},
            ${stringOrNull(body.interiorColor)},${stringOrNull(body.exteriorColor)},${stringOrNull(body.modelYear)},
            ${stringOrNull(body.plateNo)},${stringOrNull(body.batchNo)},${locationId}::uuid,${statusCode},${statusNote},
            ${stringOrNull(body.sourceType)},${stringOrNull(body.notes)},${stringOrNull(body.placeNotes)},
            ${stringOrNull(body.bookingShortageLocationNotes)},
            ${Boolean(statusNote || stringOrNull(body.notes) || stringOrNull(body.bookingShortageLocationNotes))},${user.id}::uuid,${user.id}::uuid
          ) returning *,id::text
        `;
        await applyApprovalStatusTransition(tx,request,user,{id:created.id,vin,status_code:null},statusCode);
        const vehicleForChecks = { ...created, location_code: location.code };
        await writeChecks(tx,user,vehicleForChecks,checks);
        await writeNoteHistory(tx,user,created.id,"vehicle",stringOrNull(body.notes));
        await writeNoteHistory(tx,user,created.id,"status",statusNote);
        await writeNoteHistory(tx,user,created.id,"booking_shortage_location",stringOrNull(body.bookingShortageLocationNotes));
        await writeNoteHistory(tx,user,created.id,"place",stringOrNull(body.placeNotes));
        await audit(tx,request,user,{ pageCode:"operations.manage",action:"vehicle.created",entityType:"vehicle",entityId:created.id,afterData:created });
        await outbox(tx,user,{ eventType:"operations.vehicle.created",entityType:"vehicle",entityId:created.id,vehicleId:created.id,vin,title:"تمت إضافة سيارة",description:`تمت إضافة السيارة ${vin}`,internalPath:`/operations?vehicle=${created.id}` });
        return created;
      }

      const [current] = await tx<any[]>`
        select v.*,v.id::text,l.code as location_code,l.name as location_name,
          coalesce(a.financial_approved,false) as financial_approved,coalesce(a.administrative_approved,false) as administrative_approved
        from operations.vehicles v left join operations.locations l on l.id=v.location_id
        left join operations.vehicle_approvals a on a.vehicle_id=v.id
        where v.id=${id}::uuid and coalesce(v.is_deleted,false)=false for update of v
      `;
      if (!current) throw new OperationsError(404,"NOT_FOUND","السيارة غير موجودة");
      const allowed = await permittedLocationIds(user);
      if (!isSystemAdmin(user) && !allowed.includes(String(current.location_id))) throw new OperationsError(403,"SCOPE","السيارة خارج نطاق صلاحيتك");
      const expectedVersion = Number(body.version || current.version);
      if (Number(current.version) !== expectedVersion) throw new OperationsError(409,"VERSION","تم تعديل السيارة بواسطة مستخدم آخر. أعد فتح البيانات ثم حاول مرة أخرى");
      if (vin !== current.vin && !hasPermission(user,"operations.vehicles.change_vin")) throw new OperationsError(403,"VIN_PERMISSION","تغيير رقم الهيكل يحتاج صلاحية خاصة");
      assertApprovalStatusTransition(current,statusCode);
      const moving = String(current.location_id || "") !== locationId || current.status_code !== statusCode;
      if (moving) {
        const [active] = await tx<any[]>`select request_id::text from operations.vehicle_request_locks where vehicle_id=${id}::uuid limit 1`;
        if (active) throw new OperationsError(409,"ACTIVE_REQUEST","لا يمكن تغيير مكان أو حالة السيارة أثناء وجود طلب نقل أو تصوير نشط");
      }
      let movementId: string | null = null;
      if (moving) {
        const [movement] = await tx<any[]>`
          insert into operations.movements(
            vehicle_id,from_location_id,to_location_id,old_status,new_status,note,status_note,place_note,shortage_note,
            performed_by,performer_name,performer_role,performer_branch,movement_type,before_data,after_data
          ) values (
            ${id}::uuid,${current.location_id}::uuid,${locationId}::uuid,${current.status_code},${statusCode},${stringOrNull(body.movementNote)},
            ${statusNote},${stringOrNull(body.placeNotes)},${stringOrNull(body.bookingShortageLocationNotes)},${user.id}::uuid,${user.fullName},
            ${user.roles[0] || user.roleCodes[0] || null},${user.branches[0] || user.branchCodes[0] || null},'vehicle_edit',
            ${tx.json(current)},${tx.json({ locationId,statusCode,statusNote })}
          ) returning id::text
        `;
        movementId=movement.id;
      }
      const [updated] = await tx<any[]>`
        update operations.vehicles set
          vin=${vin},car_name=${stringOrNull(body.carName)},statement=${stringOrNull(body.statement)},agent_name=${stringOrNull(body.agentName)},
          interior_color=${stringOrNull(body.interiorColor)},exterior_color=${stringOrNull(body.exteriorColor)},model_year=${stringOrNull(body.modelYear)},
          plate_no=${stringOrNull(body.plateNo)},batch_no=${stringOrNull(body.batchNo)},location_id=${locationId}::uuid,status_code=${statusCode},
          status_note=${statusNote},source_type=${stringOrNull(body.sourceType)},notes=${stringOrNull(body.notes)},place_notes=${stringOrNull(body.placeNotes)},
          booking_shortage_location_notes=${stringOrNull(body.bookingShortageLocationNotes)},
          has_notes=${Boolean(statusNote || stringOrNull(body.notes) || stringOrNull(body.bookingShortageLocationNotes))},
          updated_by=${user.id}::uuid,updated_at=now(),version=version+1
        where id=${id}::uuid and version=${expectedVersion}
        returning *,id::text
      `;
      if (!updated) throw new OperationsError(409,"VERSION","تعذر الحفظ بسبب تعديل متزامن");
      await applyApprovalStatusTransition(tx,request,user,current,statusCode);
      await writeChecks(tx,user,current,checks,movementId);
      if (stringOrNull(body.notes) && stringOrNull(body.notes) !== current.notes) await writeNoteHistory(tx,user,id,"vehicle",stringOrNull(body.notes),movementId);
      if (statusNote && statusNote !== current.status_note) await writeNoteHistory(tx,user,id,"status",statusNote,movementId);
      if (stringOrNull(body.bookingShortageLocationNotes) && stringOrNull(body.bookingShortageLocationNotes) !== current.booking_shortage_location_notes) await writeNoteHistory(tx,user,id,"booking_shortage_location",stringOrNull(body.bookingShortageLocationNotes),movementId);
      if (stringOrNull(body.placeNotes) && stringOrNull(body.placeNotes) !== current.place_notes) await writeNoteHistory(tx,user,id,"place",stringOrNull(body.placeNotes),movementId);
      await audit(tx,request,user,{ pageCode:"operations.manage",action:"vehicle.updated",entityType:"vehicle",entityId:id,beforeData:current,afterData:updated });
      if (moving) await outbox(tx,user,{ eventType:"operations.vehicle.moved",entityType:"vehicle",entityId:id,vehicleId:id,vin,title:"تم تحديث حركة سيارة",description:`تم نقل ${vin} إلى ${location.name}`,internalPath:`/operations?vehicle=${id}`,metadata:{ movementId,fromLocation:current.location_name,toLocation:location.name,oldStatus:current.status_code,newStatus:statusCode } });
      return updated;
    });
    return response.status(creating ? 201 : 200).json({ ok: true, vehicle, message: creating ? "تمت إضافة السيارة" : "تم حفظ بيانات السيارة وسجل التغييرات" });
  } catch (error: any) {
    if (error instanceof OperationsError) return response.status(error.status).json({ ok:false,error:error.message,code:error.code });
    if (error?.code === "23505") return response.status(409).json({ ok:false,error:"رقم الهيكل VIN مسجل بالفعل ولا يمكن تكراره" });
    console.error("Save vehicle failed",error);
    return response.status(500).json({ ok:false,error:"تعذر حفظ السيارة ولم يتم تسجيل بيانات جزئية" });
  }
}
