import type { SessionUser } from "./_auth.js";
import type { getSql } from "./_db.js";
import { trackingAccessScope } from "./_tracking-access.js";

export type TrackingCountSummary = {
  total: number;
  notStarted: number;
  inProgress: number;
  completed: number;
  archived: number;
};

type TrackingCountRange = {
  from?: string;
  to?: string;
};

/**
 * Returns the canonical Tracking order counters using exactly the same access
 * scope and active/archive rules everywhere they are displayed.
 */
export async function getTrackingCountSummary(
  sql: ReturnType<typeof getSql>,
  user: SessionUser,
  range: TrackingCountRange = {},
): Promise<TrackingCountSummary> {
  const scope = trackingAccessScope(user);
  const branches = scope.branchCodes;
  const from = range.from || null;
  const to = range.to || null;
  const [row] = await sql<any[]>`
    select
      count(*) filter (where coalesce(o.is_archived,false)=false)::int as total,
      count(*) filter (where coalesce(o.is_archived,false)=false and o.status='not_started')::int as not_started,
      count(*) filter (where coalesce(o.is_archived,false)=false and o.status='in_progress')::int as in_progress,
      count(*) filter (where coalesce(o.is_archived,false)=false and o.status='completed')::int as completed,
      count(*) filter (where coalesce(o.is_archived,false)=true)::int as archived
    from tracking.orders o
    where coalesce(o.is_deleted,false)=false
      and (
        ${scope.unrestricted}=true
        or (${scope.assignedOnly}=true and o.assigned_to=${user.id}::uuid)
        or (${scope.workflowAssignedOnly}=true and exists(select 1 from tracking.stage_events se where se.order_id=o.id and se.actor_id=${user.id}::uuid))
        or (${scope.branchScoped}=true and o.branch in ${sql(branches)})
      )
      and (${from}::date is null or coalesce(o.order_date,(o.created_at at time zone 'Asia/Riyadh')::date) >= ${from}::date)
      and (${to}::date is null or coalesce(o.order_date,(o.created_at at time zone 'Asia/Riyadh')::date) <= ${to}::date)
  `;

  return {
    total: Number(row?.total || 0),
    notStarted: Number(row?.not_started || 0),
    inProgress: Number(row?.in_progress || 0),
    completed: Number(row?.completed || 0),
    archived: Number(row?.archived || 0),
  };
}
