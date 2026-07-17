import type { CrmLead } from "./types";

const SOURCE_LABELS: Record<string, string> = {
  facebook: "فيسبوك",
  fb: "فيسبوك",
  meta: "فيسبوك",
  facebook_chat: "فيسبوك",
  "facebook-chat": "فيسبوك",
  instagram: "إنستجرام",
  ig: "إنستجرام",
  insta: "إنستجرام",
  instagram_chat: "إنستجرام",
  "instagram-chat": "إنستجرام",
  tiktok: "تيك توك",
  tt: "تيك توك",
  tik_tok: "تيك توك",
  tiktok_chat: "تيك توك",
  "tiktok-chat": "تيك توك",
  tiktok_snapchat: "تيك توك ليد وسناب شات ليد",
  "tiktok-snapchat": "تيك توك ليد وسناب شات ليد",
  snapchat: "سناب شات",
  snap: "سناب شات",
  whatsapp: "واتساب",
  wa: "واتساب",
  mersal: "واتساب",
  tiktok_lead: "تيك توك ليد",
  "tiktok-lead": "تيك توك ليد",
  snapchat_lead: "سناب شات ليد",
  "snapchat-lead": "سناب شات ليد",
  installment_calculator: "حاسبة التقسيط",
  "installment-calculator": "حاسبة التقسيط",
  installment: "حاسبة التقسيط",
  calculator: "حاسبة التقسيط",
  haraj: "موقع حراج",
  other_website: "موقع آخر",
  "other-website": "موقع آخر",
  branch: "خلال الفرع",
  friend: "صديق",
  unified_number: "اتصال الرقم الموحد",
  "unified-number": "اتصال الرقم الموحد",
  manual: "إدخال يدوي",
  manual_entry: "إدخال يدوي",
  "manual-entry": "إدخال يدوي",
};

const ARABIC_NORMALIZED: Record<string, string> = {
  فيسبوك: "فيسبوك",
  "فيس بوك": "فيسبوك",
  إنستجرام: "إنستجرام",
  انستجرام: "إنستجرام",
  انستغرام: "إنستجرام",
  "تيك توك": "تيك توك",
  "تيك توك ليد": "تيك توك ليد",
  "سناب شات": "سناب شات",
  "سناب شات ليد": "سناب شات ليد",
  واتساب: "واتساب",
  "حاسبة التقسيط": "حاسبة التقسيط",
  "حاسبه التقسيط": "حاسبة التقسيط",
  "موقع حراج": "موقع حراج",
  "موقع آخر": "موقع آخر",
  "موقع اخر": "موقع آخر",
  "خلال الفرع": "خلال الفرع",
  صديق: "صديق",
  "اتصال الرقم الموحد": "اتصال الرقم الموحد",
  "إدخال يدوي": "إدخال يدوي",
};

function normalize(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[\s/]+/g, "_");
}

export function sourceLabel(value?: string | null, fallback?: string | null) {
  const raw = String(value || "").trim();
  const fallbackRaw = String(fallback || "").trim();
  if (raw && ARABIC_NORMALIZED[raw]) return ARABIC_NORMALIZED[raw];
  if (fallbackRaw && ARABIC_NORMALIZED[fallbackRaw]) return ARABIC_NORMALIZED[fallbackRaw];

  const candidates = [raw, fallbackRaw].filter(Boolean);
  for (const candidate of candidates) {
    const key = normalize(candidate);
    if (SOURCE_LABELS[key]) return SOURCE_LABELS[key];
    if (key.includes("facebook") || key === "fb" || key.includes("فيسبوك") || key.includes("فيس_بوك")) return "فيسبوك";
    if (key.includes("instagram") || key === "ig" || key.includes("انستجرام") || key.includes("انستغرام")) return "إنستجرام";
    if ((key.includes("tiktok") || key.includes("تيك_توك")) && key.includes("lead")) return "تيك توك ليد";
    if (key.includes("snap") && key.includes("lead")) return "سناب شات ليد";
    if (key.includes("tiktok") || key.includes("تيك_توك")) return "تيك توك";
    if (key.includes("snap") || key.includes("سناب")) return "سناب شات";
    if (key.includes("whatsapp") || key.includes("mersal") || key.includes("واتساب") || key === "wa") return "واتساب";
    if (key.includes("installment") || key.includes("calculator") || key.includes("حاسبه_التقسيط")) return "حاسبة التقسيط";
    if (key.includes("haraj") || key.includes("حراج")) return "موقع حراج";
    if (key.includes("other_website") || key.includes("موقع_اخر")) return "موقع آخر";
    if (key.includes("branch") || key.includes("خلال_الفرع")) return "خلال الفرع";
    if (key.includes("friend") || key.includes("صديق")) return "صديق";
    if (key.includes("unified") || key.includes("رقم_الموحد")) return "اتصال الرقم الموحد";
    if (key.includes("manual") || key.includes("ادخال_يدوي")) return "إدخال يدوي";
  }
  return raw || fallbackRaw || "غير محدد";
}

export type MessagePolicy = {
  route: "whatsapp" | "facebook" | "instagram" | "tiktok";
  routeLabel: string;
  templateOnly: boolean;
  allowFreeText: boolean;
  reason: string;
};

export function messagePolicyForLead(
  lead?: Pick<CrmLead, "source_code" | "source_name" | "platform_code" | "channel_code"> | null,
  sourceConfig?: { name?: string; delivery_route?: "whatsapp" | "facebook" | "instagram" | "tiktok"; allow_free_text?: boolean } | null,
): MessagePolicy {
  const source = sourceLabel(lead?.source_code || lead?.platform_code, sourceConfig?.name || lead?.source_name);
  if (sourceConfig?.delivery_route) {
    const route = sourceConfig.delivery_route;
    const allowFreeText = route === "whatsapp" ? true : Boolean(sourceConfig.allow_free_text);
    const routeLabel = route === "whatsapp" ? "واتساب" : route === "facebook" ? "فيسبوك" : route === "instagram" ? "إنستجرام" : "تيك توك";
    return { route, routeLabel, templateOnly: false, allowFreeText, reason: route === "whatsapp" ? "الإرسال عبر واتساب بنص حر أو قالب" : `الإرسال عبر محادثة ${routeLabel}` };
  }
  const channel = normalize(lead?.channel_code);

  const templateOnlySources = new Set([
    "تيك توك ليد",
    "سناب شات ليد",
    "تيك توك ليد وسناب شات ليد",
    "حاسبة التقسيط",
    "خلال الفرع",
    "موقع حراج",
    "موقع آخر",
    "صديق",
    "اتصال الرقم الموحد",
    "إدخال يدوي",
  ]);
  if (templateOnlySources.has(source)) {
    return { route: "whatsapp", routeLabel: "واتساب", templateOnly: false, allowFreeText: true, reason: "الإرسال عبر واتساب بنص حر أو قالب" };
  }

  if (source === "فيسبوك" || channel.includes("facebook")) {
    return { route: "facebook", routeLabel: "فيسبوك", templateOnly: false, allowFreeText: true, reason: "الإرسال عبر محادثة فيسبوك" };
  }
  if (source === "إنستجرام" || channel.includes("instagram")) {
    return { route: "instagram", routeLabel: "إنستجرام", templateOnly: false, allowFreeText: true, reason: "الإرسال عبر محادثة إنستجرام" };
  }
  if (source === "تيك توك" || channel.includes("tiktok")) {
    return { route: "tiktok", routeLabel: "تيك توك", templateOnly: false, allowFreeText: true, reason: "الإرسال عبر محادثة تيك توك" };
  }

  const templateOnly = false;
  return {
    route: "whatsapp",
    routeLabel: "واتساب",
    templateOnly,
    allowFreeText: !templateOnly,
    reason: templateOnly ? "الإرسال عبر واتساب باستخدام القوالب فقط" : "الإرسال عبر واتساب بنص حر أو قالب",
  };
}

export function channelLabel(value?: string | null) {
  const key = normalize(value);
  if (key.includes("facebook")) return "فيسبوك";
  if (key.includes("instagram")) return "إنستجرام";
  if (key.includes("tiktok")) return "تيك توك";
  if (key.includes("whatsapp") || key.includes("mersal")) return "واتساب";
  return sourceLabel(value);
}

export function providerStatusLabel(value?: string | null) {
  const key = normalize(value);
  const map: Record<string, string> = {
    queued: "بانتظار الإرسال",
    sent: "تم الإرسال",
    delivered: "تم التسليم",
    read: "تمت القراءة",
    failed: "فشل الإرسال",
    received: "تم الاستلام",
  };
  return map[key] || String(value || "");
}
