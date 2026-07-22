import { clean } from "./_crm-utils.js";
import { getSql } from "./_db.js";

export type AutomationMessage = { enabled: boolean; text: string };
export type AutomationStep = {
  key: string;
  name: string;
  prompt: string;
  sortOrder: number;
  answerType: "text" | "phone" | "number" | "email" | "select" | "date" | "message";
  fieldKey: string;
  required: boolean;
  errorMessage: string;
  maxAttempts: number;
  active: boolean;
  options: Array<{ value: string; label: string }>;
};
export type AutomationServiceOption = {
  key: string;
  label: string;
  emoji: string;
  active: boolean;
  sortOrder: number;
  serviceKey: string;
  departmentCode: string;
  defaultBranch: string;
  flowType: "questions" | "message";
  aliases: string[];
  startMessage: AutomationMessage;
  endMessage: AutomationMessage;
  steps: AutomationStep[];
  system: boolean;
};
export type PlatformWorkerSetting = {
  platformCode: string;
  workerCode: string;
  enabled: boolean;
};
export type CustomerAutomationSettings = {
  enabled: boolean;
  name: string;
  platformWorkers: PlatformWorkerSetting[];
  triggerMode: "every_message" | "once_24h" | "custom";
  customIntervalValue: number;
  customIntervalUnit: "minute" | "hour" | "day";
  scheduleEnabled: boolean;
  scheduleStart: string;
  scheduleEnd: string;
  scheduleDays: number[];
  messages: {
    start: AutomationMessage;
    welcome: AutomationMessage;
    servicePrompt: AutomationMessage;
    noMatch: AutomationMessage;
    validationFallback: AutomationMessage;
    cancelled: AutomationMessage;
    restarted: AutomationMessage;
  };
  serviceOptions: AutomationServiceOption[];
  flowTimeoutValue: number;
  flowTimeoutUnit: "minute" | "hour";
  restartKeywords: string[];
  cancelKeywords: string[];
  version?: number;
  updatedAt?: string | null;
  updatedBy?: string | null;
};

const financeSteps: AutomationStep[] = [
  { key: "name", name: "الاسم", prompt: "الاسم", sortOrder: 10, answerType: "text", fieldKey: "customer_name", required: true, errorMessage: "برجاء إدخال الاسم.", maxAttempts: 3, active: true, options: [] },
  { key: "car", name: "السيارة", prompt: "السيارة", sortOrder: 20, answerType: "text", fieldKey: "car_name", required: true, errorMessage: "برجاء إدخال السيارة المطلوبة.", maxAttempts: 3, active: true, options: [] },
  { key: "phone", name: "رقم الجوال", prompt: "رقم الجوال", sortOrder: 30, answerType: "phone", fieldKey: "phone", required: true, errorMessage: "برجاء إدخال رقم جوال صحيح.", maxAttempts: 3, active: true, options: [] },
];

export const DEFAULT_CUSTOMER_AUTOMATION_SETTINGS: CustomerAutomationSettings = {
  version: 1,
  enabled: true,
  name: "أوتوميشن استقبال عملاء CRM",
  platformWorkers: [
    { platformCode: "facebook", workerCode: "facebook", enabled: true },
    { platformCode: "instagram", workerCode: "instagram", enabled: true },
    { platformCode: "whatsapp", workerCode: "whatsapp", enabled: true },
    { platformCode: "tiktok", workerCode: "tiktok-snapchat", enabled: true },
    { platformCode: "snapchat", workerCode: "tiktok-snapchat", enabled: true },
  ],
  // The flow starts only for a conversation that has no open service request. The
  // generic trigger/schedule controls are deliberately fixed and are not user-editable.
  triggerMode: "every_message",
  customIntervalValue: 24,
  customIntervalUnit: "hour",
  scheduleEnabled: false,
  scheduleStart: "00:00",
  scheduleEnd: "00:00",
  scheduleDays: [0, 1, 2, 3, 4, 5, 6],
  messages: {
    start: { enabled: false, text: "" },
    welcome: { enabled: true, text: "مرحباً بك في مجموعة محمد بن ذعار العجمي للسيارات 👋" },
    servicePrompt: { enabled: true, text: "برجاء اختيار الخدمة:" },
    noMatch: { enabled: true, text: "برجاء اختيار إحدى الخدمات الظاهرة في القائمة." },
    validationFallback: { enabled: true, text: "برجاء إدخال البيانات بصورة صحيحة." },
    cancelled: { enabled: true, text: "تم إلغاء الطلب الحالي. يمكنك إرسال رسالة جديدة للبدء مرة أخرى." },
    restarted: { enabled: false, text: "" },
  },
  serviceOptions: [
    {
      key: "cash", label: "مبيعات الكاش", emoji: "💰", active: true, sortOrder: 10,
      serviceKey: "cash", departmentCode: "cash_sales", defaultBranch: "", flowType: "message",
      aliases: ["كاش", "مبيعات كاش", "مبيعات الكاش", "شراء كاش"],
      startMessage: { enabled: false, text: "" },
      endMessage: { enabled: true, text: "تم تحويل طلبك إلى قسم مبيعات الكاش ✅\nسيتم التواصل معك قريباً" },
      steps: [], system: true,
    },
    {
      key: "finance", label: "مبيعات التمويل", emoji: "🏦", active: true, sortOrder: 20,
      serviceKey: "finance", departmentCode: "finance_sales", defaultBranch: "online", flowType: "questions",
      aliases: ["تمويل", "مبيعات تمويل", "مبيعات التمويل", "شراء تمويل"],
      startMessage: { enabled: true, text: "برجاء إدخال بيانات التمويل 👇" },
      endMessage: { enabled: true, text: "سيتم التواصل معك في أقرب وقت\nنسعد بخدمتكم دائمًا 🌹" },
      steps: financeSteps, system: true,
    },
    {
      key: "service", label: "خدمة العملاء", emoji: "🛠", active: true, sortOrder: 30,
      serviceKey: "service", departmentCode: "customer_service", defaultBranch: "customer_service", flowType: "message",
      aliases: ["خدمة العملاء", "خدمه العملاء", "خدمة", "خدمة عملاء"],
      startMessage: { enabled: false, text: "" },
      endMessage: { enabled: true, text: "سيتم التواصل معك قريباً من أحد ممثلي قسم خدمة العملاء 👨‍🔧" },
      steps: [], system: true,
    },
  ],
  flowTimeoutValue: 24,
  flowTimeoutUnit: "hour",
  restartKeywords: ["البداية", "ابدأ من جديد", "القائمة"],
  cancelKeywords: ["إلغاء", "الغاء", "خروج"],
};

function number(value: unknown, fallback: number, min = 0, max = 100000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function textList(value: unknown, fallback: string[] = []) {
  const list = Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
  return list.length ? [...new Set(list)] : [...fallback];
}

function editableText(value: unknown, fallback: string) {
  const result = clean(value);
  return result || fallback;
}

function rawOptionByKey(raw: any, key: string) {
  const rawOptions = Array.isArray(raw?.service_options) ? raw.service_options : raw?.serviceOptions;
  return Array.isArray(rawOptions) ? rawOptions.find((row: any) => clean(row?.key) === key) || null : null;
}

function normalizeEditableStep(rawStep: any, fixed: AutomationStep): AutomationStep {
  return {
    ...fixed,
    prompt: editableText(rawStep?.prompt, fixed.prompt),
    errorMessage: editableText(rawStep?.errorMessage, fixed.errorMessage),
    options: [],
  };
}

function normalizeFixedOption(raw: any, fixed: AutomationServiceOption): AutomationServiceOption {
  const rawOption = rawOptionByKey(raw, fixed.key);
  const aliases = textList(rawOption?.aliases, fixed.aliases)
    .filter((alias) => !/^\d+$/.test(clean(alias)));

  if (fixed.key === "finance") {
    const rawSteps = Array.isArray(rawOption?.steps) ? rawOption.steps : [];
    return {
      ...fixed,
      aliases,
      startMessage: {
        enabled: true,
        text: editableText(rawOption?.startMessage?.text, fixed.startMessage.text),
      },
      endMessage: {
        enabled: true,
        text: editableText(rawOption?.endMessage?.text, fixed.endMessage.text),
      },
      steps: fixed.steps.map((step) => normalizeEditableStep(rawSteps.find((row: any) => clean(row?.key) === step.key), step)),
    };
  }

  let endText = editableText(rawOption?.endMessage?.text, fixed.endMessage.text);
  // Upgrade the old generic no-step replies to the agreed service-specific messages.
  if (fixed.key === "cash" && [
    "سيتم التواصل معك في أقرب وقت\nنسعد بخدمتكم دائمًا 🌹",
    "سيتم التواصل معك في أقرب وقت\\nنسعد بخدمتكم دائمًا 🌹",
  ].includes(endText)) endText = fixed.endMessage.text;
  if (fixed.key === "service" && [
    "تم استلام طلبك وسيتم التواصل معك في أقرب وقت.",
    "سيتم التواصل معك في أقرب وقت\nنسعد بخدمتكم دائمًا 🌹",
  ].includes(endText)) endText = fixed.endMessage.text;

  return {
    ...fixed,
    aliases,
    startMessage: { enabled: false, text: "" },
    endMessage: { enabled: true, text: endText },
    steps: [],
  };
}

export function normalizeCustomerAutomationSettings(raw: any): CustomerAutomationSettings {
  const defaults = DEFAULT_CUSTOMER_AUTOMATION_SETTINGS;
  const rawMessages = raw?.automation_messages || raw?.messages || {};
  const platformWorkersRaw = raw?.platform_workers || raw?.platformWorkers;
  const platformWorkers = (Array.isArray(platformWorkersRaw) ? platformWorkersRaw : defaults.platformWorkers)
    .map((item: any) => ({
      platformCode: clean(item?.platformCode || item?.platform_code),
      workerCode: clean(item?.workerCode || item?.worker_code),
      enabled: item?.enabled !== false,
    }))
    .filter((item: PlatformWorkerSetting) => item.platformCode && item.workerCode);

  let welcomeText = editableText(rawMessages?.welcome?.text, defaults.messages.welcome.text);
  if ([
    "أهلًا وسهلًا بك في مجموعة محمد ذعار العجمي للسيارات 🌹",
    "اهلًا وسهلًا بك في مجموعة محمد ذعار العجمي للسيارات 🌹",
  ].includes(welcomeText)) welcomeText = defaults.messages.welcome.text;

  let servicePromptText = editableText(
    rawMessages?.servicePrompt?.text || raw?.service_selection_message,
    defaults.messages.servicePrompt.text,
  );
  if (servicePromptText === "برجاء اختيار الخدمة المطلوبة 👇") servicePromptText = defaults.messages.servicePrompt.text;

  return {
    enabled: true,
    name: defaults.name,
    platformWorkers: platformWorkers.length ? platformWorkers : defaults.platformWorkers,
    triggerMode: "every_message",
    customIntervalValue: defaults.customIntervalValue,
    customIntervalUnit: defaults.customIntervalUnit,
    scheduleEnabled: false,
    scheduleStart: defaults.scheduleStart,
    scheduleEnd: defaults.scheduleEnd,
    scheduleDays: [...defaults.scheduleDays],
    messages: {
      start: { enabled: false, text: "" },
      welcome: { enabled: true, text: welcomeText },
      servicePrompt: { enabled: true, text: servicePromptText },
      noMatch: { enabled: true, text: editableText(rawMessages?.noMatch?.text, defaults.messages.noMatch.text) },
      validationFallback: { enabled: true, text: editableText(rawMessages?.validationFallback?.text, defaults.messages.validationFallback.text) },
      cancelled: { enabled: true, text: defaults.messages.cancelled.text },
      restarted: { enabled: false, text: "" },
    },
    serviceOptions: defaults.serviceOptions.map((option) => normalizeFixedOption(raw, option)),
    flowTimeoutValue: defaults.flowTimeoutValue,
    flowTimeoutUnit: defaults.flowTimeoutUnit,
    restartKeywords: [...defaults.restartKeywords],
    cancelKeywords: [...defaults.cancelKeywords],
    version: number(raw?.automation_version ?? raw?.version, defaults.version || 1, 1),
    updatedAt: raw?.updated_at || raw?.updatedAt || null,
    updatedBy: raw?.updated_by || raw?.updatedBy || null,
  };
}

export function canonicalAutomationPlatform(value: unknown) {
  const source = clean(value).toLowerCase().replace(/-/g, "_");
  if (source.includes("facebook")) return "facebook";
  if (source.includes("instagram")) return "instagram";
  if (source.includes("tiktok")) return "tiktok";
  if (source.includes("snapchat") || source.includes("snap")) return "snapchat";
  if (source.includes("whatsapp") || source.includes("mersal")) return "whatsapp";
  if (source.includes("installment")) return "installment_calculator";
  return source;
}

export function customerAutomationBindingEnabled(settings: CustomerAutomationSettings, platformCode: unknown, workerCode: unknown) {
  const platform = canonicalAutomationPlatform(platformCode);
  const worker = clean(workerCode);
  return settings.enabled && settings.platformWorkers.some((row) =>
    row.enabled && row.workerCode === worker && canonicalAutomationPlatform(row.platformCode) === platform
  );
}

let cache: { value: CustomerAutomationSettings; expiresAt: number } | null = null;
export function clearCustomerAutomationSettingsCache() { cache = null; }

export async function getCustomerAutomationSettings(force = false) {
  if (!force && cache && cache.expiresAt > Date.now()) return cache.value;
  const sql = getSql();
  const [row] = await sql<any[]>`select * from crm.automation_settings where id='default'`;
  const value = normalizeCustomerAutomationSettings(row || {});
  cache = { value, expiresAt: Date.now() + 30_000 };
  return value;
}

export function intervalSeconds(value: number, unit: string) {
  if (unit === "day") return Math.max(1, value) * 86400;
  if (unit === "hour") return Math.max(1, value) * 3600;
  return Math.max(1, value) * 60;
}
