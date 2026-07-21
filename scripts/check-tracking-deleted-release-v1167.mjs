import fs from "node:fs";

const api = fs.readFileSync("server/tracking/delete.ts", "utf8");
const page = fs.readFileSync("src/tracking/pages/TrackingDeletePage.tsx", "utf8");

const checks = [
  ["API supports deleting a deleted tracking record", api.includes('action === "delete_deleted_record"')],
  ["Deleting the record removes the deleted source blocker", api.includes("delete from tracking.deleted_orders")],
  ["UI uses the requested deleted-orders label", page.includes("الطلبات المحذوفة") && !page.includes("الطلبات الممسوحة")],
  ["UI exposes the release action", page.includes('action: "delete_deleted_record"')],
  ["Empty state uses the requested wording", page.includes("لا توجد طلبات محذوفة")],
];

for (const [name, passed] of checks) {
  if (!passed) throw new Error(`Tracking deleted release check failed: ${name}`);
}

console.log("Tracking deleted order release v1.16.7 check passed.");
