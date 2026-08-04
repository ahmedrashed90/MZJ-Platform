import fs from 'node:fs';

const schema = fs.readFileSync('server/_operations-schema.ts', 'utf8');
const api = fs.readFileSync('server/operations/index.ts', 'utf8');
const modal = fs.readFileSync('src/operations/components/VehicleDetailModal.tsx', 'utf8');
const migration = fs.readFileSync('database/migrations/20260721_operations_check_history_fk_v1163.sql', 'utf8');

const checks = [
  ['Canonical safety bag definition exists', schema.includes("('safety_bag','شنطة',30)")],
  ['Legacy history codes are preserved before FK replacement', schema.includes('select distinct h.item_code')],
  ['History FK is repointed to canonical definitions', schema.includes('foreign key (item_code) references operations.check_item_definitions(code)')],
  ['Deployment migration contains the same FK repair', migration.includes("ref_table='check_item_definitions'") && migration.includes('references operations.check_item_definitions(code)')],
  ['Vehicle delete removes related tracking SMS', api.includes('delete from tracking.sms_messages where vehicle_id') && api.includes('delete from tracking.sms_messages where order_id')],
  ['Vehicle delete remains transactional', api.includes('async function deleteVehicle') && api.includes('return sql.begin(async (tx) =>')],
  ['Inventory detail exposes complete vehicle delete action', modal.includes('مسح السيارة') && modal.includes('delete_vehicle') && modal.includes('confirmVin')],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
