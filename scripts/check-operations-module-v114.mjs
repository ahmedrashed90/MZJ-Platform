import fs from "node:fs";
import path from "node:path";

const required = [
  ["api/index.ts", '["operations", operationsHandler]'],
  ["src/App.tsx", '<Route path="/operations" element={<OperationsLayout />}>'],
  ["src/App.tsx", '<Route index element={<OperationsInventoryPage />} />'],
  ["src/App.tsx", '<Route path="manage" element={<OperationsManagePage />} />'],
  ["src/App.tsx", '<Route path="movements" element={<OperationsMovementPage />} />'],
  ["src/App.tsx", '<Route path="requests" element={<OperationsRequestsPage />} />'],
  ["src/App.tsx", '<Route path="availability" element={<OperationsAvailabilityPage />} />'],
  ["src/App.tsx", '<Route path="activity" element={<OperationsActivityPage />} />'],
  ["src/components/Sidebar.tsx", "operationsOnly: true"],
  ["src/pages/SettingsPage.tsx", "OperationsSettingsPanel"],
  ["server/_auth.ts", "permissions:"],
  ["server/_operations-auth.ts", "requireOperationsPermission"],
  ["server/_operations-schema.ts", "operations.request_events"],
  ["server/_operations-schema.ts", "operations.vehicle_checklists"],
  ["server/operations/index.ts", 'action === "executeMovement"'],
  ["server/operations/index.ts", 'action === "advanceRequest"'],
  ["server/operations/index.ts", 'action === "archiveVehicle"'],
  ["src/operations/components/VehicleEditorModal.tsx", "useEscapeToClose"],
  ["src/operations/pages/OperationsRequestsPage.tsx", "useEscapeToClose"],
  ["src/operations/pages/OperationsMovementPage.tsx", "Transaction واحدة"],
  ["database/schema.sql", "Native operations module extensions"],
];

for (const [file, needle] of required) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(needle)) throw new Error(`Operations check failed: ${file} missing ${needle}`);
}

const forbidden = ["firebase", "firestore", "iframe", "media.html", "mzj-tracking", "sales3.html", "view-dashboard"];
const scanRoots = ["src/operations", "server/operations", "server/_operations-auth.ts", "server/_operations-schema.ts"];

function filesUnder(entry) {
  const stat = fs.statSync(entry);
  if (stat.isFile()) return [entry];
  return fs.readdirSync(entry, { withFileTypes: true }).flatMap((item) => filesUnder(path.join(entry, item.name)));
}

for (const file of scanRoots.flatMap(filesUnder)) {
  const text = fs.readFileSync(file, "utf8").toLowerCase();
  for (const needle of forbidden) {
    if (text.includes(needle)) throw new Error(`Operations legacy isolation failed: ${file} contains ${needle}`);
  }
}

console.log("Operations native module, routes, permissions, transaction flows, Esc closing, schema extensions, and legacy isolation checks passed.");
