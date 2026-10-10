import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const metrics = read("server/_operations-inventory-metrics.ts");
const dashboard = read("server/_dashboard-data.ts");
const operations = read("server/operations/index.ts");

const checks = [];
function expect(label, condition) {
  const ok = Boolean(condition);
  checks.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
}

expect(
  "One canonical inventory metric source is shared by dashboard counters and popup rows",
  dashboard.includes('from "./_operations-inventory-metrics.js"')
    && operations.includes('from "../_operations-inventory-metrics.js"')
    && dashboard.includes('operationsInventoryMetricCondition(sql, "actual_total")')
    && operations.includes("operationsInventoryMetricCondition(sql, metricKey)"),
);
expect(
  "Every dashboard vehicle number is based on active non-archived inventory",
  metrics.includes("v.is_deleted=false")
    && metrics.includes("v.archived_at is null")
    && metrics.includes("v.is_inventory_active=true"),
);
expect(
  "Actual total follows the approved rule and excludes only under-delivery and delivered",
  metrics.includes("coalesce(v.status_code,'') not in ('under_delivery','delivered')"),
);
expect(
  "Status cards are exclusive and match the exact inventory status filters",
  [
    "v.status_code='available_for_sale'",
    "v.status_code='reserved'",
    "v.status_code='has_notes'",
    "v.status_code='under_delivery'",
    "v.status_code='delivered'",
  ].every((value) => metrics.includes(value))
    && !metrics.includes("v.has_notes=true"),
);
expect(
  "Agency total uses the same actual-total predicate with agency location only",
  dashboard.includes('operationsInventoryMetricCondition(sql, "actual_total")} and l.code=\'agency\''),
);
expect(
  "Location cards use the canonical predicate for every displayed stock metric",
  ["actual_total", "under_delivery", "available_for_sale", "reserved", "delivered", "has_notes"]
    .every((metric) => dashboard.includes(`operationsInventoryMetricCondition(sql, "${metric}")`)),
);
expect(
  "Vehicle popup does not keep a second handwritten calculation tree",
  operations.includes('const metricKey = isOperationsInventoryMetric(metric) ? metric : "active_inventory"')
    && !operations.includes('metric === "actual_total"'),
);

const failed = checks.filter((item) => !item.ok);
if (failed.length) {
  console.error(`\nOperations dashboard card calculation checks failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}
console.log(`\nOperations dashboard card calculation checks passed: ${checks.length}/${checks.length}`);
