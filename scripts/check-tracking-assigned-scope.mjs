import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const expect = (label, condition) => {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`PASS: ${label}`);
};

const scope = read("server/_tracking-access.ts");
const orders = read("server/tracking/orders.ts");
const sms = read("server/tracking/sms.ts");
const deleted = read("server/tracking/delete.ts");
const dashboard = read("server/_dashboard-data.ts");
const schema = read("server/_tracking-schema.ts");
const sync = read("server/_erpnext-sales-order-sync.ts");

expect("Assigned tracking scope is resolved centrally", scope.includes('const assignedOnly = ["self", "assigned", "created_by_me"].includes(access.dataScope)'));
expect("Assigned scope never falls back to branch scope", scope.includes("branchScoped: !unrestricted && !assignedOnly && !workflowAssignedOnly"));
expect("Tracking orders store the mapped platform user", schema.includes("assigned_to uuid references core.users(id) on delete set null"));
expect("Existing tracking orders are backfilled from ERP links", schema.includes("tracking_assignee_backfill") && schema.includes("so.tracking_order_id=o.id") && schema.includes("so.platform_user_id"));
expect("Future ERP sync updates the tracking assignee", sync.includes("syncTrackingOrderAssignment") && sync.includes("set assigned_to=${assignedTo}::uuid"));
expect("Order lists and details require the current assignee for assigned scope", (orders.match(/scope\.assignedOnly}=true and o\.assigned_to=\$\{user\.id\}::uuid/g) || []).length >= 4);
expect("Stage actions validate the same assignee", orders.includes("scope.assignedOnly && clean(row.assigned_to) === user.id"));
expect("SMS validates the same assignee", sms.includes("scope.assignedOnly && clean(row.assigned_to) === user.id"));
expect("Delete actions validate the same assignee", deleted.includes("scope.assignedOnly && clean(order.assigned_to) === user.id"));
expect("Unified dashboard tracking metrics use the same assignee", (dashboard.match(/trackingScope\.assignedOnly}=true and o\.assigned_to=\$\{user\.id\}::uuid/g) || []).length === 2);
expect("Old unconditional branch-or-event tracking predicate is removed", !orders.includes('access.dataScope === "all" || access.branchCodes.includes'));

console.log("Tracking assigned-order visibility checks passed.");
