/**
 * Canonical, lossless phone handling for CRM sheet leads.
 * Phone values are identifiers: never coerce to Number or invent missing digits.
 */
export type SheetPhoneCheck = { normalized: string; reason: string };

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function checkSheetLeadPhone(value: unknown): SheetPhoneCheck {
  const original = String(value ?? '').trim();
  if (!original) return { normalized: '', reason: 'رقم الجوال غير موجود' };
  // Meta/Sheets phone fields can contain the literal text "p:+966...".
  const input = original.replace(/^p\s*:\s*/i, '')
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)));
  if (!/^\+?[\d\s().-]+$/.test(input)) {
    return { normalized: '', reason: 'صيغة رقم الجوال غير صحيحة؛ أدخل الأرقام الأصلية كنص' };
  }
  let digits = input.replace(/\D/g, '');
  const explicitlyInternational = /^\+/.test(input) || /^00/.test(digits);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^05\d{8}$/.test(digits)) digits = `966${digits.slice(1)}`;
  else if (/^5\d{8}$/.test(digits)) digits = `966${digits}`;

  // No Saudi country code may be silently accepted with an incorrect mobile length.
  const isSaudiMobile = /^9665\d{8}$/.test(digits);
  const isExplicitForeignNumber = explicitlyInternational && !digits.startsWith('966') && /^[1-9]\d{7,14}$/.test(digits);
  if (!isSaudiMobile && !isExplicitForeignNumber) {
    return { normalized: '', reason: 'رقم جوال غير صحيح؛ مثال: 05xxxxxxxx أو +9665xxxxxxxx' };
  }
  // Repeated trailing zeros found in damaged Excel exports are not recoverable.
  // Do NOT fill them in or assign these placeholder numbers to real customers.
  if (/0{5,}$/.test(digits)) {
    return { normalized: '', reason: 'الرقم ينتهي بأصفار كثيرة ويبدو ناقصًا؛ راجع الرقم الأصلي قبل الاستيراد' };
  }
  return { normalized: digits, reason: '' };
}
