export type OperationsArchiveActor = {
  id?: string | null;
  name?: string | null;
};

export type OperationsAutoArchiveResult = {
  archived: boolean;
  reason:
    | "archived"
    | "vehicle_not_found"
    | "already_archived"
    | "approvals_incomplete"
    | "active_transfer"
    | "tracking_incomplete";
  vehicle?: any;
};

export const AUTOMATIC_VEHICLE_ARCHIVE_REASON =
  "أرشفة تلقائية بعد اكتمال التراكينج بنسبة 100% والموافقة المالية والإدارية وعدم وجود طلب نقل جاري أو غير مكتمل";

/**
 * Canonical vehicle-archive gate.
 *
 * A vehicle is archived only when all three business conditions are true:
 * 1) the latest approval cycle has both financial and administrative approval,
 * 2) no non-deleted/non-cancelled transfer request is still incomplete,
 * 3) at least one linked tracking vehicle has every active stage completed.
 *
 * The vehicle row is locked directly (without an outer join), which keeps the
 * decision and update atomic and avoids PostgreSQL's nullable-side FOR UPDATE error.
 */
export async function tryArchiveEligibleVehicle(
  tx: any,
  vehicleId: string,
  actor: OperationsArchiveActor,
  options?: { reason?: string; action?: "archived" | "auto_archived" },
): Promise<OperationsAutoArchiveResult> {
  const [vehicle] = await tx`
    select *,id::text
    from operations.vehicles
    where id=${vehicleId}::uuid and is_deleted=false
    for update
  `;

  if (!vehicle) return { archived: false, reason: "vehicle_not_found" };
  if (vehicle.archived_at) return { archived: false, reason: "already_archived", vehicle };

  const [state] = await tx`
    select
      coalesce((
        select va.financial_approved and va.administrative_approved
        from operations.vehicle_approvals va
        where va.vehicle_id=${vehicleId}::uuid
        order by va.cycle_no desc,va.updated_at desc
        limit 1
      ),false) as approvals_complete,
      exists(
        select 1
        from operations.transfer_request_vehicles rv
        join operations.transfer_requests r on r.id=rv.transfer_request_id
        where rv.vehicle_id=${vehicleId}::uuid
          and r.is_deleted=false
          and r.cancelled_at is null
          and r.status<>'completed'
      ) as active_transfer,
      exists(
        select 1
        from tracking.order_vehicles ov
        join tracking.orders o on o.id=ov.order_id
        join tracking.vehicle_stages vs on vs.vehicle_id=ov.id
        join tracking.stages s on s.id=vs.stage_id and s.is_active=true
        where (ov.vehicle_id=${vehicleId}::uuid or (ov.vehicle_id is null and ov.vin=${vehicle.vin}))
          and coalesce(o.is_deleted,false)=false
        group by ov.id
        having count(vs.id)>0
          and count(vs.id) filter (where vs.status='completed')=count(vs.id)
      ) as tracking_complete
  `;

  if (!state?.approvals_complete) return { archived: false, reason: "approvals_incomplete", vehicle };
  if (state.active_transfer) return { archived: false, reason: "active_transfer", vehicle };
  if (!state.tracking_complete) return { archived: false, reason: "tracking_incomplete", vehicle };

  const archiveReason = String(options?.reason || AUTOMATIC_VEHICLE_ARCHIVE_REASON).trim();
  const archiveAction = options?.action || "auto_archived";
  const actorId = String(actor.id || "").trim() || null;
  const actorName = String(actor.name || "").trim() || "النظام";

  const [updated] = await tx`
    update operations.vehicles
    set archived_at=now(),
        archived_by=${actorId}::uuid,
        archived_by_name=${actorName},
        archive_reason=${archiveReason},
        is_inventory_active=false,
        updated_at=now(),
        version=version+1
    where id=${vehicleId}::uuid and archived_at is null
    returning *,id::text
  `;

  if (!updated) return { archived: false, reason: "already_archived", vehicle };

  await tx`
    insert into operations.vehicle_archive_events(vehicle_id,action,reason,actor_id,actor_name,snapshot)
    values (${vehicleId}::uuid,${archiveAction},${archiveReason},${actorId}::uuid,${actorName},${tx.json(updated)})
  `;

  return { archived: true, reason: "archived", vehicle: updated };
}

export async function tryArchiveVehicleForTrackingRecord(
  tx: any,
  trackingVehicleId: string,
  actor: OperationsArchiveActor,
): Promise<OperationsAutoArchiveResult | null> {
  const [link] = await tx`
    select coalesce(tv.vehicle_id,inventory.id)::text as operations_vehicle_id
    from tracking.order_vehicles tv
    left join lateral (
      select v.id
      from operations.vehicles v
      where v.is_deleted=false and v.vin=tv.vin
      order by (v.archived_at is null) desc,v.updated_at desc
      limit 1
    ) inventory on true
    where tv.id=${trackingVehicleId}::uuid
  `;
  const operationsVehicleId = String(link?.operations_vehicle_id || "").trim();
  if (!operationsVehicleId) return null;
  return tryArchiveEligibleVehicle(tx, operationsVehicleId, actor);
}
