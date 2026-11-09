/** MZJ lead-form purchase preference (only used by the marketing-form CRM bridge). */
export type FormPurchasePreference = 'cash' | 'finance' | 'undecided';

const normalize = (value: unknown) => String(value ?? '')
  .normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim().toLowerCase();

export function formPurchasePreference(
  answers: Record<string, string> = {},
  answerLabels: Record<string, string> = {},
): FormPurchasePreference {
  // Stable standard field IDs take precedence; visual designs use arbitrary IDs,
  // so also use the original question label stored with the submitted answer.
  let value = '';
  for (const id of ['purchase', 'purchase_method', 'payment_method']) {
    if (answers[id]) { value = answers[id]; break; }
  }
  if (!value) {
    for (const [id, label] of Object.entries(answerLabels)) {
      const title = normalize(label);
      if ((title.includes('تشتري') || title.includes('شراء') || title.includes('الدفع'))
        && (title.includes('كيف') || title.includes('طريق') || title.includes('تفضل'))) {
        value = answers[id] || '';
        if (value) break;
      }
    }
  }
  const choice = normalize(value);
  if (choice === 'كاش' || choice === 'نقدي' || choice === 'نقدا' || choice === 'cash') return 'cash';
  if (choice === 'تمويل' || choice === 'تقسيط' || choice === 'finance' || choice === 'installments') return 'finance';
  return 'undecided';
}

/** Repeatable 50/50 preference for visitors who have not chosen a payment method. */
export function undecidedFormService(formLeadId: string): 'cash' | 'finance' {
  const hex = formLeadId.replace(/[^0-9a-f]/gi, '');
  const tail = Number.parseInt(hex.slice(-6) || '0', 16);
  return Number.isFinite(tail) && tail % 2 === 0 ? 'cash' : 'finance';
}
