import { readFile } from 'node:fs/promises';

const messaging = await readFile(new URL('../server/_crm-messaging.ts', import.meta.url), 'utf8');
const conversations = await readFile(new URL('../server/crm/conversations.ts', import.meta.url), 'utf8');
const admin = await readFile(new URL('../src/crm/pages/CrmAdminPage.tsx', import.meta.url), 'utf8');

const checks = [
  ['WhatsApp route candidates include the actual legacy Mersal route', messaging.includes('"/send/mersal"')],
  ['WhatsApp route candidates include transport gateway v2 routes', messaging.includes('"/outbound/whatsapp/v1/template"') && messaging.includes('"/outbound/whatsapp/v1/text"') && messaging.includes('"/outbound/whatsapp/v1/media"')],
  ['WhatsApp route candidates include the multi-channel gateway route', messaging.includes('"/send/whatsapp"')],
  ['Fallback only continues for missing or unsupported routes', messaging.includes('shouldTryNextWorkerRoute') && messaging.includes('status === 404') && messaging.includes('status === 405')],
  ['Template payload sends both params and components', messaging.includes('params,') && messaging.includes('components: params.length')],
  ['Failed send response exposes attempted worker routes', conversations.includes('workerAttempts') && conversations.includes('workerRoute')],
  ['Admin still exposes one WhatsApp text-and-template send field', admin.includes('مسار إرسال النص والقوالب') && !admin.includes('مسار إرسال القالب</span>')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) process.exit(1);
