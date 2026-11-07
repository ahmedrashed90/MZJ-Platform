/** Header suggestions are advisory only; the user must review/save every sheet column. */
import type { FormField, SheetColumnMapping } from './lead-forms.js';

const normalized = (text: string) => String(text || '')
  .toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي')
  .replace(/[\u064B-\u065F\u0670]/g,'').replace(/[^\p{L}\p{N}]+/gu,'');

const synonyms: Record<string,string[]> = {
  name: ['اسم العميل','الاسم','الاسم الكامل','اسم الزبون','name','fullname','customername','leadname'],
  phone: ['رقم الجوال','الجوال','رقم الهاتف','الهاتف','رقم الموبايل','mobile','phone','phonenumber','mobilenumber','telephone','contactnumber'],
  vehicle: ['السيارة','اسم السيارة','السياره المطلوبة','نوع السيارة','الموديل','model','vehicle','car','carname'],
  source: ['المصدر','مصدر العميل','مصدر الزيارة','مصدر الليد','source','leadsource'],
  campaign: ['اسم الحملة','الحملة','campaign','campaignname'],
  submitted_at: ['التاريخ والوقت','تاريخ ووقت التسجيل','تاريخ التسجيل','تاريخ الاضافة','التاريخ','creationtime','createdat','date','submittedat'],
  purchase: ['طريقة الشراء','نوع الشراء','كاش او تمويل','purchase','purchasetype'],
  timeline: ['موعد الشراء','وقت الشراء','توقيت الشراء','timeline'],
  medium: ['الوسيط الاعلاني','medium','utmmedium'],
  ad_id: ['معرف الاعلان','رقم الاعلان','adid'],
  form: ['اسم الفورم','الفورم','form','formname'],
  lead_id: ['معرف الليد','leadid'],
};

export function suggestSheetColumn(header: string, fields: FormField[]): SheetColumnMapping {
  const target=normalized(header);
  if (!target) return {header,source:''};
  // This is the value expected by the user's sample OpenSouq sheet, but is editable.
  if (['الحالة','حاله','status','leadstatus'].some(x=>normalized(x)===target)) return {header,source:'fixed',value:'تم الحفظ'};
  for (const [code,variants] of Object.entries(synonyms)) {
    if (variants.some(v=>normalized(v)===target)) return {header,source:code};
  }
  const field=fields.find(f=>normalized(f.label)===target);
  return {header,source:field?`answers.${field.id}`:''};
}

export function mapSavedColumns(headers: string[], saved: (string | SheetColumnMapping)[], fields: FormField[]): SheetColumnMapping[] {
  if (saved.length===headers.length && saved.every(v=>typeof v==='string'))
    return headers.map((header,i)=>({header,source:saved[i] as string}));
  if (saved.length===headers.length && saved.every((v,i)=>typeof v==='object' && v!==null && (v as SheetColumnMapping).header===headers[i]))
    return saved.map((v,i)=>({...v as SheetColumnMapping,header:headers[i]}));
  return headers.map(header=>suggestSheetColumn(header,fields));
}
