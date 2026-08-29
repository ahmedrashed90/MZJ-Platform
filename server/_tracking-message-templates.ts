import { clean } from "./_tracking-utils.js";

export const TRACKING_SMS_TEMPLATE_STAGES = new Set([1, 9, 10]);

const DEFAULT_TRACKING_SMS_TEMPLATES: Record<number, string> = {
  1: `عميلنا العزيز / {customer_name}
مرحباً بكم في مجموعة محمد ذعار العجمي للسيارات
تم تسجيل طلب شرائكم بنجاح ✅
عدد السيارات: {vehicles_count}
الإجمالي قبل الضريبة: {subtotal_before_tax} ر.س
قيمة الضريبة: {tax_value} ر.س
الإجمالي شامل الضريبة: {total_incl_vat} ر.س
يمكنكم متابعة حالة الطلب عبر الرابط التالي:
{tracking_link}
مع مجموعة محمد ذعار العجمي للسيارات أنت نجم الطريق ⭐
📞 920014635
رابط التواصل واتساب https://api.whatsapp.com/send?phone=966920014635`,
  9: `عميلنا العزيز / {customer_name}
يسعدنا إبلاغك بجاهزية سيارتك، الآن يمكنك الحضور للاستلام أو طلب خدمة الشحن.
نشكرك على ثقتك، مع محمد ذعار العجمي للسيارات أنت نجم الطريق ⭐

مواعيد العمل:
الفترة الصباحية من الساعة 9 صباحاً إلى 11 صباحاً
الفترة المسائية من الساعة 4 مساءً إلى 9 مساءً
يوم الجمعة المساء فقط

متابعة الطلب: {tracking_link}`,
  10: `عميلنا العزيز / {customer_name}
نبارك لكم إتمام عملية التسليم بنجاح.
يشرفنا في مجموعة محمد ذعار العجمي للسيارات خدمتكم، ونتمنى لكم قيادة آمنة وتجربة ممتعة.
#نجم_الطريق`,
};

export function defaultTrackingSmsTemplate(stageOrder: unknown) {
  return DEFAULT_TRACKING_SMS_TEMPLATES[Number(stageOrder || 0)] || "";
}

export function effectiveTrackingSmsTemplate(stageOrder: unknown, configuredTemplate: unknown) {
  const configured = clean(configuredTemplate);
  return configured || defaultTrackingSmsTemplate(stageOrder);
}

export function renderTrackingSmsTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{([a-z0-9_]+)\}/gi, (match, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? match : String(value);
  });
}
