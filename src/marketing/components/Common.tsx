import type { Icon } from "@phosphor-icons/react";
import { ArrowClockwise, MagnifyingGlass, Package, WarningCircle } from "@phosphor-icons/react";

export function MarketingPageHeader({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return <header className="marketing-page-head"><div><h1>{title}</h1><p>{description}</p></div>{actions ? <div className="marketing-head-actions">{actions}</div> : null}</header>;
}

export function MarketingStat({ label, value, detail, icon: Icon }: { label: string; value: React.ReactNode; detail?: string; icon: Icon }) {
  return <article className="marketing-stat-card"><div><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</div><i><Icon size={25} weight="duotone" /></i></article>;
}

export function MarketingLoading({ text = "جاري تحميل البيانات..." }: { text?: string }) {
  return <div className="marketing-loading"><ArrowClockwise size={21} className="spin" /><span>{text}</span></div>;
}

export function MarketingError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="marketing-error"><WarningCircle size={22} /><span>{message}</span>{onRetry ? <button type="button" onClick={onRetry}>إعادة المحاولة</button> : null}</div>;
}

export function MarketingEmpty({ title, description }: { title: string; description: string }) {
  return <div className="marketing-empty"><Package size={34} weight="duotone" /><strong>{title}</strong><p>{description}</p></div>;
}

export function MarketingSearch({ value, onChange, placeholder = "بحث..." }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="marketing-search"><MagnifyingGlass size={18} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} type="search" /></label>;
}

export function MarketingBadge({ value }: { value: string | null | undefined }) {
  const text = String(value || "—");
  const tone = /مكتمل|معتمد|completed|approved|active|حاضر|connected/i.test(text) ? "success" : /متأخر|مرفوض|rejected|cancelled|late/i.test(text) ? "danger" : /انتظار|مطلوب تعديل|waiting|revision|pending|review/i.test(text) ? "warning" : "neutral";
  return <span className={`marketing-badge ${tone}`}>{text}</span>;
}

export function ProgressBar({ value }: { value: number }) {
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  return <div className="marketing-progress"><div><span style={{ width: `${safe}%` }} /></div><strong>{Math.round(safe)}%</strong></div>;
}

export function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`marketing-field ${wide ? "wide" : ""}`}><span>{label}</span>{children}</label>;
}
