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

const defaultSteps: AutomationStep[] = [
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
  triggerMode: "every_message",
  customIntervalValue: 24,
  customIntervalUnit: "hour",
  scheduleEnabled: false,
  scheduleStart: "08:00",
  scheduleEnd: "23:00",
  scheduleDays: [0, 1, 2, 3, 4, 5, 6],
  messages: {
    start: { enabled: true, text: "السلام عليكم ورحمة الله وبركاته" },
    welcome: { enabled: true, text: "أهلًا وسهلًا بك في مجموعة محمد ذعار العجمي للسيارات 🌹" },
    servicePrompt: { enabled: true, text: "برجاء اختيار الخدمة المطلوبة 👇" },
    noMatch: { enabled: true, text: "برجاء اختيار إحدى الخدمات الظاهرة في القائمة." },
    validationFallback: { enabled: true, text: "برجاء إدخال البيانات بصورة صحيحة." },
    cancelled: { enabled: true, text: "تم إلغاء الطلب الحالي. يمكنك إرسال رسالة جديدة للبدء مرة أخرى." },
    restarted: { enabled: false, text: "تمت إعادة بداية الطلب." },
  },
  serviceOptions: [
    {
      key: "cash", label: "مبيعات الكاش", emoji: "💰", active: true, sortOrder: 10,
      serviceKey: "cash", departmentCode: "cash_sales", defaultBranch: "", flowType: "questions",
      aliases: ["1", "كاش", "مبيعات كاش", "مبيعات الكاش", "شراء كاش"],
      startMessage: { enabled: false, text: "" },
      endMessage: { enabled: true, text: "سيتم التواصل معك في أقرب وقت\nنسعد بخدمتكم دائمًا 🌹" },
      steps: [], system: true,
    },
    {
      key: "finance", label: "مبيعات التمويل", emoji: "🏦", active: true, sortOrder: 20,
      serviceKey: "finance", departmentCode: "finance_sales", defaultBranch: "online", flowType: "questions",
      aliases: ["2", "تمويل", "مبيعات تمويل", "مبيعات التمويل", "شراء تمويل"],
      startMessage: { enabled: true, text: "برجاء إدخال بيانات التمويل 👇" },
      endMessage: { enabled: true, text: "سيتم التواصل معك في أقرب وقت\nنسعد بخدمتكم دائمًا 🌹" },
      steps: defaultSteps, system: true,
    },
    {
      key: "service", label: "خدمة العملاء", emoji: "🛠", active: true, sortOrder: 30,
      serviceKey: "service", departmentCode: "customer_service", defaultBranch: "customer_service", flowType: "questions",
      aliases: ["3", "خدمة العملاء", "خدمه العملاء", "خدمة"],
      startMessage: { enabled: false, text: "" },
      endMessage: { enabled: true, text: "تم استلام طلبك وسيتم التواصل معك في أقرب وقت." },
      steps: [], system: true,
    },
  ],
  flowTimeoutValue: 24,
  flowTimeoutUnit: "hour",
  restartKeywords: ["البداية", "ابدأ من جديد", "القائمة"],
  cancelKeywords: ["إلغاء", "الغاء", "خروج"],
};

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}
function number(value: unknown, fallback: number, min = 0, max = 100000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}
function textList(value: unknown, fallback: string[] = []) {
  const list = Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
  return list.length ? [...new Set(list)] : fallback;
}
function message(value: any, fallback: AutomationMessage): AutomationMessage {
  return { enabled: bool(value?.enabled, fallback.enabled), text: clean(value?.text ?? fallback.text) };
}
function normalizeStep(value: any, index: number): AutomationStep | null {
  const key = clean(value?.key || value?.name || `step_${index + 1}`).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const name = clean(value?.name || value?.prompt);
  const prompt = clean(value?.prompt || value?.name);
  if (!key || (!prompt && value?.answerType !== "message")) return null;
  const allowedTypes = new Set(["text", "phone", "number", "email", "select", "date", "message"]);
  const answerType = allowedTypes.has(clean(value?.answerType)) ? clean(value.answerType) : "text";
  const options = Array.isArray(value?.options)
    ? value.options.map((item: any) => ({ value: clean(item?.value), label: clean(item?.label || item?.value) })).filter((item: any) => item.value && item.label)
    : [];
  return {
    key, name: name || prompt || key, prompt, sortOrder: number(value?.sortOrder, (index + 1) * 10, 0),
    answerType: answerType as AutomationStep["answerType"], fieldKey: clean(value?.fieldKey),
    required: bool(value?.required, true), errorMessage: clean(value?.errorMessage || "برجاء إدخال البيانات بصورة صحيحة."),
    maxAttempts: number(value?.maxAttempts, 3, 1, 20), active: bool(value?.active, true), options,
  };
}
function normalizeOption(value: any, index: number, fallback?: AutomationServiceOption): AutomationServiceOption | null {
  const base = fallback || DEFAULT_CUSTOMER_AUTOMATION_SETTINGS.serviceOptions[0];
  const key = clean(value?.key || base.key).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const label = clean(value?.label || base.label);
  if (!key || !label) return null;
  const steps = (Array.isArray(value?.steps) ? value.steps : base.steps).map(normalizeStep).filter(Boolean) as AutomationStep[];
  return {
    key, label, emoji: clean(value?.emoji || base.emoji), active: bool(value?.active, base.active),
    sortOrder: number(value?.sortOrder, (index + 1) * 10, 0), serviceKey: clean(value?.serviceKey || key),
    departmentCode: clean(value?.departmentCode || base.departmentCode), defaultBranch: clean(value?.defaultBranch || base.defaultBranch),
    flowType: (["questions", "message"].includes(clean(value?.flowType)) ? clean(value.flowType) : "questions") as AutomationServiceOption["flowType"],
    aliases: textList(value?.aliases, base.aliases).filter((alias) => !/^\d+$/.test(clean(alias))),
    startMessage: message(value?.startMessage, base.startMessage), endMessage: message(value?.endMessage, base.endMessage),
    steps: steps.sort((a, b) => a.sortOrder - b.sortOrder), system: bool(value?.system, base.system),
  };
}

export function normalizeCustomerAutomationSettings(raw: any): CustomerAutomationSettings {
  const defaults = DEFAULT_CUSTOMER_AUTOMATION_SETTINGS;
  const rawMessages = raw?.automation_messages || raw?.messages || {};
  const rawOptions = Array.isArray(raw?.service_options) ? raw.service_options : raw?.serviceOptions;
  const normalizedOptions = (Array.isArray(rawOptions) && rawOptions.length ? rawOptions : defaults.serviceOptions)
    .map((item: any, index: number) => normalizeOption(item, index, defaults.serviceOptions.find((row) => row.key === item?.key)))
    .filter(Boolean) as AutomationServiceOption[];
  const existingOptionKeys = new Set(normalizedOptions.map((row) => row.key));
  const options = [
    ...normalizedOptions,
    ...defaults.serviceOptions.filter((row) => row.system && !existingOptionKeys.has(row.key)).map((row) => normalizeOption(row, normalizedOptions.length) as AutomationServiceOption),
  ];
  const platformWorkersRaw = raw?.platform_workers || raw?.platformWorkers;
  const platformWorkers = (Array.isArray(platformWorkersRaw) ? platformWorkersRaw : defaults.platformWorkers)
    .map((item: any) => ({ platformCode: clean(item?.platformCode || item?.platform_code), workerCode: clean(item?.workerCode || item?.worker_code), enabled: item?.enabled !== false }))
    .filter((item: PlatformWorkerSetting) => item.platformCode && item.workerCode);
  const mode = clean(raw?.trigger_mode || raw?.triggerMode);
  const intervalUnit = clean(raw?.custom_interval_unit || raw?.customIntervalUnit);
  const timeoutUnit = clean(raw?.flow_timeout_unit || raw?.flowTimeoutUnit);
  return {
    enabled: bool(raw?.automation_enabled ?? raw?.enabled, defaults.enabled),
    name: clean(raw?.automation_name || raw?.name || defaults.name),
    platformWorkers,
    triggerMode: (["every_message", "once_24h", "custom"].includes(mode) ? mode : defaults.triggerMode) as CustomerAutomationSettings["triggerMode"],
    customIntervalValue: number(raw?.custom_interval_value ?? raw?.customIntervalValue, defaults.customIntervalValue, 1),
    customIntervalUnit: (["minute", "hour", "day"].includes(intervalUnit) ? intervalUnit : defaults.customIntervalUnit) as CustomerAutomationSettings["customIntervalUnit"],
    scheduleEnabled: bool(raw?.schedule_enabled ?? raw?.scheduleEnabled, defaults.scheduleEnabled),
    scheduleStart: clean(raw?.schedule_start || raw?.scheduleStart || defaults.scheduleStart).slice(0, 5),
    scheduleEnd: clean(raw?.schedule_end || raw?.scheduleEnd || defaults.scheduleEnd).slice(0, 5),
    scheduleDays: (Array.isArray(raw?.schedule_days || raw?.scheduleDays) ? (raw?.schedule_days || raw?.scheduleDays) : defaults.scheduleDays).map(Number).filter((day: number) => day >= 0 && day <= 6),
    messages: {
      start: message(rawMessages.start, defaults.messages.start),
      welcome: message(rawMessages.welcome, defaults.messages.welcome),
      servicePrompt: message(rawMessages.servicePrompt || { text: raw?.service_selection_message }, defaults.messages.servicePrompt),
      noMatch: message(rawMessages.noMatch, defaults.messages.noMatch),
      validationFallback: message(rawMessages.validationFallback, defaults.messages.validationFallback),
      cancelled: message(rawMessages.cancelled, defaults.messages.cancelled),
      restarted: message(rawMessages.restarted, defaults.messages.restarted),
    },
    serviceOptions: options.sort((a, b) => a.sortOrder - b.sortOrder),
    flowTimeoutValue: number(raw?.flow_timeout_value ?? raw?.flowTimeoutValue, defaults.flowTimeoutValue, 1),
    flowTimeoutUnit: (["minute", "hour"].includes(timeoutUnit) ? timeoutUnit : defaults.flowTimeoutUnit) as CustomerAutomationSettings["flowTimeoutUnit"],
    restartKeywords: textList(raw?.restart_keywords || raw?.restartKeywords, defaults.restartKeywords),
    cancelKeywords: textList(raw?.cancel_keywords || raw?.cancelKeywords, defaults.cancelKeywords),
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
