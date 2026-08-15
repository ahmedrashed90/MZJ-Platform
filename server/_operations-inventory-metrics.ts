import type { getSql } from "./_db.js";

type Sql = ReturnType<typeof getSql>;

export type OperationsInventoryMetric =
  | "active_inventory"
  | "actual_total"
  | "available_for_sale"
  | "reserved"
  | "has_notes"
  | "under_delivery"
  | "delivered";

const inventoryMetrics = new Set<OperationsInventoryMetric>([
  "active_inventory",
  "actual_total",
  "available_for_sale",
  "reserved",
  "has_notes",
  "under_delivery",
  "delivered",
]);

export function isOperationsInventoryMetric(value: string): value is OperationsInventoryMetric {
  return inventoryMetrics.has(value as OperationsInventoryMetric);
}

/**
 * Canonical current-inventory predicates used by both the unified dashboard
 * counters and their drill-down rows. Keep every status bucket exclusive so
 * each number matches the same status filter in the vehicle inventory page.
 *
 * Query contract: the vehicle alias must be `v`.
 */
export function operationsInventoryMetricCondition(sql: Sql, metric: OperationsInventoryMetric) {
  const activeInventory = sql`
    v.is_deleted=false
    and v.archived_at is null
    and v.is_inventory_active=true
  `;

  if (metric === "actual_total") {
    return sql`${activeInventory} and coalesce(v.status_code,'') not in ('under_delivery','delivered')`;
  }
  if (metric === "available_for_sale") {
    return sql`${activeInventory} and v.status_code='available_for_sale'`;
  }
  if (metric === "reserved") {
    return sql`${activeInventory} and v.status_code='reserved'`;
  }
  if (metric === "has_notes") {
    return sql`${activeInventory} and v.status_code='has_notes'`;
  }
  if (metric === "under_delivery") {
    return sql`${activeInventory} and v.status_code='under_delivery'`;
  }
  if (metric === "delivered") {
    return sql`${activeInventory} and v.status_code='delivered'`;
  }
  return activeInventory;
}
