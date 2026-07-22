import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const admin = read("src/crm/pages/CrmAdminPage.tsx");
const ui = read("src/crm/components/CrmAutomationSettings.tsx");
const settings = read("server/_crm-customer-automation-settings.ts");
const settingsApi = read("server/crm/automation-settings.ts");
const engine = read("server/_crm-customer-automation.ts");
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
  'المصدر المركزي الوحيد',
  'المنصات والـ Workers',
  'متى يتم تشغيل الأوتوميشن؟',
  'اختيارات الأوتوميشن ومنشئ الفلو',
  'مدة انتظار إجابة العميل',
  'معاينة الفلو',
  'فشل التوزيع لا يوقف الأسئلة',
  'beforeunload',
]) if (!ui.includes(token)) throw new Error(`Automation UI check failed: missing ${token}`);

for (const token of [
  'DEFAULT_CUSTOMER_AUTOMATION_SETTINGS',
  'customerAutomationBindingEnabled',
  'canonicalAutomationPlatform',
  'getCustomerAutomationSettings',
  'expiresAt: Date.now() + 30_000',
  'snapchat", workerCode: "tiktok-snapchat"',
]) if (!settings.includes(token)) throw new Error(`Central settings check failed: missing ${token}`);

for (const token of [
  'isCrmManager(user)',
  'لا يمكن حذف اختيارات الخدمات الأساسية',
  'لا يمكن حذف اختيار مستخدم في سجل أوتوميشن سابق',
  'الـWorker غير موجود في المشروع',
  'clearCustomerAutomationSettingsCache',
  'crm_customer_automation_settings_saved',
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
  'departmentCode: plan.option.departmentCode',
  'branchCode: plan.option.defaultBranch',
  'settingsForRun',
  'settings_snapshot',
  'automation_version',
]) if (!engine.includes(token)) throw new Error(`State machine check failed: missing ${token}`);
if (engine.includes('accepted.includes(candidate) || candidate.includes')) throw new Error('Service choices must use exact matching, not substring matching');
const firstInboundBlock = engine.split('    if (!run) {')[1]?.split('    if (run.status === "awaiting_service")')[0] || '';
if (!firstInboundBlock.includes('return { type: "start", run }')) throw new Error('First inbound message must start the automation');
if (!firstInboundBlock.includes("'classifying',null,null")) throw new Error('First inbound message must not preselect a service');
if (firstInboundBlock.includes('detectAutomationServiceChoice')) throw new Error('First inbound message must not be consumed as a service choice');

for (const token of [
  'status=\'processing\'',
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
  'platform_workers jsonb',
  'automation_messages jsonb',
  'settings_snapshot jsonb',
  'add column if not exists settings_snapshot',
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
  const wrapper = vm.runInThisContext(`(function(require,module,exports){${output}
})`, { filename: path });
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
const normalizedLegacy = settingsRuntime.normalizeCustomerAutomationSettings({
  service_options: [{ key: "finance", label: "تمويل مخصص", aliases: ["2"] }],
});
if (normalizedLegacy.serviceOptions.length !== 3) throw new Error("Legacy settings must restore protected cash/finance/service options");
if (!normalizedLegacy.serviceOptions.find((row) => row.key === "finance")?.departmentCode) throw new Error("Legacy service options must inherit their actual department");
if (!settingsRuntime.customerAutomationBindingEnabled(settingsRuntime.DEFAULT_CUSTOMER_AUTOMATION_SETTINGS, "snapchat_lead", "tiktok-snapchat")) throw new Error("Snapchat must use its explicit combined-worker binding");
const tiktokOnly = { ...settingsRuntime.DEFAULT_CUSTOMER_AUTOMATION_SETTINGS, platformWorkers: [{ platformCode: "tiktok", workerCode: "tiktok-snapchat", enabled: true }] };
if (settingsRuntime.customerAutomationBindingEnabled(tiktokOnly, "snapchat_lead", "tiktok-snapchat")) throw new Error("TikTok enablement must not silently enable Snapchat");

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
if (detect("", { buttonPayload: "service" })?.key !== "service") throw new Error("Interactive payload key must select the configured service");

const reordered = choices.map((row) => row.key === "finance" ? { ...row, sortOrder: 5 } : row.key === "cash" ? { ...row, sortOrder: 20 } : { ...row, sortOrder: 30 });
if (engineRuntime.detectAutomationServiceChoice({}, { event: { text: "1" }, payload: {} }, reordered)?.key !== "finance") throw new Error("Numeric choices must follow the saved display order after reordering");
if (engineRuntime.detectAutomationServiceChoice({}, { event: { text: "2" }, payload: {} }, reordered)?.key !== "cash") throw new Error("Legacy numeric aliases must not override the visible display order");
const disabledFinance = choices.map((row) => row.key === "finance" ? { ...row, active: false } : row);
if (engineRuntime.detectAutomationServiceChoice({}, { event: { text: "مبيعات التمويل" }, payload: {} }, disabledFinance) !== null) throw new Error("Disabled service choices must never be accepted by label");
if (engineRuntime.detectAutomationServiceChoice({}, { event: { text: "finance" }, payload: {} }, disabledFinance) !== null) throw new Error("Disabled service choices must never be accepted by key");
if (engineRuntime.detectAutomationServiceChoice({}, { event: { text: "2" }, payload: {} }, disabledFinance)?.key !== "service") throw new Error("Numeric choices must follow the visible active-option order");

console.log('CRM customer automation v1.18.0 central settings, state machine, idempotency and distribution isolation checks passed.');
