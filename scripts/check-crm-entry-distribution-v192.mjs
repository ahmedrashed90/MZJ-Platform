import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const app = read("src/App.tsx");
const layout = read("src/crm/CrmLayout.tsx");
const admin = read("src/crm/pages/CrmAdminPage.tsx");
const entrySettings = read("src/crm/components/CrmEntryRoutingSettings.tsx");
const drawer = read("src/crm/components/LeadDrawer.tsx");
const styles = read("src/styles.css");
const schema = read("server/_crm-schema.ts");
const engine = read("server/_crm-automation.ts");
const entryApi = read("server/crm/entry-routing.ts");
const settingsApi = read("server/crm/settings.ts");
const messaging = read("server/_crm-messaging.ts");
const conversations = read("server/crm/conversations.ts");
const api = read("api/index.ts");
const vercel = read("vercel.json");
const scheduler = read("workers/MZJ-Automation-Scheduler-Worker-v1.0.0-FULL.txt");

for (const token of [
  'key: "entry_routing"',
  'label: "دخول وتوزيع العملاء"',
  'مسار إرسال النص والقوالب',
  'textSendUrl: endpointForm.sendUrl',
  'templateSendUrl: endpointForm.sendUrl',
]) {
  if (!admin.includes(token)) throw new Error(`CRM settings v1.9.2 check failed: missing ${token}`);
}

for (const token of [
  '/api/crm/entry-routing',
  'رسالة اختيار الخدمة',
  'العميل الموجود وله طلب مفتوح',
  'العميل الجديد أو الطلب السابق المغلق',
  'حدود التشغيل',
]) {
  if (!entrySettings.includes(token)) throw new Error(`Entry routing settings check failed: missing ${token}`);
}

for (const forbidden of [
  'CrmAutomationsPage',
  '/crm/automations',
  'الشروط JSON',
  'الإجراءات JSON',
  'إضافة قاعدة',
]) {
  if (app.includes(forbidden) || layout.includes(forbidden) || admin.includes(forbidden) || entrySettings.includes(forbidden)) {
    throw new Error(`Generic automation UI must be removed: found ${forbidden}`);
  }
}

for (const token of [
  'function isOutboundMessage',
  'isOutboundMessage(message) ? "out" : "in"',
  'event.key === "Escape"',
  'mappedTemplate',
  'renderTemplateInComposer',
  'rows={9}',
]) {
  if (!drawer.includes(token)) throw new Error(`Customer workspace check failed: missing ${token}`);
}
if (drawer.includes('اختر قالب واتساب')) throw new Error('Manual WhatsApp template selector must not exist in the composer');

for (const token of [
  '.crm-message.in { align-self: flex-start',
  '.crm-message.out { align-self: flex-end',
  '.crm-customer-workspace { width: 100vw; height: 100vh',
  '.crm-message-composer textarea { min-height: 168px',
]) {
  if (!styles.includes(token)) throw new Error(`Chat layout check failed: missing ${token}`);
}
for (const forbidden of ['.crm-rule-editor', '.crm-rules-toolbar', '.crm-automation-rule']) {
  if (styles.includes(forbidden)) throw new Error(`Obsolete generic automation style remains: ${forbidden}`);
}

for (const token of [
  'sendServiceSelection',
  'classifyFromMessage',
  'context.conversation?.hasOpenRequest',
  'classificationState === "awaiting_service"',
  'event_outside_entry_distribution_scope',
  'scheduleInboxAgent',
  'cancelInboxAgent',
]) {
  if (!engine.includes(token)) throw new Error(`Deterministic entry engine check failed: missing ${token}`);
}
for (const forbidden of ['automation_rules', 'executeRule', 'evaluateCondition', 'previewAutomationRule']) {
  if (engine.includes(forbidden)) throw new Error(`Generic rule engine remains active: ${forbidden}`);
}

for (const token of [
  'crm.automation_settings',
  'crm.automation_events',
  'crm.automation_jobs',
  "drop table if exists crm.automation_runs",
  "drop table if exists crm.automation_rules",
  'crm-entry-distribution-v1.9.2',
]) {
  if (!schema.includes(token)) throw new Error(`CRM schema v1.9.2 check failed: missing ${token}`);
}
if (schema.includes('create table if not exists crm.automation_rules') || schema.includes('create table if not exists crm.automation_runs')) {
  throw new Error('Generic rule tables must not be created');
}

for (const token of ['section !== "entry_routing"', 'service_selection_message', 'service_options', 'ask_for_branch=false']) {
  if (!entryApi.includes(token)) throw new Error(`Entry routing API check failed: missing ${token}`);
}
if (entryApi.includes('conditions') || entryApi.includes('actions_json') || entryApi.includes('automation_rules')) {
  throw new Error('Entry routing API must not expose generic rule JSON');
}

for (const token of [
  'template_send_url || endpoint.text_send_url || endpoint.send_url',
  'template_name',
  'template_language',
  'message: input.text',
]) {
  if (!messaging.includes(token)) throw new Error(`Mersal payload check failed: missing ${token}`);
}
if (!settingsApi.includes('const isWhatsapp = sourceCode === "whatsapp"') || !settingsApi.includes('const templateSendUrl = isWhatsapp ? textSendUrl : clean(body.templateSendUrl)')) throw new Error('WhatsApp must use the single exact send URL');
if (!conversations.includes('استكمل متغيرات القالب')) throw new Error('Template variables must be validated before manual send');

for (const token of ['["crm/entry-routing", crmEntryRoutingHandler]', '["internal/automation-job", internalAutomationJobHandler]']) {
  if (!api.includes(token)) throw new Error(`API router check failed: missing ${token}`);
}
if (api.includes('["crm/automations"')) throw new Error('Obsolete crm/automations API route remains');
if (vercel.includes('"crons"') || vercel.includes('* * * * *')) throw new Error('Vercel Cron must not be used');
for (const token of ['AUTOMATION_QUEUE', '/schedule', 'PLATFORM_AUTOMATION_CALLBACK_URL', 'delaySeconds']) {
  if (!scheduler.includes(token)) throw new Error(`Scheduler Worker check failed: missing ${token}`);
}

console.log('CRM v1.9.2 entry/distribution-only flow, full-screen chat, mapped templates, and shared Mersal send endpoint checks passed.');
