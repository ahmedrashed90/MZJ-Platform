/** Declarative conditional choices. Both the editor and public submission use the same rules. */
import type { FormField } from './lead-forms.js';

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

/** Remove answers to hidden questions or choices no longer valid after a parent answer changes. */
export function validFormAnswers(fields: FormField[], raw: Record<string,string>): Record<string,string> {
  const result: Record<string,string> = {};
  for (const field of fields) {
    if (!isVisibleField(field,result)) continue;
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
