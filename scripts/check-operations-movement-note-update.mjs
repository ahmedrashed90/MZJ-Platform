import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const operations = fs.readFileSync(path.join(root, 'server/operations/index.ts'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'server/_operations-schema.ts'), 'utf8');
const trackingDelete = fs.readFileSync(path.join(root, 'server/tracking/delete.ts'), 'utf8');
const notifications = fs.readFileSync(path.join(root, 'server/_notifications.ts'), 'utf8');
const migrations = [
  'database/migrations/20260720_operations_native_v2.sql',
  'database/migrations/20260720_operations_critical_compat_v1145.sql',
].map((file) => fs.readFileSync(path.join(root, file), 'utf8'));

const checks = [
  ['Same location/status is detected before the note-only path', operations.includes('const sameLocationAndStatus = String(v.location_id) === destinationLocationId && v.status_code === newStatus;')],
  ['The shared note is applied to حجز - نواقص - تحديد مكان', operations.includes('const effectiveShortageNote = sharedMovementNote || clean(raw.shortageNote);')],
  ['A note-only update is accepted when a note changed', operations.includes('const hasNoteUpdate = Boolean(clean(raw.note) || sharedMovementNote)') && operations.includes('if (sameLocationAndStatus) {')],
  ['A no-op remains blocked when there is no new note', operations.includes('ولم تتم إضافة ملاحظة جديدة')],
  ['Note-only persistence does not change location or status', operations.includes('const [updated] = noteOnly') && operations.includes('update operations.vehicles set state_note=${nextStateNote||null},shortage_note=${nextShortageNote||null}')],
  ['Note-only persistence is identified in movement history', operations.includes('movementType: "note_update"') && operations.includes("input.movementType || (noteOnly ? 'note_update' : 'direct')")],
  ['Agency checks are not overwritten by a note-only save', operations.includes('if (!noteOnly && vehicle.location_id && Array.isArray(raw.checks))')],
  ['Note-only result is returned separately from moved vehicles', operations.includes('const notesUpdated: any[] = [];') && operations.includes('moved, notesUpdated, pendingApprovals')],
  ['Pure note-only saves do not emit a misleading moved notification', notifications.includes('Array.isArray(result?.notesUpdated) && result.notesUpdated.length')],
  ['Canonical outbox schema includes legacy aggregate columns', schema.includes('aggregate_type text') && schema.includes('aggregate_id text')],
  ['Both operations migrations include legacy aggregate compatibility', migrations.every((text) => text.includes('aggregate_type text') && text.includes('aggregate_id text'))],
  ['Movement outbox writes aggregate identity', operations.includes('event_type,aggregate_type,aggregate_id,entity_type,entity_id,vehicle_id')],
  ['Transfer outbox writes aggregate identity', operations.includes("'operations.transfer_request.created','transfer_request',${request.id},'transfer_request',${request.id}")],
  ['Tracking delete outbox writes aggregate identity', trackingDelete.includes('event_type,aggregate_type,aggregate_id,entity_type,entity_id,vehicle_id')],
];

let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'}: ${label}`);
  if (!passed) failed += 1;
}
if (failed) {
  console.error(`Operations movement note-update checks failed: ${failed}/${checks.length}`);
  process.exit(1);
}
console.log(`Operations movement note-update checks passed: ${checks.length}/${checks.length}`);
