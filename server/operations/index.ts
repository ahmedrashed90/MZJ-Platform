import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { requestIp, type SessionUser } from "../_auth.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { hasOperationsPermission, requireOperationsPermission } from "../_operations-auth.js";

const CHECKLIST_ITEMS = [
  { key: "farshat", label: "فرشات" },
  { key: "tafaia", label: "طفاية" },
  { key: "shanta", label: "شنطة" },
  { key: "spare", label: "اسبير" },
  { key: "remote", label: "ريموت" },
  { key: "screen", label: "شاشة" },
  { key: "recorder", label: "مسجل" },
  { key: "ac", label: "مكيف" },
  { key: "camera", label: "كاميرا" },
  { key: "sensors", label: "حساس" },
] as const;

const STATUS_ALIASES: Record<string, string> = {
  "متاح للبيع": "available_for_sale",
  "حجز": "reserved",
  "بها ملاحظات": "has_notes",
  "مباع تحت التسليم": "under_delivery",
  "مباع تم التسليم": "delivered",
  available_for_sale: "available_for_sale",
  reserved: "reserved",
  has_notes: "has_notes",
  under_delivery: "under_delivery",
  delivered: "delivered",
};

const STAGE_LABELS: Record<string, string> = {
  request_received: "تم استلام الطلب",
  vehicle_sent: "تم إرسال السيارة",
  vehicle_received: "تم استلام السيارة",
  completed: "تم الانتهاء",
};

function text(value: unknown, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function nullableText(value: unknown, max = 5000) {
  const valueText = text(value, max);
  return valueText || null;
}

function normalizeVin(value: unknown) {
  return text(value, 80).replace(/\s+/g, "").toUpperCase();
}

function normalizeStatus(value: unknown) {
  const raw = text(value, 80);
  return STATUS_ALIASES[raw] || raw;
}

function bool(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1" || value === "نعم" || value === "✓";
}

function asPage(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function bodyOf(request: VercelRequest): Record<string, any> {
  if (request.body && typeof request.body === "object") return request.body as Record<string, any>;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body) as Record<string, any>; } catch { return {}; }
  }
  return {};
}

function fail(response: VercelResponse, status: number, error: string, extra?: Record<string, unknown>) {
  return response.status(status).json({ ok: false, error, ...(extra || {}) });
}

async function audit(user: SessionUser, request: VercelRequest, action: string, entityType: string, entityId: string | null, beforeData: unknown, afterData: unknown, sql: any = getSql()) {
  await sql`
    insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data,ip_address)
    values (${user.id}::uuid,'operations',${action},${entityType},${entityId},${beforeData ? JSON.stringify(beforeData) : null}::jsonb,${afterData ? JSON.stringify(afterData) : null}::jsonb,${requestIp(request)})
  `;
}

async function syncShortage(sql: any, vehicleId: string, note: string | null, userId: string) {
  if (note) {
    const [existing] = await sql<any[]>`
      select id::text from operations.vehicle_shortages
      where vehicle_id=${vehicleId}::uuid and is_resolved=false
      order by created_at desc limit 1
    `;
    if (existing) {
      await sql`update operations.vehicle_shortages set shortage_type='vehicle_note',note=${note} where id=${existing.id}::uuid`;
    } else {
      await sql`insert into operations.vehicle_shortages(vehicle_id,shortage_type,note) values (${vehicleId}::uuid,'vehicle_note',${note})`;
    }
  } else {
    await sql`
      update operations.vehicle_shortages
      set is_resolved=true,resolved_by=${userId}::uuid,resolved_at=now()
      where vehicle_id=${vehicleId}::uuid and is_resolved=false
    `;
  }
}

async function getMeta(user: SessionUser) {
  const sql = getSql();
  const [locations, statuses, colors] = await Promise.all([
    sql<any[]>`select id::text,code,name,sort_order,is_active from operations.locations where is_active=true order by sort_order,name`,
    sql<any[]>`select code,label,sort_order,is_active from operations.statuses where is_active=true order by sort_order,label`,
    sql<any[]>`select id::text,name,sort_order,is_active from operations.interior_colors where is_active=true order by sort_order,name`,
  ]);
  return {
    ok: true,
    locations,
    statuses,
    interiorColors: colors,
    checklistItems: CHECKLIST_ITEMS,
    permissions: {
      canReadVehicles: hasOperationsPermission(user, "operations.vehicles.read"),
      canCreateVehicles: hasOperationsPermission(user, "operations.vehicles.create"),
      canUpdateVehicles: hasOperationsPermission(user, "operations.vehicles.update"),
      canImportVehicles: hasOperationsPermission(user, "operations.vehicles.import"),
      canExportVehicles: hasOperationsPermission(user, "operations.vehicles.export"),
      canArchiveVehicles: hasOperationsPermission(user, "operations.vehicles.archive"),
      canReadMovements: hasOperationsPermission(user, "operations.movements.read"),
      canExecuteMovements: hasOperationsPermission(user, "operations.movements.execute"),
      canReadRequests: hasOperationsPermission(user, "operations.requests.read"),
      canCreateRequests: hasOperationsPermission(user, "operations.requests.create"),
      canDeleteRequests: hasOperationsPermission(user, "operations.requests.delete"),
      canAdvanceRequests: hasOperationsPermission(user, "operations.requests.advance"),
      canManageApprovals: hasOperationsPermission(user, "operations.approvals.manage"),
      canManageSettings: hasOperationsPermission(user, "operations.settings.manage"),
    },
  };
}

async function listVehicles(request: VercelRequest) {
  const sql = getSql();
  const search = text(request.query.search, 200);
  const location = text(request.query.location, 80);
  const status = normalizeStatus(request.query.status);
  const model = text(request.query.model, 80);
  const archive = text(request.query.archive, 20) || "active";
  const page = asPage(request.query.page, 1, 100000);
  const pageSize = asPage(request.query.pageSize, 100, 500);
  const offset = (page - 1) * pageSize;

  const [summary] = await sql<any[]>`
    select count(*)::int as total
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    where v.is_deleted=false
      and (${archive}='all' or (${archive}='archived' and v.is_archived=true) or (${archive}='active' and v.is_archived=false))
      and (${location}='' or l.code=${location})
      and (${status}='' or v.status_code=${status})
      and (${model}='' or coalesce(v.model_year,'')=${model})
      and (${search}='' or concat_ws(' ',v.vin,v.car_name,v.statement,v.agent_name,v.exterior_color,v.interior_color,v.model_year,v.plate_no,v.batch_no,l.name,v.notes,v.location_note,v.shortage_note,v.car_note) ilike ${`%${search}%`})
  `;

  const rows = await sql<any[]>`
    select
      v.id::text,v.vin,v.car_name,v.statement,v.agent_name,v.exterior_color,v.interior_color,
      v.model_year,v.plate_no,v.batch_no,v.status_code,s.label as status_label,v.source_type,
      v.has_notes,v.notes,v.location_note,v.shortage_note,v.car_note,v.tracking_url,
      v.is_archived,v.archived_at,v.created_at,v.updated_at,
      l.id::text as location_id,l.code as location_code,l.name as location_name,
      coalesce(a.financial_approved,false) as financial_approved,
      coalesce(a.administrative_approved,false) as administrative_approved,
      coalesce((select count(*) from operations.movements m where m.vehicle_id=v.id),0)::int as movements_count,
      exists(select 1 from tracking.order_vehicles tv where upper(tv.vin)=upper(v.vin)) as has_tracking
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join operations.statuses s on s.code=v.status_code
    left join operations.vehicle_approvals a on a.vehicle_id=v.id
    where v.is_deleted=false
      and (${archive}='all' or (${archive}='archived' and v.is_archived=true) or (${archive}='active' and v.is_archived=false))
      and (${location}='' or l.code=${location})
      and (${status}='' or v.status_code=${status})
      and (${model}='' or coalesce(v.model_year,'')=${model})
      and (${search}='' or concat_ws(' ',v.vin,v.car_name,v.statement,v.agent_name,v.exterior_color,v.interior_color,v.model_year,v.plate_no,v.batch_no,l.name,v.notes,v.location_note,v.shortage_note,v.car_note) ilike ${`%${search}%`})
    order by v.updated_at desc,v.created_at desc
    limit ${pageSize} offset ${offset}
  `;

  const facets = await sql<any[]>`
    select
      array_remove(array_agg(distinct model_year order by model_year),null) as models
    from operations.vehicles where is_deleted=false
  `;
  return { ok: true, rows, total: Number(summary?.total || 0), page, pageSize, models: facets[0]?.models || [] };
}

async function vehicleDetail(idOrVin: string) {
  const sql = getSql();
  const [vehicle] = await sql<any[]>`
    select
      v.*,v.id::text,l.id::text as location_id,l.code as location_code,l.name as location_name,
      s.label as status_label,
      coalesce(a.financial_approved,false) as financial_approved,
      coalesce(a.administrative_approved,false) as administrative_approved,
      a.financial_note,a.administrative_note,a.financial_approved_at,a.administrative_approved_at,
      fu.full_name as financial_approved_by_name,au.full_name as administrative_approved_by_name,
      coalesce(c.items,'{}'::jsonb) as checklist,
      exists(select 1 from tracking.order_vehicles tv where upper(tv.vin)=upper(v.vin)) as has_tracking
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join operations.statuses s on s.code=v.status_code
    left join operations.vehicle_approvals a on a.vehicle_id=v.id
    left join core.users fu on fu.id=a.financial_approved_by
    left join core.users au on au.id=a.administrative_approved_by
    left join operations.vehicle_checklists c on c.vehicle_id=v.id
    where v.is_deleted=false and (v.id::text=${idOrVin} or upper(v.vin)=upper(${idOrVin}))
    limit 1
  `;
  if (!vehicle) return null;
  const movements = await sql<any[]>`
    select m.id::text,m.old_status,m.new_status,m.note,m.movement_type,m.created_at,
      fl.name as from_location_name,tl.name as to_location_name,u.full_name as performed_by_name,
      tr.request_no
    from operations.movements m
    left join operations.locations fl on fl.id=m.from_location_id
    left join operations.locations tl on tl.id=m.to_location_id
    left join core.users u on u.id=m.performed_by
    left join operations.transfer_requests tr on tr.id=m.transfer_request_id
    where m.vehicle_id=${vehicle.id}::uuid order by m.created_at desc limit 100
  `;
  const shortages = await sql<any[]>`
    select id::text,shortage_type,note,is_resolved,resolved_at,created_at
    from operations.vehicle_shortages where vehicle_id=${vehicle.id}::uuid order by created_at desc
  `;
  return { ...vehicle, movements, shortages };
}

async function saveVehicle(request: VercelRequest, user: SessionUser) {
  const body = bodyOf(request);
  const sql = getSql();
  const id = text(body.id, 80);
  const vin = normalizeVin(body.vin);
  if (!vin) throw new Error("رقم الهيكل مطلوب");
  const statusCode = normalizeStatus(body.statusCode || body.status_code);
  const locationCode = text(body.locationCode || body.location_code, 80);
  if (!statusCode) throw new Error("حالة السيارة مطلوبة");
  if (!locationCode) throw new Error("مكان السيارة مطلوب");
  const [location] = await sql<any[]>`select id::text,code,name from operations.locations where code=${locationCode} and is_active=true`;
  if (!location) throw new Error("مكان السيارة غير صحيح");
  const carNote = nullableText(body.carNote ?? body.car_note ?? body.notes);
  const locationNote = nullableText(body.locationNote ?? body.location_note);
  const shortageNote = nullableText(body.shortageNote ?? body.shortage_note);
  const hasNotes = Boolean(carNote || locationNote || shortageNote || statusCode === "has_notes");
  const checklist = body.checklist && typeof body.checklist === "object" ? body.checklist : {};
  const approval = body.approval && typeof body.approval === "object" ? body.approval : {};

  return sql.begin(async (tx) => {
    let before: any = null;
    let vehicle: any;
    if (id) {
      [before] = await tx<any[]>`select * from operations.vehicles where id=${id}::uuid and is_deleted=false for update`;
      if (!before) throw new Error("السيارة غير موجودة");
      [vehicle] = await tx<any[]>`
        update operations.vehicles set
          vin=${vin},car_name=${nullableText(body.carName ?? body.car_name)},statement=${nullableText(body.statement)},
          agent_name=${nullableText(body.agentName ?? body.agent_name)},exterior_color=${nullableText(body.exteriorColor ?? body.exterior_color)},
          interior_color=${nullableText(body.interiorColor ?? body.interior_color)},model_year=${nullableText(body.modelYear ?? body.model_year,80)},
          plate_no=${nullableText(body.plateNo ?? body.plate_no,80)},batch_no=${nullableText(body.batchNo ?? body.batch_no,80)},
          location_id=${location.id}::uuid,status_code=${statusCode},source_type=${nullableText(body.sourceType ?? body.source_type,80)},
          has_notes=${hasNotes},notes=${carNote},car_note=${carNote},location_note=${locationNote},shortage_note=${shortageNote},
          tracking_url=${nullableText(body.trackingUrl ?? body.tracking_url)},updated_at=now()
        where id=${id}::uuid returning *,id::text
      `;
    } else {
      [vehicle] = await tx<any[]>`
        insert into operations.vehicles(
          vin,car_name,statement,agent_name,exterior_color,interior_color,model_year,plate_no,batch_no,
          location_id,status_code,source_type,has_notes,notes,car_note,location_note,shortage_note,tracking_url
        ) values (
          ${vin},${nullableText(body.carName ?? body.car_name)},${nullableText(body.statement)},${nullableText(body.agentName ?? body.agent_name)},
          ${nullableText(body.exteriorColor ?? body.exterior_color)},${nullableText(body.interiorColor ?? body.interior_color)},
          ${nullableText(body.modelYear ?? body.model_year,80)},${nullableText(body.plateNo ?? body.plate_no,80)},${nullableText(body.batchNo ?? body.batch_no,80)},
          ${location.id}::uuid,${statusCode},${nullableText(body.sourceType ?? body.source_type,80)},${hasNotes},${carNote},${carNote},${locationNote},${shortageNote},${nullableText(body.trackingUrl ?? body.tracking_url)}
        ) returning *,id::text
      `;
    }

    if (Object.keys(checklist).length) {
      await tx`
        insert into operations.vehicle_checklists(vehicle_id,items,updated_by,updated_at)
        values (${vehicle.id}::uuid,${JSON.stringify(checklist)}::jsonb,${user.id}::uuid,now())
        on conflict (vehicle_id) do update set items=excluded.items,updated_by=excluded.updated_by,updated_at=now()
      `;
    }

    const shouldHaveApproval = statusCode === "under_delivery" || bool(approval.financialApproved) || bool(approval.administrativeApproved) || text(approval.financialNote) || text(approval.administrativeNote);
    if (shouldHaveApproval) {
      const financialApproved = bool(approval.financialApproved);
      const administrativeApproved = bool(approval.administrativeApproved);
      await tx`
        insert into operations.vehicle_approvals(
          vehicle_id,financial_approved,administrative_approved,financial_approved_by,administrative_approved_by,
          financial_note,administrative_note,financial_approved_at,administrative_approved_at,updated_at
        ) values (
          ${vehicle.id}::uuid,${financialApproved},${administrativeApproved},
          ${financialApproved ? user.id : null}::uuid,${administrativeApproved ? user.id : null}::uuid,
          ${nullableText(approval.financialNote)},${nullableText(approval.administrativeNote)},
          ${financialApproved ? new Date() : null},${administrativeApproved ? new Date() : null},now()
        ) on conflict (vehicle_id) do update set
          financial_approved=excluded.financial_approved,administrative_approved=excluded.administrative_approved,
          financial_approved_by=case when excluded.financial_approved then excluded.financial_approved_by else null end,
          administrative_approved_by=case when excluded.administrative_approved then excluded.administrative_approved_by else null end,
          financial_note=excluded.financial_note,administrative_note=excluded.administrative_note,
          financial_approved_at=case when excluded.financial_approved then coalesce(operations.vehicle_approvals.financial_approved_at,now()) else null end,
          administrative_approved_at=case when excluded.administrative_approved then coalesce(operations.vehicle_approvals.administrative_approved_at,now()) else null end,
          updated_at=now()
      `;
    }
    await syncShortage(tx, vehicle.id, shortageNote, user.id);
    await audit(user, request, id ? "vehicle_update" : "vehicle_create", "vehicle", vehicle.id, before, vehicle, tx);
    return vehicle;
  });
}

async function updateApproval(request: VercelRequest, user: SessionUser) {
  const body = bodyOf(request);
  const vehicleId = text(body.vehicleId, 80);
  const kind = text(body.kind, 30);
  if (!vehicleId || !["financial", "administrative"].includes(kind)) throw new Error("بيانات الموافقة غير مكتملة");
  const approved = bool(body.approved);
  const note = nullableText(body.note);
  const sql = getSql();
  const [vehicle] = await sql<any[]>`select id::text,vin,status_code from operations.vehicles where id=${vehicleId}::uuid and is_deleted=false`;
  if (!vehicle) throw new Error("السيارة غير موجودة");
  const [before] = await sql<any[]>`select * from operations.vehicle_approvals where vehicle_id=${vehicleId}::uuid`;
  await sql`
    insert into operations.vehicle_approvals(vehicle_id,financial_approved,administrative_approved,updated_at)
    values (${vehicleId}::uuid,false,false,now()) on conflict (vehicle_id) do nothing
  `;
  if (kind === "financial") {
    await sql`
      update operations.vehicle_approvals set financial_approved=${approved},financial_note=${note},
        financial_approved_by=${approved ? user.id : null}::uuid,financial_approved_at=${approved ? new Date() : null},updated_at=now()
      where vehicle_id=${vehicleId}::uuid
    `;
  } else {
    await sql`
      update operations.vehicle_approvals set administrative_approved=${approved},administrative_note=${note},
        administrative_approved_by=${approved ? user.id : null}::uuid,administrative_approved_at=${approved ? new Date() : null},updated_at=now()
      where vehicle_id=${vehicleId}::uuid
    `;
  }
  const [after] = await sql<any[]>`select * from operations.vehicle_approvals where vehicle_id=${vehicleId}::uuid`;
  await audit(user, request, `${kind}_approval_${approved ? "approve" : "revert"}`, "vehicle", vehicleId, before, after);
  return after;
}

async function archiveVehicle(request: VercelRequest, user: SessionUser) {
  const body = bodyOf(request);
  const vehicleId = text(body.vehicleId, 80);
  const sql = getSql();
  const [vehicle] = await sql<any[]>`
    select v.*,v.id::text,coalesce(a.financial_approved,false) as financial_approved,
      coalesce(a.administrative_approved,false) as administrative_approved,
      exists(select 1 from tracking.order_vehicles tv where upper(tv.vin)=upper(v.vin)) as has_tracking,
      exists(select 1 from operations.movements m where m.vehicle_id=v.id) as has_movement
    from operations.vehicles v left join operations.vehicle_approvals a on a.vehicle_id=v.id
    where v.id=${vehicleId}::uuid and v.is_deleted=false
  `;
  if (!vehicle) throw new Error("السيارة غير موجودة");
  const missing: string[] = [];
  if (vehicle.status_code !== "delivered") missing.push("حالة السيارة يجب أن تكون مباع تم التسليم");
  if (!vehicle.financial_approved) missing.push("الموافقة المالية غير مكتملة");
  if (!vehicle.administrative_approved) missing.push("الموافقة الإدارية غير مكتملة");
  if (!vehicle.has_movement) missing.push("لا يوجد سجل حركة للسيارة");
  if (!vehicle.has_tracking && !vehicle.tracking_url) missing.push("السيارة غير مرتبطة بطلب تتبع");
  if (missing.length) {
    const error = new Error("لا يمكن أرشفة السيارة قبل استكمال الشروط");
    (error as Error & { details?: string[] }).details = missing;
    throw error;
  }
  const [updated] = await sql<any[]>`
    update operations.vehicles set is_archived=true,archived_at=now(),archived_by=${user.id}::uuid,updated_at=now()
    where id=${vehicleId}::uuid returning *,id::text
  `;
  await audit(user, request, "vehicle_archive", "vehicle", vehicleId, vehicle, updated);
  return updated;
}

async function executeMovement(request: VercelRequest, user: SessionUser) {
  const body = bodyOf(request);
  const vins = Array.from(new Set((Array.isArray(body.vins) ? body.vins : []).map(normalizeVin).filter(Boolean)));
  const destinationCode = text(body.destinationLocationCode, 80);
  const newStatus = normalizeStatus(body.statusCode);
  const note = nullableText(body.note);
  const locationNote = nullableText(body.locationNote);
  const shortageNote = nullableText(body.shortageNote);
  const agencyData = body.agencyData && typeof body.agencyData === "object" ? body.agencyData as Record<string, any> : {};
  if (!vins.length) throw new Error("أضف رقم هيكل واحدًا على الأقل");
  if (!destinationCode || !newStatus) throw new Error("حدد المكان والحالة الجديدة");
  const sql = getSql();
  const [destination] = await sql<any[]>`select id::text,code,name from operations.locations where code=${destinationCode} and is_active=true`;
  if (!destination) throw new Error("المكان المستهدف غير صحيح");

  return sql.begin(async (tx) => {
    const vehicles = await tx<any[]>`
      select v.*,v.id::text,l.name as location_name,l.code as location_code,
        coalesce(a.financial_approved,false) as financial_approved,
        coalesce(a.administrative_approved,false) as administrative_approved
      from operations.vehicles v
      left join operations.locations l on l.id=v.location_id
      left join operations.vehicle_approvals a on a.vehicle_id=v.id
      where upper(v.vin)=any(${vins.map((vin) => vin.toUpperCase())}::text[]) and v.is_deleted=false and v.is_archived=false
      for update of v
    `;
    const found = new Set(vehicles.map((vehicle) => String(vehicle.vin).toUpperCase()));
    const missing = vins.filter((vin) => !found.has(vin));
    if (missing.length) throw new Error(`أرقام الهياكل التالية غير موجودة: ${missing.join("، ")}`);
    if (newStatus === "delivered") {
      const blocked = vehicles.filter((vehicle) => !vehicle.financial_approved || !vehicle.administrative_approved).map((vehicle) => vehicle.vin);
      if (blocked.length) throw new Error(`لا يمكن التسليم قبل اكتمال الموافقات: ${blocked.join("، ")}`);
    }
    const [batch] = await tx<any[]>`
      insert into operations.movement_batches(movement_type,destination_location_id,new_status,note,performed_by)
      values ('direct',${destination.id}::uuid,${newStatus},${note},${user.id}::uuid) returning id::text
    `;
    const results: any[] = [];
    for (const vehicle of vehicles) {
      const before = { locationId: vehicle.location_id, locationCode: vehicle.location_code, statusCode: vehicle.status_code, interiorColor: vehicle.interior_color, locationNote: vehicle.location_note, shortageNote: vehicle.shortage_note };
      const agency = agencyData[normalizeVin(vehicle.vin)] || {};
      const nextInterior = nullableText(agency.interiorColor, 120) || vehicle.interior_color;
      const nextLocationNote = locationNote ?? vehicle.location_note;
      const nextShortageNote = shortageNote ?? vehicle.shortage_note;
      const hasNotes = Boolean(nextLocationNote || nextShortageNote || vehicle.car_note || newStatus === "has_notes");
      const [updated] = await tx<any[]>`
        update operations.vehicles set location_id=${destination.id}::uuid,status_code=${newStatus},interior_color=${nextInterior},
          location_note=${nextLocationNote},shortage_note=${nextShortageNote},has_notes=${hasNotes},updated_at=now()
        where id=${vehicle.id}::uuid returning *,id::text
      `;
      if (newStatus === "under_delivery") {
        await tx`insert into operations.vehicle_approvals(vehicle_id,financial_approved,administrative_approved,updated_at) values (${vehicle.id}::uuid,false,false,now()) on conflict (vehicle_id) do nothing`;
      }
      if (agency.checklist && typeof agency.checklist === "object") {
        await tx`
          insert into operations.vehicle_checklists(vehicle_id,items,updated_by,updated_at)
          values (${vehicle.id}::uuid,${JSON.stringify(agency.checklist)}::jsonb,${user.id}::uuid,now())
          on conflict (vehicle_id) do update set items=excluded.items,updated_by=excluded.updated_by,updated_at=now()
        `;
      }
      await syncShortage(tx, vehicle.id, nextShortageNote, user.id);
      const after = { locationId: destination.id, locationCode: destination.code, statusCode: newStatus, interiorColor: nextInterior, locationNote: nextLocationNote, shortageNote: nextShortageNote };
      await tx`
        insert into operations.movements(vehicle_id,from_location_id,to_location_id,old_status,new_status,note,performed_by,batch_id,movement_type,before_data,after_data)
        values (${vehicle.id}::uuid,${vehicle.location_id}::uuid,${destination.id}::uuid,${vehicle.status_code},${newStatus},${note},${user.id}::uuid,${batch.id}::uuid,'direct',${JSON.stringify(before)}::jsonb,${JSON.stringify(after)}::jsonb)
      `;
      results.push(updated);
    }
    await audit(user, request, "movement_execute", "movement_batch", batch.id, null, { vins, destinationCode, newStatus, note }, tx);
    return { batchId: batch.id, vehicles: results };
  });
}

async function listRequests(request: VercelRequest) {
  const sql = getSql();
  const status = text(request.query.status, 80);
  const type = text(request.query.type, 30);
  const search = text(request.query.search, 160);
  const rows = await sql<any[]>`
    select r.id::text,r.request_no,r.department_code,r.transfer_type,r.status,r.photo_date,r.target_status_code,r.notes,
      r.requested_at,r.completed_at,r.updated_at,sl.name as source_location_name,dl.name as destination_location_name,
      sl.code as source_location_code,dl.code as destination_location_code,u.full_name as requested_by_name,
      coalesce((select jsonb_agg(jsonb_build_object('vehicleId',v.id::text,'vin',v.vin,'carName',v.car_name,'note',rv.note) order by v.vin)
        from operations.transfer_request_vehicles rv join operations.vehicles v on v.id=rv.vehicle_id where rv.transfer_request_id=r.id),'[]'::jsonb) as vehicles,
      coalesce((select jsonb_agg(jsonb_build_object('stageCode',e.stage_code,'stageLabel',case e.stage_code when 'request_received' then 'تم استلام الطلب' when 'vehicle_sent' then 'تم إرسال السيارة' when 'vehicle_received' then 'تم استلام السيارة' when 'completed' then 'تم الانتهاء' else e.stage_code end,'note',e.note,'performedBy',eu.full_name,'createdAt',e.created_at) order by e.created_at)
        from operations.request_events e left join core.users eu on eu.id=e.performed_by where e.transfer_request_id=r.id),'[]'::jsonb) as events
    from operations.transfer_requests r
    left join operations.locations sl on sl.id=r.source_location_id
    left join operations.locations dl on dl.id=r.destination_location_id
    left join core.users u on u.id=r.requested_by
    where r.deleted_at is null
      and (${status}='' or r.status=${status})
      and (${type}='' or r.transfer_type=${type})
      and (${search}='' or concat_ws(' ',r.request_no,r.department_code,r.notes,u.full_name,sl.name,dl.name) ilike ${`%${search}%`}
        or exists(select 1 from operations.transfer_request_vehicles rv join operations.vehicles v on v.id=rv.vehicle_id where rv.transfer_request_id=r.id and concat_ws(' ',v.vin,v.car_name) ilike ${`%${search}%`}))
    order by r.requested_at desc limit 500
  `;
  return { ok: true, rows };
}

async function createRequest(request: VercelRequest, user: SessionUser) {
  const body = bodyOf(request);
  const transferType = text(body.transferType, 30);
  const destinationCode = text(body.destinationLocationCode, 80);
  const targetStatusCode = normalizeStatus(body.targetStatusCode);
  const items = (Array.isArray(body.vehicles) ? body.vehicles : []).map((item: any) => ({ vin: normalizeVin(item?.vin ?? item), note: nullableText(item?.note) })).filter((item: any) => item.vin);
  if (!items.length) throw new Error("أضف سيارة واحدة على الأقل للطلب");
  if (!destinationCode) throw new Error("حدد مكان النقل");
  if (!["transfer", "photo"].includes(transferType)) throw new Error("نوع الطلب غير صحيح");
  const sql = getSql();
  const [destination] = await sql<any[]>`select id::text,code,name from operations.locations where code=${destinationCode} and is_active=true`;
  if (!destination) throw new Error("مكان النقل غير صحيح");

  return sql.begin(async (tx) => {
    const vins = items.map((item: any) => item.vin);
    const vehicles = await tx<any[]>`
      select v.id::text,v.vin,v.car_name,v.location_id::text,l.code as location_code
      from operations.vehicles v left join operations.locations l on l.id=v.location_id
      where upper(v.vin)=any(${vins}::text[]) and v.is_deleted=false and v.is_archived=false
    `;
    const found = new Set(vehicles.map((vehicle) => normalizeVin(vehicle.vin)));
    const missing = vins.filter((vin: string) => !found.has(vin));
    if (missing.length) throw new Error(`أرقام الهياكل التالية غير موجودة: ${missing.join("، ")}`);
    const sourceIds = Array.from(new Set(vehicles.map((vehicle) => vehicle.location_id).filter(Boolean)));
    const requestNo = `OP-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${Date.now().toString().slice(-6)}`;
    const [row] = await tx<any[]>`
      insert into operations.transfer_requests(
        request_no,department_code,transfer_type,source_location_id,destination_location_id,status,requested_by,photo_date,target_status_code,notes,updated_at
      ) values (
        ${requestNo},${nullableText(body.departmentCode,80)},${transferType},${sourceIds.length===1 ? sourceIds[0] : null}::uuid,
        ${destination.id}::uuid,'request_received',${user.id}::uuid,${nullableText(body.photoDate,30)}::date,${targetStatusCode || null},${nullableText(body.notes)},now()
      ) returning *,id::text
    `;
    for (const vehicle of vehicles) {
      const item = items.find((entry: any) => entry.vin === normalizeVin(vehicle.vin));
      await tx`
        insert into operations.transfer_request_vehicles(transfer_request_id,vehicle_id,note)
        values (${row.id}::uuid,${vehicle.id}::uuid,${item?.note || null})
      `;
    }
    await tx`
      insert into operations.request_events(transfer_request_id,stage_code,note,performed_by)
      values (${row.id}::uuid,'request_received',${nullableText(body.stageNote)},${user.id}::uuid)
    `;
    await audit(user, request, "request_create", "transfer_request", row.id, null, { ...row, vehicles: items }, tx);
    return row;
  });
}

async function advanceRequest(request: VercelRequest, user: SessionUser) {
  const body = bodyOf(request);
  const requestId = text(body.requestId, 80);
  const sql = getSql();
  return sql.begin(async (tx) => {
    const [row] = await tx<any[]>`
      select r.*,r.id::text,dl.code as destination_location_code,dl.name as destination_location_name
      from operations.transfer_requests r left join operations.locations dl on dl.id=r.destination_location_id
      where r.id=${requestId}::uuid and r.deleted_at is null for update of r
    `;
    if (!row) throw new Error("الطلب غير موجود");
    const nextMap: Record<string, string> = { request_received: "vehicle_sent", vehicle_sent: "vehicle_received", vehicle_received: "completed" };
    const next = nextMap[row.status];
    if (!next) throw new Error("الطلب مكتمل بالفعل");
    const vehicles = await tx<any[]>`
      select v.*,v.id::text,rv.note as request_vehicle_note,l.code as location_code
      from operations.transfer_request_vehicles rv join operations.vehicles v on v.id=rv.vehicle_id
      left join operations.locations l on l.id=v.location_id where rv.transfer_request_id=${requestId}::uuid
      for update of v
    `;
    if (next === "vehicle_received" && row.transfer_type === "transfer") {
      for (const vehicle of vehicles) {
        const newStatus = row.target_status_code || vehicle.status_code;
        if (newStatus === "delivered") {
          const [approval] = await tx<any[]>`select financial_approved,administrative_approved from operations.vehicle_approvals where vehicle_id=${vehicle.id}::uuid`;
          if (!approval?.financial_approved || !approval?.administrative_approved) throw new Error(`لا يمكن تسليم السيارة ${vehicle.vin} قبل اكتمال الموافقات`);
        }
        const before = { locationId: vehicle.location_id, locationCode: vehicle.location_code, statusCode: vehicle.status_code };
        const after = { locationId: row.destination_location_id, locationCode: row.destination_location_code, statusCode: newStatus };
        await tx`update operations.vehicles set location_id=${row.destination_location_id}::uuid,status_code=${newStatus},updated_at=now() where id=${vehicle.id}::uuid`;
        await tx`
          insert into operations.movements(vehicle_id,from_location_id,to_location_id,old_status,new_status,note,performed_by,transfer_request_id,movement_type,before_data,after_data)
          values (${vehicle.id}::uuid,${vehicle.location_id}::uuid,${row.destination_location_id}::uuid,${vehicle.status_code},${newStatus},${nullableText(body.note) || vehicle.request_vehicle_note},${user.id}::uuid,${requestId}::uuid,'request',${JSON.stringify(before)}::jsonb,${JSON.stringify(after)}::jsonb)
        `;
      }
    }
    await tx`update operations.transfer_requests set status=${next},updated_at=now(),completed_at=${next === "completed" ? new Date() : null} where id=${requestId}::uuid`;
    await tx`insert into operations.request_events(transfer_request_id,stage_code,note,performed_by) values (${requestId}::uuid,${next},${nullableText(body.note)},${user.id}::uuid)`;
    await audit(user, request, "request_advance", "transfer_request", requestId, { status: row.status }, { status: next, stageLabel: STAGE_LABELS[next] }, tx);
    return { requestId, status: next, stageLabel: STAGE_LABELS[next] };
  });
}

async function deleteRequest(request: VercelRequest, user: SessionUser) {
  const body = bodyOf(request);
  const requestId = text(body.requestId, 80);
  const sql = getSql();
  const [row] = await sql<any[]>`select *,id::text from operations.transfer_requests where id=${requestId}::uuid and deleted_at is null`;
  if (!row) throw new Error("الطلب غير موجود");
  if (row.status !== "request_received") throw new Error("لا يمكن حذف الطلب بعد بدء مراحل إرسال أو استلام السيارة");
  await sql`update operations.transfer_requests set deleted_at=now(),updated_at=now() where id=${requestId}::uuid`;
  await audit(user, request, "request_delete", "transfer_request", requestId, row, { deletedAt: new Date().toISOString() });
  return { requestId };
}

async function listMovements(request: VercelRequest) {
  const sql = getSql();
  const search = text(request.query.search, 160);
  const from = text(request.query.from, 30);
  const to = text(request.query.to, 30);
  const location = text(request.query.location, 80);
  const rows = await sql<any[]>`
    select m.id::text,m.old_status,m.new_status,m.note,m.movement_type,m.created_at,
      v.id::text as vehicle_id,v.vin,v.car_name,v.model_year,
      fl.code as from_location_code,fl.name as from_location_name,tl.code as to_location_code,tl.name as to_location_name,
      u.full_name as performed_by_name,tr.request_no
    from operations.movements m
    join operations.vehicles v on v.id=m.vehicle_id
    left join operations.locations fl on fl.id=m.from_location_id
    left join operations.locations tl on tl.id=m.to_location_id
    left join core.users u on u.id=m.performed_by
    left join operations.transfer_requests tr on tr.id=m.transfer_request_id
    where (${search}='' or concat_ws(' ',v.vin,v.car_name,v.model_year,fl.name,tl.name,u.full_name,m.note,tr.request_no) ilike ${`%${search}%`})
      and (${from}='' or m.created_at >= ${from}::date)
      and (${to}='' or m.created_at < (${to}::date + interval '1 day'))
      and (${location}='' or fl.code=${location} or tl.code=${location})
    order by m.created_at desc limit 1000
  `;
  return { ok: true, rows };
}

async function availability(request: VercelRequest) {
  const sql = getSql();
  const search = text(request.query.search, 160);
  const location = text(request.query.location, 80);
  const rows = await sql<any[]>`
    select v.car_name,v.statement,v.model_year,v.exterior_color,v.interior_color,count(*)::int as quantity,
      jsonb_object_agg(coalesce(l.code,'unknown'),location_count) as location_counts
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    join lateral (
      select count(*)::int as location_count
      from operations.vehicles v2 where v2.is_deleted=false and v2.is_archived=false
        and v2.status_code not in ('under_delivery','delivered')
        and v2.car_name is not distinct from v.car_name and v2.statement is not distinct from v.statement
        and v2.model_year is not distinct from v.model_year and v2.exterior_color is not distinct from v.exterior_color
        and v2.interior_color is not distinct from v.interior_color and v2.location_id is not distinct from v.location_id
    ) x on true
    where v.is_deleted=false and v.is_archived=false and v.status_code not in ('under_delivery','delivered')
      and (${location}='' or l.code=${location})
      and (${search}='' or concat_ws(' ',v.car_name,v.statement,v.model_year,v.exterior_color,v.interior_color) ilike ${`%${search}%`})
    group by v.car_name,v.statement,v.model_year,v.exterior_color,v.interior_color
    order by v.car_name,v.statement,v.model_year,v.exterior_color,v.interior_color
  `;
  return { ok: true, rows };
}

async function importVehicles(request: VercelRequest, user: SessionUser) {
  const body = bodyOf(request);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
  if (!rows.length) throw new Error("ملف الاستيراد لا يحتوي على بيانات");
  const sql = getSql();
  const locations = await sql<any[]>`select id::text,code,name from operations.locations where is_active=true`;
  const locationMap = new Map<string, any>();
  for (const location of locations) {
    locationMap.set(String(location.code).toLowerCase(), location);
    locationMap.set(String(location.name).trim(), location);
  }
  const results = { created: 0, updated: 0, skipped: 0, errors: [] as Array<{ row: number; vin?: string; error: string }> };
  await sql.begin(async (tx) => {
    for (let index = 0; index < rows.length; index += 1) {
      const source = rows[index] || {};
      const vin = normalizeVin(source.vin ?? source.VIN ?? source["رقم الهيكل"] ?? source["رقم الشاسيه"]);
      if (!vin) { results.skipped += 1; results.errors.push({ row: index + 2, error: "رقم الهيكل فارغ" }); continue; }
      const locationRaw = text(source.location ?? source.locationName ?? source["المكان"] ?? source["الفرع"], 120);
      const location = locationMap.get(locationRaw) || locationMap.get(locationRaw.toLowerCase());
      if (!location) { results.skipped += 1; results.errors.push({ row: index + 2, vin, error: `المكان غير معروف: ${locationRaw || "فارغ"}` }); continue; }
      const statusCode = normalizeStatus(source.statusCode ?? source.status ?? source["الحالة"] ?? "available_for_sale");
      const [existing] = await tx<any[]>`select id::text from operations.vehicles where upper(vin)=upper(${vin}) and is_deleted=false`;
      const carNote = nullableText(source.carNote ?? source.notes ?? source["ملاحظات السيارة"] ?? source["ملاحظات في السيارة"]);
      const locationNote = nullableText(source.locationNote ?? source["ملاحظات المكان"]);
      const shortageNote = nullableText(source.shortageNote ?? source["النواقص"] ?? source["حجز - نواقص - تحديد مكان"]);
      const values = {
        carName: nullableText(source.carName ?? source["السيارة"]), statement: nullableText(source.statement ?? source["البيان"]),
        agentName: nullableText(source.agentName ?? source.agent ?? source["الوكيل"]), exteriorColor: nullableText(source.exteriorColor ?? source["اللون الخارجي"]),
        interiorColor: nullableText(source.interiorColor ?? source["اللون الداخلي"]), modelYear: nullableText(source.modelYear ?? source.model ?? source["الموديل"],80),
        plateNo: nullableText(source.plateNo ?? source.plate ?? source["اللوحة"],80), batchNo: nullableText(source.batchNo ?? source.batch ?? source["الدفعة"],80),
      };
      const hasNotes = Boolean(carNote || locationNote || shortageNote || statusCode === "has_notes");
      let vehicleId: string;
      if (existing) {
        await tx`
          update operations.vehicles set car_name=${values.carName},statement=${values.statement},agent_name=${values.agentName},
            exterior_color=${values.exteriorColor},interior_color=${values.interiorColor},model_year=${values.modelYear},plate_no=${values.plateNo},batch_no=${values.batchNo},
            location_id=${location.id}::uuid,status_code=${statusCode},has_notes=${hasNotes},notes=${carNote},car_note=${carNote},location_note=${locationNote},shortage_note=${shortageNote},
            imported_at=now(),updated_at=now() where id=${existing.id}::uuid
        `;
        vehicleId = existing.id; results.updated += 1;
      } else {
        const [created] = await tx<any[]>`
          insert into operations.vehicles(vin,car_name,statement,agent_name,exterior_color,interior_color,model_year,plate_no,batch_no,location_id,status_code,has_notes,notes,car_note,location_note,shortage_note,imported_at)
          values (${vin},${values.carName},${values.statement},${values.agentName},${values.exteriorColor},${values.interiorColor},${values.modelYear},${values.plateNo},${values.batchNo},${location.id}::uuid,${statusCode},${hasNotes},${carNote},${carNote},${locationNote},${shortageNote},now()) returning id::text
        `;
        vehicleId = created.id; results.created += 1;
      }
      await syncShortage(tx, vehicleId, shortageNote, user.id);
      if (statusCode === "under_delivery") await tx`insert into operations.vehicle_approvals(vehicle_id) values (${vehicleId}::uuid) on conflict (vehicle_id) do nothing`;
    }
    await audit(user, request, "vehicles_import", "vehicle_import", null, null, results, tx);
  });
  return results;
}

async function updateSettings(request: VercelRequest, user: SessionUser) {
  const body = bodyOf(request);
  const kind = text(body.kind, 30);
  const sql = getSql();
  if (kind === "location") {
    const code = text(body.code, 80).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    const name = text(body.name, 120);
    if (!code || !name) throw new Error("كود واسم المكان مطلوبان");
    const [row] = await sql<any[]>`
      insert into operations.locations(code,name,sort_order,is_active) values (${code},${name},${Number(body.sortOrder || 0)},true)
      on conflict (code) do update set name=excluded.name,sort_order=excluded.sort_order,is_active=true returning *,id::text
    `;
    await audit(user, request, "location_save", "operations_location", row.id, null, row);
    return row;
  }
  if (kind === "status") {
    const code = text(body.code, 80).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    const label = text(body.label, 120);
    if (!code || !label) throw new Error("كود واسم الحالة مطلوبان");
    const [row] = await sql<any[]>`
      insert into operations.statuses(code,label,sort_order,is_active) values (${code},${label},${Number(body.sortOrder || 0)},true)
      on conflict (code) do update set label=excluded.label,sort_order=excluded.sort_order,is_active=true returning *
    `;
    await audit(user, request, "status_save", "operations_status", code, null, row);
    return row;
  }
  if (kind === "color") {
    const name = text(body.name, 120);
    if (!name) throw new Error("اسم اللون مطلوب");
    const [row] = await sql<any[]>`
      insert into operations.interior_colors(name,sort_order,is_active) values (${name},${Number(body.sortOrder || 0)},true)
      on conflict (name) do update set sort_order=excluded.sort_order,is_active=true returning *,id::text
    `;
    await audit(user, request, "interior_color_save", "operations_color", row.id, null, row);
    return row;
  }
  throw new Error("نوع الإعداد غير صحيح");
}

function permissionFor(request: VercelRequest) {
  const resource = text(request.query.resource, 40) || "meta";
  if (request.method === "GET") {
    if (["meta", "vehicles", "vehicle", "availability"].includes(resource)) return "operations.vehicles.read";
    if (resource === "requests") return "operations.requests.read";
    if (resource === "movements") return "operations.movements.read";
  }
  const action = text(bodyOf(request).action, 50);
  const map: Record<string, string> = {
    saveVehicle: bodyOf(request).id ? "operations.vehicles.update" : "operations.vehicles.create",
    updateApproval: "operations.approvals.manage",
    archiveVehicle: "operations.vehicles.archive",
    executeMovement: "operations.movements.execute",
    createRequest: "operations.requests.create",
    advanceRequest: "operations.requests.advance",
    deleteRequest: "operations.requests.delete",
    importVehicles: "operations.vehicles.import",
    updateSettings: "operations.settings.manage",
  };
  return map[action] || "operations.view";
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!['GET','POST'].includes(request.method || '')) return fail(response, 405, "Method not allowed");
  const user = await requireOperationsPermission(request, response, permissionFor(request));
  if (!user) return;
  try {
    await ensureOperationsSchema();
    if (request.method === "GET") {
      const resource = text(request.query.resource, 40) || "meta";
      if (resource === "meta") return response.status(200).json(await getMeta(user));
      if (resource === "vehicles") return response.status(200).json(await listVehicles(request));
      if (resource === "vehicle") {
        const detail = await vehicleDetail(text(request.query.id || request.query.vin, 100));
        if (!detail) return fail(response, 404, "السيارة غير موجودة");
        return response.status(200).json({ ok: true, vehicle: detail });
      }
      if (resource === "requests") return response.status(200).json(await listRequests(request));
      if (resource === "movements") return response.status(200).json(await listMovements(request));
      if (resource === "availability") return response.status(200).json(await availability(request));
      return fail(response, 404, "مصدر بيانات العمليات غير موجود");
    }

    const action = text(bodyOf(request).action, 50);
    if (action === "saveVehicle") return response.status(200).json({ ok: true, vehicle: await saveVehicle(request, user) });
    if (action === "updateApproval") return response.status(200).json({ ok: true, approval: await updateApproval(request, user) });
    if (action === "archiveVehicle") return response.status(200).json({ ok: true, vehicle: await archiveVehicle(request, user) });
    if (action === "executeMovement") return response.status(200).json({ ok: true, result: await executeMovement(request, user) });
    if (action === "createRequest") return response.status(200).json({ ok: true, request: await createRequest(request, user) });
    if (action === "advanceRequest") return response.status(200).json({ ok: true, result: await advanceRequest(request, user) });
    if (action === "deleteRequest") return response.status(200).json({ ok: true, result: await deleteRequest(request, user) });
    if (action === "importVehicles") return response.status(200).json({ ok: true, result: await importVehicles(request, user) });
    if (action === "updateSettings") return response.status(200).json({ ok: true, result: await updateSettings(request, user) });
    return fail(response, 400, "إجراء العمليات غير معروف");
  } catch (error) {
    console.error("Operations API error", error);
    const details = (error as Error & { details?: string[] }).details;
    const message = error instanceof Error ? error.message : "تعذر تنفيذ العملية";
    const status = /غير موجود|not found/i.test(message) ? 404 : /مكرر|duplicate|unique/i.test(message) ? 409 : 400;
    return fail(response, status, message, details ? { details } : undefined);
  }
}
