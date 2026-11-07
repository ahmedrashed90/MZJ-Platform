import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const importer = readFileSync(new URL('../server/_crm-lead-import.ts', import.meta.url), 'utf8');
const transfer = readFileSync(new URL('../server/crm/transfer.ts', import.meta.url), 'utf8');
const lifecycle = readFileSync(new URL('../server/_crm-lifecycle.ts', import.meta.url), 'utf8');
const formBridge = readFileSync(new URL('../server/marketing/lead-forms-crm.ts', import.meta.url), 'utf8');

// All imported sources serialize by the SAME normalized nine-digit key before
// creating an identity or looking up the existing lead.
assert.match(importer, /withDatabaseAdvisoryLock\(`mzj:crm:lead-import:\$\{phoneKey\}`/);
assert.ok(importer.indexOf('const phoneKey = data.phoneNormalized.slice(-9);') < importer.indexOf('ensureContactIdentity({'));

// Repeated lead imports NEVER classify or auto-complete an existing finance
// request's missing owner, even if the new form has a different purchase type.
assert.match(importer, /const shouldClassifyForDistribution = !lead;/);
assert.doesNotMatch(importer, /requestNeedsFinanceDistribution/);

// Existing lead updates are provenance-only; operational details and primary
// source belong to the first lead record, not to the newest advertising event.
const existingUpdate = importer.match(/if \(existedBefore\)\s*\{\s*\/\/ A repeated lead[\s\S]*?update crm\.leads set([\s\S]*?)where id=\$\{lead\.id\}::uuid and is_deleted=false/);
assert.ok(existingUpdate, 'Find the existing-lead provenance-only update');
assert.match(existingUpdate[1], /source_history\s*=/);
assert.match(existingUpdate[1], /extra_data\s*=/);
for (const field of ['status_label','status_code','source_code','source_name','platform_code','assigned_to','call_center_assigned_to','current_request_id','service_key','department_code','branch_code','phone','customer_name','payment_type']) {
  assert.doesNotMatch(existingUpdate[1], new RegExp(`\\b${field}\\s*=`), `${field} must never change for a returning customer`);
}
const newLeadUpdate = importer.split('// Only a genuinely new customer receives the imported source and details.')[1];
assert.match(newLeadUpdate, /source_code=\$\{sourceCode\}/);
assert.doesNotMatch(newLeadUpdate.split('where id=${lead.id}')[0], /status_label\s*=|status_code\s*=/);

// Conversation metadata can record an import without reassigning the owner or
// overwriting a linked service request.
const existingConversation = importer.split('// Existing conversations retain their customer/request links')[1]?.split('  const existingExtraData')[0];
assert.ok(existingConversation);
for (const field of ['assigned_to','call_center_assigned_to','department_code','branch_code','service_key','classification_state']) {
  assert.doesNotMatch(existingConversation, new RegExp(`\\b${field}\\s*=`));
}
assert.match(existingConversation, /service_request_id=coalesce\(service_request_id,/);

const transferUpdate = transfer.match(/update crm\.leads set ([\s\S]*?)where id=any\(\$\{leadIds\}::uuid\[\]\)/);
assert.ok(transferUpdate);
assert.doesNotMatch(transferUpdate[1], /status_label\s*=|status_code\s*=/);
assert.match(transfer, /'bulk_transfer',\$\{old\.status_label\},\$\{old\.status_label\}/);

// The publishing form keeps its duplicate fast path and, on a cross-channel
// race, trusts the locked processor's existedBefore result.
assert.match(formBridge, /processLeadImportEvent\('marketing-form', eventId, payload\)/);
assert.match(formBridge, /const crmStatus = result\.existedBefore \? 'existing' : 'linked';/);
assert.match(lifecycle, /if \(existing && existingServiceKey === serviceKey\)/);
console.log('PASS: repeat lead import preserves state, source, ownership and request; phone lock covers all import sources');
