import type { ReactNode } from "react";

export function MarketingPage({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  void title;
  void description;
  return <div className="marketing-page">{actions ? <div className="marketing-page-actions page-top-actions">{actions}</div> : null}{children}</div>;
}

export function MarketingAlert({ type = "error", children }: { type?: "error" | "success" | "info"; children: ReactNode }) {
  return <div className={`marketing-alert ${type}`}>{children}</div>;
}

export function ProgressBar({ value }: { value: number }) {
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  return <div className="marketing-progress"><span style={{ width: `${safe}%` }} /><b>{safe.toLocaleString("ar-SA", { maximumFractionDigits: 1 })}%</b></div>;
}
