import { readFile } from 'node:fs/promises';

const messaging = await readFile(new URL('../server/_crm-messaging.ts', import.meta.url), 'utf8');
const schema = await readFile(new URL('../server/_crm-schema.ts', import.meta.url), 'utf8');
const admin = await readFile(new URL('../src/crm/pages/CrmAdminPage.tsx', import.meta.url), 'utf8');

const checks = [
  ['WhatsApp has one canonical send URL selector', messaging.includes('function unifiedWhatsappSendUrl')],
  ['WhatsApp templates use the canonical text/send route', messaging.includes('route === "whatsapp"') && messaging.includes('unifiedWhatsappSendUrl(endpoint)')],
  ['Legacy WhatsApp template URL is not preferred over text/send URL', messaging.includes('endpoint.text_send_url || endpoint.send_url || endpoint.template_send_url')],
  ['CRM schema normalizes old WhatsApp/Mersal endpoint rows', schema.includes("where source_code in ('whatsapp','mersal')") && schema.includes('template_send_url=coalesce')],
  ['Admin UI exposes one text-and-template send field', admin.includes('مسار إرسال النص والقوالب') && !admin.includes('مسار إرسال القالب</span>')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) process.exit(1);
