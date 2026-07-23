export type FinanceDetailValues = {
  customerName?: string;
  carName?: string;
  phone?: string;
};

export type ParsedFinanceDetails = {
  values: Required<FinanceDetailValues>;
  captured: FinanceDetailValues;
  missing: Array<keyof FinanceDetailValues>;
};

export const FINANCE_COMBINED_PROMPT = "برجاء إدخال بيانات التمويل 👇\nالاسم\nالسيارة\nرقم الجوال";

const FIELD_LABELS: Record<keyof FinanceDetailValues, string> = {
  customerName: "الاسم",
  carName: "السيارة",
  phone: "رقم الجوال",
};

const CAR_HINTS = new Set([
  "تويوتا", "هيونداي", "هوندا", "نيسان", "كيا", "فورد", "شيفروليه", "جيلي", "شانجان", "هافال",
  "شيري", "جاك", "بايك", "هونشي", "مازدا", "ميتسوبيشي", "سوزوكي", "رينو", "بيجو", "لكزس",
  "مرسيدس", "اودي", "بي ام", "bmw", "mg", "gac", "سوناتا", "النترا", "اكسنت", "كامري", "كورولا",
  "يارس", "توسان", "سنتافي", "سبورتاج", "سيراتو", "اوبتيما", "k5", "باترول", "صني", "اكستريل",
]);

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function trimValue(value: unknown) {
  return clean(value)
    .replace(/^[\s,،;؛:：=|/\\\-–—]+|[\s,،;؛:：=|/\\\-–—]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeFinancePhone(value: unknown) {
  let digits = clean(value).replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = digits.slice(2);
  if (/^05\d{8}$/.test(digits)) digits = `966${digits.slice(1)}`;
  else if (/^5\d{8}$/.test(digits)) digits = `966${digits}`;
  return /^9665\d{8}$/.test(digits) ? digits : "";
}

function extractPhone(value: string) {
  const match = value.match(/(?:00966|\+?966|0)?[\s().\-]*5(?:[\s().\-]*\d){8}/u);
  if (!match) return { phone: "", raw: "" };
  return { phone: normalizeFinancePhone(match[0]), raw: match[0] };
}

function markLabels(value: string) {
  return value
    .replace(/(?:اسم\s*العميل|الاسم\s*الكامل|الاسم|name)\s*[:：=\-–—]*/giu, "\n[[customerName]] ")
    .replace(/(?:اسم\s*السيار(?:ة|ه)|نوع\s*السيار(?:ة|ه)|السيار(?:ة|ه)|car)\s*[:：=\-–—]*/giu, "\n[[carName]] ")
    .replace(/(?:رقم\s*(?:الجوال|الهاتف|الموبايل)|الجوال|الهاتف|الموبايل|phone|mobile)\s*[:：=\-–—]*/giu, "\n[[phone]] ");
}

function extractLabeledValues(value: string) {
  const captured: FinanceDetailValues = {};
  const marked = markLabels(value);
  const expression = /\[\[(customerName|carName|phone)\]\]\s*([\s\S]*?)(?=\n?\[\[(?:customerName|carName|phone)\]\]|$)/gu;
  for (const match of marked.matchAll(expression)) {
    const field = match[1] as keyof FinanceDetailValues;
    const raw = trimValue(match[2]);
    if (!raw) continue;
    if (field === "phone") {
      const phone = normalizeFinancePhone(raw);
      if (phone) captured.phone = phone;
    } else {
      captured[field] = raw;
    }
  }
  return captured;
}

function removeLabels(value: string) {
  return value
    .replace(/(?:اسم\s*العميل|الاسم\s*الكامل|الاسم|name)\s*[:：=\-–—]*/giu, "\n")
    .replace(/(?:اسم\s*السيار(?:ة|ه)|نوع\s*السيار(?:ة|ه)|السيار(?:ة|ه)|car)\s*[:：=\-–—]*/giu, "\n")
    .replace(/(?:رقم\s*(?:الجوال|الهاتف|الموبايل)|الجوال|الهاتف|الموبايل|phone|mobile)\s*[:：=\-–—]*/giu, "\n");
}

function normalizedCompare(value: unknown) {
  return trimValue(value).toLocaleLowerCase("ar").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
}

function splitSegments(value: string, excluded: string[]) {
  const excludedValues = new Set(excluded.filter(Boolean).map(normalizedCompare));
  return value
    .replace(/\s+[\-–—]\s+/gu, "\n")
    .split(/[\r\n,،;؛|/\\]+/u)
    .map(trimValue)
    .filter(Boolean)
    .filter((item) => !excludedValues.has(normalizedCompare(item)));
}

function splitNameAndCar(value: string) {
  const words = trimValue(value).split(/\s+/u).filter(Boolean);
  if (words.length < 2) return null;
  const normalizedWords = words.map(normalizedCompare);
  let carIndex = normalizedWords.findIndex((word, index) => index > 0 && (CAR_HINTS.has(word) || /\d/u.test(word)));
  if (carIndex < 1) carIndex = words.length === 2 ? 1 : words.length - 1;
  return {
    customerName: trimValue(words.slice(0, carIndex).join(" ")),
    carName: trimValue(words.slice(carIndex).join(" ")),
  };
}

export function parseFinanceCombinedDetails(input: unknown, existing: FinanceDetailValues = {}): ParsedFinanceDetails {
  const raw = clean(input);
  const values: Required<FinanceDetailValues> = {
    customerName: trimValue(existing.customerName),
    carName: trimValue(existing.carName),
    phone: normalizeFinancePhone(existing.phone),
  };
  const captured: FinanceDetailValues = {};
  const labeled = extractLabeledValues(raw);
  if (labeled.customerName) captured.customerName = labeled.customerName;
  if (labeled.carName) captured.carName = labeled.carName;
  if (labeled.phone) captured.phone = labeled.phone;

  const extractedPhone = extractPhone(raw);
  if (!captured.phone && extractedPhone.phone) captured.phone = extractedPhone.phone;

  let residual = removeLabels(raw);
  if (extractedPhone.raw) residual = residual.replace(extractedPhone.raw, "\n");
  const excluded = [captured.customerName || "", captured.carName || ""];
  const segments = splitSegments(residual, excluded);
  const missingTextFields = (["customerName", "carName"] as const).filter((field) => !values[field] && !captured[field]);

  if (missingTextFields.length === 1 && segments.length) {
    captured[missingTextFields[0]] = trimValue(segments.join(" "));
  } else if (missingTextFields.length === 2) {
    if (segments.length >= 2) {
      captured.customerName = trimValue(segments[0]);
      captured.carName = trimValue(segments.slice(1).join(" "));
    } else if (segments.length === 1) {
      const split = extractedPhone.phone ? splitNameAndCar(segments[0]) : null;
      if (split) {
        captured.customerName = split.customerName;
        captured.carName = split.carName;
      } else {
        captured.customerName = trimValue(segments[0]);
      }
    }
  }

  if (captured.customerName) values.customerName = trimValue(captured.customerName);
  if (captured.carName) values.carName = trimValue(captured.carName);
  if (captured.phone) values.phone = normalizeFinancePhone(captured.phone);

  const missing = (["customerName", "carName", "phone"] as const).filter((field) => !values[field]);
  return { values, captured, missing };
}

export function financeMissingPrompt(missing: Array<keyof FinanceDetailValues>) {
  if (!missing.length) return "";
  if (missing.length === 3) return FINANCE_COMBINED_PROMPT;
  return `برجاء استكمال بيانات التمويل التالية 👇\n${missing.map((field) => FIELD_LABELS[field]).join("\n")}`;
}
