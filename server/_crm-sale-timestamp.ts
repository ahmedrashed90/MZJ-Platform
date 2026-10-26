const RIYADH_TIME_ZONE = "Asia/Riyadh";
const RIYADH_UTC_OFFSET = "+03:00";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function calendarDate(value: unknown) {
  const raw = clean(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = parseTimestamp(raw);
  if (!parsed) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RIYADH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function parseTimestamp(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = clean(value);
  if (!raw) return null;

  // ERPNext commonly sends `creation` without a timezone. It is a Riyadh-local
  // wall clock value, so never let the server's own timezone reinterpret it.
  const naive = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/.exec(raw);
  if (naive) {
    const milliseconds = (naive[3] || "").slice(0, 3).padEnd(3, "0");
    const parsed = new Date(`${naive[1]}T${naive[2]}.${milliseconds}${RIYADH_UTC_OFFSET}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeRiyadhTimestamp(value: unknown) {
  return parseTimestamp(value)?.toISOString() || null;
}

export function saleTimestampForOrder(orderDate: unknown, eventTimestamp: unknown, fallback = new Date()) {
  const eventDate = parseTimestamp(eventTimestamp) || parseTimestamp(fallback) || new Date();
  const businessDate = calendarDate(orderDate) || calendarDate(eventDate);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: RIYADH_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(eventDate);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "00";
  const milliseconds = String(eventDate.getUTCMilliseconds()).padStart(3, "0");
  return new Date(`${businessDate}T${part("hour")}:${part("minute")}:${part("second")}.${milliseconds}${RIYADH_UTC_OFFSET}`).toISOString();
}
