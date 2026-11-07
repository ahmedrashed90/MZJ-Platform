import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const importer = readFileSync(new URL('../server/_crm-lead-import.ts', import.meta.url), 'utf8');
const transfer = readFileSync(new URL('../server/crm/transfer.ts', import.meta.url), 'utf8');
const lifecycle = readFileSync(new URL('../server/_crm-lifecycle.ts', import.meta.url), 'utf8');
const formBridge = readFileSync(new URL('../server/marketing/lead-forms-crm.ts', import.meta.url), 'utf8');

// Original CRM records must not be reclassified merely because a second
// advertising event arrived with a different service / source.
assert.match(importer, /const shouldClassifyForDistribution = !lead \|\| \(requestNeedsFinanceDistribution && serviceKey === "finance"\);/);
assert.doesNotMatch(importer, /leadNeedsFinanceDistribution/);

// An import may enrich an existing customer's metadata, but must never touch
// status_label or status_code, even when a repeated event arrives later.
const leadUpdate = importer.match(/update crm\.leads set([\s\S]*?)where id=\$\{lead\.id\}::uuid\s+returning/);
assert.ok(leadUpdate, 'Find inbound lead update');
assert.doesNotMatch(leadUpdate[1], /status_label\s*=/);
assert.doesNotMatch(leadUpdate[1], /status_code\s*=/);
assert.match(importer, /const existedBefore = Boolean\(lead\);/);
assert.match(importer, /const shouldClassifyForDistribution/);
assert.match(importer, /event_type,new_status,new_department/);

// The only allowed existing-request reuse through the classifier preserves
// status and updates missing assignment (not opening a fresh request).
assert.match(lifecycle, /if \(existing && existingServiceKey === serviceKey\)/);
const reusedRequestBranch = lifecycle.split('if (existing && existingServiceKey === serviceKey)')[1]?.split('return { request: activeRequest')[0];
assert.ok(reusedRequestBranch);
assert.doesNotMatch(reusedRequestBranch, /status_label\s*=/);
assert.match(reusedRequestBranch, /needsPrimaryAssignment/);

// Bulk reassignment is an ownership change, never a stage reset.
const transferUpdate = transfer.match(/update crm\.leads set ([\s\S]*?)where id=any\(\$\{leadIds\}::uuid\[\]\)/);
assert.ok(transferUpdate);
assert.doesNotMatch(transferUpdate[1], /status_label\s*=/);
assert.doesNotMatch(transferUpdate[1], /status_code\s*=/);
assert.match(transfer, /'bulk_transfer',\$\{old\.status_label\},\$\{old\.status_label\}/);

// The published marketing forms use the same, protected CRM import path.
assert.match(formBridge, /processLeadImportEvent\('marketing-form', eventId, payload\)/);
console.log('PASS: existing CRM statuses survive duplicate leads and bulk reassignment');
