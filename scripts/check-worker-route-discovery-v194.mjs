import { readFile } from 'node:fs/promises';

const messaging = await readFile(new URL('../server/_crm-messaging.ts', import.meta.url), 'utf8');
const admin = await readFile(new URL('../src/crm/pages/CrmAdminPage.tsx', import.meta.url), 'utf8');

const checks = [
  ['WhatsApp text uses the configured canonical worker route', messaging.includes('function unifiedWhatsappSendUrl') && messaging.includes('endpoint.text_send_url || endpoint.send_url || endpoint.template_send_url') && !messaging.includes('/outbound/whatsapp/v1/') && !messaging.includes('/send/whatsapp')],
  ['WhatsApp media may use its dedicated configured worker route', messaging.includes('endpoint.media_send_url || unifiedWhatsappSendUrl(endpoint)')],
  ['Worker delivery has no route fallback loop', !messaging.includes('shouldTryNextWorkerRoute')],
  ['Template payload sends both params and components', messaging.includes('params,') && messaging.includes('components: params.length')],
  ['Mersal template name is preferred over provider numeric id', messaging.includes('input.template.name || input.template.external_id')],
  ['UI request returns queued while Vercel finishes the provider call in the background', messaging.includes('waitUntil(finishWorkerDelivery(input))') && messaging.includes('providerStatus: "queued"')],
  ['Worker result is stored directly by the background platform task', messaging.includes('providerConfirmedAt') && messaging.includes('update integrations.outbound_jobs set')],
  ['Admin exposes separate text/template and attachment worker route fields', admin.includes('مسار إرسال النص والقوالب') && admin.includes('مسار إرسال المرفقات')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
if (failed.length) process.exit(1);
