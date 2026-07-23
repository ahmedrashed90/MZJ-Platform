import type { ReactNode } from "react";

export function MarketingPageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="marketing-page-header">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="marketing-page-actions">{actions}</div> : null}
    </header>
  );
}
