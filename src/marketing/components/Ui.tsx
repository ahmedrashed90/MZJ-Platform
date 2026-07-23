import type { ReactNode } from "react";
import { ArrowClockwise, CaretLeft, CaretRight, X } from "@phosphor-icons/react";
import { campaignStatusLabels, departmentLabels, photographyStatusLabels, taskStatusLabels } from "../types";

export function MarketingPageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="marketing-page-head">
      <div><h1>{title}</h1><p>{description}</p></div>
      {actions ? <div className="marketing-page-actions">{actions}</div> : null}
    </header>
  );
}

export function MarketingAlert({ type = "error", children }: { type?: "error" | "success" | "info"; children: ReactNode }) {
  return <div className={`marketing-alert ${type}`}>{children}</div>;
}

export function MarketingEmpty({ title, description, icon }: { title: string; description?: string; icon?: ReactNode }) {
  return <div className="marketing-empty">{icon}<strong>{title}</strong>{description ? <span>{description}</span> : null}</div>;
}

export function MarketingLoading({ label = "جاري تحميل البيانات..." }: { label?: string }) {
  return <div className="marketing-loading"><ArrowClockwise size={24} className="marketing-spin" /><span>{label}</span></div>;
}

export function ProgressBar({ value, label, compact = false }: { value: number; label?: string; compact?: boolean }) {
  const safe = Math.max(0, Math.min(100, Math.round(Number(value || 0))));
  return (
    <div className={`marketing-progress ${compact ? "compact" : ""}`}>
      <div className="marketing-progress-copy"><span>{label || "التقدم"}</span><b>{safe}%</b></div>
      <div className="marketing-progress-track"><i style={{ width: `${safe}%` }} /></div>
    </div>
  );
}

export function StatusBadge({ status, type = "task" }: { status: string; type?: "task" | "campaign" | "photography" | "publish" }) {
  const labels = type === "campaign" ? campaignStatusLabels : type === "photography" ? photographyStatusLabels : type === "publish" ? {
    draft: "مسودة", ready: "جاهز", scheduled: "مجدول", publishing: "جاري النشر", published: "تم النشر", failed: "فشل", blocked: "متوقف", cancelled: "ملغي", waiting_user_completion: "بانتظار الإكمال", disconnected: "غير متصل", connected: "متصل", expired: "منتهي", error: "خطأ", sandbox_under_review: "Sandbox / Review", waiting_allowlist: "بانتظار الموافقة", disabled: "معطل", account_selection_required: "اختر الحساب", missing_instagram_business: "Instagram Business غير موجود",
  } : taskStatusLabels;
  return <span className={`marketing-status status-${status}`}>{labels[status] || status}</span>;
}

export function DepartmentBadge({ code }: { code: string }) {
  return <span className={`marketing-department department-${code}`}>{departmentLabels[code] || code}</span>;
}

export function MarketingModal({ open, title, subtitle, onClose, children, wide = false, footer }: { open: boolean; title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  if (!open) return null;
  return (
    <div className="marketing-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className={`marketing-modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button type="button" onClick={onClose} aria-label="إغلاق"><X size={21} /></button></header>
        <div className="marketing-modal-body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </section>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="marketing-pagination">
      <span>عرض {total ? (page - 1) * pageSize + 1 : 0}–{Math.min(total, page * pageSize)} من {total.toLocaleString("ar-SA")}</span>
      <div><button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}><CaretRight size={17} /></button><b>{page} / {pages}</b><button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)}><CaretLeft size={17} /></button></div>
    </div>
  );
}

export function formatDate(value?: string | null, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("ar-SA", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(date);
}

export function formatMoney(value: number | string | null | undefined) {
  return new Intl.NumberFormat("ar-SA", { style: "currency", currency: "SAR", maximumFractionDigits: 2 }).format(Number(value || 0));
}
