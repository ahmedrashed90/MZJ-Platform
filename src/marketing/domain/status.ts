export const statusLabels: Record<string, string> = {
  draft: "مسودة",
  scheduled: "مجدولة",
  in_progress: "جاري العمل",
  ready_for_publish: "جاهزة للنشر",
  completed: "مكتملة",
  archived: "مؤرشفة",
  cancelled: "ملغاة",
  pending_template: "في انتظار رفع Task Template",
  template_submitted: "Task Template تحت المراجعة",
  changes_requested: "مطلوب تعديل",
  template_approved: "تم اعتماد Task Template",
  content_done: "مهمة المحتوى منتهية",
  blocked_by_template: "في انتظار اعتماد Task Template",
  ready: "جاهزة للاستلام",
  received: "تم الاستلام",
  under_review: "تحت المراجعة",
  published: "تم النشر",
  failed: "فشل",
  blocked: "متوقفة",
  waiting_user_completion: "بانتظار إكمال المستخدم",
  disconnected: "غير متصلة",
  connected: "متصلة",
  sandbox_under_review: "Sandbox تحت المراجعة",
  waiting_allowlist: "بانتظار Allowlist",
  disabled: "معطلة",
};

export function statusLabel(status?: string | null) {
  return statusLabels[String(status || "")] || String(status || "—");
}

export function statusTone(status?: string | null) {
  const value = String(status || "");
  if (["completed", "content_done", "template_approved", "published", "connected", "ready_for_publish"].includes(value)) return "success";
  if (["changes_requested", "failed", "cancelled", "delayed"].includes(value)) return "danger";
  if (["under_review", "template_submitted", "scheduled", "waiting_allowlist", "sandbox_under_review"].includes(value)) return "warning";
  if (["received", "in_progress", "ready"].includes(value)) return "active";
  return "neutral";
}
