import fs from "node:fs";
import path from "node:path";

const requiredFiles = [
  "server/_operations-schema.ts",
  "server/_operations-auth.ts",
  "server/_operations-service.ts",
  "server/operations/index.ts",
  "src/operations/OperationsLayout.tsx",
  "src/operations/pages/InventoryPage.tsx",
  "src/operations/pages/VehicleManagementPage.tsx",
  "src/operations/pages/MovementPage.tsx",
  "src/operations/pages/RequestsPage.tsx",
  "src/operations/pages/ApprovalsPage.tsx",
  "src/operations/pages/MovementLogPage.tsx",
  "database/migrations/20260719_operations_native.sql",
];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`Operations check failed: missing ${file}`);
}

const checks = [
  ["src/App.tsx", '<Route path="/operations" element={<OperationsLayout />}>'],
  ["src/App.tsx", '<Route path="movement" element={<MovementPage />} />'],
  ["src/operations/OperationsLayout.tsx", 'label: "الحركة"'],
  ["server/_operations-service.ts", 'vehicle.location_code==="agency"'],
  ["server/_operations-service.ts", "financial_approved"],
  ["server/_operations-service.ts", "administrative_approved"],
  ["server/_operations-service.ts", "DUPLICATE_ACTIVE_REQUEST"],
  ["server/_operations-service.ts", "INVALID_SOURCE_LOCATION"],
  ["server/_operations-service.ts", "VEHICLE_NOT_ELIGIBLE"],
  ["server/_operations-service.ts", "sql.begin(async"],
  ["server/operations/index.ts", "requestId"],
  ["server/operations/index.ts", "fieldErrors"],
  ["server/operations/index.ts", 'approvalType === "financial"'],
  ["server/operations/index.ts", 'approvalType === "administrative"'],
  ["server/_dashboard-data.ts", "getOperationsDashboard(user)"],
  ["server/_operations-service.ts", "getShortages(user)"],
  ["server/integrations/tracking-orders.ts", "operations_vehicle_id"],
  ["src/operations/components/VehicleDetailDrawer.tsx", "AbortController"],
  ["src/operations/components/VehicleDetailDrawer.tsx", "setDetail(null)"],
  ["src/operations/components/StickyHorizontalScroll.tsx", "scrollLeft"],
  ["src/operations/pages/InventoryPage.tsx", "تصدير النتائج الحالية إلى Excel"],
  ["src/operations/pages/MovementPage.tsx", "checklistByVehicle"],
  ["src/operations/pages/MovementPage.tsx", "حجز - نواقص - تحديد مكان"],
  ["database/migrations/20260719_operations_native.sql", "legacy_transfer_request_id"],
  ["database/migrations/20260719_operations_native.sql", "operations.event_outbox"],
];
for (const [file, needle] of checks) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(needle)) throw new Error(`Operations check failed: ${file} missing ${needle}`);
}

const operationsSources = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(?:ts|tsx|css)$/.test(entry.name)) operationsSources.push(full);
  }
}
walk("src/operations");
walk("server/operations");
operationsSources.push("server/_operations-auth.ts", "server/_operations-schema.ts", "server/_operations-service.ts");
const forbidden = [
  [/firebase/i, "Firebase"],
  [/<iframe/i, "iframe"],
  [/@(?:gmail|hotmail|outlook|mzj-platform)\.com/i, "hardcoded email"],
  [/localStorage/i, "localStorage source of truth"],
];
for (const file of operationsSources) {
  const text = fs.readFileSync(file, "utf8");
  for (const [pattern, label] of forbidden) {
    if (pattern.test(text)) throw new Error(`Operations check failed: ${label} found in ${file}`);
  }
}

const app = fs.readFileSync("src/App.tsx", "utf8");
if (/operations\/(?:bulk|batch|group)-?movement/i.test(app)) throw new Error("Operations check failed: duplicate group movement route exists");
if (/movementNote/.test(fs.readFileSync("src/operations/pages/MovementPage.tsx", "utf8"))) throw new Error("Operations check failed: removed movementNote payload returned");

const migration = fs.readFileSync("database/migrations/20260719_operations_native.sql", "utf8");
if (/drop\s+table|truncate\s+/i.test(migration)) throw new Error("Operations check failed: destructive migration statement found");

console.log("Operations native module structural, safety, routing, state-machine, dashboard-source, tracking-link, and migration checks passed.");
