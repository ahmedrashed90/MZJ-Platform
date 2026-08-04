import type { ReactNode } from "react";

export function MarketingPage({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return <div className="marketing-page"><header className="marketing-page-head"><div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{actions ? <div className="marketing-page-actions">{actions}</div> : null}</header>{children}</div>;
}

export function MarketingAlert({ type = "error", children }: { type?: "error" | "success" | "info"; children: ReactNode }) {
  return <div className={`marketing-alert ${type}`}>{children}</div>;
}

export function ProgressBar({ value }: { value: number }) {
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  return <div className="marketing-progress"><span style={{ width: `${safe}%` }} /><b>{safe.toLocaleString("ar-SA", { maximumFractionDigits: 1 })}%</b></div>;
}
