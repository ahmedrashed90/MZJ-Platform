import { readFile } from 'node:fs/promises';

const messaging = await readFile(new URL('../server/_crm-messaging.ts', import.meta.url), 'utf8');
const direct = await readFile(new URL('../src/crm/mersalDirect.ts', import.meta.url), 'utf8');
const conversations = await readFile(new URL('../server/crm/conversations.ts', import.meta.url), 'utf8');
const admin = await readFile(new URL('../src/crm/pages/CrmAdminPage.tsx', import.meta.url), 'utf8');

const checks = [
  ['WhatsApp uses the single configured send URL', messaging.includes('endpoint.send_url || endpoint.text_send_url') && direct.includes('endpoint?.send_url || endpoint?.text_send_url')],
  ['No guessed WhatsApp fallback routes remain', !messaging.includes('/outbound/whatsapp/v1/') && !messaging.includes('/send/whatsapp')],
  ['Direct Mersal send uses one POST request', direct.includes('await fetch(workerUrl') && direct.includes('method: "POST"')],
  ['Template payload uses the Mersal template name before numeric external id', direct.includes('input.template.name || input.template.external_id') && messaging.includes('input.template.name || input.template.external_id')],
  ['Template payload sends params', direct.includes('template_name: templateName') && direct.includes('params,')],
  ['Successful direct delivery is persisted without sending twice', conversations.includes('providerDelivered === true') && conversations.includes('recordDeliveredCrmMessage')],
  ['Admin still exposes one WhatsApp text-and-template send field', admin.includes('مسار إرسال النص والقوالب') && !admin.includes('مسار إرسال القالب</span>')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) process.exit(1);
