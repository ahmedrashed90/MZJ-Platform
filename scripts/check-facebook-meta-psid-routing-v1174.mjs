import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const processor = fs.readFileSync(path.join(root, 'server/_integration-processor.ts'), 'utf8');

const required = [
  'metaExactServiceSelection',
  'resolveCanonicalConversationByPhone',
  'Canonical Facebook conversation was not found for the verified finance phone',
  'pending_finance_phone_received',
  "'awaiting_details'",
  "العميل اختار مبيعات التمويل ويستكمل البيانات",
  'pendingServiceKey: "finance"',
  'suppressMessagePersistence',
  'financeDataCompletion',
  'manychat_finance_data_completion',
  '"service.selection"',
  "service_key='finance',department_code=null",
  'recordOwnershipEvent',
  'ManyChat Contact ID is required as an alias unless the exact selection came from Meta with the real PSID',
];
for (const token of required) {
  if (!processor.includes(token)) throw new Error(`Missing Facebook v1.17.4 routing token: ${token}`);
}

if (processor.includes('findByName')) throw new Error('Name matching must not be introduced in the PostgreSQL integration processor');
if (!processor.includes('const externalId = participant || (source === "facebook" ? manychatContactId : "")')) {
  throw new Error('ManyChat alias must remain separate from the canonical Facebook participant');
}
if (!processor.includes('pendingSelectionState?.service_key === "finance" && Boolean(identity.phoneNormalized)')) {
  throw new Error('Pending finance must complete only with a normalized phone on the canonical Facebook contact');
}

console.log('facebook meta PSID routing v1.17.4 check passed');
