import { X } from "@phosphor-icons/react";
import { useEscapeToClose } from "../../components/useEscapeToClose";

export function OperationsModal({ open, title, onClose, children, wide = false }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEscapeToClose(open, onClose);
  if (!open) return null;
  return (
    <div className="operations-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`operations-modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button type="button" onClick={onClose} aria-label="إغلاق"><X size={21} /></button></header>
        <div className="operations-modal-body">{children}</div>
      </section>
    </div>
  );
}
