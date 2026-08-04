type ActivityDetailLine = { label: string; value: string };

type ActivityInput = {
  action: string;
  system_code?: string | null;
  page_code?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  user_name?: string | null;
  result?: string | null;
  rejection_reason?: string | null;
  before_data?: unknown;
  after_data?: unknown;
  activity_vehicle_vin?: string | null;
  activity_vehicle_name?: string | null;
  activity_vehicle_statement?: string | null;
  activity_location_name?: string | null;
  activity_current_status_name?: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  reserved: "حجز",
  available_for_sale: "متاح للبيع",
  under_delivery: "تحت التسليم",
  delivered: "مباع تم التسليم",
  sold: "تم البيع",
  has_notes: "به ملاحظات",
  archived: "مؤرشف",
};

const ACTION_LABELS: Record<string, string> = {
  page_view: "فتح صفحة",
  login: "تسجيل دخول",
  logout: "تسجيل خروج",
  login_failed: "محاولة دخول غير ناجحة",
  user_created: "إنشاء مستخدم",
  user_updated: "تعديل مستخدم",
  user_deleted: "حذف مستخدم",
  role_created: "إنشاء دور",
  role_updated: "تعديل دور",
  branch_created: "إنشاء فرع",
  branch_updated: "تعديل فرع",
  department_created: "إنشاء قسم",
  department_updated: "تعديل قسم",
  vehicle_created: "إضافة سيارة",
  vehicle_updated: "تعديل سيارة",
  vehicle_deleted: "حذف سيارة",
  operation_location_saved: "تغيير مكان سيارة",
  operation_status_saved: "حفظ إعداد حالة سيارة",
  erpnext_vehicle_status_synced: "مزامنة حالة سيارة من NEXT ERP",
  create_campaign: "إنشاء حملة",
  create_agenda: "إنشاء أجندة",
  receive_task: "استلام تاسك",
  upload_template: "رفع Task Template",
  review_template: "مراجعة Task Template",
  save_publish_prep: "حفظ تجهيز النشر",
  archive_entity: "أرشفة سجل",
  delete_entity: "حذف سجل",
  permission_denied: "رفض صلاحية",
  activity_log_deleted: "مسح سجل النشاط",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function first(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return "";
}

function status(value: unknown) {
  const raw = text(value);
  return STATUS_LABELS[raw] || raw;
}

function add(lines: ActivityDetailLine[], label: string, value: unknown) {
  const normalized = text(value);
  if (!normalized || lines.some((line) => line.label === label && line.value === normalized)) return;
  lines.push({ label, value: normalized });
}

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  const ignored = new Set(["updated_at", "created_at", "version", "password_hash", "source_payload", "before_data", "after_data"]);
  const labels: Record<string, string> = {
    full_name: "الاسم",
    email: "البريد",
    is_active: "حالة الحساب",
    status_code: "الحالة",
    branch_code: "الفرع",
    department_code: "القسم",
    location_id: "المكان",
    notes: "الملاحظات",
    assigned_to: "المسؤول",
  };
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !ignored.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .slice(0, 8)
    .map((key) => labels[key] || key.replace(/_/g, " "));
}

export function buildActivityDetails(row: ActivityInput) {
  const before = record(row.before_data);
  const after = record(row.after_data);
  const action = text(row.action);
  const actionLabel = ACTION_LABELS[action] || action.replace(/_/g, " ") || "نشاط مسجل";
  const lines: ActivityDetailLine[] = [];
  let title = actionLabel;
  let description = "تم تسجيل الإجراء داخل المنصة.";

  if (["erpnext_vehicle_status_synced", "vehicle_updated", "vehicle_created", "vehicle_deleted"].includes(action) || row.entity_type === "vehicle") {
    const oldStatus = status(first(before, ["status_name", "status_label", "status_code", "old_status"]));
    const newStatus = status(first(after, ["status_name", "status_label", "status_code", "new_status"]) || row.activity_current_status_name);
    const vin = first(after, ["vin", "serial_no", "serialNo"]) || first(before, ["vin", "serial_no", "serialNo"]) || text(row.activity_vehicle_vin);
    const carName = first(after, ["car_name", "vehicle_name", "item_name"]) || first(before, ["car_name", "vehicle_name", "item_name"]) || text(row.activity_vehicle_name);
    const statement = first(after, ["statement", "description"]) || first(before, ["statement", "description"]) || text(row.activity_vehicle_statement);
    const location = first(after, ["location_name", "location", "place_name"]) || first(before, ["location_name", "location", "place_name"]) || text(row.activity_location_name);
    const actor = first(after, ["updated_by_name", "performed_by_name", "reserved_by_name", "erpModifiedBy"]) || text(row.user_name);
    const source = first(after, ["source_name", "source", "erpEvent"]) || (action === "erpnext_vehicle_status_synced" ? "NEXT ERP" : "المنصة");

    if (oldStatus && newStatus && oldStatus !== newStatus) {
      title = `تم تغيير حالة السيارة من ${oldStatus} إلى ${newStatus}`;
      description = `${actor || "المستخدم"} غيّر حالة السيارة${vin ? ` رقم الهيكل ${vin}` : ""} من ${oldStatus} إلى ${newStatus}.`;
    } else if (action === "erpnext_vehicle_status_synced" && newStatus) {
      title = `تمت مزامنة حالة السيارة إلى ${newStatus}`;
      description = `${actor || "المستخدم"} حدّث حالة السيارة${vin ? ` رقم الهيكل ${vin}` : ""} إلى ${newStatus} من NEXT ERP.`;
    } else if (action === "vehicle_created") {
      title = `تمت إضافة السيارة${vin ? ` رقم الهيكل ${vin}` : ""}`;
      description = `${actor || "المستخدم"} أضاف السيارة${carName ? ` ${carName}` : ""} إلى مخزون العمليات.`;
    } else if (action === "vehicle_deleted") {
      title = `تم حذف السيارة${vin ? ` رقم الهيكل ${vin}` : ""}`;
      description = `${actor || "المستخدم"} حذف السيارة من مخزون العمليات.`;
    } else {
      const fields = changedFields(before, after);
      title = actionLabel;
      description = fields.length ? `تم تعديل بيانات السيارة في: ${fields.join("، ")}.` : "تم تنفيذ الإجراء على السيارة داخل سيستم العمليات.";
      add(lines, "الحقول المتغيرة", fields.join("، "));
    }

    add(lines, "رقم الهيكل", vin);
    add(lines, "السيارة", carName);
    add(lines, "البيان", statement);
    add(lines, "المكان", location);
    add(lines, "الحالة السابقة", oldStatus);
    add(lines, "الحالة الحالية", newStatus);
    add(lines, "المسؤول", actor);
    add(lines, "مصدر الإجراء", source);
    add(lines, "إداري الحجز", first(after, ["reserved_by_name"]));
    add(lines, "بريد إداري الحجز", first(after, ["reserved_by_email"]));
  } else if (action === "page_view") {
    const path = first(after, ["path"]) || text(row.entity_id);
    const pageTitle = first(after, ["title"]);
    title = `تم فتح ${pageTitle || "صفحة داخل المنصة"}`;
    description = `${text(row.user_name) || "المستخدم"} فتح الصفحة ${path || text(row.page_code) || "المحددة"}.`;
    add(lines, "الصفحة", pageTitle);
    add(lines, "المسار", path);
  } else if (["login", "logout", "login_failed"].includes(action)) {
    title = actionLabel;
    description = action === "login_failed"
      ? `تم تسجيل محاولة دخول غير ناجحة${row.rejection_reason ? ` بسبب ${row.rejection_reason}` : ""}.`
      : `${text(row.user_name) || "المستخدم"} نفّذ إجراء ${actionLabel}.`;
  } else if (action.startsWith("user_") || action.startsWith("role_") || action.startsWith("branch_") || action.startsWith("department_")) {
    const name = first(after, ["full_name", "name", "label", "code"]) || first(before, ["full_name", "name", "label", "code"]);
    const fields = changedFields(before, after);
    title = `${actionLabel}${name ? `: ${name}` : ""}`;
    description = fields.length ? `تم تنفيذ الإجراء وتغيير: ${fields.join("، ")}.` : "تم تنفيذ الإجراء وحفظه بنجاح.";
    add(lines, "السجل", name);
    add(lines, "الحقول المتغيرة", fields.join("، "));
  } else if (first(after, ["route"])) {
    const route = first(after, ["route"]);
    const method = first(after, ["method"]);
    const statusCode = first(after, ["statusCode"]);
    title = actionLabel;
    description = `تم تنفيذ الإجراء داخل ${route}${method ? ` بطريقة ${method}` : ""}${statusCode ? ` وكانت النتيجة HTTP ${statusCode}` : ""}.`;
    add(lines, "المسار", route);
    add(lines, "طريقة الطلب", method);
    add(lines, "كود النتيجة", statusCode);
    add(lines, "مدة التنفيذ", first(after, ["durationMs"]) ? `${first(after, ["durationMs"])} مللي ثانية` : "");
  } else {
    const fields = changedFields(before, after);
    description = fields.length ? `تم تنفيذ الإجراء وتغيير: ${fields.join("، ")}.` : "تم تنفيذ الإجراء وتسجيله داخل المنصة.";
    add(lines, "السجل", text(row.entity_type));
    add(lines, "رقم السجل", text(row.entity_id));
    add(lines, "الحقول المتغيرة", fields.join("، "));
  }

  if (row.result === "failure" || row.result === "denied") {
    description = `${description} النتيجة: ${row.result === "denied" ? "مرفوض" : "فشل"}${row.rejection_reason ? ` — ${row.rejection_reason}` : ""}.`;
  }

  return { activity_title: title, activity_description: description, activity_details: lines };
}
