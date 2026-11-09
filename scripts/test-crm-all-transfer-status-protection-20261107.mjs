import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const lifecycle = read('server/_crm-lifecycle.ts');
const server = read('server/crm/leads.ts');
const ui = read('src/crm/components/LeadDrawer.tsx');
const social = read('server/_marketing-engagement.ts');
const importer = read('server/_crm-lead-import.ts');

// Service selection creates new request state without overwriting the lead's
// previous status and source. An automated ad is not a deliberate transfer.
const transactionalUpdate = lifecycle.split('update crm.leads set contact_id=${conversation.contact_id}::uuid,current_request_id=${createdRequest.id}')[1]?.split('where id=${lead.id}::uuid and is_deleted=false')[0];
assert.ok(transactionalUpdate, 'Find the core lead update in the reclassification transaction');
assert.doesNotMatch(transactionalUpdate, /\bstatus_label\s*=|\bstatus_code\s*=/);
assert.match(transactionalUpdate, /source_code=coalesce\(nullif\(source_code,''\),\$\{sourceCode\}\)/);
assert.match(transactionalUpdate, /source_name=coalesce\(nullif\(source_name,''\),\$\{originalSource \?/);
assert.match(lifecycle, /service_request_created',\$\{customerStatus\}/);
assert.match(lifecycle, /service_request_reclassified',\$\{customerStatus\},\$\{customerStatus\}/);
assert.match(lifecycle, /\$\{branchCode\},'عميل جديد','open'/);
assert.match(lifecycle, /customerStatusPreserved: true/);
assert.match(lifecycle, /sql\.begin\(async \(tx\) =>/);
assert.match(lifecycle, /withDatabaseAdvisoryLock\(`mzj:crm:service-classification:\$\{conversation\.contact_id\}`/);
assert.match(lifecycle, /const explicitServiceChange = \["customer_service_selection", "automation_flow", "manual"\]/);
assert.match(lifecycle, /if \(existing && existingServiceKey !== serviceKey && !explicitServiceChange\)/);
console.log('PASS: lifecycle preserves lead status/source and prevents implicit reclassification, with atomic request writes');

// The manual transfer handler and both customer-drawer options previously
// changed the lead status to new solely because the department changed.
const manualTransfer = server.match(/if \(departmentChanged\) \{([\s\S]*?)\} else if \(databaseEdit/);
assert.ok(manualTransfer);
assert.match(manualTransfer[1], /input\.statusLabel = clean\(before\.status_label\)/);
assert.match(manualTransfer[1], /input\.statusCode = clean\(before\.status_code\)/);
assert.match(manualTransfer[1], /if \(!databaseEdit\)/);
assert.doesNotMatch(manualTransfer[1], /input\.statusLabel\s*=\s*["']عميل جديد["']/);
assert.match(server, /const statusChangeRequested = previousStatusLabel !== input\.statusLabel/);
const workspaceTransfer = ui.match(/function changeDepartmentState\([\s\S]*?\n  \}/)?.[0];
const databaseTransfer = ui.match(/function changeDatabaseDepartment\([\s\S]*?\n  \}/)?.[0];
assert.ok(workspaceTransfer && databaseTransfer);
assert.match(workspaceTransfer, /status_label: current\.values\.status_label/);
assert.match(databaseTransfer, /status_label: current\.values\.status_label/);
assert.doesNotMatch(workspaceTransfer, /status_label:\s*["']عميل جديد["']/);
assert.doesNotMatch(databaseTransfer, /status_label:.*\?\s*["']عميل جديد["']/);
assert.match(ui, /currentValue && !statuses\.some\(\(status\) => status\.value === currentValue\)/);
console.log('PASS: manual transfer and both customer editors keep the current status, even when absent from the new department');

// Post interactions and repeat imports must never replace an original source.
assert.match(social, /source_code=coalesce\(nullif\(source_code,''\),\$\{source\.code\}\)/);
assert.match(social, /source_name=coalesce\(nullif\(source_name,''\),\$\{originalSource \?/);
assert.match(social, /source_history=\$\{sql\.json\(updatedHistory\)\}/);
assert.match(social, /return \{ leadId, reused: Boolean\(existingCustomer \|\| classification\.reused\) \}/);
assert.match(importer, /const shouldClassifyForDistribution = !lead/);
console.log('PASS: social engagement and imported leads preserve original source and do not treat existing contacts as new');
