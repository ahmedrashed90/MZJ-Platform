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

const DEFAULT_MAIN_WIDGETS = [
  "kpi:total-customers",
  "kpi:open-conversations",
  "kpi:no-answer",
  "kpi:sold",
  "analytics:new-customers",
  "analytics:recent-conversations",
  "analytics:distribution",
  "summary:departments",
] as const;

let schemaPromise: Promise<void> | null = null;

export function ensureDashboardLayoutSchema() {
  if (!schemaPromise) {
    const sql = getSql();
    schemaPromise = sql.unsafe(`
      create table if not exists core.user_dashboard_layouts (
        user_id uuid primary key references core.users(id) on delete cascade,
        operation_widget_order jsonb not null default '[]'::jsonb,
        main_widget_order jsonb not null default '[]'::jsonb,
        hidden_main_widgets jsonb not null default '[]'::jsonb,
        updated_at timestamptz not null default now()
      );
      alter table core.user_dashboard_layouts add column if not exists main_widget_order jsonb not null default '[]'::jsonb;
      alter table core.user_dashboard_layouts add column if not exists hidden_main_widgets jsonb not null default '[]'::jsonb;
    `).then(() => undefined).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function cleanOrder(value: unknown, defaults: readonly string[]) {
  const allowed = new Set<string>(defaults);
  const result: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = String(item || "").trim();
      if (allowed.has(id) && !result.includes(id)) result.push(id);
    }
  }
  for (const id of defaults) if (!result.includes(id)) result.push(id);
  return result;
}

function cleanHidden(value: unknown) {
  const allowed = new Set<string>(DEFAULT_MAIN_WIDGETS);
  const result: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = String(item || "").trim();
      if (allowed.has(id) && !result.includes(id)) result.push(id);
    }
  }
  return result;
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function getDashboardLayout(userId: string) {
  await ensureDashboardLayoutSchema();
  const sql = getSql();
  const [row] = await sql<{ operation_widget_order: unknown; main_widget_order: unknown; hidden_main_widgets: unknown }[]>`
    select operation_widget_order,main_widget_order,hidden_main_widgets
    from core.user_dashboard_layouts
    where user_id=${userId}::uuid
  `;
  return {
    operationWidgetOrder: cleanOrder(row?.operation_widget_order, DEFAULT_OPERATION_WIDGETS),
    mainWidgetOrder: cleanOrder(row?.main_widget_order, DEFAULT_MAIN_WIDGETS),
    hiddenMainWidgets: cleanHidden(row?.hidden_main_widgets),
  };
}

export async function saveDashboardLayout(userId: string, value: unknown) {
  await ensureDashboardLayoutSchema();
  const sql = getSql();
  const input = objectValue(value);
  const [current] = await sql<{ operation_widget_order: unknown; main_widget_order: unknown; hidden_main_widgets: unknown }[]>`
    select operation_widget_order,main_widget_order,hidden_main_widgets
    from core.user_dashboard_layouts
    where user_id=${userId}::uuid
  `;
  const operationWidgetOrder = Object.prototype.hasOwnProperty.call(input, "operationWidgetOrder")
    ? cleanOrder(input.operationWidgetOrder, DEFAULT_OPERATION_WIDGETS)
    : cleanOrder(current?.operation_widget_order, DEFAULT_OPERATION_WIDGETS);
  const mainWidgetOrder = Object.prototype.hasOwnProperty.call(input, "mainWidgetOrder")
    ? cleanOrder(input.mainWidgetOrder, DEFAULT_MAIN_WIDGETS)
    : cleanOrder(current?.main_widget_order, DEFAULT_MAIN_WIDGETS);
  const hiddenMainWidgets = Object.prototype.hasOwnProperty.call(input, "hiddenMainWidgets")
    ? cleanHidden(input.hiddenMainWidgets)
    : cleanHidden(current?.hidden_main_widgets);

  await sql`
    insert into core.user_dashboard_layouts(user_id,operation_widget_order,main_widget_order,hidden_main_widgets,updated_at)
    values(${userId}::uuid,${sql.json(operationWidgetOrder)},${sql.json(mainWidgetOrder)},${sql.json(hiddenMainWidgets)},now())
    on conflict(user_id) do update set
      operation_widget_order=excluded.operation_widget_order,
      main_widget_order=excluded.main_widget_order,
      hidden_main_widgets=excluded.hidden_main_widgets,
      updated_at=now()
  `;
  return { operationWidgetOrder, mainWidgetOrder, hiddenMainWidgets };
}
