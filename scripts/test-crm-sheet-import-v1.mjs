import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const sourceModule = { exports: {} };
const sharedSource = fs.readFileSync('shared/crm-sheet-sources.ts', 'utf8');
const compiledSources = ts.transpileModule(sharedSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
new Function('require','module','exports',compiledSources)((name) => { throw new Error(`Unexpected shared import: ${name}`); }, sourceModule, sourceModule.exports);
const { resolveSheetLeadSource } = sourceModule.exports;
assert.equal(resolveSheetLeadSource('Facebook').code, 'facebook_lead');
assert.equal(resolveSheetLeadSource('Instagram').code, 'instagram_lead');
assert.equal(resolveSheetLeadSource('TikTok').code, 'tiktok_lead');
assert.equal(resolveSheetLeadSource('Snapchat').code, 'snapchat_lead');
assert.equal(resolveSheetLeadSource('Google Ads').code, 'google_ads');
assert.equal(resolveSheetLeadSource('').code, 'sheet_lead');
assert.equal(resolveSheetLeadSource('unknown-source-that-is-not-registered'), null);
const src = fs.readFileSync('server/_crm-sheet-import.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const leads = new Map();
let assignedCount = 0;
let notificationCount = 0;
const tag = (chunks, ...values) => {
  const sql = chunks.join('?').toLowerCase();
  if (sql.includes('from crm.leads l left join core.users')) {
    const phone = values[0];
    const found = leads.get(phone);
    return Promise.resolve(found ? [{ id: found.id, customer_name: found.customer_name, branch_code: found.branch_code, assigned_name: found.assigned_name }] : []);
  }
  if (sql.includes('insert into crm.leads(')) {
    const [customer_name, phone, phone_normalized, source_code, source_name, service_key, department_code, branch_code, payment_type, campaign_name, assigned_to] = values;
    const row = { id: `lead-${leads.size+1}`, customer_name, phone, phone_normalized, source_code, source_name, service_key, department_code, branch_code, payment_type, campaign_name, assigned_to, assigned_name: `مندوب ${assigned_to}`, is_deleted: false };
    leads.set(phone_normalized, row);
    return Promise.resolve([row]);
  }
  return Promise.resolve([]);
};
tag.begin = async (callback) => callback(tag);
const normalizePhone = (raw) => {
  let value = String(raw || '').replace(/\D/g, '');
  if (/^05\d{8}$/.test(value)) value = `966${value.slice(1)}`;
  if (/^5\d{8}$/.test(value)) value = `966${value}`;
  return /^\d{8,15}$/.test(value) ? value : '';
};
const deps = {
  '../shared/crm-sheet-sources.js': sourceModule.exports,
  './_db.js': { getSql: () => tag, withDatabaseAdvisoryLock: async (_key, work) => work() },
  './_crm-utils.js': {
    audit: async () => undefined, clean: (v) => String(v ?? '').trim(), normalizePhone,
    chooseSheetImportAssignment: async (serviceKey) => {
      assignedCount += 1;
      return { assignedTo: `agent-${assignedCount}`, assignedName: `مندوب ${assignedCount}`,
        branchCode: serviceKey === 'cash' ? 'hall' : 'qadisiyah' };
    },
  },
  './_crm-customer-fields.js': { getCustomerFieldDefinitions: async () => [], calculateLeadCompletion: () => 20 },
  './_crm-lifecycle.js': { attachLeadToContactAndOpenRequest: async () => ({}) },
  './_notifications.js': { emitCrmLeadNotification: async () => { notificationCount += 1; } },
};
const moduleObject = { exports: {} };
new Function('require','module','exports',js)((moduleName) => {
  if (!deps[moduleName]) throw new Error(`Unexpected module: ${moduleName}`);
  return deps[moduleName];
}, moduleObject, moduleObject.exports);
const { importCrmSheetBatch } = moduleObject.exports;
const actor = { id: '00000000-0000-0000-0000-000000000001', fullName: 'مدير النظام' };
const rows = Array.from({length:10}, (_,i) => ({rowNumber:i+2, customerName:`عميل ${i+1}`, phone:`05${String(i+1).padStart(8,'0')}`}));
const first = await importCrmSheetBatch(actor, rows, 'cash', 'الحملة');
assert.equal(first.summary.created,10);
assert.equal(first.summary.existing,0);
assert.equal(assignedCount,10);
const original = new Map([...leads].map(([phone, lead])=>[phone,{...lead}]));
const nextFile = rows.map(row=>({...row, customerName:`اسم معدل ${row.rowNumber}`,source:'Google Ads'})).concat(
  Array.from({length:5},(_,i) => ({rowNumber:12+i,customerName:`جديد ${i+1}`,phone:`05${String(i+11).padStart(8,'0')}`,source:['Facebook','Instagram','TikTok','Snapchat','Google Ads'][i]}))
);
const second = await importCrmSheetBatch(actor, nextFile,'finance','الحملة الثانية');
assert.equal(second.summary.created,5);
assert.equal(second.summary.existing,10);
assert.equal(assignedCount,15,'Existing phones must never trigger assignment');
for (const [phone, before] of original) {
  const after=leads.get(phone);
  assert.deepEqual(after,before,'Existing lead assignment, branch, service, name and campaign stay intact');
}
const third=await importCrmSheetBatch(actor,nextFile,'cash','الحملة الثالثة');
assert.equal(third.summary.created,0);
assert.equal(third.summary.existing,15);
assert.equal(assignedCount,15);
assert.equal(notificationCount,15);
const beforeExistingExtra = assignedCount;
const preexistingWithUnknownSource = await importCrmSheetBatch(actor,[
  {rowNumber:2,customerName:'Already in CRM',phone:'0500000001',source:'unknown made up label'}
], 'finance', 'another campaign');
assert.equal(preexistingWithUnknownSource.summary.existing,1);
assert.equal(assignedCount,beforeExistingExtra);
assert.equal(leads.get('966500000001').source_code,'sheet_lead');
const newWithUnknownSource = await importCrmSheetBatch(actor,[
  {rowNumber:3,customerName:'Invalid attribution',phone:'0500000099',source:'unknown made up label'}
], 'cash', 'another campaign');
assert.equal(newWithUnknownSource.summary.invalid,1);
assert.equal(assignedCount,beforeExistingExtra);
const duplicates=await importCrmSheetBatch(actor,[
  {rowNumber:2,customerName:'عميل',phone:'0500000100'},
  {rowNumber:3,customerName:'نفس الجوال',phone:'+966500000100'},
  {rowNumber:4,customerName:'بدون رقم',phone:''}
], 'cash','');
assert.equal(duplicates.summary.created,1);
assert.equal(duplicates.summary.duplicateInFile,1);
assert.equal(duplicates.summary.invalid,1);
assert.equal(assignedCount,16);
console.log('PASS: First sheet (10) creates 10 leads and assigns 10 owners');
console.log('PASS: Reimport expanded sheet (15) assigns only five new leads');
console.log('PASS: Existing owner, branch, customer name, source and campaign remain unchanged');
console.log('PASS: Per-row lead source persists in CRM source_code for marketing reports');
console.log('PASS: Reimport of same 15 creates no leads, changes no owners, notifies no one');
console.log('PASS: Duplicate phone formats and invalid records are rejected without distribution');
console.log('PASS: Existing CRM lead is skipped even with a changed or invalid sheet source');
console.log('PASS: Unrecognized source is rejected for new leads to protect marketing attribution');
