import { X } from "@phosphor-icons/react";
import { useEscapeToClose } from "../../components/useEscapeToClose";

export function OperationsModal({
  open,
  title,
  description,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEscapeToClose(open, onClose);
  if (!open) return null;
  return (
    <div className="ops-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`ops-modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="ops-overlay-head">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" className="ops-icon-button" onClick={onClose} aria-label="إغلاق"><X size={20} /></button>
        </header>
        <div className="ops-overlay-body">{children}</div>
      </section>
    </div>
  );
}

export function OperationsDrawer({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEscapeToClose(open, onClose);
  if (!open) return null;
  return (
    <div className="ops-overlay ops-drawer-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="ops-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="ops-overlay-head">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" className="ops-icon-button" onClick={onClose} aria-label="إغلاق"><X size={20} /></button>
        </header>
        <div className="ops-overlay-body">{children}</div>
      </aside>
    </div>
  );
}
