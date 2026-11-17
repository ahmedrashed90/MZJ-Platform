import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../server/crm/manual-leads.ts', import.meta.url), 'utf8');
const approval = source.split('const outcome = await sql.begin(async (tx) => {')[1]?.split('if ("error" in outcome)')[0];
assert.ok(approval, 'Approval must be transactional');
assert.match(approval, /approval_status='pending'\s*for update/, 'Pending request must be locked');
assert.match(approval, /crm\.leads where id=\$\{targetId\}::uuid and is_deleted=false for update/, 'Canonical lead must be locked');
assert.match(approval, /lead\.phone_normalized !== pending\.phone_normalized/, 'Phone must match canonical lead');
assert.match(approval, /u\.is_active=true/, 'New agent must be active');
assert.match(approval, /ub\.is_primary desc/, 'Primary branch must be preferred');
assert.match(approval, /agent\.branch_code === lead\.branch_code \? lead\.branch_code : agent\.branch_code/, 'Branch must follow new agent');
const update = approval.match(/update crm\.leads set ([\s\S]*?)\s+where id=\$\{targetId\}/)?.[1];
assert.ok(update, 'Lead update must exist');
for (const field of ['customer_name','phone','phone_normalized','service_key','department_code','status_label','payment_type','car_name','car_category','car_model','notes','source_history','registered_at','location']) {
  assert.doesNotMatch(update, new RegExp(`\\b${field}\\s*=`), `${field} must remain untouched during transfer`);
}
assert.match(update, /assigned_to=/);
assert.match(update, /branch_code=/);
assert.match(approval, /approval_status='approved'/);
assert.match(approval, /insert into crm\.lead_events/);
assert.match(source, /row\.approval_status === "approved" && row\.created_lead_id/, 'Approved requests cannot edit existing leads');
console.log('PASS: manual duplicate transfer protects customer data and approval is atomic');
