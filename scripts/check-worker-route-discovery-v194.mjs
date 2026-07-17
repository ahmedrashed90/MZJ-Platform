import { readFile } from 'node:fs/promises';

const messaging = await readFile(new URL('../server/_crm-messaging.ts', import.meta.url), 'utf8');
const conversations = await readFile(new URL('../server/crm/conversations.ts', import.meta.url), 'utf8');
const admin = await readFile(new URL('../src/crm/pages/CrmAdminPage.tsx', import.meta.url), 'utf8');
const worker = await readFile(new URL('../workers/MZJ-Mersal-CRM-Worker-v31-Platform-Database.txt', import.meta.url), 'utf8');

const checks = [
  ['WhatsApp uses the single configured text/template route', messaging.includes('clean(endpoint.text_send_url || endpoint.send_url)')],
  ['Legacy route fallback discovery is removed', !messaging.includes('shouldTryNextWorkerRoute') && !messaging.includes('/outbound/whatsapp/v1/text') && !messaging.includes('/send/whatsapp')],
  ['Gateway secret is added only on the server', messaging.includes('"x-mzj-gateway-secret": secretValue') && !admin.includes('x-mzj-gateway-secret')],
  ['Template payload uses the Mersal template name before external id', messaging.includes('input.template.name || input.template.external_id')],
  ['Template payload sends both params and components', messaging.includes('params,') && messaging.includes('components: params.length')],
  ['Failed send response exposes the exact worker route', conversations.includes('workerAttempts') && conversations.includes('workerRoute')],
  ['Admin still exposes one WhatsApp text-and-template send field', admin.includes('مسار إرسال النص والقوالب') && !admin.includes('مسار إرسال القالب</span>')],
  ['Mersal worker writes inbound events to the unified platform', worker.includes('MZJ_PLATFORM_INBOUND_URL') && worker.includes('/api/integrations/whatsapp')],
  ['Mersal worker contains no Firebase persistence', !worker.includes('firestoreClient(') && !worker.includes('wa_conversations/')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) process.exit(1);
