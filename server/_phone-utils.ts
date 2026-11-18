export function normalizePhone(value: unknown) {
  let phone = String(value || "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[^\d]/g, "");

  if (phone.startsWith("00")) phone = phone.slice(2);

  if (/^05\d{8}$/.test(phone)) {
    phone = `966${phone.slice(1)}`;
  } else if (/^5\d{8}$/.test(phone)) {
    phone = `966${phone}`;
  }

  return /^\d{8,15}$/.test(phone) ? phone : "";
}
