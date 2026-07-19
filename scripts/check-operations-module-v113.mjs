import fs from "node:fs";

const required = [
  ["api/index.ts", '["operations", operationsHandler]'],
  ["src/App.tsx", 'path="/operations"'],
  ["src/operations/OperationsLayout.tsx", "مخزون السيارات"],
  ["src/operations/OperationsLayout.tsx", "إدارة السيارات"],
  ["src/operations/OperationsLayout.tsx", "الحركة"],
  ["src/operations/OperationsLayout.tsx", "طلبات النقل"],
  ["src/operations/OperationsLayout.tsx", "الموافقات"],
  ["src/operations/OperationsLayout.tsx", "جميع السيارات"],
  ["src/operations/OperationsLayout.tsx", "سجل الحركات"],
  ["src/operations/OperationsLayout.tsx", "الأرشيف"],
  ["server/operations.ts", "operations.vehicle.delete"],
  ["server/operations.ts", "VEHICLE_HAS_HISTORY"],
  ["server/operations.ts", "move_vehicles"],
  ["server/operations.ts", "advance_transfer"],
  ["server/operations.ts", "APPROVALS_REQUIRED"],
  ["server/operations.ts", "for update"],
  ["server/_operations-schema.ts", "operations.vehicle_statuses"],
  ["server/_operations-schema.ts", "operations.vehicle_approval_cycles"],
  ["server/_operations-schema.ts", "operations.transfer_request_events"],
  ["server/_operations-schema.ts", "operations.event_outbox"],
  ["server/_operations-schema.ts", "audit.vehicle_deletions"],
  ["server/_operations-schema.ts", "operations.vehicle.delete"],
  ["server/_operations-schema.ts", "tracking.orders.delete"],
  ["server/_dashboard-data.ts", "operations.schema"],
  ["server/_dashboard-data.ts", "sectionErrors"],
  ["src/pages/SettingsPage.tsx", "OperationsSettingsPanel"],
  ["src/operations/pages/OperationsManagePage.tsx", "استبدال كامل"],
  ["src/operations/pages/OperationsManagePage.tsx", "إضافة فوق الحالي"],
  ["src/operations/pages/OperationsManagePage.tsx", "تحديث من الشيت"],
  ["server/_operations-schema.ts", "operations.import.replace"],
  ["server/_operations-schema.ts", "operations.transfer.delete"],
  ["server/operations.ts", "delete_transfer"],
  ["server/operations.ts", "confirmReplace"],
  ["src/operations/components/VehicleTable.tsx", "operations-column-resizer"],
  ["src/operations/components/VehicleTable.tsx", "localStorage.getItem"],
  ["src/operations/components/VehicleTable.tsx", "onDoubleClick"],
  ["src/operations/components/VehicleDetailDrawer.tsx", "update_vehicle"],
  ["src/operations/pages/OperationsTransfersPage.tsx", "حذف قبل التنفيذ"],
  ["src/operations/pages/OperationsTransfersPage.tsx", 'resource:"transfer"'],
  ["src/operations/pages/OperationsMovementPage.tsx", "مراجعة الحركة قبل التنفيذ"],
  ["src/operations/pages/OperationsMovementPage.tsx", "operations-movement-vehicle-data"],
  ["src/operations/components/OperationsSettingsPanel.tsx", "branch_ids"],
  ["server/operations.ts", "operations.location_branches"],
  ["server/operations.ts", "branch_ids"],
  ["src/operations/pages/OperationsApprovalsPage.tsx", "operations-confirm-modal"],
];

for (const [file, needle] of required) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(needle)) throw new Error(`Operations check failed: ${file} missing ${needle}`);
}

const operationFiles = [
  ...fs.readdirSync("src/operations", { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => `src/operations/${entry.name}`),
  ...fs.readdirSync("src/operations/pages", { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => `src/operations/pages/${entry.name}`),
  ...fs.readdirSync("src/operations/components", { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => `src/operations/components/${entry.name}`),
  "server/operations.ts",
];
for (const file of operationFiles) {
  const text = fs.readFileSync(file, "utf8");
  if (/firebase|firestore/i.test(text)) throw new Error(`Operations Native must not depend on Firebase: ${file}`);
}


for (const file of operationFiles) {
  const text = fs.readFileSync(file, "utf8");
  if (/window\.prompt|window\.confirm/.test(text)) throw new Error(`Operations must use platform dialogs instead of browser prompts: ${file}`);
}

const api = fs.readFileSync("server/operations.ts", "utf8");
if (/mock\s*data|localStorage/i.test(api)) throw new Error("Operations API must not use mock data or localStorage as a source of truth.");
if (!fs.existsSync("database/migrations/20260720_operations_native.sql")) throw new Error("Operations migration is missing.");

console.log("Operations Native v1.13.3 structure, permissions, transactions, import modes, dashboard isolation, and safe deletion checks passed.");
