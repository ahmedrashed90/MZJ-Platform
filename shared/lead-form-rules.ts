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
  if (field.type !== 'choice') return [];
  const matched = (field.optionRules || []).find(rule => rule.conditions.length > 0 &&
    rule.conditions.every(condition => answers[condition.fieldId] === condition.equals));
  return matched ? matched.options : field.options;
}

/** An explicit screen without a question block is an informational step.
 * An empty choice group also has no answer to collect. Legacy layouts retain their input. */
export function acceptsFieldAnswer(field: FormField, answers: Record<string,string>, design?: FormDesign): boolean {
  const screen = design?.screens?.[field.id];
  if (Array.isArray(screen) && !screen.some(block => block.kind === 'question')) return false;
  return field.type !== 'choice' || effectiveChoiceOptions(field,answers).some(option => option.trim());
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
    if (field.type === 'choice' && !effectiveChoiceOptions(field,result).includes(value)) continue;
    result[field.id] = value;
  }
  return result;
}

/** Logos and images can be assigned even to choices present only in a conditional rule. */
export function allChoiceOptions(field: FormField): string[] {
  return [...new Set([...(field.options || []),...(field.optionRules || []).flatMap(rule => rule.options)].filter(Boolean))];
}
