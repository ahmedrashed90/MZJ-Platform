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

const DEFAULT_DASHBOARD_WIDGETS = [...DEFAULT_MAIN_WIDGETS, ...DEFAULT_OPERATION_WIDGETS] as const;
const MAIN_WIDGET_SET = new Set<string>(DEFAULT_MAIN_WIDGETS);
const OPERATION_WIDGET_SET = new Set<string>(DEFAULT_OPERATION_WIDGETS);

let schemaPromise: Promise<void> | null = null;

export function ensureDashboardLayoutSchema() {
  if (!schemaPromise) {
    const sql = getSql();
    schemaPromise = sql.unsafe(`
      create table if not exists core.user_dashboard_layouts (
        user_id uuid primary key references core.users(id) on delete cascade,
        operation_widget_order jsonb not null default '[]'::jsonb,
        main_widget_order jsonb not null default '[]'::jsonb,
        dashboard_widget_order jsonb not null default '[]'::jsonb,
        hidden_main_widgets jsonb not null default '[]'::jsonb,
        updated_at timestamptz not null default now()
      );
      alter table core.user_dashboard_layouts add column if not exists main_widget_order jsonb not null default '[]'::jsonb;
      alter table core.user_dashboard_layouts add column if not exists operation_widget_order jsonb not null default '[]'::jsonb;
      alter table core.user_dashboard_layouts add column if not exists dashboard_widget_order jsonb not null default '[]'::jsonb;
      alter table core.user_dashboard_layouts add column if not exists hidden_main_widgets jsonb not null default '[]'::jsonb;
      update core.user_dashboard_layouts
      set dashboard_widget_order=coalesce(main_widget_order,'[]'::jsonb)||coalesce(operation_widget_order,'[]'::jsonb)
      where dashboard_widget_order='[]'::jsonb
        and (main_widget_order<>'[]'::jsonb or operation_widget_order<>'[]'::jsonb);
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
  const result: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = String(item || "").trim();
      if (MAIN_WIDGET_SET.has(id) && !result.includes(id)) result.push(id);
    }
  }
  return result;
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function splitOrder(widgetOrder: string[]) {
  return {
    mainWidgetOrder: widgetOrder.filter((id) => MAIN_WIDGET_SET.has(id)),
    operationWidgetOrder: widgetOrder.filter((id) => OPERATION_WIDGET_SET.has(id)),
  };
}

function rowWidgetOrder(row: { dashboard_widget_order?: unknown; main_widget_order?: unknown; operation_widget_order?: unknown } | undefined) {
  const stored = Array.isArray(row?.dashboard_widget_order) ? row?.dashboard_widget_order : [];
  if (stored.length) return cleanOrder(stored, DEFAULT_DASHBOARD_WIDGETS);
  return cleanOrder([
    ...cleanOrder(row?.main_widget_order, DEFAULT_MAIN_WIDGETS),
    ...cleanOrder(row?.operation_widget_order, DEFAULT_OPERATION_WIDGETS),
  ], DEFAULT_DASHBOARD_WIDGETS);
}

export async function getDashboardLayout(userId: string) {
  await ensureDashboardLayoutSchema();
  const sql = getSql();
  const [row] = await sql<{ operation_widget_order: unknown; main_widget_order: unknown; dashboard_widget_order: unknown; hidden_main_widgets: unknown; updated_at: string }[]>`
    select operation_widget_order,main_widget_order,dashboard_widget_order,hidden_main_widgets,updated_at::text
    from core.user_dashboard_layouts
    where user_id=${userId}::uuid
  `;
  const widgetOrder = rowWidgetOrder(row);
  return {
    widgetOrder,
    ...splitOrder(widgetOrder),
    hiddenMainWidgets: cleanHidden(row?.hidden_main_widgets),
    updatedAt: String(row?.updated_at || ""),
  };
}

export async function saveDashboardLayout(userId: string, value: unknown) {
  await ensureDashboardLayoutSchema();
  const sql = getSql();
  const input = objectValue(value);
  const [current] = await sql<{ operation_widget_order: unknown; main_widget_order: unknown; dashboard_widget_order: unknown; hidden_main_widgets: unknown }[]>`
    select operation_widget_order,main_widget_order,dashboard_widget_order,hidden_main_widgets
    from core.user_dashboard_layouts
    where user_id=${userId}::uuid
  `;

  const currentWidgetOrder = rowWidgetOrder(current);
  let widgetOrder = currentWidgetOrder;
  if (Object.prototype.hasOwnProperty.call(input, "widgetOrder")) {
    widgetOrder = cleanOrder(input.widgetOrder, DEFAULT_DASHBOARD_WIDGETS);
  } else if (Object.prototype.hasOwnProperty.call(input, "mainWidgetOrder") || Object.prototype.hasOwnProperty.call(input, "operationWidgetOrder")) {
    const currentSplit = splitOrder(currentWidgetOrder);
    const mainOrder = Object.prototype.hasOwnProperty.call(input, "mainWidgetOrder")
      ? cleanOrder(input.mainWidgetOrder, DEFAULT_MAIN_WIDGETS)
      : currentSplit.mainWidgetOrder;
    const operationOrder = Object.prototype.hasOwnProperty.call(input, "operationWidgetOrder")
      ? cleanOrder(input.operationWidgetOrder, DEFAULT_OPERATION_WIDGETS)
      : currentSplit.operationWidgetOrder;
    widgetOrder = cleanOrder([...mainOrder, ...operationOrder], DEFAULT_DASHBOARD_WIDGETS);
  }

  const { mainWidgetOrder, operationWidgetOrder } = splitOrder(widgetOrder);
  const hiddenMainWidgets = Object.prototype.hasOwnProperty.call(input, "hiddenMainWidgets")
    ? cleanHidden(input.hiddenMainWidgets)
    : cleanHidden(current?.hidden_main_widgets);

  const [saved] = await sql<{ updated_at: string }[]>`
    insert into core.user_dashboard_layouts(user_id,operation_widget_order,main_widget_order,dashboard_widget_order,hidden_main_widgets,updated_at)
    values(${userId}::uuid,${sql.json(operationWidgetOrder)},${sql.json(mainWidgetOrder)},${sql.json(widgetOrder)},${sql.json(hiddenMainWidgets)},now())
    on conflict(user_id) do update set
      operation_widget_order=excluded.operation_widget_order,
      main_widget_order=excluded.main_widget_order,
      dashboard_widget_order=excluded.dashboard_widget_order,
      hidden_main_widgets=excluded.hidden_main_widgets,
      updated_at=now()
    returning updated_at::text
  `;
  return { widgetOrder, operationWidgetOrder, mainWidgetOrder, hiddenMainWidgets, updatedAt: String(saved?.updated_at || "") };
}
