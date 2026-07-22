import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const admin = read("src/crm/pages/CrmAdminPage.tsx");
const ui = read("src/crm/components/CrmAutomationSettings.tsx");
const settings = read("server/_crm-customer-automation-settings.ts");
const settingsApi = read("server/crm/automation-settings.ts");
const engine = read("server/_crm-customer-automation.ts");
const messaging = read("server/_crm-messaging.ts");
const automation = read("server/_crm-automation.ts");
const integration = read("server/_integration-processor.ts");
const lifecycle = read("server/_crm-lifecycle.ts");
const schema = read("server/_crm-schema.ts");
const api = read("api/index.ts");

for (const token of [
  'key: "automation"',
  'label: "إعدادات الأوتوميشن"',
  '<CrmAutomationSettings />',
]) if (!admin.includes(token)) throw new Error(`Automation tab check failed: missing ${token}`);

for (const token of [
  'الفلو الثلاثي ثابتًا حسب السيناريو المعتمد',
  'الحالة العامة',
  'المنصات والـ Workers',
  'متى يتم تشغيل الأوتوميشن؟',
  'مرة كل 24 ساعة',
  'مدة مخصصة',
  'تشغيل الأوتوميشن على المنصة',
  'رسالة العميل الجديد',
  '💰 مبيعات الكاش',
  '🏦 مبيعات التمويل',
  '🛠 خدمة العملاء',
  'الردود المقبولة',
  'معاينة الفلو الثابت',
  'beforeunload',
]) if (!ui.includes(token)) throw new Error(`Fixed automation UI check failed: missing ${token}`);
for (const forbidden of [
  'إضافة اختيار',
  'إضافة خطوة',
  'نوع الفلو',
  'القسم المرتبط',
  'الفرع الافتراضي',
]) if (ui.includes(forbidden)) throw new Error(`Fixed automation UI must not expose ${forbidden}`);

for (const token of [
  'DEFAULT_CUSTOMER_AUTOMATION_SETTINGS',
  'customerAutomationBindingEnabled',
  'canonicalAutomationPlatform',
  'getCustomerAutomationSettings',
  'expiresAt: Date.now() + 30_000',
  'مرحباً بك في مجموعة محمد بن ذعار العجمي للسيارات 👋',
  'تم تحويل طلبك إلى قسم مبيعات الكاش ✅',
  'سيتم التواصل معك قريباً من أحد ممثلي قسم خدمة العملاء 👨‍🔧',
  'flowType: "message"',
]) if (!settings.includes(token)) throw new Error(`Fixed central settings check failed: missing ${token}`);

for (const token of [
  'isCrmManager(user)',
  'triggerMode: submitted?.triggerMode ?? before.triggerMode',
  'customIntervalValue: submitted?.customIntervalValue ?? before.customIntervalValue',
  'submitted?.platformWorkers || before.platformWorkers',
  'allowedBindings',
  'clearCustomerAutomationSettingsCache',
  'crm_customer_automation_settings_saved',
  'تم حفظ إعدادات الأوتوميشن',
]) if (!settingsApi.includes(token)) throw new Error(`Automation settings API check failed: missing ${token}`);

for (const token of [
  'detectAutomationServiceChoice',
  'pg_advisory_xact_lock',
  'active_flow_on_another_conversation',
  "status in ('awaiting_service','classifying','awaiting_step')",
  'keywordMatch(incomingText, effectiveSettings.cancelKeywords)',
  'keywordMatch(incomingText, effectiveSettings.restartKeywords)',
  'validateAnswer',
  'saveLeadAnswer',
  'continueFlow',
  'nextAutomationStepIndex',
  'FINANCE_STEP_ORDER',
  "status='awaiting_step',current_step_index=${index},current_step_key=${next.key}",
  'departmentCode: plan.option.departmentCode',
  'branchCode: plan.option.defaultBranch',
  'settingsForRun',
  'settings_snapshot',
  'open_service_request_exists',
  'flow-start-question',
  "status='classifying'",
  'waitForProvider: true',
  'nextStepKey: nextStep?.key || null',
  '`question:${plan.nextStep.key}`',
]) if (!engine.includes(token)) throw new Error(`Fixed state machine check failed: missing ${token}`);
if (engine.includes('accepted.includes(candidate) || candidate.includes')) throw new Error('Service choices must use exact matching, not substring matching');
const firstInboundBlock = engine.split('    if (!run) {')[1]?.split('    if (run.status === "awaiting_service")')[0] || '';
if (!firstInboundBlock.includes('return { type: "start", run }')) throw new Error('First inbound message must start the automation');
if (!firstInboundBlock.includes("'classifying',null,null")) throw new Error('First inbound message must not preselect a service');
if (firstInboundBlock.includes('detectAutomationServiceChoice')) throw new Error('First inbound message must not be consumed as a service choice');
if (!firstInboundBlock.includes("request_state='open'")) throw new Error('Existing open service requests must not restart the automation');
if (!engine.includes('options.map(optionDisplay).join("\\n")')) throw new Error('Service list must use the fixed labels without numeric prefixes');
if (!engine.includes('settings.messages.welcome.enabled ? settings.messages.welcome.text')) throw new Error('Welcome and service list must be combined in the first response');


for (const token of [
  'waitForProvider?: boolean',
  'await finishWorkerDelivery(deliveryInput)',
  'providerStatus !== "sent"',
]) if (!messaging.includes(token)) throw new Error(`Provider acknowledgement check failed: missing ${token}`);

for (const token of [
  "status='processing'",
  'customerAutomation.skipped === true',
  'customerAutomation.reason === "flow_deferred"',
  "status in ('received','deferred')",
  'drainDeferredAutomationEvents',
  'processCustomerAutomationInbound',
]) if (!automation.includes(token)) throw new Error(`Automation event claim check failed: missing ${token}`);

for (const token of [
  'eventKey: `${source}:message:${inboundFingerprint}`',
  'automationOwnsServiceSelection',
  'serviceSelectionKey: knownService',
  'workerCode: routeSource',
]) if (!integration.includes(token)) throw new Error(`Inbound idempotency/worker check failed: missing ${token}`);

for (const token of [
  'resolveAssignments',
  'distributionStatus',
  'distributionError',
  'customer_automation_is_message_source_of_truth',
]) if (!lifecycle.includes(token)) throw new Error(`Distribution separation check failed: missing ${token}`);

for (const token of [
  'crm.customer_automation_runs',
  'crm_customer_automation_runs_one_active',
  'crm_customer_automation_runs_one_active_contact',
  'crm-customer-automation-v1.18.0',
  'crm-customer-automation-fixed-flow-v1.18.1',
  'CRM_CUSTOMER_AUTOMATION_FIXED_FLOW_V1181_SQL',
  'platform_workers jsonb',
  'automation_messages jsonb',
  'settings_snapshot jsonb',
]) if (!schema.includes(token)) throw new Error(`Automation schema check failed: missing ${token}`);

for (const token of [
  'crmAutomationSettingsHandler',
  '["crm/automation-settings", crmAutomationSettingsHandler]',
]) if (!api.includes(token)) throw new Error(`Automation API route check failed: missing ${token}`);

function loadTypeScriptModule(path, stubs) {
  const source = read(path);
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: path,
  }).outputText;
  const module = { exports: {} };
  const wrapper = vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: path });
  wrapper((specifier) => {
    if (Object.prototype.hasOwnProperty.call(stubs, specifier)) return stubs[specifier];
    throw new Error(`Unexpected test import ${specifier} from ${path}`);
  }, module, module.exports);
  return module.exports;
}

const utilityStub = {
  clean: (value) => String(value ?? "").trim(),
  normalizePhone: (value) => {
    let phone = String(value ?? "").replace(/[^0-9]/g, "");
    if (/^05\d{8}$/.test(phone)) phone = `966${phone.slice(1)}`;
    else if (/^5\d{8}$/.test(phone)) phone = `966${phone}`;
    return /^\d{8,15}$/.test(phone) ? phone : "";
  },
};
const settingsRuntime = loadTypeScriptModule("server/_crm-customer-automation-settings.ts", {
  "./_crm-utils.js": utilityStub,
  "./_db.js": { getSql: () => { throw new Error("Database must not be used by normalization tests"); } },
});
const normalized = settingsRuntime.normalizeCustomerAutomationSettings({
  enabled: false,
  triggerMode: "custom",
  serviceOptions: [
    { key: "finance", label: "اسم متغير", active: false, departmentCode: "wrong", aliases: ["قسط"], steps: [{ key: "phone", fieldKey: "wrong", prompt: "جوالك", errorMessage: "رقم غير صحيح" }] },
  ],
});
if (normalized.enabled !== false) throw new Error("General automation activation must remain editable");
if (normalized.name !== "أوتوميشن استقبال عملاء CRM") throw new Error("Automation name must normalize safely");
if (normalized.triggerMode !== "custom") throw new Error("Custom trigger policy must remain editable");
if (normalized.customIntervalValue !== 24 || normalized.customIntervalUnit !== "hour") throw new Error("Custom trigger interval must normalize safely");
if (normalized.serviceOptions.length !== 3) throw new Error("Fixed flow must always contain exactly three services");
const fixedFinance = normalized.serviceOptions.find((row) => row.key === "finance");
if (fixedFinance?.label !== "مبيعات التمويل" || fixedFinance?.departmentCode !== "finance_sales" || fixedFinance?.active !== true) throw new Error("Finance structure must not be user-editable");
if (fixedFinance?.steps.find((row) => row.key === "phone")?.fieldKey !== "phone") throw new Error("Finance field mapping must remain fixed");
if (fixedFinance?.steps.find((row) => row.key === "phone")?.prompt !== "جوالك") throw new Error("Finance question text must remain editable");
if (!fixedFinance?.aliases.includes("قسط")) throw new Error("Accepted replies must remain editable");
if (!settingsRuntime.customerAutomationBindingEnabled(settingsRuntime.DEFAULT_CUSTOMER_AUTOMATION_SETTINGS, "snapchat_lead", "tiktok-snapchat")) throw new Error("Snapchat must use its explicit combined-worker binding");

const engineRuntime = loadTypeScriptModule("server/_crm-customer-automation.ts", {
  "./_crm-lifecycle.js": { classifyConversationService: async () => ({}) },
  "./_crm-messaging.js": { deliverConversationMessage: async () => ({}) },
  "./_crm-customer-automation-settings.js": settingsRuntime,
  "./_crm-utils.js": utilityStub,
  "./_db.js": { getSql: () => ({}) },
});
const choices = settingsRuntime.DEFAULT_CUSTOMER_AUTOMATION_SETTINGS.serviceOptions;
const detect = (text, payload = {}) => engineRuntime.detectAutomationServiceChoice({ payload }, { event: { text }, payload }, choices);
if (detect("1")?.key !== "cash") throw new Error("Exact numeric service choice 1 must select cash");
if (detect("10") !== null) throw new Error("Numeric choice matching must not accept 10 as 1");
if (detect("مبيعات التمويل")?.key !== "finance") throw new Error("Arabic service label must be accepted exactly");
if (detect("", { buttonPayload: "service" })?.key !== "service") throw new Error("Interactive payload key must select customer service");
if (engineRuntime.nextAutomationStepIndex(fixedFinance, "name") !== 1) throw new Error("Finance name must advance to car");
if (engineRuntime.nextAutomationStepIndex(fixedFinance, "car") !== 2) throw new Error("Finance car must advance to phone");
if (engineRuntime.nextAutomationStepIndex(fixedFinance, "phone") !== 3) throw new Error("Finance phone must advance to the end message");

console.log('CRM customer automation v1.18.5 provider-confirmed finance progression checks passed.');
