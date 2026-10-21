import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { OPERATIONS_VEHICLE_IMPORT_HEADERS as headers, vehicleImportStateNote } from '../shared/operations-vehicle-import.ts';
import { buildXlsxBytes } from '../src/operations/excel.ts';

const legacyVehicleNote = 'ملاحظات في السيارة';
const legacyShortageNote = 'حجز - نواقص - تحديد مكان';
const legacyStateNote = 'ملاحظات السيارات (تُفتح عند الحالة: بها ملاحظات)';
assert.equal(headers.length, 25, 'New template should have the original 27 columns minus 2 retired inputs');
assert.equal(new Set(headers).size, headers.length, 'Template header names must be unique');
assert.equal(headers.includes('ملاحظات'), true);
for (const removed of [legacyVehicleNote, legacyShortageNote, legacyStateNote]) {
  assert.equal(headers.includes(removed), false, `Obsolete column ${removed} must not appear in new template`);
}
for (const preserved of ['الهيكل (VIN)', 'المكان', 'الحالة', 'الموافقة المالية', 'الموافقة الادارية', 'Tracking']) {
  assert.equal(headers.includes(preserved), true, `Unexpected loss of ${preserved}`);
}
const examples = [
  [{ 'الهيكل (VIN)': '0000123', 'ملاحظات': 'ملاحظة مع متاح للبيع', 'الحالة': 'متاح للبيع' }, 'ملاحظة مع متاح للبيع'],
  [{ 'الهيكل (VIN)': '0000123', 'ملاحظات': 'ملاحظة مع حجز', 'الحالة': 'حجز' }, 'ملاحظة مع حجز'],
  [{ [legacyStateNote]: 'ملاحظات القالب القديم', [legacyVehicleNote]: 'حقل تم حذفه', [legacyShortageNote]: 'تم إلغاؤه' }, 'ملاحظات القالب القديم'],
  [{ [legacyVehicleNote]: 'لا يجب استيراد هذا', [legacyShortageNote]: 'لا يجب استيراد هذا' }, ''],
  [{ 'ملاحظات': '', [legacyStateNote]: 'لا يجب أن يطغى على عمود جديد فارغ' }, ''],
  [{ 'stateNote': 'خدمة برمجية قديمة' }, 'خدمة برمجية قديمة'],
];
for (const [input, expected] of examples) {
  assert.equal(vehicleImportStateNote(input), expected, `Wrong mapping of ${JSON.stringify(input)}`);
}
const ui = fs.readFileSync('src/operations/pages/VehicleManagementPage.tsx', 'utf8');
const api = fs.readFileSync('server/operations/index.ts', 'utf8');
assert.match(ui, /exportExcel\("قالب-استيراد-السيارات\.xlsx", \[\.\.\.OPERATIONS_VEHICLE_IMPORT_HEADERS\], \[\]\)/);
assert.match(ui, /<span>ملاحظات<\/span><textarea required=\{form\.statusCode === "has_notes"\}/);
for (const removed of [legacyVehicleNote, legacyShortageNote, legacyStateNote]) assert.equal(ui.includes(removed), false);
const importArea = api.slice(api.indexOf('async function importVehicles('), api.indexOf('async function importVehicles(') + 9000);
assert.match(importArea, /stateNote: clean\(vehicleImportStateNote\(raw\)\)/);
assert.match(importArea, /state_note=coalesce\(nullif\(\$\{row\.stateNote\},''\),state_note\)/);
assert.equal(/\$\{row\.notes\}|\$\{row\.shortageNote\}/.test(importArea), false);
assert.match(api, /body\.notes === undefined \? before\.notes/);
assert.match(api, /body\.shortageNote === undefined \? before\.shortage_note/);

// This is exactly the browser's exporter function; ensure it yields a valid XLSX.
const xlsx = buildXlsxBytes([...headers], []);
assert.ok(xlsx.byteLength > 1000);
if (process.env.MZJ_TEST_EXCEL_PATH) fs.writeFileSync(process.env.MZJ_TEST_EXCEL_PATH, xlsx);
console.log(`PASS Operations vehicle import template: 25 column export, new+legacy header mapping, 6 note scenarios, manual edit legacy preservation, XLSX generated (${xlsx.byteLength} bytes).`);
