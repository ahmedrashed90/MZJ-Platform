import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const fail = (message) => { console.error(`Operations v1.14 check failed: ${message}`); process.exitCode = 1; };
const requireText = (file, text) => { if (!read(file).includes(text)) fail(`${file} is missing ${text}`); };

const requiredFiles = [
  "src/operations/OperationsLayout.tsx",
  "src/operations/OperationsContext.tsx",
  "src/operations/pages/OperationsInventoryPage.tsx",
  "src/operations/pages/OperationsVehiclesPage.tsx",
  "src/operations/pages/OperationsMovementsPage.tsx",
  "src/operations/pages/OperationsRequestsPage.tsx",
  "src/operations/pages/OperationsAllCarsPage.tsx",
  "src/operations/pages/OperationsMovementLogPage.tsx",
  "src/operations/components/OperationsOverlay.tsx",
  "server/_operations-schema.ts",
  "server/_operations-auth.ts",
  "server/operations/meta.ts",
  "server/operations/vehicles.ts",
  "server/operations/movements.ts",
  "server/operations/requests.ts",
  "server/operations/reports.ts",
  "server/operations/settings.ts",
];
for (const file of requiredFiles) if (!fs.existsSync(path.join(root, file))) fail(`missing ${file}`);

requireText("src/App.tsx", '<Route path="/operations" element={<OperationsLayout />}>');
for (const route of ["inventory", "vehicles", "movements", "requests", "all-cars", "movement-log"]) {
  requireText("src/App.tsx", `<Route path="${route}"`);
}
for (const route of ["operations/meta", "operations/vehicles", "operations/movements", "operations/requests", "operations/reports", "operations/settings"]) {
  requireText("api/index.ts", `["${route}"`);
}
for (const table of ["operations.vehicle_statuses", "operations.movement_batches", "operations.request_events"]) {
  requireText("server/_operations-schema.ts", table);
}
requireText("src/operations/components/OperationsOverlay.tsx", "useEscapeToClose(open, onClose)");
requireText("server/_dashboard-data.ts", "ensureOperationsSchema");
requireText("server/_dashboard-data.ts", "counts_in_actual_inventory");
requireText("server/_auth.ts", "permissionCodes");
requireText("server/operations/vehicles.ts", "bulk_import");
requireText("src/operations/pages/OperationsVehiclesPage.tsx", "استيراد CSV");

const operationsRoots = ["src/operations", "server/operations"];
const forbidden = [
  /<iframe\b/i,
  /firebase(?:app|auth|firestore)?/i,
  /media\.html/i,
  /mzj-workflow\.vercel\.app/i,
  /mzj-tracking\.firebaseapp\.com/i,
  /mersal-wa/i,
];
function walk(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const rel = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(rel);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      const source = read(rel);
      for (const expression of forbidden) if (expression.test(source)) fail(`legacy dependency ${expression} found in ${rel}`);
    }
  }
}
for (const directory of operationsRoots) walk(directory);

const app = read("src/App.tsx");
if (/path=["'](?:tracking|media)["']/.test(app.slice(app.indexOf('<Route path="/operations"'), app.indexOf('<Route path="/tracking"')))) {
  fail("tracking or media was nested inside the operations route");
}
if (/OperationsDashboard/i.test(app) || fs.existsSync(path.join(root, "src/operations/pages/OperationsDashboardPage.tsx"))) {
  fail("an old operations dashboard was added");
}

if (!process.exitCode) console.log("Operations v1.14 native module checks passed.");
