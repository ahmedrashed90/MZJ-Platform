/** Declarative CRM answer mapping. Only customer-profile fields are allowed;
 * assignment, status, payment, source and system identifiers are never targets. */
export const FORM_CRM_FIELDS = [
  { value: 'auto', label: 'تلقائي حسب السؤال' },
  { value: 'car_type', label: 'نوع السيارة' },
  { value: 'age', label: 'العمر' },
  { value: 'salary', label: 'الراتب' },
  { value: 'obligation', label: 'الالتزام إن وجد' },
  { value: 'salary_bank', label: 'نزول الراتب على أي بنك' },
  { value: 'location', label: 'المكان' },
  { value: 'car_model', label: 'الموديل' },
  { value: 'car_category', label: 'الفئة' },
  { value: 'color', label: 'اللون' },
  { value: 'notes', label: 'الملاحظات' },
] as const;
export type FormCrmField = typeof FORM_CRM_FIELDS[number]['value'];
export type ResolvedFormCrmField = Exclude<FormCrmField, 'auto'>;
export type ProfileField = Exclude<ResolvedFormCrmField, 'notes'>;

export function sanitizeFormCrmField(value: unknown): FormCrmField | undefined {
  return FORM_CRM_FIELDS.find(field => field.value === value)?.value;
}

function normalized(value: unknown): string {
  return String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/gu, '')
    .replace(/[أإآٱ]/gu, 'ا').replace(/ى/gu, 'ي').replace(/ة/gu, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Infer existing forms without republishing. Specific and non-profile questions
 * take precedence over broad keywords (e.g. بنك الراتب, موعد شراء السيارة). */
export function resolveFormCrmField(id: unknown, label: unknown, configured?: unknown): ResolvedFormCrmField {
  const explicit = sanitizeFormCrmField(configured);
  if (explicit && explicit !== 'auto') return explicit;
  const text = normalized(label);
  const key = normalized(id);
  const has = (pattern: RegExp) => pattern.test(text);
  if (has(/(?:متي|امتي|موعد|توقيت|مده|خلال|وقت).*(?:شراء|تشتري|ناوي|السياره)|(?:نوع|طبيعه|جه[هة])\s*(?:وظيف|عمل)|وظيفت|جهه العمل|قطاع العمل|\b(?:timeline|employment|job|employer|purchase timing)\b/u)) return 'notes';
  if (has(/بنك|مصرف|\b(?:bank|salary bank)\b/u)) return 'salary_bank';
  if (has(/التزام|استقطاع|اقساط شهريه|\b(?:obligation|obligations|monthly debt)\b/u)) return 'obligation';
  if (has(/راتب|دخل شهري|\b(?:salary|monthly income)\b/u)) return 'salary';
  if (has(/(?:^| )عمر(?:ك)?(?: |$)|(?:^| )السن(?: |$)|\b(?:age)\b/u)) return 'age';
  if (has(/موديل|طراز|سنه الصنع|\b(?:model|model year)\b/u)) return 'car_model';
  if (has(/(?:^| )(?:الفئه|فئه|الفئه المطلوبه)(?: |$)|\b(?:trim|vehicle category)\b/u)) return 'car_category';
  if (has(/(?:^| )اللون(?: |$)|(?:^| )لون(?: |$)|\b(?:color|colour)\b/u)) return 'color';
  if (has(/مدينه|مدينتك|المنطقه|مكان السكن|المكان|\b(?:city|location)\b/u)) return 'location';
  if (has(/(?:^| )(?:ما|ايه|اي|وش|اسم|نوع|حدد|اختر|اختار) (?:السياره|سياره|الماركه|ماركه)|^(?:السياره|نوع السياره|اسم السياره|الماركه)$|\b(?:vehicle|car name|car type)\b/u)) return 'car_type';
  const aliases: Record<string, ResolvedFormCrmField> = {
    vehicle:'car_type', car:'car_type', 'car name':'car_type', 'car type':'car_type',
    age:'age', salary:'salary', 'monthly salary':'salary', income:'salary',
    obligation:'obligation', obligations:'obligation', 'monthly obligations':'obligation',
    bank:'salary_bank', 'salary bank':'salary_bank', city:'location', location:'location',
    model:'car_model', 'car model':'car_model', category:'car_category', 'car category':'car_category',
    color:'color', colour:'color', timeline:'notes', job:'notes', employment:'notes', purchase:'notes',
  };
  return Object.hasOwn(aliases, key) ? aliases[key] : 'notes';
}

/** Accept an exact nonnegative number, optionally with SAR and correctly grouped
 * digits. Ranges, lower/upper bounds and approximate values remain literal notes. */
export function exactFormCrmNumber(value: string, field: 'age'|'salary'|'obligation'): number | null {
  let text = value.normalize('NFKC').trim()
    .replace(/[٠-٩]/gu, c => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/gu, c => String(c.charCodeAt(0) - 0x6f0))
    .replace(/\u066c/gu, ',').replace(/\u066b/gu, '.');
  if (field === 'obligation' && /^(?:لا يوجد|لا توجد|بدون التزامات|بدون التزام|لا شيء|none|no obligations)$/u.test(normalized(text))) return 0;
  text = text.replace(field === 'age' ? /\s*(?:سنة|سنه|عام|years?)$/iu : /\s*(?:ريال(?: سعودي)?|ر\s*\.?\s*س\.?|SAR|﷼)$/iu, '').trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/u.test(text)) return null;
  const number = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(number) || number < 0 || number >= 1e12) return null;
  if (field === 'age' && (!Number.isInteger(number) || number < 1 || number > 120)) return null;
  return number;
}

export type FormCrmAnswer = { id: string; label: string; value: string; field: ResolvedFormCrmField; profileValue: string | number | null };
function readableAnswer(value: string): { text: string; multiple: boolean } {
  if (value.startsWith('[')) {
    try {
      const array: unknown = JSON.parse(value);
      if (Array.isArray(array) && array.length && array.every(v => typeof v === 'string')) return { text: array.join('، '), multiple: array.length > 1 };
    } catch { /* Ordinary text is not a JSON choice list. */ }
  }
  return { text: value, multiple: false };
}
export function formCrmAnswers(answers: Record<string,string> | null | undefined, labels: Record<string,string> | null | undefined, mappings?: Record<string,unknown> | null): FormCrmAnswer[] {
  const entries: FormCrmAnswer[] = [];
  for (const [id, raw] of Object.entries(answers || {})) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const label = String(labels?.[id] || id).trim();
    const field = resolveFormCrmField(id, label, mappings?.[id]);
    const {text, multiple} = readableAnswer(raw.trim());
    const profileValue = field === 'notes' || multiple ? null :
      field === 'age' || field === 'salary' || field === 'obligation' ? exactFormCrmNumber(text, field) : text;
    entries.push({id,label,value:text,field,profileValue});
  }
  return entries;
}
