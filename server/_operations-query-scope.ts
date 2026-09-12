import { getSystemAccess } from "./_access-control.js";
import type { SessionUser } from "./_auth.js";
import type { getSql } from "./_db.js";

type Sql = ReturnType<typeof getSql>;

function operationsAccess(user: SessionUser) {
  const access = getSystemAccess(user, "operations");
  const branches = access.branchCodes.length ? access.branchCodes : ["__none__"];
  const statusCodes = access.vehicleStatusCodes?.length ? access.vehicleStatusCodes : ["__none__"];
  return {
    unrestrictedBranches: access.dataScope === "all",
    branches,
    unrestrictedStatuses: !access.vehicleStatusCodes?.length,
    statusCodes,
  };
}

/**
 * Canonical access scope for transfer and photography requests.
 * The request alias must be `r` and the linked vehicle tables are queried internally.
 */
export function operationsRequestAccessScope(sql: Sql, user: SessionUser) {
  const access = operationsAccess(user);
  return sql`
    (${access.unrestrictedBranches}=true
      or r.source_branch_code in ${sql(access.branches)}
      or r.destination_branch_code in ${sql(access.branches)}
      or exists(
        select 1
        from operations.locations request_scope_location
        where request_scope_location.id in (r.source_location_id,r.destination_location_id)
          and (request_scope_location.code in ${sql(access.branches)} or request_scope_location.branch_code in ${sql(access.branches)})
      )
      or r.requested_by=${user.id}::uuid)
    and (${access.unrestrictedStatuses}=true or exists(
      select 1
      from operations.transfer_request_vehicles request_status_rv
      join operations.vehicles request_status_v on request_status_v.id=request_status_rv.vehicle_id
      where request_status_rv.transfer_request_id=r.id
        and request_status_v.is_deleted=false
        and request_status_v.status_code in ${sql(access.statusCodes)}
    ))
  `;
}

/**
 * A request is operationally visible while at least one linked vehicle is active.
 * Completed requests disappear from active operations counts after all linked cars are archived.
 */
export function operationsRequestHasActiveVehicle(sql: Sql, user: SessionUser) {
  const access = operationsAccess(user);
  return sql`exists(
    select 1
    from operations.transfer_request_vehicles active_request_rv
    join operations.vehicles active_request_v on active_request_v.id=active_request_rv.vehicle_id
    where active_request_rv.transfer_request_id=r.id
      and active_request_v.is_deleted=false
      and active_request_v.archived_at is null
      and active_request_v.is_inventory_active=true
      and (${access.unrestrictedStatuses}=true or active_request_v.status_code in ${sql(access.statusCodes)})
  )`;
}

/**
 * Canonical scope used by both the approvals page and the unified dashboard card.
 * The query aliases must be `a`, `v`, and `l`.
 */
export function operationsApprovalVisibilityScope(sql: Sql, user: SessionUser) {
  const access = operationsAccess(user);
  return sql`
    a.is_active=true
    and v.is_deleted=false
    and v.archived_at is null
    and (v.status_code='under_delivery' or a.pending_delivery is not null)
    and (${access.unrestrictedBranches}=true or l.code in ${sql(access.branches)} or l.branch_code in ${sql(access.branches)})
    and (${access.unrestrictedStatuses}=true or v.status_code in ${sql(access.statusCodes)})
  `;
}
