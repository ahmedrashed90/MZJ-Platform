import { getSql } from "./_db.js";

const DEFAULT_OPERATION_WIDGETS = [
  "inventory",
  "location:warehouse",
  "location:agency",
  "location:hall",
  "location:qadisiyah",
  "location:multaqa",
  "approvals",
  "shortages",
  "transfers",
  "sales-tracking",
] as const;

let schemaPromise: Promise<void> | null = null;

export function ensureDashboardLayoutSchema() {
  if (!schemaPromise) {
    const sql = getSql();
    schemaPromise = sql.unsafe(`
      create table if not exists core.user_dashboard_layouts (
        user_id uuid primary key references core.users(id) on delete cascade,
        operation_widget_order jsonb not null default '[]'::jsonb,
        updated_at timestamptz not null default now()
      );
    `).then(() => undefined).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function cleanOrder(value: unknown) {
  const allowed = new Set<string>(DEFAULT_OPERATION_WIDGETS);
  const result: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = String(item || "").trim();
      if (allowed.has(id) && !result.includes(id)) result.push(id);
    }
  }
  for (const id of DEFAULT_OPERATION_WIDGETS) if (!result.includes(id)) result.push(id);
  return result;
}

export async function getDashboardLayout(userId: string) {
  await ensureDashboardLayoutSchema();
  const sql = getSql();
  const [row] = await sql<{ operation_widget_order: unknown }[]>`
    select operation_widget_order from core.user_dashboard_layouts where user_id=${userId}::uuid
  `;
  return { operationWidgetOrder: cleanOrder(row?.operation_widget_order) };
}

export async function saveDashboardLayout(userId: string, value: unknown) {
  await ensureDashboardLayoutSchema();
  const order = cleanOrder(value);
  const sql = getSql();
  await sql`
    insert into core.user_dashboard_layouts(user_id,operation_widget_order,updated_at)
    values(${userId}::uuid,${sql.json(order)},now())
    on conflict(user_id) do update set operation_widget_order=excluded.operation_widget_order,updated_at=now()
  `;
  return { operationWidgetOrder: order };
}
