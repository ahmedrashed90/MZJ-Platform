import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { requireTrackingUser } from "../_tracking-auth.js";
import { hasPermission } from "../_access-control.js";
import { trackingAccessScope } from "../_tracking-access.js";
import { getTrackingCountSummary } from "../_tracking-counts.js";
import { ensureTrackingSchema } from "../_tracking-schema.js";
import { ensureOperationsSchema } from "../_operations-schema.js";
import { tryArchiveVehicleForTrackingRecord } from "../_operations-auto-archive.js";
import { archiveTrackingOrderInventory, TrackingOrderArchiveError } from "../_tracking-order-archive.js";
import { clean, ensureVehicleStageRows, recalculateTrackingOrder } from "../_tracking-utils.js";
import { emitTrackingNotification } from "../_notifications.js";
import { isApprovalControlledTrackingStage } from "../_tracking-approval-sync.js";

function validDate(value: unknown) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

async function getOrderDetail(id: string, user: NonNullable<Awaited<ReturnType<typeof requireTrackingUser>>>) {
  const scope = trackingAccessScope(user);
  const branches = scope.branchCodes;
  const sql = getSql();
  const [order] = await sql<any[]>`
    select o.*,o.id::text,
      coalesce((select count(*) from tracking.order_vehicles v where v.order_id=o.id),0)::int as vehicles_count,
      coalesce((select count(*) from tracking.vehicle_stages vs join tracking.order_vehicles v on v.id=vs.vehicle_id join tracking.stages s on s.id=vs.stage_id and s.is_active=true where v.order_id=o.id and vs.status='completed'),0)::int as completed_stages,
      coalesce((select count(*) from tracking.vehicle_stages vs join tracking.order_vehicles v on v.id=vs.vehicle_id join tracking.stages s on s.id=vs.stage_id and s.is_active=true where v.order_id=o.id),0)::int as total_stages
    from tracking.orders o
    where o.id=${id}::uuid and coalesce(o.is_deleted,false)=false
      and (
        ${scope.unrestricted}=true
        or (${scope.assignedOnly}=true and o.assigned_to=${user.id}::uuid)
        or (${scope.workflowAssignedOnly}=true and exists(select 1 from tracking.stage_events se where se.order_id=o.id and se.actor_id=${user.id}::uuid))
        or (${scope.branchScoped}=true and o.branch in ${sql(branches)})
      )
  `;
  if (!order) return null;

  const vehicles = await sql<any[]>`
    select v.*,v.id::text
    from tracking.order_vehicles v
    where v.order_id=${id}::uuid
    order by coalesce(nullif(regexp_replace(v.item_no,'\\D','','g'),''),'999999')::int, v.created_at
  `;

  for (const vehicle of vehicles) {
    await ensureVehicleStageRows(vehicle.id);
    vehicle.stages = await sql<any[]>`
      select
        s.id::text as stage_id,s.code,s.name,s.description,s.owner_type,s.sort_order,s.sms_enabled,s.is_active,
        vs.id::text as vehicle_stage_id,vs.status,vs.completed_at,vs.reverted_at,
        cu.full_name as completed_by_name,ru.full_name as reverted_by_name,
        exists(
          select 1 from tracking.sms_messages sm
          where sm.order_id=${id}::uuid and sm.vehicle_id=${vehicle.id}::uuid and sm.stage_id=s.id and sm.status not in ('failed','cancelled')
        ) as sms_sent
      from tracking.stages s
      left join tracking.vehicle_stages vs on vs.stage_id=s.id and vs.vehicle_id=${vehicle.id}::uuid
      left join core.users cu on cu.id=vs.completed_by
      left join core.users ru on ru.id=vs.reverted_by
      where s.is_active=true
      order by s.sort_order
    `;
  }

  const [updatedSummary] = await sql<any[]>`
    select o.status,o.updated_at,
      count(vs.id)::int as total_stages,
      count(vs.id) filter (where vs.status='completed')::int as completed_stages
    from tracking.orders o
    left join tracking.order_vehicles tv on tv.order_id=o.id
    left join tracking.vehicle_stages vs on vs.vehicle_id=tv.id
    left join tracking.stages st on st.id=vs.stage_id and st.is_active=true
    where o.id=${id}::uuid and (vs.id is null or st.id is not null)
    group by o.id
  `;
  if (updatedSummary) Object.assign(order, updatedSummary);

  const events = await sql<any[]>`
    select e.id::text,e.action,e.actor_name,e.note,e.created_at,s.name as stage_name,s.sort_order,v.vin,v.item_no
    from tracking.stage_events e
    join tracking.stages s on s.id=e.stage_id
    join tracking.order_vehicles v on v.id=e.vehicle_id
    where e.order_id=${id}::uuid
    order by e.created_at desc
    limit 100
  `;

  const smsMessages = await sql<any[]>`
    select m.id::text,m.phone,m.message,m.status,m.firestore_document_id,m.queued_by_name,m.queued_at,m.sent_at,
      s.name as stage_name,s.sort_order,v.vin
    from tracking.sms_messages m
    left join tracking.stages s on s.id=m.stage_id
    left join tracking.order_vehicles v on v.id=m.vehicle_id
    where m.order_id=${id}::uuid
    order by m.queued_at desc
    limit 50
  `;

  return { ...order, vehicles, events, smsMessages };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  await ensureTrackingSchema();
  await ensureOperationsSchema();
  const user = await requireTrackingUser(request, response);
  if (!user) return;
  const sql = getSql();
  const scope = trackingAccessScope(user);
  const branches = scope.branchCodes;

  if (request.method === "GET") {
    const id = clean(request.query.id);
    if (id) {
      const detail = await getOrderDetail(id, user);
      if (!detail) return response.status(404).json({ ok: false, error: "طلب التتبع غير موجود" });
      return response.status(200).json({ ok: true, order: detail });
    }

    const search = clean(request.query.search);
    const status = clean(request.query.status);
    const requestedFrom = clean(request.query.from);
    const requestedTo = clean(request.query.to);
    const from = validDate(requestedFrom);
    const to = validDate(requestedTo);
    if ((requestedFrom && !from) || (requestedTo && !to)) return response.status(400).json({ ok: false, error: "صيغة التاريخ غير صحيحة" });
    if (from && to && from > to) return response.status(400).json({ ok: false, error: "تاريخ البداية يجب أن يكون قبل تاريخ النهاية" });
    const archivedOnly = ["1", "true", "yes"].includes(clean(request.query.archived).toLowerCase());
    const limit = Math.min(Math.max(Number(request.query.limit || 1000), 1), 2000);
    const pattern = `%${search}%`;
    const orders = await sql<any[]>`
      select
        o.id::text,o.sales_order_no,o.customer_name,o.customer_mobile,o.branch,o.order_date,o.delivery_date,o.sales_person,
        o.status,o.tracking_token,o.is_archived,o.is_cancelled,o.cancelled_at,o.cancellation_reason,o.subtotal_before_tax,o.tax_value,o.total_incl_vat,o.advance_paid,o.registration_fee,o.created_at,o.updated_at,
        count(distinct v.id)::int as vehicles_count,
        count(vs.id)::int as total_stages,
        count(vs.id) filter (where vs.status='completed')::int as completed_stages,
        string_agg(distinct nullif(v.vin,''), ', ') as vins
      from tracking.orders o
      left join tracking.order_vehicles v on v.order_id=o.id
      left join tracking.vehicle_stages vs on vs.vehicle_id=v.id
      left join tracking.stages sx on sx.id=vs.stage_id and sx.is_active=true
      where coalesce(o.is_deleted,false)=false
        and (
          ${scope.unrestricted}=true
          or (${scope.assignedOnly}=true and o.assigned_to=${user.id}::uuid)
          or (${scope.workflowAssignedOnly}=true and exists(select 1 from tracking.stage_events se where se.order_id=o.id and se.actor_id=${user.id}::uuid))
          or (${scope.branchScoped}=true and o.branch in ${sql(branches)})
        )
        and coalesce(o.is_archived,false)=${archivedOnly}
        and (vs.id is null or sx.id is not null)
        and (${status}='' or o.status=${status})
        and (${from || null}::date is null or coalesce(o.order_date,(o.created_at at time zone 'Asia/Riyadh')::date) >= ${from || null}::date)
        and (${to || null}::date is null or coalesce(o.order_date,(o.created_at at time zone 'Asia/Riyadh')::date) <= ${to || null}::date)
        and (
          ${search}='' or o.sales_order_no ilike ${pattern} or coalesce(o.customer_name,'') ilike ${pattern}
          or coalesce(o.customer_mobile,'') ilike ${pattern} or exists (
            select 1 from tracking.order_vehicles vx where vx.order_id=o.id and vx.vin ilike ${pattern}
          )
        )
      group by o.id
      order by o.updated_at desc
      limit ${limit}
    `;
    const countSummary = await getTrackingCountSummary(sql, user, { from, to });
    const counts = {
      total: countSummary.total,
      not_started: countSummary.notStarted,
      in_progress: countSummary.inProgress,
      completed: countSummary.completed,
      archived: countSummary.archived,
    };
    return response.status(200).json({ ok: true, orders, counts });
  }

  if (request.method === "POST") {
    const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    const action = clean(body.action);

    if (action === "archive_order" || action === "reconcile_archived_orders") {
      if (!hasPermission(user, "tracking.order.archive")) {
        return response.status(403).json({ ok: false, error: "لا توجد صلاحية لأرشفة طلبات التتبع" });
      }

      // This explicitly requested recovery action is for previously archived
      // orders only. It uses the exact same transactional gate as new orders,
      // and never changes an approval or replays a Tracking stage.
      if (action === "reconcile_archived_orders") {
        const candidates = await sql<any[]>`
          select distinct o.id::text as id,o.sales_order_no
          from tracking.orders o
          join tracking.order_vehicles tv on tv.order_id=o.id
          join operations.vehicles v on v.is_deleted=false and v.archived_at is null
            and (v.id=tv.vehicle_id or (tv.vehicle_id is null and nullif(trim(tv.vin),'') is not null
              and upper(trim(v.vin))=upper(trim(tv.vin))))
          where o.is_archived=true and coalesce(o.is_deleted,false)=false and coalesce(o.is_cancelled,false)=false
            and (
              ${scope.unrestricted}=true
              or (${scope.assignedOnly}=true and o.assigned_to=${user.id}::uuid)
              or (${scope.workflowAssignedOnly}=true and exists(select 1 from tracking.stage_events se where se.order_id=o.id and se.actor_id=${user.id}::uuid))
              or (${scope.branchScoped}=true and o.branch in ${sql(branches)})
            )
          order by o.sales_order_no
          limit 20
        `;
        let archivedVehicles = 0;
        let reconciledOrders = 0;
        const failures: Array<{ salesOrderNo: string; error: string }> = [];
        for (const candidate of candidates) {
          try {
            const outcome = await sql.begin(async (tx) => {
              const [locked] = await tx<any[]>`
                select id::text,is_archived,is_cancelled from tracking.orders
                where id=${candidate.id}::uuid and coalesce(is_deleted,false)=false
                for update
              `;
              if (!locked?.is_archived || locked.is_cancelled) {
                throw new TrackingOrderArchiveError("الطلب لم يعد مؤرشفًا أو أصبح ملغيًا", "invalid_order");
              }
              return archiveTrackingOrderInventory(tx, candidate.id, { id: user.id, name: user.fullName });
            });
            archivedVehicles += outcome.archivedVehicles;
            reconciledOrders++;
          } catch (failure) {
            failures.push({
              salesOrderNo: candidate.sales_order_no,
              error: failure instanceof Error ? failure.message : "تعذر تسوية الأرشفة",
            });
          }
        }
        return response.status(200).json({
          ok: true, reviewedOrders: candidates.length, reconciledOrders, archivedVehicles, failures,
          message: candidates.length
            ? `تمت مراجعة ${candidates.length} طلب مؤرشف واستكمال أرشفة ${archivedVehicles} سيارة في العمليات${failures.length ? `، وتعذرت تسوية ${failures.length} طلب` : ""}`
            : "لا توجد طلبات مؤرشفة تحتاج إلى استكمال أرشفة سيارات العمليات",
        });
      }

      const orderId = clean(body.orderId);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
        return response.status(400).json({ ok: false, error: "رقم الطلب الداخلي غير صحيح" });
      }
      let inventory;
      let wasArchived = false;
      try {
        // Both sides commit or roll back together. A concurrent stage action
        // also locks this order before changing any individual VIN's stages.
        const archived = await sql.begin(async (tx) => {
          const [order] = await tx<any[]>`
            select o.id::text,o.is_archived,o.is_cancelled
            from tracking.orders o
            where o.id=${orderId}::uuid and coalesce(o.is_deleted,false)=false
              and (
                ${scope.unrestricted}=true
                or (${scope.assignedOnly}=true and o.assigned_to=${user.id}::uuid)
                or (${scope.workflowAssignedOnly}=true and exists(select 1 from tracking.stage_events se where se.order_id=o.id and se.actor_id=${user.id}::uuid))
                or (${scope.branchScoped}=true and o.branch in ${tx(branches)})
              )
            for update of o
          `;
          if (!order) throw new TrackingOrderArchiveError("طلب التتبع غير موجود أو خارج نطاق صلاحياتك", "order_not_found");
          if (order.is_cancelled) throw new TrackingOrderArchiveError("طلب البيع ملغي من NEXT ERP ولا يمكن أرشفته", "cancelled");
          const result = await archiveTrackingOrderInventory(tx, orderId, { id: user.id, name: user.fullName });
          if (!order.is_archived) {
            await tx`
              update tracking.orders
              set is_archived=true,archived_at=now(),archived_by=${user.id}::uuid,archived_by_name=${user.fullName},
                  archive_reason='اكتملت جميع مراحل التتبع',status='completed',updated_at=now()
              where id=${orderId}::uuid
            `;
          }
          return { inventory: result, wasArchived: Boolean(order.is_archived) };
        });
        inventory = archived.inventory;
        wasArchived = archived.wasArchived;
      } catch (failure) {
        if (failure instanceof TrackingOrderArchiveError) {
          return response.status(failure.reason === "order_not_found" ? 404 : 409).json({ ok: false, error: failure.message, reason: failure.reason });
        }
        throw failure;
      }
      const detail = await getOrderDetail(orderId, user);
      const message = wasArchived
        ? `الطلب مؤرشف بالفعل؛ تمت مراجعة وربط أرشفة سيارات العمليات (${inventory.archivedVehicles} جديدة)`
        : `تم نقل الطلب إلى الأرشيف واستكمال أرشفة ${inventory.archivedVehicles} سيارة في العمليات`;
      const result = { ok: true, order: detail, orderId, inventory, message };
      if (!wasArchived) {
        await emitTrackingNotification(user, action, { ...body, archived: true }, result)
          .catch((error) => console.error("Tracking archive notification failed", error));
      }
      return response.status(200).json(result);
    }

    // A single-vehicle action affects that VIN only. A bulk completion uses
    // exactly the selected vehicles, never all siblings of the sales order.
    const bulk = action === "complete_stage_bulk" || action === "revert_stage_bulk";
    const requestedIds = bulk ? body.vehicleIds : [body.vehicleId];
    const vehicleIds = Array.isArray(requestedIds) ? [...new Set(requestedIds.map(clean))] : [];
    const stageId = clean(body.stageId);
    if (!["complete_stage", "complete_stage_bulk", "revert_stage", "revert_stage_bulk"].includes(action)) {
      return response.status(400).json({ ok: false, error: "الإجراء غير مدعوم" });
    }
    if (!stageId || !vehicleIds.length || vehicleIds.length > 100 ||
        vehicleIds.some(value => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stageId)) {
      return response.status(400).json({ ok: false, error: "حدد سيارات صحيحة ومرحلة واحدة" });
    }
    const [row] = await sql<any[]>`
      select vs.id::text,vs.status,v.order_id::text,s.name,s.sort_order,o.is_archived,o.is_cancelled,o.branch,o.assigned_to::text
      from tracking.vehicle_stages vs
      join tracking.order_vehicles v on v.id=vs.vehicle_id
      join tracking.orders o on o.id=v.order_id
      join tracking.stages s on s.id=vs.stage_id and s.is_active=true
      where vs.vehicle_id=${vehicleIds[0]}::uuid and vs.stage_id=${stageId}::uuid
    `;
    if (!row) return response.status(404).json({ ok: false, error: "مرحلة السيارة غير موجودة" });
    const workflowAssigned = scope.workflowAssignedOnly
      ? Boolean((await sql<any[]>`select 1 from tracking.stage_events where order_id=${row.order_id}::uuid and actor_id=${user.id}::uuid limit 1`)[0])
      : false;
    const canAccessOrder = scope.unrestricted
      || (scope.assignedOnly && clean(row.assigned_to) === user.id)
      || (scope.workflowAssignedOnly && workflowAssigned)
      || (scope.branchScoped && branches.includes(clean(row.branch)));
    if (!canAccessOrder) return response.status(403).json({ ok: false, error: "الطلب خارج نطاق بياناتك" });
    if (isApprovalControlledTrackingStage(row.sort_order)) {
      return response.status(409).json({ ok: false,
        error: "المرحلتان 6 و7 مرتبطتان بالموافقة المالية والإدارية من تبويب الموافقات، ولا يمكن تعديلهما يدويًا من التراكينج" });
    }
    const stageNo = String(Number(row.sort_order || 0)).padStart(2, "0");
    const reverting = action === "revert_stage" || action === "revert_stage_bulk";
    const permissionCode = reverting ? `tracking.stage.${stageNo}.rollback` : `tracking.stage.${stageNo}.complete`;
    if (!hasPermission(user, permissionCode)) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لتنفيذ هذه المرحلة", permission: permissionCode });
    if (reverting && !clean(body.note)) return response.status(400).json({ ok: false, error: "سبب التراجع مطلوب" });
    if (row.is_cancelled) return response.status(400).json({ ok: false, error: "طلب البيع ملغي من NEXT ERP ولا يمكن تعديل مراحله" });
    if (row.is_archived) return response.status(400).json({ ok: false, error: "الطلب مؤرشف ولا يمكن تعديل مراحله" });

    const belonging = await sql<any[]>`
      select id::text from tracking.order_vehicles where order_id=${row.order_id}::uuid and id=any(${vehicleIds}::uuid[])
    `;
    if (belonging.length !== vehicleIds.length) return response.status(400).json({ ok: false, error: "بعض السيارات ليست ضمن هذا الطلب" });
    for (const vehicleId of vehicleIds) await ensureVehicleStageRows(vehicleId);

    let affectedCount = 0;
    try {
      await sql.begin(async (tx) => {
        const [currentOrder] = await tx<any[]>`
          select is_archived,is_cancelled from tracking.orders
          where id=${row.order_id}::uuid and coalesce(is_deleted,false)=false
          for update
        `;
        if (!currentOrder || currentOrder.is_archived || currentOrder.is_cancelled) {
          throw new TrackingOrderArchiveError("الطلب مؤرشف أو ملغي ولا يمكن تعديل مراحله", "closed_order");
        }
        // Operations approvals lock inventory before updating Tracking stages.
        // Acquire the same locks in the same order to avoid cross-system
        // deadlocks when a bulk completion overlaps a financial approval.
        await tx`
          select v.id
          from tracking.order_vehicles tv
          join operations.vehicles v on v.is_deleted=false and
            (v.id=tv.vehicle_id or (tv.vehicle_id is null and upper(trim(v.vin))=upper(trim(tv.vin))))
          where tv.order_id=${row.order_id}::uuid and tv.id=any(${vehicleIds}::uuid[])
          order by v.id
          for update of v
        `;
        // Hold row locks during the entire selected-vehicles operation. A second
        // concurrent request cannot double-complete or double-log these VINs.
        const selectedStages = await tx<any[]>`
          select vs.id from tracking.vehicle_stages vs
          join tracking.order_vehicles v on v.id=vs.vehicle_id
          where v.order_id=${row.order_id}::uuid and vs.stage_id=${stageId}::uuid
            and vs.vehicle_id=any(${vehicleIds}::uuid[]) for update of vs
        `;
        if (selectedStages.length !== vehicleIds.length) throw new Error("مرحلة غير متاحة لإحدى السيارات المختارة");
        const targets = reverting
          ? await tx<any[]>`update tracking.vehicle_stages set
              status='pending',reverted_by=${user.id}::uuid,reverted_at=now(),completed_by=null,completed_at=null,updated_at=now()
              where vehicle_id=any(${vehicleIds}::uuid[]) and stage_id=${stageId}::uuid and status='completed'
              returning vehicle_id::text`
          : await tx<any[]>`update tracking.vehicle_stages set
              status='completed',completed_by=${user.id}::uuid,completed_at=now(),reverted_by=null,reverted_at=null,updated_at=now()
              where vehicle_id=any(${vehicleIds}::uuid[]) and stage_id=${stageId}::uuid and status<>'completed'
              returning vehicle_id::text`;
        affectedCount = targets.length;
        for (const target of targets) {
          await tx`
            insert into tracking.stage_events(order_id,vehicle_id,stage_id,action,actor_id,actor_name,note)
            values (${row.order_id}::uuid,${target.vehicle_id}::uuid,${stageId}::uuid,${reverting ? "reverted" : "completed"},${user.id}::uuid,${user.fullName},${clean(body.note)||null})
          `;
          if (!reverting) await tryArchiveVehicleForTrackingRecord(tx, target.vehicle_id, { id: user.id, name: user.fullName });
        }
      });
    } catch (failure) {
      if (failure instanceof TrackingOrderArchiveError) {
        return response.status(409).json({ ok: false, error: failure.message, reason: failure.reason });
      }
      throw failure;
    }

    await recalculateTrackingOrder(row.order_id);
    const detail = await getOrderDetail(row.order_id, user);
    const vehicleWord = bulk ? ` للسيارات المحددة (${affectedCount} من ${vehicleIds.length})` : " للسيارة المحددة";
    const result = {
      ok: true,
      order: detail,
      orderId: row.order_id,
      affectedVehicles: affectedCount,
      selectedVehicles: vehicleIds.length,
      skippedVehicles: vehicleIds.length - affectedCount,
      message: reverting ? `تم التراجع عن المرحلة${vehicleWord}` : `تم إنهاء المرحلة${vehicleWord}`,
    };
    if (affectedCount > 0) await emitTrackingNotification(user, reverting ? "revert_stage" : "complete_stage", { ...body, orderId: row.order_id, stageNo, vehicleIds }, result).catch((error) => console.error("Tracking stage notification failed", error));
    return response.status(200).json(result);
  }

  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
