import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import {
  OPERATIONS_PERMISSIONS,
  hasOperationsPermission,
  requireOperationsPermission,
  requireOperationsUser,
} from "../_operations-auth.js";
import { auditOperations, clean, nextOperationsNumber, normalizeContents, normalizeVin, nullableText } from "../_operations-utils.js";

function parseBody(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, any>;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body || "{}"); } catch { return {}; }
  }
  return {};
}

function scopeAll(user: { roleCodes: string[]; branchCodes: string[] }) {
  if (user.roleCodes.some((code) => ["admin", "sales_manager"].includes(code))) return true;
  return user.roleCodes.includes("operations_user") && user.branchCodes.length === 0;
}

async function vehicleDetail(id: string, user: { roleCodes: string[]; branchCodes: string[] }) {
  const sql = getSql();
  const all = scopeAll(user);
  const [vehicle] = await sql<any[]>`
    select
      v.id::text,v.legacy_id,v.vin,v.car_name,v.statement,v.agent_name,v.exterior_color,v.interior_color,
      v.model_year,v.plate_no,v.batch_no,v.location_id::text,l.code as location_code,l.name as location_name,
      v.status_code,vs.name as status_name,v.source_type,v.location_note,v.shortage_note,v.notes,v.contents,
      v.has_notes,v.is_archived,v.archived_at,v.archive_note,v.created_at,v.updated_at,
      au.full_name as archived_by_name,cu.full_name as created_by_name,uu.full_name as updated_by_name,
      coalesce(ap.financial_approved,false) as financial_approved,
      coalesce(ap.administrative_approved,false) as administrative_approved,
      ap.financial_note,ap.administrative_note,ap.financial_approved_at,ap.administrative_approved_at,
      fu.full_name as financial_approved_by_name,adu.full_name as administrative_approved_by_name,
      coalesce(mv.movements_count,0)::int as movements_count,mv.last_movement_at,
      coalesce(sh.shortages_count,0)::int as shortages_count,
      exists(
        select 1 from tracking.order_vehicles tov
        join tracking.orders tor on tor.id=tov.order_id
        where upper(trim(tov.vin))=upper(trim(v.vin)) and (coalesce(tor.is_archived,false)=true or tor.status='completed')
      ) as tracking_completed
    from operations.vehicles v
    left join operations.locations l on l.id=v.location_id
    left join core.branches b on b.id=l.branch_id
    left join operations.vehicle_statuses vs on vs.code=v.status_code
    left join lateral (
      select a.* from operations.vehicle_approvals a where a.vehicle_id=v.id order by a.updated_at desc limit 1
    ) ap on true
    left join core.users fu on fu.id=ap.financial_approved_by
    left join core.users adu on adu.id=ap.administrative_approved_by
    left join core.users au on au.id=v.archived_by
    left join core.users cu on cu.id=v.created_by
    left join core.users uu on uu.id=v.updated_by
    left join lateral (
      select count(*)::int as movements_count,max(created_at) as last_movement_at from operations.movements where vehicle_id=v.id
    ) mv on true
    left join lateral (
      select count(*) filter (where is_resolved=false)::int as shortages_count from operations.vehicle_shortages where vehicle_id=v.id
    ) sh on true
    where v.id=${id}::uuid and v.is_deleted=false
      and (${all}::boolean or coalesce(l.location_type,'other')<>'branch' or coalesce(b.code,'')=any(${user.branchCodes}::text[]))
  `;
  if (!vehicle) return null;

  const [movements, shortages, requests] = await Promise.all([
    sql<any[]>`
      select m.id::text,m.movement_type,m.old_status,m.new_status,m.note,m.performed_by_name,m.created_at,
             fl.name as from_location_name,tl.name as to_location_name,mb.batch_no,tr.request_no
      from operations.movements m
      left join operations.locations fl on fl.id=m.from_location_id
      left join operations.locations tl on tl.id=m.to_location_id
      left join operations.movement_batches mb on mb.id=m.movement_batch_id
      left join operations.transfer_requests tr on tr.id=m.request_id
      where m.vehicle_id=${id}::uuid order by m.created_at desc limit 100
    `,
    sql<any[]>`
      select s.id::text,s.shortage_type,s.note,s.is_resolved,s.created_at,s.resolved_at,
             cu.full_name as created_by_name,ru.full_name as resolved_by_name
      from operations.vehicle_shortages s
      left join core.users cu on cu.id=s.created_by
      left join core.users ru on ru.id=s.resolved_by
      where s.vehicle_id=${id}::uuid order by s.is_resolved,s.created_at desc
    `,
    sql<any[]>`
      select r.id::text,r.request_no,r.transfer_type,r.status,r.current_stage,r.requested_at,r.completed_at,
             dl.name as destination_name
      from operations.transfer_request_vehicles rv
      join operations.transfer_requests r on r.id=rv.transfer_request_id and r.is_deleted=false
      left join operations.locations dl on dl.id=r.destination_location_id
      where rv.vehicle_id=${id}::uuid order by r.requested_at desc limit 50
    `,
  ]);

  return { ...vehicle, movements, shortages, requests };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  await ensureOperationsSchema();
  const user = await requireOperationsUser(request, response);
  if (!user) return;
  const sql = getSql();

  try {
    if (request.method === "GET") {
      if (!requireOperationsPermission(user, response, OPERATIONS_PERMISSIONS.vehiclesView)) return;
      const id = clean(request.query.id);
      if (id) {
        const detail = await vehicleDetail(id, user);
        if (!detail) return response.status(404).json({ ok: false, error: "السيارة غير موجودة أو خارج نطاق صلاحيتك" });
        return response.status(200).json({ ok: true, vehicle: detail });
      }

      const search = clean(request.query.search);
      const location = clean(request.query.location);
      const status = clean(request.query.status);
      const archived = ["1", "true", "yes"].includes(clean(request.query.archived).toLowerCase());
      const limit = Math.min(Math.max(Number(request.query.limit || 500), 1), 2000);
      const pattern = `%${search}%`;
      const all = scopeAll(user);

      const vehicles = await sql<any[]>`
        select
          v.id::text,v.vin,v.car_name,v.statement,v.agent_name,v.exterior_color,v.interior_color,v.model_year,
          v.plate_no,v.batch_no,v.location_id::text,l.code as location_code,l.name as location_name,
          v.status_code,vs.name as status_name,v.location_note,v.shortage_note,v.notes,v.contents,v.has_notes,
          v.is_archived,v.archived_at,v.created_at,v.updated_at,
          coalesce(ap.financial_approved,false) as financial_approved,
          coalesce(ap.administrative_approved,false) as administrative_approved,
          coalesce(mv.movements_count,0)::int as movements_count,mv.last_movement_at,
          exists(
            select 1 from tracking.order_vehicles tov
            join tracking.orders tor on tor.id=tov.order_id
            where upper(trim(tov.vin))=upper(trim(v.vin)) and (coalesce(tor.is_archived,false)=true or tor.status='completed')
          ) as tracking_completed
        from operations.vehicles v
        left join operations.locations l on l.id=v.location_id
        left join core.branches b on b.id=l.branch_id
        left join operations.vehicle_statuses vs on vs.code=v.status_code
        left join lateral (
          select a.* from operations.vehicle_approvals a where a.vehicle_id=v.id order by a.updated_at desc limit 1
        ) ap on true
        left join lateral (
          select count(*)::int as movements_count,max(created_at) as last_movement_at from operations.movements where vehicle_id=v.id
        ) mv on true
        where v.is_deleted=false and v.is_archived=${archived}
          and (${location}='' or l.code=${location} or l.id::text=${location})
          and (${status}='' or v.status_code=${status})
          and (
            ${search}='' or v.vin ilike ${pattern} or coalesce(v.car_name,'') ilike ${pattern}
            or coalesce(v.statement,'') ilike ${pattern} or coalesce(v.model_year,'') ilike ${pattern}
            or coalesce(v.plate_no,'') ilike ${pattern} or coalesce(v.batch_no,'') ilike ${pattern}
          )
          and (${all}::boolean or coalesce(l.location_type,'other')<>'branch' or coalesce(b.code,'')=any(${user.branchCodes}::text[]))
        order by v.updated_at desc
        limit ${limit}
      `;

      const [counts] = await sql<any[]>`
        select
          count(*) filter (where v.is_deleted=false and v.is_archived=false)::int as active,
          count(*) filter (where v.is_deleted=false and v.is_archived=false and st.counts_in_actual_inventory=true)::int as actual_inventory,
          count(*) filter (where v.is_deleted=false and v.is_archived=false and v.status_code='available_for_sale')::int as available_for_sale,
          count(*) filter (where v.is_deleted=false and v.is_archived=false and v.status_code='under_delivery')::int as under_delivery,
          count(*) filter (where v.is_deleted=false and v.is_archived=false and v.has_notes=true)::int as has_notes,
          count(*) filter (where v.is_deleted=false and v.is_archived=true)::int as archived
        from operations.vehicles v
        left join operations.vehicle_statuses st on st.code=v.status_code
        left join operations.locations l on l.id=v.location_id
        left join core.branches b on b.id=l.branch_id
        where (${all}::boolean or coalesce(l.location_type,'other')<>'branch' or coalesce(b.code,'')=any(${user.branchCodes}::text[]))
      `;

      return response.status(200).json({ ok: true, vehicles, counts });
    }

    if (request.method === "POST") {
      const body = parseBody(request);
      const action = clean(body.action) || "save";

      if (action === "save") {
        const id = clean(body.id);
        const permission = id ? OPERATIONS_PERMISSIONS.vehiclesUpdate : OPERATIONS_PERMISSIONS.vehiclesCreate;
        if (!requireOperationsPermission(user, response, permission)) return;
        const all = scopeAll(user);

        const vin = normalizeVin(body.vin);
        const locationId = clean(body.locationId);
        const statusCode = clean(body.statusCode) || "available_for_sale";
        if (!vin) return response.status(400).json({ ok: false, error: "رقم الهيكل مطلوب" });
        if (!locationId) return response.status(400).json({ ok: false, error: "اختر موقع السيارة" });
        if (!statusCode) return response.status(400).json({ ok: false, error: "اختر حالة السيارة" });

        const [validMeta] = await sql<any[]>`
          select
            exists(
              select 1 from operations.locations l left join core.branches b on b.id=l.branch_id
              where l.id=${locationId}::uuid and l.is_active=true
                and (${all}::boolean or l.location_type<>'branch' or coalesce(b.code,'')=any(${user.branchCodes}::text[]))
            ) as location_ok,
            exists(select 1 from operations.vehicle_statuses where code=${statusCode} and is_active=true) as status_ok
        `;
        if (!validMeta?.location_ok || !validMeta?.status_ok) return response.status(400).json({ ok: false, error: "الموقع أو الحالة غير صحيحة" });

        const payload = {
          vin,
          carName: nullableText(body.carName),
          statement: nullableText(body.statement),
          agentName: nullableText(body.agentName),
          exteriorColor: nullableText(body.exteriorColor),
          interiorColor: nullableText(body.interiorColor),
          modelYear: nullableText(body.modelYear),
          plateNo: nullableText(body.plateNo),
          batchNo: nullableText(body.batchNo),
          locationId,
          statusCode,
          sourceType: nullableText(body.sourceType),
          locationNote: nullableText(body.locationNote),
          shortageNote: nullableText(body.shortageNote),
          notes: nullableText(body.notes),
          contents: normalizeContents(body.contents),
        };
        const hasNotes = Boolean(payload.locationNote || payload.shortageNote || payload.notes || statusCode === "has_notes");

        const saved = await sql.begin(async (tx) => {
          let before: any = null;
          let vehicle: any;
          if (id) {
            [before] = await tx<any[]>`
              select v.* from operations.vehicles v
              left join operations.locations l on l.id=v.location_id
              left join core.branches b on b.id=l.branch_id
              where v.id=${id}::uuid and v.is_deleted=false and v.is_archived=false
                and (${all}::boolean or coalesce(l.location_type,'other')<>'branch' or coalesce(b.code,'')=any(${user.branchCodes}::text[]))
              for update of v
            `;
            if (!before) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
            [vehicle] = await tx<any[]>`
              update operations.vehicles set
                vin=${payload.vin},car_name=${payload.carName},statement=${payload.statement},agent_name=${payload.agentName},
                exterior_color=${payload.exteriorColor},interior_color=${payload.interiorColor},model_year=${payload.modelYear},
                plate_no=${payload.plateNo},batch_no=${payload.batchNo},location_id=${payload.locationId}::uuid,
                status_code=${payload.statusCode},source_type=${payload.sourceType},location_note=${payload.locationNote},
                shortage_note=${payload.shortageNote},notes=${payload.notes},contents=${tx.json(payload.contents)},
                has_notes=${hasNotes},updated_by=${user.id}::uuid,updated_at=now()
              where id=${id}::uuid
              returning id::text,vin,status_code
            `;
            if (before.status_code === "under_delivery" && !["under_delivery", "delivered"].includes(statusCode)) {
              await tx`
                update operations.vehicle_approvals set
                  financial_approved=false,administrative_approved=false,
                  financial_approved_by=null,administrative_approved_by=null,
                  financial_approved_at=null,administrative_approved_at=null,updated_at=now()
                where vehicle_id=${id}::uuid
              `;
            }
          } else {
            [vehicle] = await tx<any[]>`
              insert into operations.vehicles(
                vin,car_name,statement,agent_name,exterior_color,interior_color,model_year,plate_no,batch_no,
                location_id,status_code,source_type,location_note,shortage_note,notes,contents,has_notes,created_by,updated_by
              ) values (
                ${payload.vin},${payload.carName},${payload.statement},${payload.agentName},${payload.exteriorColor},
                ${payload.interiorColor},${payload.modelYear},${payload.plateNo},${payload.batchNo},${payload.locationId}::uuid,
                ${payload.statusCode},${payload.sourceType},${payload.locationNote},${payload.shortageNote},${payload.notes},
                ${tx.json(payload.contents)},${hasNotes},${user.id}::uuid,${user.id}::uuid
              ) returning id::text,vin,status_code
            `;
          }
          if (["under_delivery", "delivered"].includes(statusCode)) {
            await tx`
              insert into operations.vehicle_approvals(vehicle_id)
              select ${vehicle.id}::uuid where not exists(
                select 1 from operations.vehicle_approvals where vehicle_id=${vehicle.id}::uuid
              )
            `;
          }

          if (payload.shortageNote) {
            const [existingShortage] = await tx<any[]>`
              select id::text from operations.vehicle_shortages
              where vehicle_id=${vehicle.id}::uuid and shortage_type='general' and is_resolved=false
              order by created_at desc limit 1 for update
            `;
            if (existingShortage) {
              await tx`
                update operations.vehicle_shortages set note=${payload.shortageNote},updated_at=now()
                where id=${existingShortage.id}::uuid
              `;
            } else {
              await tx`
                insert into operations.vehicle_shortages(vehicle_id,shortage_type,note,created_by)
                values (${vehicle.id}::uuid,'general',${payload.shortageNote},${user.id}::uuid)
              `;
            }
          } else {
            await tx`
              update operations.vehicle_shortages set is_resolved=true,resolved_by=${user.id}::uuid,resolved_at=now(),updated_at=now()
              where vehicle_id=${vehicle.id}::uuid and shortage_type='general' and is_resolved=false
            `;
          }

          await tx`
            insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data)
            values (${user.id}::uuid,'operations',${id ? "vehicle_updated" : "vehicle_created"},'vehicle',${vehicle.id},
              ${before ? tx.json(before) : null},${tx.json(payload)})
          `;
          return vehicle;
        });

        const detail = await vehicleDetail(saved.id, user);
        return response.status(id ? 200 : 201).json({ ok: true, vehicle: detail, message: id ? "تم تحديث بيانات السيارة" : "تمت إضافة السيارة" });
      }

      if (action === "bulk_import") {
        if (!requireOperationsPermission(user, response, OPERATIONS_PERMISSIONS.vehiclesImport)) return;
        const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
        if (!rows.length) return response.status(400).json({ ok: false, error: "ملف الاستيراد لا يحتوي على صفوف صالحة" });

        const all = scopeAll(user);
        const [locations, statuses] = await Promise.all([
          sql<any[]>`
            select l.id::text,l.code,l.name,b.code as branch_code
            from operations.locations l left join core.branches b on b.id=l.branch_id
            where l.is_active=true and (${all}::boolean or coalesce(l.location_type,'other')<>'branch' or coalesce(b.code,'')=any(${user.branchCodes}::text[]))
          `,
          sql<any[]>`select code,name from operations.vehicle_statuses where is_active=true and code<>'archived'`,
        ]);
        const locationMap = new Map<string, string>();
        for (const item of locations) {
          locationMap.set(clean(item.code).toLowerCase(), item.id);
          locationMap.set(clean(item.name).toLowerCase(), item.id);
        }
        const statusMap = new Map<string, string>();
        for (const item of statuses) {
          statusMap.set(clean(item.code).toLowerCase(), item.code);
          statusMap.set(clean(item.name).toLowerCase(), item.code);
        }

        const result = await sql.begin(async (tx) => {
          let created = 0;
          let updated = 0;
          const errors: Array<{ row: number; vin: string; error: string }> = [];
          for (let index = 0; index < rows.length; index += 1) {
            const input = rows[index] && typeof rows[index] === "object" ? rows[index] as Record<string, any> : {};
            const vin = normalizeVin(input.vin);
            const rawLocation = clean(input.location) || clean(input.locationCode);
            const rawStatus = clean(input.status) || clean(input.statusCode);
            const locationId = locationMap.get(rawLocation.toLowerCase());
            const statusCode = rawStatus ? statusMap.get(rawStatus.toLowerCase()) : "available_for_sale";
            if (!vin) { errors.push({ row: index + 2, vin: "", error: "رقم الهيكل مفقود" }); continue; }
            if (!locationId) { errors.push({ row: index + 2, vin, error: "الموقع غير معروف أو خارج الصلاحية" }); continue; }
            if (!statusCode) { errors.push({ row: index + 2, vin, error: `الحالة غير معروفة: ${rawStatus}` }); continue; }

            const shortageNote = nullableText(input.shortageNote);
            const locationNote = nullableText(input.locationNote);
            const notes = nullableText(input.notes);
            const contents = normalizeContents(input.contents);
            const hasNotes = Boolean(shortageNote || locationNote || notes || statusCode === "has_notes");
            const [vehicle] = await tx<any[]>`
              insert into operations.vehicles(
                vin,car_name,statement,agent_name,exterior_color,interior_color,model_year,plate_no,batch_no,
                location_id,status_code,source_type,location_note,shortage_note,notes,contents,has_notes,created_by,updated_by
              ) values (
                ${vin},${nullableText(input.carName)},${nullableText(input.statement)},${nullableText(input.agentName)},
                ${nullableText(input.exteriorColor)},${nullableText(input.interiorColor)},${nullableText(input.modelYear)},
                ${nullableText(input.plateNo)},${nullableText(input.batchNo)},${locationId}::uuid,${statusCode},
                ${nullableText(input.sourceType)},${locationNote},${shortageNote},${notes},${tx.json(contents)},${hasNotes},
                ${user.id}::uuid,${user.id}::uuid
              )
              on conflict (vin) do update set
                car_name=excluded.car_name,statement=excluded.statement,agent_name=excluded.agent_name,
                exterior_color=excluded.exterior_color,interior_color=excluded.interior_color,model_year=excluded.model_year,
                plate_no=excluded.plate_no,batch_no=excluded.batch_no,location_id=excluded.location_id,status_code=excluded.status_code,
                source_type=excluded.source_type,location_note=excluded.location_note,shortage_note=excluded.shortage_note,
                notes=excluded.notes,contents=excluded.contents,has_notes=excluded.has_notes,updated_by=${user.id}::uuid,updated_at=now()
              where operations.vehicles.is_deleted=false and operations.vehicles.is_archived=false
                and (
                  ${all}::boolean or exists(
                    select 1 from operations.locations current_location
                    left join core.branches current_branch on current_branch.id=current_location.branch_id
                    where current_location.id=operations.vehicles.location_id and (
                      coalesce(current_location.location_type,'other')<>'branch'
                      or coalesce(current_branch.code,'')=any(${user.branchCodes}::text[])
                    )
                  )
                )
              returning id::text,(xmax=0) as inserted
            `;
            if (!vehicle) { errors.push({ row: index + 2, vin, error: "السيارة محذوفة أو مؤرشفة أو خارج نطاق صلاحيتك" }); continue; }
            if (vehicle.inserted) created += 1; else updated += 1;

            if (["under_delivery", "delivered"].includes(statusCode)) {
              await tx`
                insert into operations.vehicle_approvals(vehicle_id)
                select ${vehicle.id}::uuid where not exists(select 1 from operations.vehicle_approvals where vehicle_id=${vehicle.id}::uuid)
              `;
            }
            if (shortageNote) {
              const [existing] = await tx<any[]>`
                select id::text from operations.vehicle_shortages
                where vehicle_id=${vehicle.id}::uuid and shortage_type='general' and is_resolved=false
                order by created_at desc limit 1 for update
              `;
              if (existing) await tx`update operations.vehicle_shortages set note=${shortageNote},updated_at=now() where id=${existing.id}::uuid`;
              else await tx`insert into operations.vehicle_shortages(vehicle_id,shortage_type,note,created_by) values (${vehicle.id}::uuid,'general',${shortageNote},${user.id}::uuid)`;
            } else {
              await tx`
                update operations.vehicle_shortages set is_resolved=true,resolved_by=${user.id}::uuid,resolved_at=now(),updated_at=now()
                where vehicle_id=${vehicle.id}::uuid and shortage_type='general' and is_resolved=false
              `;
            }
          }
          await tx`
            insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data)
            values (${user.id}::uuid,'operations','vehicles_bulk_imported','vehicle_import',${nextOperationsNumber("IMP")},
              ${tx.json({ totalRows: rows.length, created, updated, errors: errors.slice(0, 100) })})
          `;
          return { created, updated, errors, total: rows.length };
        });

        return response.status(200).json({ ok: true, ...result, message: `تم استيراد ${result.created + result.updated} سيارة` });
      }

      if (action === "approval") {
        const vehicleId = clean(body.vehicleId);
        const kind = clean(body.kind);
        const approved = body.approved === true;
        const note = nullableText(body.note);
        if (!vehicleId || !["financial", "administrative"].includes(kind)) return response.status(400).json({ ok: false, error: "بيانات الاعتماد غير مكتملة" });
        const permission = kind === "financial" ? OPERATIONS_PERMISSIONS.financialApproval : OPERATIONS_PERMISSIONS.administrativeApproval;
        if (!requireOperationsPermission(user, response, permission)) return;
        const all = scopeAll(user);

        const [vehicle] = await sql<any[]>`
          select v.id::text,v.status_code from operations.vehicles v
          left join operations.locations l on l.id=v.location_id
          left join core.branches b on b.id=l.branch_id
          where v.id=${vehicleId}::uuid and v.is_deleted=false and v.is_archived=false
            and (${all}::boolean or coalesce(l.location_type,'other')<>'branch' or coalesce(b.code,'')=any(${user.branchCodes}::text[]))
        `;
        if (!vehicle) return response.status(404).json({ ok: false, error: "السيارة غير موجودة" });
        if (vehicle.status_code !== "under_delivery") return response.status(400).json({ ok: false, error: "الاعتمادات متاحة فقط للسيارات المباعة تحت التسليم" });

        await sql.begin(async (tx) => {
          await tx`
            insert into operations.vehicle_approvals(vehicle_id)
            select ${vehicleId}::uuid where not exists(select 1 from operations.vehicle_approvals where vehicle_id=${vehicleId}::uuid)
          `;
          if (kind === "financial") {
            await tx`
              update operations.vehicle_approvals set
                financial_approved=${approved},financial_note=${note},
                financial_approved_by=${approved ? user.id : null}::uuid,
                financial_approved_at=${approved ? tx`now()` : null},
                financial_reverted_by=${approved ? null : user.id}::uuid,
                financial_reverted_at=${approved ? null : tx`now()`},updated_at=now()
              where id=(select id from operations.vehicle_approvals where vehicle_id=${vehicleId}::uuid order by updated_at desc limit 1)
            `;
          } else {
            await tx`
              update operations.vehicle_approvals set
                administrative_approved=${approved},administrative_note=${note},
                administrative_approved_by=${approved ? user.id : null}::uuid,
                administrative_approved_at=${approved ? tx`now()` : null},
                administrative_reverted_by=${approved ? null : user.id}::uuid,
                administrative_reverted_at=${approved ? null : tx`now()`},updated_at=now()
              where id=(select id from operations.vehicle_approvals where vehicle_id=${vehicleId}::uuid order by updated_at desc limit 1)
            `;
          }
          await tx`
            insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data)
            values (${user.id}::uuid,'operations',${approved ? `${kind}_approval_granted` : `${kind}_approval_reverted`},'vehicle',${vehicleId},
              ${tx.json({ approved, note })})
          `;
        });

        return response.status(200).json({ ok: true, vehicle: await vehicleDetail(vehicleId, user), message: approved ? "تم تسجيل الاعتماد" : "تم التراجع عن الاعتماد" });
      }

      if (action === "archive") {
        if (!requireOperationsPermission(user, response, OPERATIONS_PERMISSIONS.vehiclesArchive)) return;
        const all = scopeAll(user);
        const vehicleId = clean(body.vehicleId);
        const archiveNote = nullableText(body.note);
        if (!vehicleId) return response.status(400).json({ ok: false, error: "السيارة مطلوبة" });

        const [state] = await sql<any[]>`
          select v.id::text,v.vin,v.status_code,v.is_archived,
            coalesce(ap.financial_approved,false) as financial_approved,
            coalesce(ap.administrative_approved,false) as administrative_approved,
            exists(select 1 from operations.movements m where m.vehicle_id=v.id) as has_movement,
            exists(
              select 1 from tracking.order_vehicles tov
              join tracking.orders tor on tor.id=tov.order_id
              where upper(trim(tov.vin))=upper(trim(v.vin)) and (coalesce(tor.is_archived,false)=true or tor.status='completed')
            ) as tracking_completed
          from operations.vehicles v
          left join operations.locations l on l.id=v.location_id
          left join core.branches b on b.id=l.branch_id
          left join lateral(select a.* from operations.vehicle_approvals a where a.vehicle_id=v.id order by a.updated_at desc limit 1) ap on true
          where v.id=${vehicleId}::uuid and v.is_deleted=false
            and (${all}::boolean or coalesce(l.location_type,'other')<>'branch' or coalesce(b.code,'')=any(${user.branchCodes}::text[]))
        `;
        if (!state) return response.status(404).json({ ok: false, error: "السيارة غير موجودة" });
        if (state.is_archived) return response.status(200).json({ ok: true, vehicle: await vehicleDetail(vehicleId, user), message: "السيارة مؤرشفة بالفعل" });
        if (state.status_code !== "delivered") return response.status(400).json({ ok: false, error: "الأرشفة متاحة بعد وصول السيارة إلى مباع تم التسليم" });
        if (!state.financial_approved || !state.administrative_approved) return response.status(400).json({ ok: false, error: "يجب اكتمال الاعتماد المالي والإداري قبل الأرشفة" });
        if (!state.has_movement) return response.status(400).json({ ok: false, error: "لا يمكن الأرشفة قبل وجود حركة مسجلة للسيارة" });
        if (!state.tracking_completed) return response.status(400).json({ ok: false, error: "لا يمكن الأرشفة قبل اكتمال طلب التراكينج المرتبط برقم الهيكل" });

        await sql`
          update operations.vehicles set is_archived=true,status_code='archived',archived_at=now(),archived_by=${user.id}::uuid,
            archive_note=${archiveNote},updated_by=${user.id}::uuid,updated_at=now()
          where id=${vehicleId}::uuid
        `;
        await auditOperations(user, "vehicle_archived", "vehicle", vehicleId, { vin: state.vin, note: archiveNote });
        return response.status(200).json({ ok: true, vehicle: await vehicleDetail(vehicleId, user), message: "تم نقل السيارة إلى الأرشيف" });
      }

      if (action === "resolve_shortage") {
        if (!requireOperationsPermission(user, response, OPERATIONS_PERMISSIONS.vehiclesUpdate)) return;
        const all = scopeAll(user);
        const shortageId = clean(body.shortageId);
        const resolved = body.resolved !== false;
        if (!shortageId) return response.status(400).json({ ok: false, error: "النقص المطلوب غير محدد" });
        const [row] = await sql<any[]>`
          update operations.vehicle_shortages s set is_resolved=${resolved},resolved_by=${resolved ? user.id : null}::uuid,
            resolved_at=${resolved ? sql`now()` : null},updated_at=now()
          from operations.vehicles v
          left join operations.locations l on l.id=v.location_id
          left join core.branches b on b.id=l.branch_id
          where s.id=${shortageId}::uuid and v.id=s.vehicle_id
            and (${all}::boolean or coalesce(l.location_type,'other')<>'branch' or coalesce(b.code,'')=any(${user.branchCodes}::text[]))
          returning s.vehicle_id::text
        `;
        if (!row) return response.status(404).json({ ok: false, error: "سجل النقص غير موجود" });
        if (resolved) {
          await sql`
            update operations.vehicles v set
              shortage_note=case when not exists(
                select 1 from operations.vehicle_shortages s where s.vehicle_id=v.id and s.is_resolved=false
              ) then null else shortage_note end,
              has_notes=(
                coalesce(location_note,'')<>'' or coalesce(notes,'')<>'' or status_code='has_notes' or exists(
                  select 1 from operations.vehicle_shortages s where s.vehicle_id=v.id and s.is_resolved=false
                )
              ),updated_by=${user.id}::uuid,updated_at=now()
            where v.id=${row.vehicle_id}::uuid
          `;
        }
        return response.status(200).json({ ok: true, vehicle: await vehicleDetail(row.vehicle_id, user), message: resolved ? "تم إغلاق النقص" : "تمت إعادة فتح النقص" });
      }

      return response.status(400).json({ ok: false, error: "الإجراء غير مدعوم" });
    }

    return response.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error: any) {
    console.error("Operations vehicles failed", error);
    if (error?.code === "23505") return response.status(409).json({ ok: false, error: "رقم الهيكل مستخدم بالفعل" });
    if (error?.code === "22P02") return response.status(400).json({ ok: false, error: "معرّف غير صالح" });
    if (error?.code === "NOT_FOUND") return response.status(404).json({ ok: false, error: "السيارة غير موجودة" });
    return response.status(500).json({ ok: false, error: "تعذر تنفيذ عملية السيارة" });
  }
}
