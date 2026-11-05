import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(project, file), 'utf8');
const frontend = read('src/operations/pages/MovementPage.tsx');
const backend = read('server/operations/index.ts');

// Validate the new visual default, with no user-requested status change.
assert.match(frontend, /const \[newStatus, setNewStatus\] = useState\(""\)/);
assert.match(frontend, /<select value=\{displayedNewStatus\} onChange=\{\(event\) => setNewStatus\(event\.target\.value\)\}>/);
assert.match(frontend, /<option value="">الحالة الحالية لكل سيارة \(بدون تغيير\)<\/option>/);
assert.match(frontend, /body: JSON\.stringify\(\{\s*action: "move_vehicles",\s*destinationLocationId,\s*newStatus,/);
assert.match(frontend, /setDestinationLocationId\(""\);\s*setNewStatus\(""\);/);
assert.match(frontend, /required=\{\(newStatus \|\| row\.status_code\) === "has_notes"\}/);
assert.match(frontend, /\(newStatus \|\| item\.status_code\) === "has_notes"/);

const defaultCode = frontend.match(/  const currentStatusCodes = \[\.\.\.new Set\(selected\.map\(\(item\) => item\.status_code\)\)\];[\s\S]+?  const statusName = [\s\S]+?;\n/);
assert.ok(defaultCode, 'The dropdown must derive its default from selected vehicle statuses');
const defaults = new Function('selected', 'newStatus', 'statuses', `${defaultCode[0]} return { displayedNewStatus, statusName };`);
assert.deepEqual(defaults([{ status_code: 'reserved', status_name: 'حجز' }], '', []), { displayedNewStatus: 'reserved', statusName: 'حجز' });
assert.deepEqual(defaults([{ status_code: 'reserved' }, { status_code: 'under_delivery' }], '', []), { displayedNewStatus: '', statusName: 'الحالة الحالية لكل سيارة' });
assert.equal(defaults([{ status_code: 'reserved' }], 'available_for_sale', []).displayedNewStatus, 'available_for_sale');

// Exercise the actual moveVehicles handler in an isolated DB mock.
// TypeScript is a project devDependency; global TypeScript is used only if dependencies are absent in QA.
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); }
catch {
  const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  ts = require(path.join(globalRoot, 'typescript'));
}
const start = backend.indexOf('async function moveVehicles(');
const end = backend.indexOf('\nasync function createTransfer(', start);
assert.ok(start >= 0 && end > start);
const js = ts.transpileModule(backend.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

async function runMovement({ statuses, override = '', sameLocation = false, stateNotes = [] }) {
  const ids = statuses.map((_, i) => `id-${i + 1}`);
  const vehicles = Object.fromEntries(ids.map((id, index) => [id, {
    id, vin: `VIN${index + 1}`, location_id: sameLocation ? 'dest' : 'origin', status_code: statuses[index],
    location_code: 'hall', branch_code: 'hall', state_note: stateNotes[index] || '', shortage_note: '', interior_color: '',
  }]));
  const moves = [];
  const batches = [];
  let deliveryApprovals = 0;
  let deliveryClosures = 0;
  const tag = async (strings, ...values) => {
    const query = strings.join('?');
    if (query.includes('from operations.locations where id=')) return [{ id: 'dest', name: 'الصالة', branch_code: 'hall', code: 'hall' }];
    if (query.includes('from operations.vehicle_statuses where code=')) return [{ code: values[0], name: values[0] }];
    if (query.includes('from operations.vehicles v left join operations.locations')) return [vehicles[values[0]]];
    if (query.includes('insert into operations.movement_batches')) { batches.push({ newStatus: values[2] }); return [{ id: `batch-${batches.length}`, batch_no: 'MB-QA' }]; }
    throw new Error(`Unexpected SQL: ${query.slice(0, 130)}`);
  };
  tag.begin = async (fn) => fn(tag);
  const ctx = {
    clean: (value) => String(value ?? '').trim(),
    actor: () => ({ id: 'admin', role: 'admin', branch: 'hall', name: 'Admin' }),
    requestId: () => 'MB-TEST',
    assertVehicleStatusAccess: () => {},
    assertBranchAccess: () => {},
    AGENCY_INTERIOR_COLORS: new Set(),
    OperationError: class OperationError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } },
    persistVehicleMovement: async (_tx, { vehicle, destination, newStatus }) => {
      moves.push({ vin: vehicle.vin, original: vehicle.status_code, newStatus });
      return { movement: { id: `movement-${moves.length}` }, vehicle: { ...vehicle, status_code: newStatus, location_id: destination.id } };
    },
    ensureActiveVehicleApprovalCycle: async () => { deliveryApprovals += 1; return { financial_approved: false, administrative_approved: false }; },
    startFreshVehicleApprovalCycle: async () => {},
    closeActiveVehicleApprovalCycle: async () => { deliveryClosures += 1; },
    console,
  };
  vm.runInNewContext(`${js}\nthis.testMoveVehicles = moveVehicles;`, ctx);
  let result;
  let error;
  try {
    result = await ctx.testMoveVehicles(tag, {
      items: ids.map((vehicleId, index) => ({ vehicleId, stateNote: stateNotes[index] || '' })),
      destinationLocationId: 'dest', newStatus: override,
    }, {});
  } catch (cause) { error = cause; }
  return { moves, batches, deliveryApprovals, deliveryClosures, result, error };
}

const preserveSingle = await runMovement({ statuses: ['reserved'] });
assert.equal(preserveSingle.error, undefined);
assert.equal(preserveSingle.moves[0].newStatus, 'reserved');
assert.equal(preserveSingle.result.moved[0].currentStatusCode, 'reserved');
assert.equal(preserveSingle.batches[0].newStatus, null);

const preserveMultiple = await runMovement({ statuses: ['reserved', 'available_for_sale', 'under_delivery'] });
assert.equal(preserveMultiple.error, undefined);
assert.deepEqual(preserveMultiple.moves.map((v) => v.newStatus), ['reserved', 'available_for_sale', 'under_delivery']);
assert.equal(preserveMultiple.batches.length, 1);
assert.equal(preserveMultiple.batches[0].newStatus, null);

const explicitOverride = await runMovement({ statuses: ['reserved', 'under_delivery'], override: 'available_for_sale' });
assert.equal(explicitOverride.error, undefined);
assert.deepEqual(explicitOverride.moves.map((v) => v.newStatus), ['available_for_sale', 'available_for_sale']);
assert.equal(explicitOverride.batches[0].newStatus, 'available_for_sale');

const deliveredMove = await runMovement({ statuses: ['delivered'] });
assert.equal(deliveredMove.error, undefined);
assert.equal(deliveredMove.moves[0].newStatus, 'delivered');
assert.equal(deliveredMove.deliveryApprovals, 0, 'Preserving delivered status must not start another delivery approval');
assert.equal(deliveredMove.deliveryClosures, 0, 'Preserving delivered status must not close an approval cycle');

const unchanged = await runMovement({ statuses: ['reserved'], sameLocation: true });
assert.equal(unchanged.error?.code, 'CONFLICT');
assert.equal(unchanged.moves.length, 0);

const hasNotes = await runMovement({ statuses: ['has_notes'] });
assert.equal(hasNotes.error?.code, 'VALIDATION_ERROR');

console.log('PASS: 13 status-preservation checks (frontend defaults, mixed selections, server overrides, approvals, notes)');
