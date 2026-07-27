import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { useEscapeToClose } from "./useEscapeToClose";

let lockedOverlays = 0;
let previousOverflow = "";

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  className = "",
  level = 0,
  initialFocusRef,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  level?: number;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEscapeToClose(open, onClose);

  useEffect(() => {
    if (!open) return;
    lockedOverlays += 1;
    if (lockedOverlays === 1) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    const timer = window.setTimeout(() => (initialFocusRef?.current || closeButtonRef.current)?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      lockedOverlays = Math.max(0, lockedOverlays - 1);
      if (lockedOverlays === 0) document.body.style.overflow = previousOverflow;
    };
  }, [open, initialFocusRef]);

  if (!open) return null;
  return createPortal(
    <div className="mzj-modal-backdrop" style={{ zIndex: 1000 + level * 20 }} onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className={`mzj-modal-card ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="mzj-modal-header">
          <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="إغلاق"><X size={21} /></button>
        </header>
        <div className="mzj-modal-body">{children}</div>
        {footer ? <footer className="mzj-modal-footer">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}
