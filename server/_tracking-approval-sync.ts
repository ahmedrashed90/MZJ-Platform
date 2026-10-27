/**
 * Source-of-truth bridge for Tracking stages 6 (financial) and 7 (administrative).
 * Inventory vehicles use operations.vehicle_approvals (per VIN/cycle).
 * External sales without inventory use tracking.sale_vehicle_approvals (per
 * sales-order vehicle). Tracking stages are projections of the corresponding
 * approval, not a second approval system. Syncing targets only the newest
 * sale; archived late approvals require explicit allowArchived.
 *
 * All updates (including the tracking summary and the audit trail) can run
 * inside the caller's operations transaction so the two systems cannot commit
 * contradictory approval statuses when an approval is changed.
 */
export const APPROVAL_CONTROLLED_TRACKING_STAGES = [6, 7] as const;

export function isApprovalControlledTrackingStage(sortOrder: unknown): boolean {
  return Number(sortOrder) === 6 || Number(sortOrder) === 7;
}

type SyncActor = { id?: string | null; name?: string | null; note?: string | null };

export async function syncTrackingApprovalStagesForTrackingVehicle(
  db: any,
  trackingVehicleId: string,
  actor: SyncActor = {},
  options: { allowArchived?: boolean } = {},
) {
  const [link] = await db`
    select tv.id::text as tracking_vehicle_id,tv.order_id::text as order_id,
      o.is_archived,o.is_cancelled,o.is_deleted,
      ov.id::text as operations_vehicle_id,coalesce(ov.vin,tv.vin) as vin,
      (coalesce(external_approval.financial_approved,false) or coalesce(approval.financial_approved,false)) as financial_approved,
      (coalesce(external_approval.administrative_approved,false) or coalesce(approval.administrative_approved,false)) as administrative_approved,
      (case when external_approval.financial_approved then external_approval.financial_approved_by else approval.financial_approved_by end)::text as financial_approved_by,
      (case when external_approval.administrative_approved then external_approval.administrative_approved_by else approval.administrative_approved_by end)::text as administrative_approved_by,
      case when external_approval.financial_approved then external_approval.financial_approved_by_name else approval.financial_approved_by_name end as financial_approved_by_name,
      case when external_approval.administrative_approved then external_approval.administrative_approved_by_name else approval.administrative_approved_by_name end as administrative_approved_by_name,
      case when external_approval.financial_approved then external_approval.financial_approved_at else approval.financial_approved_at end as financial_approved_at,
      case when external_approval.administrative_approved then external_approval.administrative_approved_at else approval.administrative_approved_at end as administrative_approved_at
    from tracking.order_vehicles tv
    join tracking.orders o on o.id=tv.order_id
    left join lateral (
      select v.id,v.vin from operations.vehicles v
      where v.is_deleted=false and (
        v.id=tv.vehicle_id
        or (tv.vehicle_id is null and nullif(trim(tv.vin),'') is not null
            and upper(trim(v.vin))=upper(trim(tv.vin)))
      )
      order by case when v.id=tv.vehicle_id then 0 else 1 end,v.updated_at desc
      limit 1
    ) ov on true
    left join lateral (
      select va.financial_approved,va.administrative_approved,
        va.financial_approved_by,va.administrative_approved_by,
        va.financial_approved_by_name,va.administrative_approved_by_name,
        va.financial_approved_at,va.administrative_approved_at
      from operations.vehicle_approvals va
      where va.vehicle_id=ov.id
      order by va.cycle_no desc,va.updated_at desc
      limit 1
    ) approval on true
    left join tracking.sale_vehicle_approvals external_approval
      on external_approval.tracking_vehicle_id=tv.id
    where tv.id=${trackingVehicleId}::uuid
  `;
  if (!link || link.is_deleted || link.is_cancelled || (link.is_archived && !options.allowArchived)) return { orderId: "", changed: 0 };

  if (link.operations_vehicle_id || link.vin) {
    // Both inventory and external approvals belong to the newest eligible
    // sale for this VIN. Historical sales keep their own stage snapshots.
    const [latest] = await db`
      select tv.id::text as id from tracking.order_vehicles tv
      join tracking.orders o on o.id=tv.order_id
      where coalesce(o.is_deleted,false)=false and coalesce(o.is_cancelled,false)=false
        and (${options.allowArchived === true}=true or coalesce(o.is_archived,false)=false)
        and (
          (${link.operations_vehicle_id || null}::uuid is not null
            and tv.vehicle_id=${link.operations_vehicle_id || null}::uuid)
          or (nullif(trim(tv.vin),'') is not null
              and upper(trim(tv.vin))=upper(trim(${link.vin || ""})))
        )
      order by o.order_date desc nulls last,o.created_at desc,tv.created_at desc,tv.id desc
      limit 1
    `;
    if (latest?.id !== trackingVehicleId) return { orderId: "", changed: 0 };
  }

  const stageRows = await db`
    select s.id::text,s.sort_order,vs.status as prior_status
    from tracking.stages s
    left join tracking.vehicle_stages vs on vs.stage_id=s.id and vs.vehicle_id=${trackingVehicleId}::uuid
    where s.is_active=true and s.sort_order in (6,7)
    order by s.sort_order
  `;
  let changed = 0;
  for (const stage of stageRows) {
    const financial = Number(stage.sort_order) === 6;
    const approved = financial ? link.financial_approved === true : link.administrative_approved === true;
    const desired = approved ? "completed" : "pending";
    const approvedBy = approved ? (financial ? link.financial_approved_by : link.administrative_approved_by) : null;
    const approvedAt = approved ? (financial ? link.financial_approved_at : link.administrative_approved_at) : null;
    const reverting = stage.prior_status === "completed" && !approved;
    const [updated] = await db`
      insert into tracking.vehicle_stages (
        vehicle_id,stage_id,status,completed_by,completed_at,reverted_by,reverted_at,updated_at
      ) values (
        ${trackingVehicleId}::uuid,${stage.id}::uuid,${desired},${approvedBy || null}::uuid,
        ${approvedAt || null}::timestamptz,
        ${reverting ? actor.id || null : null}::uuid,
        ${reverting ? new Date().toISOString() : null}::timestamptz,now()
      )
      on conflict (vehicle_id,stage_id) do update set
        status=excluded.status,completed_by=excluded.completed_by,completed_at=excluded.completed_at,
        reverted_by=excluded.reverted_by,reverted_at=excluded.reverted_at,updated_at=now()
      where tracking.vehicle_stages.status is distinct from excluded.status
        or (excluded.status='completed' and (
          tracking.vehicle_stages.completed_by is distinct from excluded.completed_by
          or tracking.vehicle_stages.completed_at is distinct from excluded.completed_at
        ))
        or (excluded.status='pending' and (
          tracking.vehicle_stages.completed_by is not null
          or tracking.vehicle_stages.completed_at is not null
        ))
      returning id::text
    `;
    if (!updated) continue;
    changed += 1;
    if (stage.prior_status !== desired && (stage.prior_status || approved)) {
      const recordedBy = approved ? approvedBy : actor.id || null;
      const recordedName = approved
        ? financial ? link.financial_approved_by_name : link.administrative_approved_by_name
        : actor.name || "النظام";
      await db`
        insert into tracking.stage_events(order_id,vehicle_id,stage_id,action,actor_id,actor_name,note)
        values (${link.order_id}::uuid,${trackingVehicleId}::uuid,${stage.id}::uuid,
          ${approved ? "completed" : "reverted"},${recordedBy || null}::uuid,
          ${recordedName || "النظام"},${actor.note || "تزامن تلقائي من تبويب الموافقات"})
      `;
    }
  }

  // An archived sale keeps its historical order status and archive markers.
  // Only its approval-controlled stage rows and audit events are updated.
  if (changed && !link.is_archived) {
    const [summary] = await db`
      select count(vs.id)::int as total,
        count(vs.id) filter(where vs.status='completed')::int as completed
      from tracking.order_vehicles tv
      join tracking.vehicle_stages vs on vs.vehicle_id=tv.id
      join tracking.stages s on s.id=vs.stage_id and s.is_active=true
      where tv.order_id=${link.order_id}::uuid
    `;
    const total = Number(summary?.total || 0);
    const completed = Number(summary?.completed || 0);
    const status = completed === 0 ? "not_started" : total > 0 && completed === total ? "completed" : "in_progress";
    await db`
      update tracking.orders set status=${status},updated_at=now()
      where id=${link.order_id}::uuid and status is distinct from ${status}
    `;
  }
  return { orderId: link.order_id as string, changed };
}

export async function syncTrackingApprovalStagesForOperationsVehicle(db: any, operationsVehicleId: string, actor: SyncActor = {}) {
  const trackingVehicles = await db`
    select tv.id::text from tracking.order_vehicles tv
    join tracking.orders o on o.id=tv.order_id
    join operations.vehicles ov on ov.id=${operationsVehicleId}::uuid
    where coalesce(o.is_deleted,false)=false and coalesce(o.is_cancelled,false)=false
      and coalesce(o.is_archived,false)=false
      and (tv.vehicle_id=ov.id or (tv.vehicle_id is null and nullif(trim(tv.vin),'') is not null
        and upper(trim(tv.vin))=upper(trim(ov.vin))))
    order by o.order_date desc nulls last,o.created_at desc,tv.created_at desc
    limit 1
  `;
  for (const row of trackingVehicles) {
    await syncTrackingApprovalStagesForTrackingVehicle(db, row.id, actor);
  }
}
