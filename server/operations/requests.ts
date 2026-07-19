import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { OPERATIONS_PERMISSIONS, requireOperationsPermission, requireOperationsUser } from "../_operations-auth.js";
import { clean, nextOperationsNumber, nullableText, requestStatusFromStage } from "../_operations-utils.js";

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

function stagePermission(stage: number) {
  if (stage === 1) return OPERATIONS_PERMISSIONS.requestsReceive;
  if (stage === 2) return OPERATIONS_PERMISSIONS.requestsDispatch;
  if (stage === 3) return OPERATIONS_PERMISSIONS.requestsConfirmReceipt;
  return OPERATIONS_PERMISSIONS.requestsComplete;
}

async function requestDetail(id: string, user: { roleCodes: string[]; branchCodes: string[] }) {
  const sql = getSql();
  const all = scopeAll(user);
  const [requestRow] = await sql<any[]>`
    select
      r.id::text,r.request_no,r.department_code,r.transfer_type,r.source_location_id::text,r.destination_location_id::text,
      r.target_status_code,r.status,r.current_stage,r.photo_date,r.notes,r.requested_by::text,r.requested_by_name,
      r.requested_at,r.completed_by::text,r.completed_at,r.created_at,r.updated_at,
      sl.name as source_location_name,dl.name as destination_location_name,vs.name as target_status_name,cu.full_name as completed_by_name
    from operations.transfer_requests r
    left join operations.locations sl on sl.id=r.source_location_id
    left join operations.locations dl on dl.id=r.destination_location_id
    left join operations.vehicle_statuses vs on vs.code=r.target_status_code
    left join core.users cu on cu.id=r.completed_by
    where r.id=${id}::uuid and r.is_deleted=false
      and (
        ${all}::boolean or exists(
          select 1 from operations.transfer_request_vehicles rv
          left join operations.locations l on l.id=rv.source_location_id
          left join core.branches b on b.id=l.branch_id
          left join operations.locations dlx on dlx.id=rv.destination_location_id
          left join core.branches db on db.id=dlx.branch_id
          where rv.transfer_request_id=r.id and (
            (coalesce(l.location_type,'other')<>'branch' or coalesce(b.code,'')=any(${user.branchCodes}::text[]))
            and (coalesce(dlx.location_type,'other')<>'branch' or coalesce(db.code,'')=any(${user.branchCodes}::text[]))
          )
        )
      )
  `;
  if (!requestRow) return null;

  const [vehicles, events] = await Promise.all([
    sql<any[]>`
      select
        v.id::text,v.vin,v.car_name,v.statement,v.model_year,v.exterior_color,v.interior_color,
        v.status_code,vs.name as status_name,cl.name as current_location_name,
        rv.source_location_id::text,sl.name as source_location_name,
        rv.destination_location_id::text,dl.name as destination_location_name,
        rv.target_status_code,rvs.name as target_status_name,rv.note
      from operations.transfer_request_vehicles rv
      join operations.vehicles v on v.id=rv.vehicle_id
      left join operations.locations cl on cl.id=v.location_id
      left join operations.locations sl on sl.id=rv.source_location_id
      left join operations.locations dl on dl.id=rv.destination_location_id
      left join operations.vehicle_statuses vs on vs.code=v.status_code
      left join operations.vehicle_statuses rvs on rvs.code=rv.target_status_code
      where rv.transfer_request_id=${id}::uuid
      order by v.vin
    `,
    sql<any[]>`
      select e.id::text,e.stage_no,e.action,e.actor_id::text,e.actor_name,e.note,e.created_at
      from operations.request_events e
      where e.request_id=${id}::uuid order by e.created_at desc
    `,
  ]);
  return { ...requestRow, vehicles, events };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  await ensureOperationsSchema();
  const user = await requireOperationsUser(request, response);
  if (!user) return;
  const sql = getSql();

  try {
    if (request.method === "GET") {
      if (!requireOperationsPermission(user, response, OPERATIONS_PERMISSIONS.requestsView)) return;
      const id = clean(request.query.id);
      if (id) {
        const detail = await requestDetail(id, user);
        if (!detail) return response.status(404).json({ ok: false, error: "الطلب غير موجود أو خارج نطاق صلاحيتك" });
        return response.status(200).json({ ok: true, request: detail });
      }

      const search = clean(request.query.search);
      const type = clean(request.query.type);
      const status = clean(request.query.status);
      const completedOnly = ["1", "true", "yes"].includes(clean(request.query.completed).toLowerCase());
      const limit = Math.min(Math.max(Number(request.query.limit || 500), 1), 2000);
      const pattern = `%${search}%`;
      const all = scopeAll(user);

      const requests = await sql<any[]>`
        select
          r.id::text,r.request_no,r.transfer_type,r.status,r.current_stage,r.photo_date,r.notes,r.requested_by_name,
          r.requested_at,r.completed_at,r.updated_at,sl.name as source_location_name,dl.name as destination_location_name,
          vs.name as target_status_name,count(distinct rv.vehicle_id)::int as vehicles_count,
          string_agg(distinct v.vin,', ' order by v.vin) as vins
        from operations.transfer_requests r
        left join operations.locations sl on sl.id=r.source_location_id
        left join operations.locations dl on dl.id=r.destination_location_id
        left join operations.vehicle_statuses vs on vs.code=r.target_status_code
        left join operations.transfer_request_vehicles rv on rv.transfer_request_id=r.id
        left join operations.vehicles v on v.id=rv.vehicle_id
        where r.is_deleted=false
          and (${completedOnly}::boolean = (r.status='completed'))
          and (${type}='' or r.transfer_type=${type})
          and (${status}='' or r.status=${status})
          and (${search}='' or r.request_no ilike ${pattern} or coalesce(r.requested_by_name,'') ilike ${pattern} or exists(
            select 1 from operations.transfer_request_vehicles sx join operations.vehicles vx on vx.id=sx.vehicle_id
            where sx.transfer_request_id=r.id and (vx.vin ilike ${pattern} or coalesce(vx.car_name,'') ilike ${pattern})
          ))
          and (
            ${all}::boolean or exists(
              select 1 from operations.transfer_request_vehicles sx
              left join operations.locations lx on lx.id=sx.source_location_id
              left join core.branches bx on bx.id=lx.branch_id
              left join operations.locations dx on dx.id=sx.destination_location_id
              left join core.branches dbx on dbx.id=dx.branch_id
              where sx.transfer_request_id=r.id and (
                (coalesce(lx.location_type,'other')<>'branch' or coalesce(bx.code,'')=any(${user.branchCodes}::text[]))
                and (coalesce(dx.location_type,'other')<>'branch' or coalesce(dbx.code,'')=any(${user.branchCodes}::text[]))
              )
            )
          )
        group by r.id,sl.name,dl.name,vs.name
        order by r.updated_at desc
        limit ${limit}
      `;

      const [counts] = await sql<any[]>`
        select
          count(r.id) filter (where r.status<>'completed')::int as active,
          count(r.id) filter (where r.current_stage=0)::int as not_started,
          count(r.id) filter (where r.current_stage=1)::int as request_received,
          count(r.id) filter (where r.current_stage=2)::int as vehicle_sent,
          count(r.id) filter (where r.current_stage=3)::int as vehicle_received,
          count(r.id) filter (where r.status='completed')::int as completed
        from operations.transfer_requests r
        where r.is_deleted=false and (
          ${all}::boolean or exists(
            select 1 from operations.transfer_request_vehicles rv
            left join operations.locations l on l.id=rv.source_location_id
            left join core.branches b on b.id=l.branch_id
            left join operations.locations dlx on dlx.id=rv.destination_location_id
            left join core.branches db on db.id=dlx.branch_id
            where rv.transfer_request_id=r.id and (
              (coalesce(l.location_type,'other')<>'branch' or coalesce(b.code,'')=any(${user.branchCodes}::text[]))
              and (coalesce(dlx.location_type,'other')<>'branch' or coalesce(db.code,'')=any(${user.branchCodes}::text[]))
            )
          )
        )
      `;
      return response.status(200).json({ ok: true, requests, counts });
    }

    if (request.method === "POST") {
      const body = parseBody(request);
      const action = clean(body.action) || "create";

      if (action === "create") {
        if (!requireOperationsPermission(user, response, OPERATIONS_PERMISSIONS.requestsCreate)) return;
        const transferType = clean(body.transferType);
        const vehicleIds = Array.isArray(body.vehicleIds) ? [...new Set(body.vehicleIds.map(clean).filter(Boolean))] : [];
        const destinationLocationId = clean(body.destinationLocationId);
        const targetStatusCode = clean(body.targetStatusCode) || null;
        const photoDate = clean(body.photoDate) || null;
        const notes = nullableText(body.notes);
        if (!['transfer', 'photo'].includes(transferType)) return response.status(400).json({ ok: false, error: "اختر نوع الطلب: نقل أو تصوير" });
        if (!vehicleIds.length) return response.status(400).json({ ok: false, error: "اختر سيارة واحدة على الأقل" });
        if (!destinationLocationId) return response.status(400).json({ ok: false, error: transferType === "photo" ? "اختر مكان التصوير" : "اختر مكان النقل" });
        if (transferType === "photo" && !photoDate) return response.status(400).json({ ok: false, error: "حدد تاريخ التصوير" });

        const all = scopeAll(user);
        const vehicles = await sql<any[]>`
          select v.id::text,v.vin,v.location_id::text,v.status_code,l.code as location_code,b.code as branch_code
          from operations.vehicles v
          left join operations.locations l on l.id=v.location_id
          left join core.branches b on b.id=l.branch_id
          where v.id=any(${vehicleIds}::uuid[]) and v.is_deleted=false and v.is_archived=false
            and (${all}::boolean or coalesce(l.location_type,'other')<>'branch' or coalesce(b.code,'')=any(${user.branchCodes}::text[]))
        `;
        if (vehicles.length !== vehicleIds.length) return response.status(400).json({ ok: false, error: "بعض السيارات غير موجودة أو خارج نطاق صلاحيتك" });
        const [meta] = await sql<any[]>`
          select exists(
              select 1 from operations.locations l left join core.branches b on b.id=l.branch_id
              where l.id=${destinationLocationId}::uuid and l.is_active=true
                and (${all}::boolean or l.location_type<>'branch' or coalesce(b.code,'')=any(${user.branchCodes}::text[]))
            ) as location_ok,
            (${targetStatusCode}::text is null or exists(select 1 from operations.vehicle_statuses where code=${targetStatusCode} and is_active=true and code<>'archived')) as status_ok
        `;
        if (!meta?.location_ok || !meta?.status_ok) return response.status(400).json({ ok: false, error: "الموقع أو الحالة المحددة غير صحيحة" });

        const requestNo = nextOperationsNumber("REQ");
        const created = await sql.begin(async (tx) => {
          const sourceLocationId = vehicles.every((item) => item.location_id === vehicles[0].location_id) ? vehicles[0].location_id : null;
          const [row] = await tx<any[]>`
            insert into operations.transfer_requests(
              request_no,department_code,transfer_type,source_location_id,destination_location_id,target_status_code,
              status,current_stage,photo_date,notes,requested_by,requested_by_name
            ) values (
              ${requestNo},'operations',${transferType},${sourceLocationId}::uuid,${destinationLocationId}::uuid,${targetStatusCode},
              'not_started',0,${photoDate}::date,${notes},${user.id}::uuid,${user.fullName}
            ) returning id::text,request_no
          `;
          for (const vehicle of vehicles) {
            await tx`
              insert into operations.transfer_request_vehicles(
                transfer_request_id,vehicle_id,source_location_id,destination_location_id,target_status_code,note
              ) values (${row.id}::uuid,${vehicle.id}::uuid,${vehicle.location_id}::uuid,${destinationLocationId}::uuid,
                ${targetStatusCode || vehicle.status_code},${nullableText(body.vehicleNotes?.[vehicle.id])})
            `;
          }
          await tx`
            insert into operations.request_events(request_id,stage_no,action,actor_id,actor_name,note,after_data)
            values (${row.id}::uuid,0,'created',${user.id}::uuid,${user.fullName},${notes},
              ${tx.json({ requestNo, transferType, vehicleIds, destinationLocationId, targetStatusCode, photoDate })})
          `;
          await tx`
            insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data)
            values (${user.id}::uuid,'operations','request_created','transfer_request',${row.id},
              ${tx.json({ requestNo, transferType, vehicleIds, destinationLocationId, targetStatusCode, photoDate, notes })})
          `;
          return row;
        });
        return response.status(201).json({ ok: true, request: await requestDetail(created.id, user), message: "تم إنشاء الطلب" });
      }

      if (action === "advance") {
        const requestId = clean(body.requestId);
        const nextStage = Number(body.stage);
        if (!requestId || ![1, 2, 3, 4].includes(nextStage)) return response.status(400).json({ ok: false, error: "الطلب أو المرحلة غير صحيحة" });
        if (!requireOperationsPermission(user, response, stagePermission(nextStage))) return;
        const all = scopeAll(user);

        await sql.begin(async (tx) => {
          const [row] = await tx<any[]>`
            select r.* from operations.transfer_requests r
            where r.id=${requestId}::uuid and r.is_deleted=false and (
              ${all}::boolean or exists(
                select 1 from operations.transfer_request_vehicles rv
                left join operations.locations sl on sl.id=rv.source_location_id
                left join core.branches sb on sb.id=sl.branch_id
                left join operations.locations dl on dl.id=rv.destination_location_id
                left join core.branches db on db.id=dl.branch_id
                where rv.transfer_request_id=r.id and (
                  (coalesce(sl.location_type,'other')<>'branch' or coalesce(sb.code,'')=any(${user.branchCodes}::text[]))
                  and (coalesce(dl.location_type,'other')<>'branch' or coalesce(db.code,'')=any(${user.branchCodes}::text[]))
                )
              )
            ) for update
          `;
          if (!row) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
          if (row.status === "completed") throw Object.assign(new Error("COMPLETED"), { code: "COMPLETED" });
          if (nextStage !== Number(row.current_stage || 0) + 1) throw Object.assign(new Error("STAGE_ORDER"), { code: "STAGE_ORDER" });

          const requestVehicles = await tx<any[]>`
            select rv.*,v.id::text,v.vin,v.location_id::text as current_location_id,v.status_code,v.contents,v.notes,
              coalesce(ap.financial_approved,false) as financial_approved,
              coalesce(ap.administrative_approved,false) as administrative_approved
            from operations.transfer_request_vehicles rv
            join operations.vehicles v on v.id=rv.vehicle_id and v.is_deleted=false and v.is_archived=false
            left join lateral(select a.* from operations.vehicle_approvals a where a.vehicle_id=v.id order by a.updated_at desc limit 1) ap on true
            where rv.transfer_request_id=${requestId}::uuid
            for update of v
          `;
          if (!requestVehicles.length) throw Object.assign(new Error("NO_VEHICLES"), { code: "NO_VEHICLES" });

          if (nextStage === 3 && row.transfer_type === "transfer") {
            const targetStatus = row.target_status_code || requestVehicles[0].status_code;
            if (targetStatus === "delivered") {
              const blocked = requestVehicles.filter((vehicle) => !vehicle.financial_approved || !vehicle.administrative_approved);
              if (blocked.length) throw Object.assign(new Error(blocked.map((item) => item.vin).join("، ")), { code: "APPROVALS_REQUIRED" });
            }
            const batchNo = nextOperationsNumber("MOV");
            const [batch] = await tx<any[]>`
              insert into operations.movement_batches(batch_no,movement_type,destination_location_id,target_status_code,note,request_id,performed_by,performed_by_name)
              values (${batchNo},'request',${row.destination_location_id}::uuid,${targetStatus},${nullableText(body.note)},${requestId}::uuid,${user.id}::uuid,${user.fullName})
              returning id::text
            `;
            for (const vehicle of requestVehicles) {
              const vehicleTargetStatus = vehicle.target_status_code || targetStatus || vehicle.status_code;
              const before = { locationId: vehicle.current_location_id, statusCode: vehicle.status_code };
              const after = { locationId: row.destination_location_id, statusCode: vehicleTargetStatus };
              await tx`
                update operations.vehicles set location_id=${row.destination_location_id}::uuid,status_code=${vehicleTargetStatus},
                  updated_by=${user.id}::uuid,updated_at=now()
                where id=${vehicle.id}::uuid
              `;
              if (vehicleTargetStatus === "under_delivery") {
                await tx`
                  insert into operations.vehicle_approvals(vehicle_id)
                  select ${vehicle.id}::uuid where not exists(select 1 from operations.vehicle_approvals where vehicle_id=${vehicle.id}::uuid)
                `;
              } else if (vehicle.status_code === "under_delivery" && vehicleTargetStatus !== "delivered") {
                await tx`
                  update operations.vehicle_approvals set financial_approved=false,administrative_approved=false,
                    financial_approved_by=null,administrative_approved_by=null,financial_approved_at=null,administrative_approved_at=null,updated_at=now()
                  where vehicle_id=${vehicle.id}::uuid
                `;
              }
              await tx`
                insert into operations.movements(
                  movement_batch_id,request_id,vehicle_id,movement_type,from_location_id,to_location_id,old_status,new_status,note,
                  before_data,after_data,performed_by,performed_by_name
                ) values (
                  ${batch.id}::uuid,${requestId}::uuid,${vehicle.id}::uuid,'request',${vehicle.current_location_id}::uuid,
                  ${row.destination_location_id}::uuid,${vehicle.status_code},${vehicleTargetStatus},${nullableText(body.note)},
                  ${tx.json(before)},${tx.json(after)},${user.id}::uuid,${user.fullName}
                )
              `;
            }
          }

          const status = requestStatusFromStage(nextStage);
          await tx`
            update operations.transfer_requests set current_stage=${nextStage},status=${status},updated_at=now(),
              completed_by=${nextStage === 4 ? user.id : null}::uuid,
              completed_at=${nextStage === 4 ? tx`now()` : null}
            where id=${requestId}::uuid
          `;
          await tx`
            insert into operations.request_events(request_id,stage_no,action,actor_id,actor_name,note,before_data,after_data)
            values (${requestId}::uuid,${nextStage},${status},${user.id}::uuid,${user.fullName},${nullableText(body.note)},
              ${tx.json({ stage: row.current_stage, status: row.status })},${tx.json({ stage: nextStage, status })})
          `;
          await tx`
            insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data)
            values (${user.id}::uuid,'operations','request_stage_completed','transfer_request',${requestId},
              ${tx.json({ stage: nextStage, status, note: nullableText(body.note) })})
          `;
        });

        return response.status(200).json({ ok: true, request: await requestDetail(requestId, user), message: nextStage === 4 ? "تم إنهاء الطلب" : "تم تنفيذ المرحلة" });
      }

      if (action === "delete") {
        if (!requireOperationsPermission(user, response, OPERATIONS_PERMISSIONS.requestsDelete)) return;
        const all = scopeAll(user);
        const requestId = clean(body.requestId);
        if (!requestId) return response.status(400).json({ ok: false, error: "الطلب مطلوب" });
        const [row] = await sql<any[]>`
          update operations.transfer_requests r set is_deleted=true,deleted_by=${user.id}::uuid,deleted_at=now(),updated_at=now()
          where r.id=${requestId}::uuid and r.is_deleted=false and r.current_stage<3 and (
            ${all}::boolean or exists(
              select 1 from operations.transfer_request_vehicles rv
              left join operations.locations sl on sl.id=rv.source_location_id
              left join core.branches sb on sb.id=sl.branch_id
              left join operations.locations dl on dl.id=rv.destination_location_id
              left join core.branches db on db.id=dl.branch_id
              where rv.transfer_request_id=r.id and (
                (coalesce(sl.location_type,'other')<>'branch' or coalesce(sb.code,'')=any(${user.branchCodes}::text[]))
                and (coalesce(dl.location_type,'other')<>'branch' or coalesce(db.code,'')=any(${user.branchCodes}::text[]))
              )
            )
          )
          returning id::text,request_no,current_stage
        `;
        if (!row) return response.status(400).json({ ok: false, error: "لا يمكن حذف الطلب بعد مرحلة استلام السيارة أو أن الطلب غير موجود" });
        await sql`
          insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data)
          values (${user.id}::uuid,'operations','request_deleted','transfer_request',${requestId},${sql.json({ requestNo: row.request_no, stage: row.current_stage })})
        `;
        return response.status(200).json({ ok: true, message: "تم حذف الطلب" });
      }

      return response.status(400).json({ ok: false, error: "الإجراء غير مدعوم" });
    }

    return response.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error: any) {
    console.error("Operations requests failed", error);
    if (error?.code === "NOT_FOUND") return response.status(404).json({ ok: false, error: "الطلب غير موجود" });
    if (error?.code === "COMPLETED") return response.status(400).json({ ok: false, error: "الطلب مكتمل ولا يمكن تنفيذ مراحل جديدة" });
    if (error?.code === "STAGE_ORDER") return response.status(400).json({ ok: false, error: "يجب تنفيذ مراحل الطلب بالترتيب" });
    if (error?.code === "NO_VEHICLES") return response.status(400).json({ ok: false, error: "لا توجد سيارات فعالة داخل الطلب" });
    if (error?.code === "APPROVALS_REQUIRED") return response.status(400).json({ ok: false, error: `لا يمكن تسجيل مباع تم التسليم قبل اكتمال الاعتماد المالي والإداري: ${error.message}` });
    if (error?.code === "23505") return response.status(409).json({ ok: false, error: "تعذر إنشاء رقم طلب فريد؛ أعد المحاولة" });
    if (error?.code === "22P02") return response.status(400).json({ ok: false, error: "إحدى القيم المحددة غير صالحة" });
    return response.status(500).json({ ok: false, error: "تعذر تنفيذ عملية الطلب" });
  }
}
