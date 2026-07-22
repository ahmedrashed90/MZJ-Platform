import fs from "node:fs";
import { execFileSync } from "node:child_process";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const expectAll = (label, text, tokens) => {
  for (const token of tokens) if (!text.includes(token)) throw new Error(`${label}: missing ${token}`);
};
const forbidAll = (label, text, tokens) => {
  for (const token of tokens) if (text.includes(token)) throw new Error(`${label}: forbidden ${token}`);
};

const migration = read("database/migrations/20260722_crm_automation_flow_v1180.sql");
const schema = read("server/_crm-schema.ts");
const engine = read("server/_crm-conversation-automation.ts");
const lifecycle = read("server/_crm-lifecycle.ts");
const utils = read("server/_crm-utils.ts");
const processor = read("server/_integration-processor.ts");
const legacy = read("server/_crm-automation.ts");
const settingsApi = read("server/crm/automation-settings.ts");
const entryApi = read("server/crm/entry-routing.ts");
const ui = read("src/crm/components/CrmAutomationSettings.tsx");
const entryUi = read("src/crm/components/CrmEntryRoutingSettings.tsx");
const admin = read("src/crm/pages/CrmAdminPage.tsx");
const messaging = read("server/_crm-messaging.ts");
const worker = read("facebook-worker/src/index.js");
const api = read("api/index.ts");

expectAll("migration", migration, [
  "crm.automation_platforms",
  "crm.automation_start_messages",
  "crm.automation_flows",
  "crm.automation_flow_aliases",
  "crm.automation_flow_steps",
  "crm.automation_sessions",
  "crm.automation_inbound_events",
  "crm.automation_answers",
  "crm.automation_outbound_messages",
  "crm.automation_final_actions",
  "crm_automation_sessions_one_active_conversation_idx",
  "crm_automation_sessions_one_active_contact_idx",
  "crm-conversation-automation-v1.18.0",
  "v.max_attempts::integer",
  "تم تحويل طلبك إلى قسم مبيعات الكاش ✅\\nسيتم التواصل معك قريباً",
  "برجاء إدخال بيانات التمويل 👇\\nالاسم",
  "سيتم التواصل معك في أقرب وقت\\nنسعد بخدمتكم دائمًا 🌹",
  "سيتم التواصل معك قريباً من أحد ممثلي قسم خدمة العملاء 👨‍🔧",
]);
forbidAll("migration duplicate alias seeds", migration, [
  "('cash','text','مبيعات الكاش','مبيعات الكاش')",
  "('finance','text','مبيعات التمويل','مبيعات التمويل')",
  "('service','text','خدمة العملاء','خدمة العملاء')",
]);
expectAll("embedded migration", schema, ["CRM_CONVERSATION_AUTOMATION_V1180_SQL", "crm-conversation-automation-v1.18.0"]);
const embeddedMigration = schema.match(/const CRM_CONVERSATION_AUTOMATION_V1180_SQL = String\.raw`([\s\S]*?)`;\n/)?.[1]?.trim();
if (!embeddedMigration || embeddedMigration !== migration.trim()) throw new Error("Embedded automation migration differs from the deployment migration");

expectAll("automation engine", engine, [
  "pg_advisory_xact_lock",
  "trigger_policy_cooldown",
  "automation_inbound_events",
  "automation_outbound_messages",
  "automation_final_actions",
  "awaitProvider: true",
  "moveToNextInteractiveStep",
  "allowedValues",
  "max_attempts",
  "ksaMobile",
  "const assignCallCenter = flow.service_key === \"finance\"",
  "suppressAutomaticTemplate: true",
  "db: tx",
  "retryableFailedFinalSession",
  "retriedFailedQuestion",
  "assignmentState",
]);
expectAll("lifecycle transaction reuse", lifecycle, [
  "db?: any",
  "const sql = input.db || getSql()",
  "assignPrimary?: boolean",
  "assignCallCenter?: boolean",
  "suppressAutomaticTemplate?: boolean",
  "suppressed_by_conversation_automation",
]);
expectAll("assignment transaction reuse", utils, [
  "chooseAssignment(serviceKey: string, requestedBranch = \"\", sourceCode = \"\", db?: any)",
  "chooseCallCenterAssignment(sourceCode = \"\", requestedBranch = \"online\", db?: any)",
]);
expectAll("inbound integration", processor, [
  "processConversationAutomationEvent",
  "entryAutomationHandled: conversationFlow?.handled === true",
  "conversationAutomationSource",
]);
expectAll("legacy separation", legacy, [
  "conversation_automation_is_the_single_entry_flow",
  "scheduleInboxAgent",
  "cancelInboxAgent",
]);
forbidAll("legacy entry flow", legacy, ["sendServiceSelection", "classifyFromMessage", "detectServiceChoice"]);

expectAll("settings API", settingsApi, [
  "isCrmManager(user)",
  'section === "general"',
  'section === "platform"',
  'section === "platform_health"',
  'section === "start_message"',
  'section === "flow"',
  "لا يمكن ربط Worker تابع لمنصة مختلفة",
  "validationRules",
  "final_action",
]);
expectAll("settings UI", ui, [
  "الحالة والسياسة",
  "المنصات والـWorkers",
  "رسائل البداية",
  "الاختيارات والفلو",
  "الجلسات والسجل",
  "أقل عدد حروف",
  "أقصى عدد حروف",
  "عدد المحاولات",
  "القيم المقبولة للاختيار",
  "الإجراء النهائي ورسالة النهاية",
]);
expectAll("admin route", admin, ['key: "automation"', '<CrmAutomationSettings />']);
expectAll("api route", api, ['["crm/automation-settings", crmAutomationSettingsHandler]', 'version: "1.18.0"']);
expectAll("distribution responsibility separation", entryApi + entryUi, ["إعدادات الأوتوميشن", "قواعد الموظفين"]);
expectAll("provider-confirmed sending", messaging, [
  "awaitProvider?: boolean",
  "finishWorkerDelivery",
  "providerMessageId",
  "httpStatus",
  "const sql = input.db || getSql()",
  "db: input.awaitProvider === true ? sql : undefined",
]);

expectAll("facebook worker routes", worker, [
  "META_WEBHOOK_PATHS",
  "AUTOMATION_PATHS",
  "SEND_PATHS",
  "x-hub-signature-256",
  "providerMessageId",
  "facebookPsid",
  "quick_reply",
  "postback",
  "attachments",
  "sendGraphMessage",
  "status: accepted ? \"sent\" : \"failed\"",
  "FACEBOOK_SEND_IDEMPOTENCY_KV",
  "idempotentReplay",
  "meta_webhook_is_authoritative",
]);
expectAll("facebook worker ownership", worker, ["platformOwnsAutomation: true", "role: \"transport_only\""]);
forbidAll("facebook worker business logic", worker, [
  "detectFacebookServiceSelection",
  "serviceDefinition(",
  "chooseAssignment(",
  "assignCallCenter",
  "financeRegistrationReady",
]);
execFileSync(process.execPath, ["--check", new URL("../facebook-worker/src/index.js", import.meta.url).pathname], { stdio: "pipe" });

const financeName = migration.indexOf("برجاء إدخال بيانات التمويل 👇\\nالاسم");
const financeCar = migration.indexOf("'finance_car','السيارة','السيارة'");
const financePhone = migration.indexOf("'finance_phone','رقم الجوال','رقم الجوال'");
if (!(financeName >= 0 && financeCar > financeName && financePhone > financeCar)) {
  throw new Error("Finance seed order must be name -> car -> phone");
}

console.log("CRM conversation automation v1.18.0 architecture, scenarios, UI, database, idempotency, and Facebook transport checks passed.");
