import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server/marketing/index.ts', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../src/marketing/pages/MarketingDatabasePage.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/marketing/marketing.css', import.meta.url), 'utf8');

const checks = [
  ['creative edit snapshot does not use ambiguous ORDER BY output aliases', !server.includes('select distinct on (content_user_id) *,id::text,content_user_id::text,file_id::text')],
  ['creative edit snapshot qualifies and explicitly selects task template fields', server.includes('select distinct on (tt.content_user_id)') && server.includes('order by tt.content_user_id,tt.created_at desc,tt.id desc')],
  ['server exposes a dedicated creative delete action', server.includes("action==='delete_entity_creative'") && server.includes('async function deleteEntityCreative')],
  ['creative delete is scoped to the selected campaign or agenda', server.includes("c.campaign_id=${sourceId}::uuid") && server.includes("c.agenda_id=${sourceId}::uuid")],
  ['published creative deletion is blocked', server.includes('لا يمكن مسح كرييتيف تم نشره بالفعل')],
  ['creative delete cleans/reassigns affected campaign budget items', server.includes('affectedBudgets') && server.includes('delete from marketing.budget_items') && server.includes('set creative_id=${remaining.creative_id}::uuid')],
  ['database page shows an explicit creative delete button', page.includes('marketing-creative-delete-button') && page.includes('delete_entity_creative')],
  ['database page requires confirmation before deleting a creative', page.includes('تأكيد مسح الكرييتيف')],
  ['database delete refreshes the selected record and list', page.includes('await open(selected);') && page.includes('await load();')],
  ['creative delete button has dedicated styling', css.includes('.marketing-creative-delete-button') && css.includes('.marketing-creative-row-actions')],
];

let passed = 0;
for (const [label, ok] of checks) {
  if (ok) {
    console.log(`PASS: ${label}`);
    passed += 1;
  } else {
    console.error(`FAIL: ${label}`);
  }
}
console.log(`Marketing creative edit/delete checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exit(1);
