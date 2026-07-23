export const DEPARTMENT_LABELS: Record<string, string> = {
  content: "قسم المحتوى",
  design: "التصميم",
  montage: "المونتاج",
  photography: "التصوير",
};

export function formatMarketingDate(value?: string | null, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-SA", withTime
    ? { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export function toLocalInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function statusTone(status: string) {
  if (["تم الاستلام", "تاسك معتمد", "تم النشر", "مكتملة"].includes(status)) return "success";
  if (["مطلوب تعديل", "متأخر"].includes(status)) return "danger";
  if (["في انتظار الاعتماد", "في انتظار اعتماد الهيكل", "في انتظار Task Template"].includes(status)) return "warning";
  if (["جاهز للتنفيذ", "تجهيز النشر", "مجدول", "مجدولة", "جاهز للجدولة"].includes(status)) return "info";
  return "neutral";
}

export function copyText(value: string) {
  return navigator.clipboard.writeText(value);
}
