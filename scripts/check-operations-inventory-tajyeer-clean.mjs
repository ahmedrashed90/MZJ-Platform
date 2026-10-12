import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const server = read('server/operations/index.ts');
const inventorySchema = read('server/_operations-schema.ts');
const accessSchema = read('server/_access-control-schema.ts');
const catalog = read('shared/operations-inventory-fields.ts');
const permissionCatalog = read('shared/access-control.ts');
const movement = read('src/operations/pages/MovementPage.tsx');
const inventory = read('src/operations/pages/InventoryPage.tsx');
const table = read('src/operations/components/VehicleTable.tsx');
const users = read('src/access-control/UsersPermissionsPanel.tsx');
const style = read('src/styles.css');
const assertChecks = [
  ['Schema stores tajyeer as false initially', /is_tajyeer boolean not null default false/.test(inventorySchema)],
  ['Schema stores tajyeer author and timestamp', /tajyeer_updated_at timestamptz/.test(inventorySchema) && /tajyeer_updated_by uuid references core\.users/.test(inventorySchema)],
  ['Permissions migrations live only in central access schema', !inventorySchema.includes('operations.inventory.column.car') && accessSchema.includes('OPERATIONS_INVENTORY_ACCESS_SQL')],
  ['Dedicated tajyeer edit permission exists', permissionCatalog.includes('operations.inventory.tajyeer.update') && accessSchema.includes("'operations.inventory.tajyeer.update'")],
  ['Visibility catalog contains 15 columns', (catalog.match(/permission: "operations\.inventory\.column\./g) || []).length === 15],
  ['Existing viewers inherit column visibility by default', accessSchema.includes("base.code='operations.inventory.view'") && accessSchema.includes("col.code like 'operations.inventory.column.%'")],
  ['Tajyeer modification is not granted to all users', accessSchema.includes("where r.code in ('admin','system_admin')")],
  ['User permissions select inventory columns', users.includes('OPERATIONS_INVENTORY_FIELDS.map((field)') && users.includes('access-inventory-column-grid')],
  ['User permissions apply individual allow/deny', users.includes('[field.permission]: event.target.checked ? (inherited ? "inherit" : "allow") : "deny"') && users.includes('canViewOperationsInventoryField(previewPermissions, field.permission)')],
  ['Server reports effective inventory visibility', server.includes('inventoryVisibleColumns: OPERATIONS_INVENTORY_FIELDS.filter((field) => canViewOperationsInventoryField(user, field.permission))')],
  ['Server hides denied inventory fields in stock listing', server.includes('if (boolValue(request.query.inventory))') && server.includes('delete row[key]')],
  ['Tajyeer filter applied to totals and rows', (server.match(/v\.is_tajyeer=\(\$\{tajyeer\}='yes'\)/g) || []).length === 2],
  ['Tajyeer update action rejects non-booleans', server.includes('typeof body.isTajyeer !== "boolean"')],
  ['Tajyeer update route checks granular permission', server.includes('requireOperationsPermission(user, "operations.inventory.tajyeer.update", response)')],
  ['Tajyeer update locks the correct VIN row within scope', server.includes('for update of v') && server.includes('const statusScope = vehicleStatusScope(tx as ReturnType<typeof getSql>, user)')],
  ['Tajyeer changes create durable audit record', server.includes("'vehicle_tajyeer_updated'") && server.includes('isTajyeer: Boolean(before.is_tajyeer)')],
  ['Explicit visibility denials override inventory-view defaults', catalog.includes('deniedPermissions?.includes(fieldPermission)') && catalog.includes('operations.inventory.view')],
  ['Stock shows colored interactive badges', table.includes('operations-tajyeer-badge') && table.includes('onTajyeer(row)')],
  ['Stock supports yes/no/all selection', inventory.includes('aria-label="\u0641\u0644\u062a\u0631 \u0627\u0644\u062a\u062c\u064a\u064a\u0631"') && inventory.includes('<option value="yes">') && inventory.includes('<option value="no">')],
  ['Stock export uses user-specific visible columns', inventory.includes('meta.inventoryVisibleColumns.includes(item.key)') && inventory.includes('allRows.map((row) => visible.map((item) => item.read(row)))')],
  ['Removed legacy columns are absent from stock table', !table.includes('shortage_note') && !table.includes('reserved_by_name') && !table.includes('row.notes')],
  ['Movement has exactly one note input, always visible', (movement.match(/key: "stateNote"/g) || []).length === 1 && !movement.includes('newStatus === "has_notes" ? [')],
  ['Movement removed legacy note/shortage inputs', !movement.includes('shortageNote:') && !movement.includes('note: row.note') && !movement.includes('sharedMovementNote')],
  ['Movement only displays financial approval', !movement.includes('administrative_approved') && movement.includes('row.financial_approved')],
  ['Movement keeps note mandatory for status has_notes', movement.includes('required={newStatus === "has_notes"}')],
  ['Movement backend preserves past shortage notes', server.includes('raw.shortageNote === undefined && !sharedMovementNote ? undefined')],
  ['Movement backend still validates notes for has_notes', server.includes('if (newStatus === "has_notes" && !effectiveStateNote)')],
  ['CSS has approved red and green badges', style.includes('.operations-tajyeer-badge.yes') && style.includes('.operations-tajyeer-badge.no')],
  ['VIN remains visible independent of column permissions', table.includes('column.key === "vin"')],
];
let failed = 0;
for (const [name, ok] of assertChecks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (!ok) failed += 1;
}
console.log(`Operations tajyeer checks: ${assertChecks.length - failed}/${assertChecks.length}`);
if (failed) process.exit(1);
