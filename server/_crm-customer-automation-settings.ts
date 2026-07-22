import { clean } from "./_crm-utils.js";
import { getSql } from "./_db.js";

export type TriggerPolicy = "every_message" | "every_24_hours" | "custom_interval";
export type IntervalUnit = "minute" | "hour" | "day";

export type AutomationBinding = {
  platformCode: string;
  workerCode: string;
  enabled: boolean;
};

export type AutomationChoice = {
  key: "cash" | "finance" | "service";
  label: string;
  emoji: string;
  aliases: string[];
  enabled: boolean;
  sortOrder: number;
};

export type AutomationMessages = {
  greeting: string;
  servicePrompt: string;
  noMatch: string;
};

export type AutomationFlows = {
  cash: { completionMessage: string };
  finance: {
    startMessage: string;
    nameQuestion: string;
    nameError: string;
    carQuestion: string;
    carError: string;
    phoneQuestion: string;
    phoneError: string;
    completionMessage: string;
  };
  service: { completionMessage: string };
};

export type CustomerAutomationSettings = {
  enabled: boolean;
  name: string;
  triggerPolicy: TriggerPolicy;
  intervalValue: number;
  intervalUnit: IntervalUnit;
  bindings: AutomationBinding[];
  messages: AutomationMessages;
  choices: AutomationChoice[];
  flows: AutomationFlows;
  version: number;
  updatedAt?: string | null;
  updatedBy?: string | null;
};

export const CUSTOMER_AUTOMATION_DEFAULTS: CustomerAutomationSettings = {
  enabled: true,
  name: "أوتوميشن استقبال عملاء CRM",
  triggerPolicy: "every_message",
  intervalValue: 24,
  intervalUnit: "hour",
  bindings: [],
  messages: {
    greeting: "مرحباً بك في مجموعة محمد بن ذعار العجمي للسيارات 👋",
    servicePrompt: "برجاء اختيار الخدمة:",
    noMatch: "برجاء اختيار إحدى الخدمات الظاهرة في القائمة.",
  },
  choices: [
    { key: "cash", label: "مبيعات الكاش", emoji: "💰", aliases: ["1", "كاش", "مبيعات كاش", "مبيعات الكاش", "شراء كاش"], enabled: true, sortOrder: 10 },
    { key: "finance", label: "مبيعات التمويل", emoji: "🏦", aliases: ["2", "تمويل", "مبيعات تمويل", "مبيعات التمويل", "شراء تمويل"], enabled: true, sortOrder: 20 },
    { key: "service", label: "خدمة العملاء", emoji: "🛠", aliases: ["3", "خدمة العملاء", "خدمه العملاء", "خدمة", "خدمة عملاء"], enabled: true, sortOrder: 30 },
  ],
  flows: {
    cash: { completionMessage: "تم تحويل طلبك إلى قسم مبيعات الكاش ✅\nسيتم التواصل معك قريباً" },
    finance: {
      startMessage: "برجاء إدخال بيانات التمويل 👇",
      nameQuestion: "الاسم",
      nameError: "برجاء إدخال الاسم.",
      carQuestion: "السيارة",
      carError: "برجاء إدخال السيارة المطلوبة.",
      phoneQuestion: "رقم الجوال",
      phoneError: "برجاء إدخال رقم جوال صحيح.",
      completionMessage: "سيتم التواصل معك في أقرب وقت\nنسعد بخدمتكم دائمًا 🌹",
    },
    service: { completionMessage: "سيتم التواصل معك قريباً من أحد ممثلي قسم خدمة العملاء 👨‍🔧" },
  },
  version: 1,
};

function bool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  const token = clean(value).toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(token)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(token)) return false;
  return fallback;
}

function int(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function text(value: unknown, fallback: string, allowEmpty = false) {
  const result = clean(value);
  return result || (allowEmpty ? "" : fallback);
}

function textList(value: unknown, fallback: string[]) {
  const list = Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
  return list.length ? [...new Set(list)] : [...fallback];
}

function normalizePolicy(value: unknown): TriggerPolicy {
  const token = clean(value);
  return token === "every_24_hours" || token === "custom_interval" ? token : "every_message";
}

function normalizeUnit(value: unknown): IntervalUnit {
  const token = clean(value);
  return token === "minute" || token === "day" ? token : "hour";
}

function rawChoice(rawChoices: unknown, key: AutomationChoice["key"]) {
  return Array.isArray(rawChoices) ? rawChoices.find((item: any) => clean(item?.key) === key) : null;
}

export function normalizeCustomerAutomationSettings(raw: any): CustomerAutomationSettings {
  const defaults = CUSTOMER_AUTOMATION_DEFAULTS;
  const rawBindings = raw?.platform_bindings ?? raw?.bindings;
  const rawMessages = raw?.entry_messages ?? raw?.messages;
  const rawChoices = raw?.service_choices ?? raw?.choices;
  const rawFlows = raw?.flow_messages ?? raw?.flows;

  const bindings = Array.isArray(rawBindings)
    ? rawBindings.map((item: any) => ({
        platformCode: clean(item?.platformCode || item?.platform_code).toLowerCase(),
        workerCode: clean(item?.workerCode || item?.worker_code).toLowerCase(),
        enabled: bool(item?.enabled, true),
      })).filter((item: AutomationBinding) => item.platformCode && item.workerCode)
    : [];

  const choices = defaults.choices.map((fixed) => {
    const item = rawChoice(rawChoices, fixed.key) || {};
    return {
      ...fixed,
      label: text(item.label, fixed.label),
      emoji: text(item.emoji, fixed.emoji, true),
      aliases: textList(item.aliases, fixed.aliases),
      enabled: bool(item.enabled, fixed.enabled),
      sortOrder: int(item.sortOrder ?? item.sort_order, fixed.sortOrder, 1, 999),
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    enabled: bool(raw?.enabled, defaults.enabled),
    name: text(raw?.automation_name ?? raw?.name, defaults.name),
    triggerPolicy: normalizePolicy(raw?.trigger_policy ?? raw?.triggerPolicy),
    intervalValue: int(raw?.interval_value ?? raw?.intervalValue, defaults.intervalValue, 1, 100000),
    intervalUnit: normalizeUnit(raw?.interval_unit ?? raw?.intervalUnit),
    bindings,
    messages: {
      greeting: text(rawMessages?.greeting, defaults.messages.greeting),
      servicePrompt: text(rawMessages?.servicePrompt ?? rawMessages?.service_prompt, defaults.messages.servicePrompt),
      noMatch: text(rawMessages?.noMatch ?? rawMessages?.no_match, defaults.messages.noMatch),
    },
    choices,
    flows: {
      cash: {
        completionMessage: text(rawFlows?.cash?.completionMessage ?? rawFlows?.cash?.completion_message, defaults.flows.cash.completionMessage),
      },
      finance: {
        startMessage: text(rawFlows?.finance?.startMessage ?? rawFlows?.finance?.start_message, defaults.flows.finance.startMessage),
        nameQuestion: text(rawFlows?.finance?.nameQuestion ?? rawFlows?.finance?.name_question, defaults.flows.finance.nameQuestion),
        nameError: text(rawFlows?.finance?.nameError ?? rawFlows?.finance?.name_error, defaults.flows.finance.nameError),
        carQuestion: text(rawFlows?.finance?.carQuestion ?? rawFlows?.finance?.car_question, defaults.flows.finance.carQuestion),
        carError: text(rawFlows?.finance?.carError ?? rawFlows?.finance?.car_error, defaults.flows.finance.carError),
        phoneQuestion: text(rawFlows?.finance?.phoneQuestion ?? rawFlows?.finance?.phone_question, defaults.flows.finance.phoneQuestion),
        phoneError: text(rawFlows?.finance?.phoneError ?? rawFlows?.finance?.phone_error, defaults.flows.finance.phoneError),
        completionMessage: text(rawFlows?.finance?.completionMessage ?? rawFlows?.finance?.completion_message, defaults.flows.finance.completionMessage),
      },
      service: {
        completionMessage: text(rawFlows?.service?.completionMessage ?? rawFlows?.service?.completion_message, defaults.flows.service.completionMessage),
      },
    },
    version: int(raw?.version, defaults.version, 1, 1000000),
    updatedAt: raw?.updated_at || raw?.updatedAt || null,
    updatedBy: raw?.updated_by || raw?.updatedBy || null,
  };
}

export async function loadCustomerAutomationSettings() {
  const sql = getSql();
  const [row] = await sql<any[]>`select *,updated_by::text from crm.customer_automation_settings where id='default' limit 1`;
  return row ? normalizeCustomerAutomationSettings(row) : null;
}

export function intervalMilliseconds(settings: Pick<CustomerAutomationSettings, "triggerPolicy" | "intervalValue" | "intervalUnit">) {
  if (settings.triggerPolicy === "every_message") return 0;
  if (settings.triggerPolicy === "every_24_hours") return 24 * 60 * 60 * 1000;
  const multiplier = settings.intervalUnit === "minute" ? 60 * 1000 : settings.intervalUnit === "day" ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  return Math.max(1, settings.intervalValue) * multiplier;
}

export function platformFromWorkerCode(value: unknown) {
  const code = clean(value).toLowerCase();
  if (code.includes("facebook")) return "facebook";
  if (code.includes("instagram")) return "instagram";
  if (code.includes("whatsapp") || code.includes("mersal")) return "whatsapp";
  if (code.includes("tiktok")) return "tiktok";
  if (code.includes("snapchat")) return "snapchat";
  return code.replace(/[_-](chat|worker)$/g, "");
}
