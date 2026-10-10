import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server/marketing/index.ts', import.meta.url), 'utf8');
const schema = fs.readFileSync(new URL('../server/_marketing-schema.ts', import.meta.url), 'utf8');

const checks = [
  ['schema persists per-entity sequence state', schema.includes('create table if not exists marketing.entity_sequences') && schema.includes('primary key(source_type,source_id)')],
  ['creative allocation considers current instance codes', server.includes("substring(c.instance_code from '([0-9]+)$')")],
  ['creative allocation considers previously deleted instance codes from audit', server.includes("a.action='creative_deleted'") && server.includes("a.after_data->>'instanceCode'")],
  ['creative allocation is atomic through ON CONFLICT state advancement', server.includes('on conflict(source_type,source_id) do update set') && server.includes('next_creative_index=greatest(marketing.entity_sequences.next_creative_index,${observed}) + 1')],
  ['task template batch allocation is monotonic and persisted', server.includes('async function allocateTaskBatch') && server.includes('next_task_batch=greatest(marketing.entity_sequences.next_task_batch,${observed}) + 1')],
  ['task number generation uses the allocated task batch', server.includes('_TPL_${taskBatch}_${templateIndex}')],
  ['database creative add no longer uses creative COUNT + 1', !server.includes("select count(*)::int + 1 as value from marketing.creatives where (${sourceType}='campaign'")],
  ['creative revision no longer uses task-template COUNT + 1000', !server.includes('select count(*)::int + 1000 as value from marketing.task_templates')],
  ['campaign creative creation uses monotonic allocator', server.includes('const creativeIndex = await allocateCreativeIndex(tx, "campaign", campaign.id);')],
  ['agenda creative creation uses monotonic allocator', server.includes('const creativeIndex = await allocateCreativeIndex(tx, "agenda", agenda.id);')],
  ['database creative creation uses monotonic allocator', server.includes('creativeIndex = await allocateCreativeIndex(tx, sourceType, sourceId);')],
  ['existing task_no unique constraint remains intact', schema.includes('task_no text not null unique')],
];

let passed = 0;
for (const [label, ok] of checks) {
  if (ok) { console.log(`PASS: ${label}`); passed += 1; }
  else console.error(`FAIL: ${label}`);
}
console.log(`Marketing creative monotonic sequence v38 checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
