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

export function publicTrackingUrl(requestOrigin: string, vin: string, orderNo: string) {
  const configured = clean(process.env.TRACKING_PUBLIC_BASE_URL);
  const base = configured || requestOrigin;
  const key = vin && !vin.startsWith("PENDING-") ? `vin=${encodeURIComponent(vin)}` : `order=${encodeURIComponent(orderNo)}`;
  return `${base.replace(/\/$/, "")}/track?${key}`;
}

export async function ensureVehicleStageRows(vehicleId: string) {
  const sql = getSql();
  await sql`
    insert into tracking.vehicle_stages(vehicle_id, stage_id)
    select ${vehicleId}::uuid, s.id
    from tracking.stages s
    where s.is_active = true
    on conflict (vehicle_id, stage_id) do nothing
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
