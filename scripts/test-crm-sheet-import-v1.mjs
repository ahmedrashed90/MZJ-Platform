import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const sourceModule = { exports: {} };
const sharedSource = fs.readFileSync('shared/crm-sheet-sources.ts', 'utf8');
const compiledSources = ts.transpileModule(sharedSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
new Function('require','module','exports',compiledSources)((name) => { throw new Error(`Unexpected shared import: ${name}`); }, sourceModule, sourceModule.exports);
const { resolveSheetLeadSource } = sourceModule.exports;
const phoneModule = { exports: {} };
const phoneJs = ts.transpileModule(fs.readFileSync('shared/crm-sheet-phone.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
new Function('require', 'module', 'exports', phoneJs)((name) => { throw new Error(`Unexpected phone import: ${name}`); }, phoneModule, phoneModule.exports);
const { checkSheetLeadPhone } = phoneModule.exports;
assert.equal(checkSheetLeadPhone('p:+966546670570').normalized, '966546670570');
assert.equal(checkSheetLeadPhone('+966546670570').normalized, '966546670570');
assert.equal(checkSheetLeadPhone('0546670570').normalized, '966546670570');
assert.equal(checkSheetLeadPhone('٠٥٤٦٦٧٠٥٧٠').normalized, '966546670570');
assert.equal(checkSheetLeadPhone('p:+201016242870').normalized, '201016242870');
assert.equal(checkSheetLeadPhone('966548000000').normalized, '');
assert.match(checkSheetLeadPhone('966548000000').reason, /أصفار/);
assert.equal(checkSheetLeadPhone('966550026263828').normalized, '');
assert.equal(checkSheetLeadPhone('9.665e+11').normalized, '');

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
  '../shared/crm-sheet-phone.js': phoneModule.exports,
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
for (const lead of leads.values()) assert.equal(lead.phone, lead.phone_normalized, 'Stored phone must be canonical');
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
const prefixSample = await importCrmSheetBatch(actor, [
  { rowNumber: 42, customerName: 'ياسر', phone: 'p:+966546670570', source: 'Snapchat' },
  { rowNumber: 43, customerName: 'رقم غير كامل', phone: '966548000000', source: 'Snapchat' },
], 'cash', 'lead phone fix');
assert.equal(prefixSample.summary.created, 1);
assert.equal(prefixSample.summary.invalid, 1);
assert.equal(leads.get('966546670570').phone, '966546670570');
assert.equal(notificationCount, 17);
console.log('PASS: Imported p:+966 becomes a canonical phone and placeholder zeros are not added');
console.log('PASS: First sheet (10) creates 10 leads and assigns 10 owners');
console.log('PASS: Reimport expanded sheet (15) assigns only five new leads');
console.log('PASS: Existing owner, branch, customer name, source and campaign remain unchanged');
console.log('PASS: Per-row lead source persists in CRM source_code for marketing reports');
console.log('PASS: Reimport of same 15 creates no leads, changes no owners, notifies no one');
console.log('PASS: Duplicate phone formats and invalid records are rejected without distribution');
console.log('PASS: Existing CRM lead is skipped even with a changed or invalid sheet source');
console.log('PASS: Unrecognized source is rejected for new leads to protect marketing attribution');

// Regression: an explicit superadmin repair can only fix provably equivalent
// presentation formats, never invent a missing number or reassign a customer.
const legacyRecords = [
  { id: 'lead-good', contact_id: 'contact-good', phone: 'p:+966546670570', phone_normalized: '966546670570', primary_phone: 'p:+966546670570', primary_phone_normalized: '966546670570', customer_name: 'عميل قديم', branch_code: 'hall', assigned_name: 'المندوب الأصلي', source_name: 'سناب شات ليد' },
  { id: 'lead-bad', contact_id: 'contact-bad', phone: '966548000000', phone_normalized: '966548000000', primary_phone: '966548000000', primary_phone_normalized: '966548000000', customer_name: 'يحتاج مراجعة', branch_code: 'qadisiyah', assigned_name: 'المندوب الأصلي', source_name: 'سناب شات ليد' },
];
const touched = [];
const legacySql = (parts, ...values) => {
  const text = parts.join('?').toLowerCase();
  if (text.includes('from crm.leads l') && text.includes('l.contact_id::text')) return Promise.resolve(legacyRecords.filter((row) => row.phone !== row.phone_normalized).map((row) => ({ ...row })));
  if (text.includes('from crm.leads l') && text.includes('u.full_name as assigned_name')) return Promise.resolve(legacyRecords);
  if (text.includes('update crm.leads set phone=')) {
    const row = legacyRecords.find((lead) => lead.id === values[1]);
    if (row && row.phone === values[2] && row.phone_normalized === values[3]) {
      row.phone = values[0]; touched.push('lead.phone'); return Promise.resolve([{ id: row.id }]);
    }
    return Promise.resolve([]);
  }
  if (text.includes('update crm.contacts set primary_phone=')) {
    const row = legacyRecords.find((lead) => lead.contact_id === values[1]);
    if (row && row.primary_phone === values[2] && row.primary_phone_normalized === values[3]) {
      row.primary_phone = values[0]; touched.push('contact.primary_phone'); return Promise.resolve([{ id: row.contact_id }]);
    }
    return Promise.resolve([]);
  }
  if (text.includes('select count(*)::int as count')) return Promise.resolve([{ count: legacyRecords.filter((row) => row.phone_normalized.endsWith('00000')).length }]);
  throw new Error(`Unexpected legacy phone repair SQL: ${text.slice(0, 200)}`);
};
legacySql.begin = async (callback) => callback(legacySql);
deps['./_db.js'].getSql = () => legacySql;
const flaggedBefore = await moduleObject.exports.listPreviouslyImportedSheetPhoneIssues();
assert.equal(flaggedBefore.total, 2);
const repair = await moduleObject.exports.normalizePreviouslyImportedSheetPhones(actor);
assert.deepEqual([repair.corrected, repair.contactPhonesCorrected, repair.requiresReview, repair.suspiciousPhones], [1, 1, 0, 1]);
assert.deepEqual(touched, ['lead.phone', 'contact.primary_phone']);
assert.equal(legacyRecords[0].phone, '966546670570');
assert.equal(legacyRecords[0].phone_normalized, '966546670570');
assert.equal(legacyRecords[1].phone, '966548000000');
assert.equal(legacyRecords[1].assigned_name, 'المندوب الأصلي');
assert.equal(legacyRecords[1].branch_code, 'qadisiyah');
const flaggedAfter = await moduleObject.exports.listPreviouslyImportedSheetPhoneIssues();
assert.equal(flaggedAfter.total, 1);
assert.equal(flaggedAfter.rows[0].leadId, 'lead-bad');
assert.match(flaggedAfter.rows[0].reviewReason, /أصفار/);
console.log('PASS: Existing p:+966 repair touches only verified phone displays, never assignments or damaged digits');
console.log('PASS: Read-only CRM phone review lists only remaining malformed sheet-imported contacts');
