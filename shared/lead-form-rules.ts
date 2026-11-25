/** Declarative conditional choices. Both the editor and public submission use the same rules. */
import type { FormField } from './lead-forms.js';
import type { FormDesign } from './lead-form-design.js';

export type ChoiceCondition = { fieldId: string; equals: string };
export type ChoiceOptionRule = { conditions: ChoiceCondition[]; options: string[] };

export function isVisibleField(field: FormField, answers: Record<string,string>): boolean {
  return !field.showIf || answers[field.showIf.fieldId] === field.showIf.equals;
}

/** First matching rule wins. A rule may check two or more preceding answers (AND). */
export function effectiveChoiceOptions(field: FormField, answers: Record<string,string>): string[] {
  if (!isChoiceType(field.type)) return [];
  const matched = (field.optionRules || []).find(rule => rule.conditions.length > 0 &&
    rule.conditions.every(condition => answers[condition.fieldId] === condition.equals));
  return matched ? matched.options : field.options;
}

/** An explicit screen without a question block is an informational step.
 * An empty choice group also has no answer to collect. Legacy layouts retain their input. */
export function acceptsFieldAnswer(field: FormField, answers: Record<string,string>, design?: FormDesign): boolean {
  const stepId = field.stepId || field.id;
  const screen = design?.screens?.[stepId];
  if (Array.isArray(screen) && !screen.some(block => block.kind === 'question' && (block.fieldId || stepId) === field.id)) return false;
  return !isChoiceType(field.type) || effectiveChoiceOptions(field,answers).some(option => option.trim());
}

/** Remove a choice from this question, including conditional groups and its media. */
export function removeChoiceOption(field: FormField, option: string): FormField {
  const optionImages = {...field.optionImages};
  const optionImageModes = {...field.optionImageModes};
  delete optionImages[option];
  delete optionImageModes[option];
  return {...field, options:field.options.filter(value => value !== option),
    optionRules:field.optionRules?.map(rule => ({...rule,options:rule.options.filter(value => value !== option)})),
    optionImages,optionImageModes};
}

/** Remove answers to hidden questions or choices no longer valid after a parent answer changes. */
export function validFormAnswers(fields: FormField[], raw: Record<string,string>, design?: FormDesign): Record<string,string> {
  const result: Record<string,string> = {};
  for (const field of fields) {
    if (!isVisibleField(field,result) || !acceptsFieldAnswer(field,result,design)) continue;
    const value = raw[field.id];
    if (!value) continue;
    if (field.type === 'multi') {
      const selected=multiAnswers(value).filter(option=>effectiveChoiceOptions(field,result).includes(option));
      if(selected.length)result[field.id]=JSON.stringify(selected);
      continue;
    }
    if (isChoiceType(field.type) && !effectiveChoiceOptions(field,result).includes(value)) continue;
    result[field.id] = value;
  }
  return result;
}

/** Logos and images can be assigned even to choices present only in a conditional rule. */
export function allChoiceOptions(field: FormField): string[] {
  return [...new Set([...(field.options || []),...(field.optionRules || []).flatMap(rule => rule.options)].filter(Boolean))];
}

export function isChoiceType(type:FormField['type']):boolean {return type==='choice'||type==='multi'||type==='dropdown';}
export function isSingleChoiceType(type:FormField['type']):boolean {return type==='choice'||type==='dropdown';}
export function multiAnswers(value:unknown):string[]{
  if(typeof value!=='string'||value.length>2200)return [];
  try{const parsed:unknown=JSON.parse(value);return Array.isArray(parsed)&&parsed.length<=12&&parsed.every(v=>typeof v==='string')?[...new Set(parsed as string[])]:[];}catch{return [];}
}
export function answerLimit(field:FormField):number{return field.type==='longtext'?1000:field.type==='multi'?2200:field.type==='email'?254:180;}
/** One validation contract for preview and submitted payload. Does not erase partially typed input. */
export function validateFormAnswer(field:FormField,value:string,answers:Record<string,string>):string|null{
  const answer=value.trim();
  if(!answer)return field.required?`يرجى الإجابة عن: ${field.label}`:null;
  if(answer.length>answerLimit(field))return `الإجابة أطول من الحد المسموح: ${field.label}`;
  if(field.type==='multi'){
    const selected=multiAnswers(answer);
    if(!selected.length||selected.some(v=>!effectiveChoiceOptions(field,answers).includes(v)))return 'إجابة اختيار غير صالحة';
  }else if(isChoiceType(field.type)&&!effectiveChoiceOptions(field,answers).includes(answer))return 'إجابة اختيار غير صالحة';
  if(field.type==='number'&&!/^\d{1,12}(?:\.\d{1,2})?$/.test(answer))return `قيمة رقمية غير صالحة: ${field.label}`;
  if(field.type==='phone'&&!/^(?:05\d{8}|(?:\+?966)5\d{8})$/.test(answer.replace(/[\s()-]/g,'')))return `أدخل رقم جوال سعودي صحيح: ${field.label}`;
  if(field.type==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer))return `أدخل بريدًا إلكترونيًا صحيحًا: ${field.label}`;
  if(field.type==='date'){
    const parsed=new Date(answer+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(answer)||!Number.isFinite(parsed.valueOf())||parsed.toISOString().slice(0,10)!==answer)return `أدخل تاريخًا صحيحًا: ${field.label}`;
  }
  if(field.type==='consent'&&answer!=='نعم')return `يرجى اختيار الموافقة الصحيحة: ${field.label}`;
  return null;
}
