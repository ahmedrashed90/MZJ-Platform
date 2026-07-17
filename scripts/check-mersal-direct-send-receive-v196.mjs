import { readFile } from "node:fs/promises";

const messaging = await readFile(new URL("../server/_crm-messaging.ts", import.meta.url), "utf8");
const conversations = await readFile(new URL("../server/crm/conversations.ts", import.meta.url), "utf8");
const processor = await readFile(new URL("../server/_integration-processor.ts", import.meta.url), "utf8");

const checks = [
  ["WhatsApp text and templates use one configured send URL", messaging.includes('clean(endpoint.text_send_url || endpoint.send_url)')],
  ["No WhatsApp route discovery fallbacks remain", !messaging.includes('/outbound/whatsapp/v1/text') && !messaging.includes('/send/whatsapp') && !messaging.includes('shouldTryNextWorkerRoute')],
  ["Mersal template sends its real name, not external numeric id", messaging.includes('const templateName = clean(input.template.name)') && !messaging.includes('input.template.external_id || input.template.name')],
  ["Template payload matches CRM reference shape", messaging.includes('template_name: templateName') && messaging.includes('params: extractNumberedTemplateParams') && !messaging.includes('components: params.length')],
  ["Free text payload contains message and text", messaging.includes('return { ...base, message: input.text, text: input.text }')],
  ["WhatsApp conversation identity is the normalized phone", messaging.includes('conversationId: phone, convId: phone') && conversations.includes('const whatsappId = normalizePhone')],
  ["Inbound WhatsApp reuses the existing lead conversation by phone", processor.includes("l.phone_normalized=${identity.phoneNormalized}") && processor.includes("ct.primary_phone_normalized=${identity.phoneNormalized}")],
  ["Customer reply enables free text", messaging.includes('العميل رد داخل المحادثة؛ النص الحر متاح عبر واتساب')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
if (failed.length) process.exit(1);
