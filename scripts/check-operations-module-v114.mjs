import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const required = [
  'src/operations/OperationsLayout.tsx',
  'src/operations/pages/OperationsInventoryPage.tsx',
  'src/operations/pages/OperationsVehicleManagementPage.tsx',
  'src/operations/pages/OperationsMovementPage.tsx',
  'src/operations/pages/OperationsBatchMovementPage.tsx',
  'src/operations/pages/OperationsRequestsPage.tsx',
  'src/operations/pages/OperationsAllVehiclesPage.tsx',
  'src/operations/pages/OperationsMovementHistoryPage.tsx',
  'src/operations/pages/OperationsApprovalsPage.tsx',
  'src/operations/pages/OperationsArchivePage.tsx',
  'server/operations/vehicles.ts',
  'server/operations/movements.ts',
  'server/operations/requests.ts',
  'server/operations/approvals.ts',
  'server/operations/archive.ts',
  'database/migrations/20260719_operations_native_v1.sql',
];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing operations file: ${file}`);
}
const app = read('src/App.tsx');
for (const route of ['vehicles','movement','batch-movement','requests','all-vehicles','movements','approvals','archive']) {
  if (!app.includes(`path="${route}"`)) throw new Error(`Missing operations route: ${route}`);
}
const operationsFiles = required.filter((file) => file.startsWith('src/operations') || file.startsWith('server/operations'));
const forbidden = [/firebase/i, /firestore/i, /<iframe/i, /@mzj-platform\.com/i];
for (const file of operationsFiles) {
  const content = read(file);
  for (const pattern of forbidden) if (pattern.test(content)) throw new Error(`Forbidden legacy pattern ${pattern} in ${file}`);
}
const migration = read('database/migrations/20260719_operations_native_v1.sql');
for (const token of ['system_admin','event_outbox','vehicle_tracking_summary','request_stage_events','vehicle_check_history','movement_batches','vehicle_archives','pg_trgm']) {
  if (!migration.includes(token)) throw new Error(`Migration missing ${token}`);
}
const movements = read('server/operations/movements.ts');
if (!movements.includes('sql.begin')) throw new Error('Movements are not transactional');
const requests = read('server/operations/requests.ts');
if (!requests.includes('for update') || !requests.includes('vehicle_received')) throw new Error('Request stage locking or receiving flow is missing');
const inventory = read('src/operations/pages/OperationsInventoryPage.tsx');
const trackingOrders = read('src/tracking/pages/TrackingOrdersPage.tsx');
if (!inventory.includes('/tracking?request=') || !trackingOrders.includes('requestedOrderId')) throw new Error('Tracking deep-link from operations is missing');
const approvals = read('server/operations/approvals.ts');
if (!approvals.includes('financial_approved') || !approvals.includes('administrative_approved')) throw new Error('Independent approvals are missing');
console.log('Operations native v1.14 routes, migration, permissions, transactions, tracking link, and legacy exclusions passed.');
