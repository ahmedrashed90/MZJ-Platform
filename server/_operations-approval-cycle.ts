/**
 * Canonical approval-cycle lifecycle for operations vehicles.
 *
 * Every transition into `under_delivery` owns one active approval cycle.
 * Leaving that status closes the active cycle. Returning to it starts a new
 * cycle while preserving all prior cycles and their audit events.
 */
export async function findActiveVehicleApprovalCycle(tx: any, vehicleId: string) {
  const [approval] = await tx`
    select *,id::text
    from operations.vehicle_approvals
    where vehicle_id=${vehicleId}::uuid and is_active=true
    order by cycle_no desc,updated_at desc
    limit 1
    for update
  `;
  return approval || null;
}

export async function ensureActiveVehicleApprovalCycle(tx: any, vehicleId: string) {
  const current = await findActiveVehicleApprovalCycle(tx, vehicleId);
  if (current) return current;

  const [cycle] = await tx`
    select coalesce(max(cycle_no),0)+1 as next
    from operations.vehicle_approvals
    where vehicle_id=${vehicleId}::uuid
  `;
  const [created] = await tx`
    insert into operations.vehicle_approvals(vehicle_id,cycle_no,is_active,pending_delivery)
    values (${vehicleId}::uuid,${Number(cycle?.next || 1)},true,null)
    returning *,id::text
  `;
  return created;
}

export async function closeActiveVehicleApprovalCycle(tx: any, vehicleId: string) {
  await tx`
    update operations.vehicle_approvals
    set is_active=false,pending_delivery=null,updated_at=now()
    where vehicle_id=${vehicleId}::uuid and is_active=true
  `;
}

export async function startFreshVehicleApprovalCycle(tx: any, vehicleId: string) {
  await closeActiveVehicleApprovalCycle(tx, vehicleId);
  return ensureActiveVehicleApprovalCycle(tx, vehicleId);
}
