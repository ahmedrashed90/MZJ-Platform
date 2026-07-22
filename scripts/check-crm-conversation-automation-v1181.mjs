import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const admin = read("src/crm/pages/CrmAdminPage.tsx");
const ui = read("src/crm/components/CrmConversationAutomationSettings.tsx");
const entryUi = read("src/crm/components/CrmEntryRoutingSettings.tsx");
const api = read("server/crm/conversation-automation.ts");
const entryApi = read("server/crm/entry-routing.ts");
const engine = read("server/_crm-conversation-flow.ts");
const legacy = read("server/_crm-automation.ts");
const integration = read("server/_integration-processor.ts");
const migration = read("database/migrations/20260723_crm_conversation_automation_v1181.sql");
const router = read("api/index.ts");
const styles = read("src/styles.css");
const baselineSchema = read("server/_crm-schema.ts");

const requireTokens = (source, tokens, label) => {
  for (const token of tokens) if (!source.includes(token)) throw new Error(`${label}: missing ${token}`);
};
const forbidTokens = (source, tokens, label) => {
  for (const token of tokens) if (source.includes(token)) throw new Error(`${label}: forbidden ${token}`);
};

requireTokens(admin, ['key: "conversation_automation"', 'label: "إعدادات الأوتوميشن"', '<CrmConversationAutomationSettings />'], "admin tab");
requireTokens(ui, [
  '/api/crm/conversation-automation',
  'الحالة والسياسة',
  'المنصات والـWorkers',
  'رسائل البداية',
  'الاختيارات والفلو',
  'الجلسات والسجل',
  'إضافة رد مقبول',
  'إضافة خطوة',
  'رسالة النهاية',
  'إعداد قاعدة البيانات مطلوب',
  'معاينة بداية المحادثة',
], "automation UI");
requireTokens(styles, ['/* CRM conversation automation */', '.crm-automation-flow-layout', '.crm-automation-summary', '.crm-automation-load-error', '.crm-automation-phone-preview'], "automation styles");
requireTokens(entryUi, ['إعدادات الأوتوميشن هي المصدر الوحيد', 'محرك التوزيع المركزي', 'لا يوجد حفظ لإعدادات فلو قديمة'], "entry boundary UI");
requireTokens(entryApi, ['ENTRY_AUTOMATION_MOVED', 'conversation-automation'], "entry boundary API");

requireTokens(api, [
  'getCrmConversationAutomationSchemaStatus',
  'CRM_CONVERSATION_AUTOMATION_MIGRATION_REQUIRED',
  'crm.conversation_automation_settings',
  'crm.conversation_automation_platforms',
  'crm.conversation_automation_start_messages',
  'crm.conversation_automation_flows',
  'crm.conversation_automation_flow_steps',
  'crm.conversation_automation_sessions',
], "automation API");
requireTokens(engine, [
  'processCrmConversationFlowEvent',
  'pg_advisory_xact_lock',
  'crm.conversation_automation_inbound_events',
  'crm.conversation_automation_outbound_messages',
  'crm.conversation_automation_final_actions',
  'classifyConversationService',
  'assignCallCenter',
  'awaitProvider: true',
  'automation_migration_required',
], "automation engine");
forbidTokens(engine, ['create table', 'alter table', 'drop table'], "runtime schema mutation");
requireTokens(legacy, ['conversation_automation_is_the_single_entry_flow', 'scheduleInboxAgent', 'cancelInboxAgent'], "legacy automation separation");
forbidTokens(legacy, ['sendServiceSelection', 'classifyFromMessage'], "parallel entry flow");
requireTokens(integration, ['processCrmConversationFlowEvent', 'conversationAutomationSource', 'entryAutomationHandled'], "integration processor");
requireTokens(router, ['["crm/conversation-automation", crmConversationAutomationHandler]', 'version: "1.18.1"'], "API router");

requireTokens(migration, [
  'create table if not exists crm.conversation_automation_settings',
  'create table if not exists crm.conversation_automation_sessions',
  'crm-conversation-automation-v1.18.1',
  'مرحباً بك في مجموعة محمد بن ذعار العجمي للسيارات 👋',
  'تم تحويل طلبك إلى قسم مبيعات الكاش ✅',
  'برجاء إدخال بيانات التمويل 👇',
  'سيتم التواصل معك في أقرب وقت',
  'سيتم التواصل معك قريباً من أحد ممثلي قسم خدمة العملاء 👨‍🔧',
  "insert into crm.conversation_automation_flow_aliases",
], "migration");
forbidTokens(migration, [
  'drop table if exists crm.automation_events',
  'drop table if exists crm.automation_jobs',
], "migration isolation");
requireTokens(migration, [
  'drop column if exists service_selection_enabled',
  'drop column if exists service_selection_message',
  'drop column if exists service_options',
  'drop column if exists ask_for_branch',
  'drop column if exists no_match_behavior',
  'drop column if exists unclassified_label',
], "legacy entry-flow cleanup");
forbidTokens(baselineSchema, [
  'service_selection_enabled',
  'service_selection_message',
  'service_options jsonb',
  'ask_for_branch',
  'no_match_behavior',
  'unclassified_label',
], "baseline schema entry-flow cleanup");

console.log("CRM conversation automation v1.18.1 clean rebuild checks passed.");
