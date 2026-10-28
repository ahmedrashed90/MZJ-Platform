/** MZJ platform forms: isolated schema/types; no dependencies on CRM or marketing workflows. */
import type { FormDesign } from './lead-form-design.js';
export type { FormDesign, DesignBlock, DesignBlockKind } from './lead-form-design.js';
export { createTemplateDesign, resolveFormDesign, DESIGN_BLOCK_LABELS } from './lead-form-design.js';
export type FormTemplate = 'steps' | 'visual' | 'chat' | 'quiz' | 'minimal' | 'classic';
export type FormField = { id: string; label: string; type: 'choice' | 'text' | 'number'; options: string[]; optionImages?: Record<string,string>; description?: string; required: boolean; showIf?: { fieldId: string; equals: string } | null };
export type FormStyle = { brown: string; cream: string; welcome: string; actionLabel: string; successTitle: string; successMessage: string; coverUrl: string; logoUrl: string };
export type FormConfig = { fields: FormField[]; style: FormStyle; design?: FormDesign };
export type SavedFormDesign = {id:string;name:string;template:FormTemplate;config:FormConfig;created_at:string;updated_at:string};
export type FormStatus = 'draft' | 'published' | 'paused' | 'archived';
// Legacy string columns remain supported for forms linked before the sheet-header mapper.
export type SheetColumnMapping = { header: string; source: string; value?: string };
export type SheetColumnConfig = string | SheetColumnMapping;
export type LeadForm = { id: string; slug: string; title: string; description: string; template: FormTemplate; status: FormStatus; config: FormConfig; published_config?: FormConfig | null; published_metadata?: {title:string;description:string;template:FormTemplate} | null; sheet_id: string; sheet_tab: string; sheet_columns: SheetColumnConfig[]; created_at: string; updated_at: string; published_at: string | null; visits: number; submissions: number; sheet_pending: number };
export type LeadRow = { id: string; form_id: string; form_title: string; name: string; phone: string; answers: Record<string,string>; source: string; campaign: string; medium: string; ad_id: string; created_at: string; sheet_status: string; sheet_error: string | null };
export const FORM_TEMPLATES: { id: FormTemplate; name: string; description: string; glyph: string }[] = [
  { id: 'steps', name: 'خطوة بخطوة', description: 'سؤال في كل شاشة مع شريط تقدم', glyph: '01' },
  { id: 'visual', name: 'البطاقات المصورة', description: 'بطاقات كبيرة وتفاعل بصري مع الاختيارات', glyph: '02' },
  { id: 'chat', name: 'محادثة تفاعلية', description: 'خطوات تشبه المحادثة مع العميل', glyph: '03' },
  { id: 'quiz', name: 'اختبار تفاعلي', description: 'أسئلة حماسية مع انتقالات سلسة', glyph: '04' },
  { id: 'minimal', name: 'الحد الأدنى', description: 'خطوات أنيقة بدون مشتتات', glyph: '05' },
  { id: 'classic', name: 'الكلاسيكي', description: 'نموذج مقسم وسريع الاستخدام', glyph: '06' },
];
export const DEFAULT_FORM_CONFIG: FormConfig = {
  fields: [
    { id: 'vehicle', label: 'إيه السيارة اللي بتدور عليها؟', type: 'choice', required: true, options: ['هيونداي', 'تويوتا', 'نيسان', 'أخرى'] },
    { id: 'purchase', label: 'تحب تشتري إزاي؟', type: 'choice', required: true, options: ['كاش', 'تمويل'] },
    { id: 'timeline', label: 'إمتى ناوي تشتري؟', type: 'choice', required: true, options: ['في أقرب وقت', 'خلال شهر', 'لسه بقارن'] },
  ],
  style: { brown: '#4A211C', cream: '#F3E8DC', welcome: 'سيارتك أقرب مما تتخيل', actionLabel: 'إرسال الطلب', successTitle: 'تم استلام طلبك بنجاح', successMessage: 'شكرًا لتواصلك مع محمد ذعار العجمي للسيارات.', coverUrl: '', logoUrl: '/logo.png' },
};
export const DEFAULT_SHEET_COLUMNS = ['name', 'phone', 'source', 'campaign', 'vehicle', 'purchase', 'timeline', 'submitted_at'];
export const AVAILABLE_SHEET_COLUMNS = [
  { code: 'name', label: 'اسم العميل' }, { code: 'phone', label: 'رقم الجوال' },
  { code: 'source', label: 'مصدر الزيارة' }, { code: 'campaign', label: 'اسم الحملة' },
  { code: 'medium', label: 'الوسيط الإعلاني' }, { code: 'ad_id', label: 'معرف الإعلان' },
  { code: 'form', label: 'اسم الفورم' }, { code: 'vehicle', label: 'السيارة' },
  { code: 'purchase', label: 'طريقة الشراء' }, { code: 'timeline', label: 'موعد الشراء' },
  { code: 'submitted_at', label: 'تاريخ التسجيل' }, { code: 'lead_id', label: 'معرف الليد' },
];
