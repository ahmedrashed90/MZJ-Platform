/** The canonical columns used by Operations > Vehicle Management > Export blank template. */
export const OPERATIONS_VEHICLE_IMPORT_HEADERS = [
  "الهيكل (VIN)", "السيارة", "البيان", "الوكيل", "اللون الداخلي", "اللون الخارجي", "موديل", "اللوحة", "اسم الدفعة بالتاريخ", "المكان",
  "الحالة", "ملاحظات",
  "فرشات", "طفاية", "شنطة", "اسبير", "ريموت", "شاشة", "مسجل", "مكيف", "كاميرا", "حساس",
  "الموافقة المالية", "الموافقة الادارية", "Tracking",
] as const;

/**
 * Use the new header first, but continue accepting the old STATUS-note header.
 * Old vehicle/shortage-note fields are intentionally not imported: they remain
 * stored in the database for historical records but are no longer user inputs.
 * Header keys (not spreadsheet column positions) determine the mapping.
 */
export function vehicleImportStateNote(row: Record<string, unknown>): unknown {
  const keys = [
    "ملاحظات",
    "stateNote",
    "ملاحظات السيارات (تُفتح عند الحالة: بها ملاحظات)",
  ];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key] ?? "";
  }
  return "";
}
