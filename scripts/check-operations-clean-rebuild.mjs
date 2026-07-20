import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
function check(label, condition) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  checks.push(label);
}

const schema = read('server/_operations-schema.ts');
const migration = read('database/migrations/014_operations_tracking_clean_rebuild.sql');
const trackingSchema = read('server/_tracking-schema.ts');
const trackingDelete = read('server/tracking/delete.ts');
const trackingOrders = read('src/tracking/pages/TrackingOrdersPage.tsx');
const modal = read('src/operations/components/OperationsModal.tsx');
const dashboard = read('src/pages/DashboardPage.tsx');
const integration = read('server/integrations/tracking-orders.ts');
const operationsApi = read('server/operations/index.ts');

const addRequires = schema.indexOf('alter table operations.vehicle_statuses add column if not exists requires_note');
const statusUpsert = schema.indexOf('insert into operations.vehicle_statuses(code,name,requires_note');
check('requires_note is added before status upsert', addRequires >= 0 && statusUpsert > addRequires);
check('migration contains requires_note compatibility', migration.includes('alter table operations.vehicle_statuses add column if not exists requires_note'));
check('migration preserves old check-history column mappings', migration.includes('actor_id=coalesce(actor_id,changed_by)'));
check('operations schema is executed transactionally', schema.includes('runSqlMigrationTransaction'));
check('tracking schema is executed transactionally', trackingSchema.includes('runSqlMigrationTransaction'));
check('tracking deletion uses one SQL transaction', trackingDelete.includes('await sql.begin(async (tx) =>'));
check('tracking deletion preserves operations vehicle', !trackingDelete.includes('delete from operations.vehicles'));
check('tracking deletion records exact source fingerprint', trackingDelete.includes('tracking.deleted_source_identities'));
check('ingest does not permanently block order number', !integration.includes('deleted_order_blocks'));
check('tracking deletion is available from details', trackingOrders.includes('مسح طلب التراكينج'));
check('delete confirmation modal uses shared portal modal', trackingOrders.includes('<OperationsModal open={deleteOpen}') && modal.includes('createPortal'));
check('modal layer is above tracking details', read('src/styles.css').includes('.operations-modal-backdrop { position:fixed; inset:0; z-index:10000'));
check('dashboard vehicle popup has requested fields', ['رقم الهيكل','السيارة','البيان','موديل','داخلي','خارجي','المكان','الحالة'].every((value) => dashboard.includes(value)));
check('dashboard transfer/photo popup exists', dashboard.includes('طلبات النقل والتصوير') && dashboard.includes('request_type === "photo"'));
check('inventory tracking query calculates progress from stage rows', operationsApi.includes("count(vs.id) filter(where vs.status='completed')"));
check('inventory query does not read a nonexistent stage progress column', !operationsApi.includes('vs.progress'));

for (const directory of ['src/operations', 'server/operations']) {
  const files = fs.readdirSync(path.join(root, directory), { recursive: true }).filter((entry) => typeof entry === 'string' && /\.(ts|tsx)$/.test(entry));
  for (const file of files) {
    const text = read(path.join(directory, file));
    check(`${directory}/${file} contains no Firebase/Firestore dependency`, !/firebase|firestore/i.test(text));
  }
}

console.log(`Operations clean rebuild checks passed (${checks.length}).`);
