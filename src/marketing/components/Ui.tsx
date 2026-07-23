import type { ReactNode } from "react";
import { X } from "@phosphor-icons/react";

export function PageHead({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <header className="marketing-page-head"><div><h1>{title}</h1><p>{description}</p></div>{actions ? <div className="marketing-head-actions">{actions}</div> : null}</header>;
}
export function Alert({ type = "info", children }: { type?: "info" | "error" | "success" | "warning"; children: ReactNode }) {
  return <div className={`marketing-alert ${type}`}>{children}</div>;
}
export function Modal({ open, title, subtitle, onClose, children, footer, wide = false }: { open: boolean; title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return <div className="marketing-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`marketing-modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true"><header><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button type="button" onClick={onClose} aria-label="إغلاق"><X size={20} /></button></header><div className="marketing-modal-body">{children}</div>{footer ? <footer>{footer}</footer> : null}</section></div>;
}
export function Empty({ text }: { text: string }) { return <div className="marketing-empty">{text}</div>; }
export function ProgressBar({ value }: { value: number }) { const safe = Math.max(0, Math.min(100, Number(value) || 0)); return <div className="marketing-progress"><span style={{ width: `${safe}%` }} /><b>{Math.round(safe)}%</b></div>; }
const marketingStatusLabels: Record<string, string> = {
  new: "جديد", waiting_template: "في انتظار اعتماد Task Template", received: "تم الاستلام", active: "قيد التنفيذ", completed: "مكتمل",
  template_review: "في انتظار المراجعة", template_revision: "مطلوب تعديل", rejected: "مرفوض", publishing: "قسم النشر", draft: "مسودة",
  request_received: "تم استلام الطلب", scheduled: "تم تحديد الموعد", in_progress: "جاري التصوير", cancelled: "ملغي",
};
export function marketingStatusLabel(status: string) { return marketingStatusLabels[status] || status; }
export function StatusBadge({ status }: { status: string }) {
  return <span className={`marketing-status status-${status}`}>{marketingStatusLabel(status)}</span>;
}
export function ConfirmButton({ children, onClick, disabled, tone = "primary", type = "button" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; tone?: "primary" | "secondary" | "danger"; type?: "button" | "submit" }) {
  return <button type={type} className={`marketing-button ${tone}`} onClick={onClick} disabled={disabled}>{children}</button>;
}
