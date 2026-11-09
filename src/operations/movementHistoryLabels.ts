const ARABIC_RE = /[\u0600-\u06FF]/;

const STATUS_LABELS: Record<string, string> = {
  available_for_sale: "متاح للبيع",
  reserved: "حجز",
  has_notes: "بها ملاحظات",
  under_delivery: "مباع تحت التسليم",
  delivered: "مباع تم التسليم",
  sold: "تم البيع",
  archived: "مؤرشف",
  created: "تم إنشاء الطلب",
  request_received: "تم استلام الطلب",
  vehicle_sent: "تم إرسال السيارة",
  vehicle_received: "تم استلام السيارة",
  completed: "تم الانتهاء",
  cancelled: "ملغي",
  active: "نشط",
  inactive: "غير نشط",
  pending: "قيد الانتظار",
  approved: "معتمد",
  rejected: "مرفوض",
};

const MOVEMENT_LABELS: Record<string, string> = {
  direct: "حركة مباشرة",
  transfer: "نقل سيارة",
  photography: "طلب تصوير",
  note_update: "تحديث ملاحظات الحركة",
  status_note: "تحديث ملاحظة الحالة",
  vehicle_management: "تحديث بيانات السيارة من الإدارة",
  vehicle_created: "تسجيل السيارة في النظام",
  vehicle_registered: "تسجيل السيارة في النظام",
  vehicle_updated: "تحديث بيانات السيارة",
  vehicle_deleted: "حذف السيارة من النظام",
  vehicle_check: "تحديث تشييك السيارة",
  erpnext_sale: "تسجيل بيع من ERPNext",
  erpnext_vehicle_status: "تحديث حالة السيارة من ERPNext",
  erpnext_vehicle_status_synced: "مزامنة حالة السيارة من ERPNext",
  tracking_delivery: "إتمام التسليم من التتبع",
  approved_delivery: "إتمام التسليم بعد الاعتمادات",
  request_create: "إنشاء طلب نقل",
  request_delete: "حذف طلب نقل",
  request_step: "تحديث مرحلة طلب النقل",
  request_stage_completed: "اكتمال مرحلة طلب النقل",
  request_stage_reverted: "التراجع عن مرحلة طلب النقل",
  request_cancelled: "إلغاء طلب النقل",
  request_transfer_receive_car: "استلام السيارة في طلب النقل",
  tracking_stage_completed: "إكمال مرحلة التتبع",
  tracking_stage_reverted: "التراجع عن مرحلة التتبع",
  archive_archived: "أرشفة السيارة",
  archive_auto_archived: "أرشفة السيارة تلقائيًا",
  archive_restored: "استعادة السيارة من الأرشيف",
  archive_restore: "استعادة السيارة من الأرشيف",
  archive_event: "إجراء على أرشيف السيارة",
};

const APPROVAL_TYPE_LABELS: Record<string, string> = {
  financial: "الموافقة المالية",
  administrative: "الموافقة الإدارية",
};

const APPROVAL_ACTION_LABELS: Record<string, string> = {
  approve: "اعتماد",
  revert: "إلغاء الاعتماد",
  reset: "إعادة ضبط",
  note: "تحديث ملاحظة",
  cancelled: "إلغاء",
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function movementStatusLabel(value: unknown): string {
  const raw = clean(value);
  if (!raw || raw === "—") return "—";
  if (ARABIC_RE.test(raw)) return raw;
  const key = raw.toLowerCase();
  return STATUS_LABELS[key] || raw;
}

export function movementTypeLabel(value: unknown): string {
  const raw = clean(value);
  if (!raw || raw === "—") return "—";

  if (raw.startsWith("قديم — ")) {
    const suffix = raw.slice("قديم — ".length).trim();
    return `قديم — ${movementTypeLabel(suffix)}`;
  }

  if (ARABIC_RE.test(raw)) return raw;
  const key = raw.toLowerCase();
  if (MOVEMENT_LABELS[key]) return MOVEMENT_LABELS[key];

  if (key.startsWith("approval_")) {
    const parts = key.split("_");
    const approvalType = APPROVAL_TYPE_LABELS[parts[1]] || parts[1] || "الموافقة";
    const action = APPROVAL_ACTION_LABELS[parts.slice(2).join("_")] || parts.slice(2).join("_") || "إجراء";
    return `${approvalType} — ${action}`;
  }

  if (key.startsWith("request_")) {
    const action = key.slice("request_".length);
    const dynamic: Record<string, string> = {
      event: "إجراء على طلب النقل",
      stage_completed: "اكتمال مرحلة طلب النقل",
      stage_reverted: "التراجع عن مرحلة طلب النقل",
      cancelled: "إلغاء طلب النقل",
    };
    return dynamic[action] || "إجراء على طلب النقل";
  }

  if (key.startsWith("tracking_stage_")) {
    const action = key.slice("tracking_stage_".length);
    if (action === "completed") return "إكمال مرحلة التتبع";
    if (action === "reverted") return "التراجع عن مرحلة التتبع";
    return "إجراء على مرحلة التتبع";
  }

  if (key.startsWith("archive_")) {
    const action = key.slice("archive_".length);
    if (action === "archived" || action === "auto_archived") return action === "auto_archived" ? "أرشفة السيارة تلقائيًا" : "أرشفة السيارة";
    if (action === "restored" || action === "restore") return "استعادة السيارة من الأرشيف";
    return "إجراء على أرشيف السيارة";
  }

  return raw;
}
