import { getSql } from "./_db.js";

export function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = clean(value).replace(/[^\d.,-]/g, "").replace(/,/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function dateValue(value: unknown): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function normalizeSaudiPhone(value: unknown) {
  let digits = clean(value).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `966${digits.slice(1)}`;
  if (!digits.startsWith("966") && digits.length === 9) digits = `966${digits}`;
  return /^9665\d{8}$/.test(digits) ? digits : "";
}

export function publicTrackingUrl(requestOrigin: string, trackingToken: string) {
  const configured = clean(process.env.TRACKING_PUBLIC_BASE_URL);
  const base = configured || requestOrigin;
  const token = clean(trackingToken);
  if (!token) throw new Error("Tracking token is required");
  return `${base.replace(/\/$/, "")}/track?token=${encodeURIComponent(token)}`;
}

export async function ensureVehicleStageRows(vehicleId: string) {
  const sql = getSql();

  // Stage actions are order-wide: completing or reverting a stage updates every
  // vehicle that belongs to the order. If ERP synchronization adds a vehicle
  // later, its stage rows must inherit the last explicit order-level stage
  // action instead of being recreated as pending and making progress regress.
  await sql`
    with vehicle_order as (
      select order_id
      from tracking.order_vehicles
      where id=${vehicleId}::uuid
    ), latest_stage_events as (
      select distinct on (e.stage_id)
        e.stage_id,e.action,e.actor_id,e.created_at
      from tracking.stage_events e
      join vehicle_order vo on vo.order_id=e.order_id
      order by e.stage_id,e.created_at desc,e.id desc
    )
    insert into tracking.vehicle_stages(
      vehicle_id,stage_id,status,completed_by,completed_at,reverted_by,reverted_at
    )
    select
      ${vehicleId}::uuid,s.id,
      case when le.action='completed' then 'completed' else 'pending' end,
      case when le.action='completed' then le.actor_id else null end,
      case when le.action='completed' then le.created_at else null end,
      case when le.action='reverted' then le.actor_id else null end,
      case when le.action='reverted' then le.created_at else null end
    from tracking.stages s
    left join latest_stage_events le on le.stage_id=s.id
    where s.is_active=true
    on conflict (vehicle_id, stage_id) do nothing
  `;

  // Heal rows created by an older sync after a stage had already been completed.
  // Only an explicit stage event can change the canonical state, so the normal
  // rollback action remains fully supported and no unrelated workflow changes.
  await sql`
    with vehicle_order as (
      select order_id
      from tracking.order_vehicles
      where id=${vehicleId}::uuid
    ), latest_stage_events as (
      select distinct on (e.stage_id)
        e.stage_id,e.action,e.actor_id,e.created_at
      from tracking.stage_events e
      join vehicle_order vo on vo.order_id=e.order_id
      order by e.stage_id,e.created_at desc,e.id desc
    )
    update tracking.vehicle_stages vs
    set
      status=case when le.action='completed' then 'completed' else 'pending' end,
      completed_by=case when le.action='completed' then le.actor_id else null end,
      completed_at=case when le.action='completed' then le.created_at else null end,
      reverted_by=case when le.action='reverted' then le.actor_id else null end,
      reverted_at=case when le.action='reverted' then le.created_at else null end,
      updated_at=greatest(vs.updated_at,le.created_at)
    from latest_stage_events le
    where vs.vehicle_id=${vehicleId}::uuid
      and vs.stage_id=le.stage_id
      and (
        (le.action='completed' and vs.status<>'completed')
        or (le.action='reverted' and vs.status<>'pending')
      )
  `;
}

export async function recalculateTrackingOrder(orderId: string) {
  const sql = getSql();
  const [summary] = await sql<{ vehicles: number; total_stages: number; completed_stages: number }[]>`
    select
      count(distinct v.id)::int as vehicles,
      count(vs.id)::int as total_stages,
      count(vs.id) filter (where vs.status='completed')::int as completed_stages
    from tracking.order_vehicles v
    left join tracking.vehicle_stages vs on vs.vehicle_id=v.id
    left join tracking.stages s on s.id=vs.stage_id and s.is_active=true
    where v.order_id=${orderId}::uuid and (vs.id is null or s.id is not null)
  `;
  const vehicles = Number(summary?.vehicles || 0);
  const total = Number(summary?.total_stages || 0);
  const completed = Number(summary?.completed_stages || 0);
  const status = completed <= 0 ? "not_started" : total > 0 && completed >= total ? "completed" : "in_progress";
  await sql`update tracking.orders set status=${status},updated_at=now() where id=${orderId}::uuid`;
  return { vehicles, total, completed, status };
}
