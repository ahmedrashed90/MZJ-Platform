import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("database/migrations/20260723_crm_automation_flow_rebuild_v1180.sql");
const schema = read("server/_crm-schema.ts");
const engine = read("server/_crm-flow-engine.ts");
const financeDetails = read("server/_crm-finance-details.ts");
const settingsApi = read("server/crm/automation-settings.ts");
const entryApi = read("server/crm/entry-routing.ts");
const integration = read("server/_integration-processor.ts");
const messaging = read("server/_crm-messaging.ts");
const lifecycle = read("server/_crm-lifecycle.ts");
const background = read("server/_crm-background-jobs.ts");
const ui = read("src/crm/components/CrmAutomationSettings.tsx");
const contract = read("shared/crmAutomationContract.ts");
const pageModel = read("src/crm/automationModel.ts");
const admin = read("src/crm/pages/CrmAdminPage.tsx");
const api = read("api/index.ts");
const worker = read("facebook-worker/src/index.js");
const workerCopy = read("workers/MZJ-Facebook-Worker-v2.0.0-FULL.js");
const db = read("server/_db.ts");
const integrationRoute = read("server/integrations/[source].ts");

function requireTokens(label, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) throw new Error(`${label}: missing ${token}`);
  }
}
function forbidTokens(label, source, tokens) {
  for (const token of tokens) {
    if (source.includes(token)) throw new Error(`${label}: forbidden token remains: ${token}`);
  }
}

requireTokens("migration", migration, [
  "begin;",
  "alter table crm.automation_settings rename to crm_runtime_settings",
  "alter table crm.automation_events rename to background_events",
  "alter table crm.automation_jobs rename to background_jobs",
  "drop table if exists crm.automation_final_actions cascade",
  "create table crm.automation_definitions",
  "create table crm.automation_platforms",
  "create table crm.automation_start_messages",
  "create table crm.automation_choices",
  "create table crm.automation_choice_replies",
  "create table crm.automation_steps",
  "create table crm.automation_sessions",
  "create table crm.automation_inbound_events",
  "create table crm.automation_answers",
  "create table crm.automation_outbound_messages",
  "create table crm.automation_final_actions",
  "is_archived boolean not null default false",
  "crm_automation_sessions_one_active_idx",
  "crm_automation_sessions_one_active_contact_idx",
  "event_key text not null unique",
  "idempotency_key text not null unique",
  "session_id uuid not null unique references",
  "crm-automation-flow-rebuild-v1.18.0",
  "مرحباً بك في مجموعة محمد بن ذعار العجمي للسيارات 👋",
  "💰 مبيعات الكاش",
  "🏦 مبيعات التمويل",
  "🛠 خدمة العملاء",
  "برجاء إدخال بيانات التمويل 👇",
  "('finance','finance_name'",
  "('finance','finance_car'",
  "('finance','finance_phone'",
  "تم تحويل طلبك إلى قسم مبيعات الكاش ✅",
  "سيتم التواصل معك في أقرب وقت",
  "نسعد بخدمتكم دائمًا 🌹",
  "سيتم التواصل معك قريباً من أحد ممثلي قسم خدمة العملاء 👨‍🔧",
  "commit;",
]);
if (!schema.includes(migration.trim())) throw new Error("embedded CRM schema migration is not synchronized with the standalone SQL file");

const runtimeSqlBlocks = [...engine.matchAll(/`([\s\S]*?)`/g)].map((match) => match[1]);
for (const block of runtimeSqlBlocks) {
  const projectsDuplicateId = /select\s+\*,\s*id::text/i.test(block);
  const orderByClause = block.match(/order\s+by\s+([\s\S]*?)(?:\blimit\b|\bfor\s+update\b|$)/i)?.[1] || "";
  const ordersByBareId = /(^|,)\s*id(?:\s+(?:asc|desc))?(?:\s*,|\s*$)/i.test(orderByClause.trim());
  if (projectsDuplicateId && ordersByBareId) {
    throw new Error(`engine: ambiguous runtime SQL projects id twice and orders by bare id: ${block.trim()}`);
  }
}

requireTokens("engine ordered collection readers", engine, [
  "c.id::text as id",
  "order by c.sort_order,c.id",
  "o.id::text as id",
  "order by o.sort_order,o.id",
  "m.id::text as id",
  "order by m.sort_order,m.id",
  "s.id::text as id",
  "order by s.sort_order,s.id",
]);
forbidTokens("engine ambiguous ordered readers", engine, [
  "order by sort_order,id",
  "order by sort_order desc,id desc",
]);

requireTokens("finance combined details parser", financeDetails, [
  "FINANCE_COMBINED_PROMPT",
  "parseFinanceCombinedDetails",
  "financeMissingPrompt",
  "normalizeFinancePhone",
  "customerName",
  "carName",
  "phone",
]);
requireTokens("finance combined runtime", engine, [
  "sendFinanceCombinedQuestion",
  "handleFinanceCombinedAnswer",
  "awaiting_finance_details",
  "finance_details_incomplete",
  "finance-details:missing",
  "financeBatchSteps",
  "financeCombinedPrompt",
]);

requireTokens("engine", engine, [
  "pg_advisory_xact_lock",
  "on conflict(event_key)",
  "ACTIVE_SESSION_STATES",
  "classifyConversationService",
  "mergeDuplicateContacts",
  "awaitProviderResult: true",
  "providerSucceeded",
  "automation_inbound_events",
  "automation_answers",
  "automation_outbound_messages",
  "automation_final_actions",
  "is_archived=false",
  "question_send_failed",
  "step_message_send_failed",
  "advanceChoiceFlow",
  "loadStepOptions",
  "stepOptionButtons",
  "final_action_failed",
  "retrySendingSession",
]);
forbidTokens("engine", engine, [
  "roundRobin",
  "round_robin",
  "selectEmployee",
  "eligibleEmployees",
  "distributionCursor",
]);
requireTokens("central distribution", lifecycle, ["export async function classifyConversationService", "export async function mergeDuplicateContacts"]);
requireTokens("integration", integration, ["handleAutomationInbound", "publishBackgroundEvent"]);
requireTokens("database conversation serialization", db, [
  'createHash("sha256")',
  'databaseAdvisoryLockPair',
  'digest.readInt32BE(0)',
  'digest.readInt32BE(4)',
  'lockClient',
  'getLockSql',
  'locks.reserve()',
  'reserved`select pg_advisory_lock(${lockNamespace}::integer,${lockValue}::integer)`',
  'reserved`select pg_advisory_unlock(${lockNamespace}::integer,${lockValue}::integer)`',
  'return await work()',
]);
forbidTokens("database conversation serialization", db, [
  'AsyncLocalStorage',
  'sqlContext',
  'reservedSqlFacade',
  'hashtext(',
  'pg_advisory_lock($1',
  'pg_advisory_unlock($1',
]);
requireTokens("transaction conversation serialization", engine, [
  'databaseAdvisoryLockPair(`transaction:${input.conversationId}`)',
  'tx`select pg_advisory_xact_lock(${lockNamespace}::integer,${lockValue}::integer)`',
]);
forbidTokens("transaction conversation serialization", engine, [
  'hashtext(',
  'pg_advisory_xact_lock($1',
]);
requireTokens("integration ingress ordering", integrationRoute, [
  'integrationConversationLockKey',
  'withDatabaseAdvisoryLock(lockKey',
  'integration:${source}:conversation:',
  'await ensureCrmSchema()',
  'processIntegrationEvent(source,eventKey,payload)',
  'direction === "out" ? "" : integrationConversationLockKey',
]);
if (integrationRoute.indexOf('withDatabaseAdvisoryLock(lockKey') > integrationRoute.indexOf('processIntegrationEvent(source,eventKey,payload)')) {
  throw new Error("integration ingress ordering: processIntegrationEvent must run inside the conversation lock");
}
if (integrationRoute.indexOf('await ensureCrmSchema()') < integrationRoute.indexOf('withDatabaseAdvisoryLock(lockKey')) {
  throw new Error("integration ingress ordering: schema and processing must start after the conversation lock is acquired");
}
requireTokens("messaging", messaging, ["awaitProviderResult", "finishWorkerDelivery"]);
requireTokens("background jobs", background, ["crm.background_events", "crm.background_jobs"]);

requireTokens("settings API", settingsApi, [
  "default_customer_entry",
  "every_message",
  "once_24_hours",
  "custom_duration",
  "platformCompatible",
  "to_jsonb(c)->>'is_archived'",
  "is_archived=true",
  "join crm.automation_choices c on c.id=r.choice_id",
  "join crm.automation_steps s on s.id=o.step_id",
  "databaseReadError",
  "normalizeAutomationSettings",
  "normalizeAutomationEndpoints",
  "AutomationSettingsResponse",
  "const automation = normalizeAutomationSettings",
  "body.automation",
  "إعدادات الأوتوميشن متاحة لإدارة CRM فقط",
]);
forbidTokens("settings API request contract", settingsApi, [
  "body.settings",
  "automation.start_messages",
  "automation.trigger_policy",
]);
forbidTokens("settings API database coupling", settingsApi, [
  "select *",
  "=any(",
  "e.text_send_url",
  "created_by::text",
  "updated_by::text",
]);
requireTokens("shared automation contract", contract, [
  "export type AutomationSettings",
  "export type AutomationSettingsResponse",
  "normalizeAutomationSettings",
  "normalizeAutomationEndpoints",
  "normalizeAutomationSettingsResponse",
  "platforms: records(value.platforms).map",
  "startMessages: records(value.startMessages).map",
  "choices: records(value.choices).map",
  "replies: records(choice.replies).map",
  "steps: records(choice.steps).map",
  "options: records(step.options).map",
]);
requireTokens("automation page model", pageModel, [
  "automationResponseToDraft",
  "automationDraftToSettings",
  "normalizeAutomationSettingsResponse",
  "triggerIntervalSeconds",
]);
requireTokens("entry-routing boundary", entryApi, ["409", "إعدادات الأوتوميشن"]);
requireTokens("API route", api, ['["crm/automation-settings", crmAutomationSettingsHandler]']);

requireTokens("automation UI", ui, [
  "/api/crm/automation-settings",
  "automationResponseToDraft",
  "automationDraftToSettings",
  "الحالة العامة وسياسة التشغيل",
  "المنصات والـWorkers",
  "رسائل بداية الأوتوميشن",
  "الاختيارات وخطوات الفلو",
  "معاينة الفلو",
  "إضافة رسالة",
  "إضافة اختيار",
  "إضافة خطوة",
  "حسب محرك التوزيع",
]);
forbidTokens("automation UI database field leakage", ui, [
  "source_code",
  "worker_code",
  "is_enabled",
  "start_messages",
  "choice_code",
  "step_code",
  "health_url",
]);
requireTokens("admin tab", admin, ["CrmAutomationSettings", "إعدادات الأوتوميشن"]);

if (worker !== workerCopy) throw new Error("standalone Facebook Worker copy is not synchronized");
requireTokens("Facebook Worker", worker, [
  '"/meta/webhook"',
  '"/webhook/facebook"',
  '"/automation"',
  '"/send/facebook"',
  "verifySignature",
  "normalizeMetaEvents",
  "participantId",
  "provider_message_id",
  "quick_replies",
  "sendGraph",
  "sendManyChatText",
  "PLATFORM_INBOUND_URL",
]);
forbidTokens("Facebook Worker business flow", worker, [
  "مبيعات الكاش",
  "مبيعات التمويل",
  "خدمة العملاء",
  "برجاء إدخال بيانات التمويل",
  "finance_name",
  "finance_car",
  "finance_phone",
  "createLead",
  "forceServiceReclassification",
]);

function normalize(value) {
  return String(value || "").trim().toLowerCase()
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[ـًٌٍَُِّْ]/g, "")
    .replace(/[✅🌹👨‍🔧👇🔥🏦🛠💰]/g, "")
    .replace(/[_\-–—|/\\]+/g, " ").replace(/[\s،,:؛.!?؟]+/g, " ").trim();
}
function phone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (/^05\d{8}$/.test(digits)) digits = `966${digits.slice(1)}`;
  else if (/^5\d{8}$/.test(digits)) digits = `966${digits}`;
  return /^9665\d{8}$/.test(digits) ? digits : "";
}

const choices = {
  cash: { replies: ["مبيعات الكاش", "كاش", "1", "cash"], steps: [], final: "cash_done" },
  finance: { replies: ["مبيعات التمويل", "تمويل", "2", "finance"], steps: ["finance_details"], final: "finance_done" },
  service: { replies: ["خدمة العملاء", "3", "service"], steps: [], final: "service_done" },
};
function parseFinanceDetails(value, previous = {}) {
  const raw = String(value || "").trim();
  const phoneValue = phone(raw);
  let withoutPhone = raw.replace(/(?:00966|\+?966|0)?[\s().-]*5(?:[\s().-]*\d){8}/, "\n");
  withoutPhone = withoutPhone
    .replace(/(?:اسم\s*العميل|الاسم|name)\s*[:=\-]*/gi, "\n")
    .replace(/(?:اسم\s*السيار(?:ة|ه)|نوع\s*السيار(?:ة|ه)|السيار(?:ة|ه)|car)\s*[:=\-]*/gi, "\n")
    .replace(/(?:رقم\s*(?:الجوال|الهاتف)|الجوال|الهاتف|phone|mobile)\s*[:=\-]*/gi, "\n");
  const parts = withoutPhone.split(/[\r\n,،;؛|/\\]+/).map((item) => item.trim()).filter(Boolean);
  const values = { name: previous.name || "", car: previous.car || "", phone: previous.phone || "" };
  if (phoneValue) values.phone = phoneValue;
  const missingText = ["name", "car"].filter((field) => !values[field]);
  if (missingText.length === 1 && parts.length) values[missingText[0]] = parts.join(" ");
  else if (missingText.length === 2 && parts.length >= 2) { values.name = parts[0]; values.car = parts.slice(1).join(" "); }
  else if (missingText.length === 2 && parts.length === 1 && phoneValue) {
    const words = parts[0].split(/\s+/).filter(Boolean);
    if (words.length >= 2) { values.name = words.slice(0, -1).join(" "); values.car = words.at(-1); }
    else values.name = parts[0];
  } else if (missingText.length === 2 && parts.length === 1) values.name = parts[0];
  return values;
}
function simulate(events) {
  const seen = new Set();
  const output = [];
  let session = null;
  let created = 0;
  let distributed = 0;
  let finalMessages = 0;
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    if (!session) {
      session = { status: "awaiting_choice", choice: null, answers: {} };
      output.push("welcome");
      continue;
    }
    if (session.status === "awaiting_choice") {
      const input = normalize(event.payload || event.text);
      const choiceKey = Object.entries(choices).find(([, value]) => value.replies.map(normalize).includes(input))?.[0];
      if (!choiceKey) { output.push("choice_retry"); continue; }
      session.choice = choiceKey;
      if (!choices[choiceKey].steps.length) {
        created += 1; distributed += 1; finalMessages += 1;
        session.status = "completed"; output.push(choices[choiceKey].final); continue;
      }
      session.status = "awaiting_answer"; output.push("finance_details_question"); continue;
    }
    if (session.status === "awaiting_answer") {
      session.answers = parseFinanceDetails(event.text, session.answers);
      const missing = ["name", "car", "phone"].filter((field) => !session.answers[field]);
      if (missing.length) { output.push(`finance_missing_${missing.join("_")}`); continue; }
      created += 1; distributed += 2; finalMessages += 1;
      session.status = "completed"; output.push("finance_done");
    }
  }
  return { output, session, created, distributed, finalMessages, seen: seen.size };
}

const cash = simulate([
  { id: "c1", text: "السلام عليكم" },
  { id: "c2", payload: "cash" },
  { id: "c2", payload: "cash" },
]);
if (cash.output.join(",") !== "welcome,cash_done" || cash.created !== 1 || cash.distributed !== 1 || cash.finalMessages !== 1) throw new Error("cash acceptance simulation failed");

const finance = simulate([
  { id: "f1", text: "مرحبا" },
  { id: "f2", text: "مبيعات التمويل" },
  { id: "f3", text: "أحمد محمد، سوناتا، 0541421013" },
  { id: "f3", text: "أحمد محمد، سوناتا، 0541421013" },
]);
if (finance.output.join(",") !== "welcome,finance_details_question,finance_done") throw new Error(`finance combined acceptance simulation failed: ${finance.output.join(",")}`);
if (finance.session.answers.name !== "أحمد محمد" || finance.session.answers.car !== "سوناتا" || finance.session.answers.phone !== "966541421013") throw new Error("finance combined answers were not retained");
if (finance.created !== 1 || finance.distributed !== 2 || finance.finalMessages !== 1) throw new Error("finance combined idempotency simulation failed");

const financeLines = simulate([
  { id: "fl1", text: "مرحبا" },
  { id: "fl2", text: "2" },
  { id: "fl3", text: "أحمد محمد\nتويوتا كامري\n0541421013" },
]);
if (financeLines.output.join(",") !== "welcome,finance_details_question,finance_done") throw new Error("finance multiline acceptance simulation failed");

const financePartial = simulate([
  { id: "fp1", text: "مرحبا" },
  { id: "fp2", text: "تمويل" },
  { id: "fp3", text: "أحمد" },
  { id: "fp4", text: "سوناتا" },
  { id: "fp5", text: "0541421013" },
]);
if (financePartial.output.join(",") !== "welcome,finance_details_question,finance_missing_car_phone,finance_missing_phone,finance_done") throw new Error(`finance partial accumulation simulation failed: ${financePartial.output.join(",")}`);

const service = simulate([
  { id: "s1", text: "مرحبا" },
  { id: "s2", text: "خدمة العملاء" },
]);
if (service.output.join(",") !== "welcome,service_done" || service.created !== 1 || service.distributed !== 1) throw new Error("customer service acceptance simulation failed");

const waitSeconds = (policy, value, unit) => policy === "once_24_hours" ? 86400 : value * ({ minute: 60, hour: 3600, day: 86400 }[unit] || 0);
if (waitSeconds("once_24_hours", 0, "minute") !== 86400 || waitSeconds("custom_duration", 5, "minute") !== 300 || waitSeconds("custom_duration", 2, "hour") !== 7200 || waitSeconds("custom_duration", 3, "day") !== 259200) throw new Error("trigger policy duration simulation failed");

console.log("CRM automation v1.18.0 static architecture and acceptance simulations: PASS");
