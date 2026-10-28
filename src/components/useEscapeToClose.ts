import { useEffect, useRef } from "react";

const openOverlayStack: symbol[] = [];

export function useEscapeToClose(isOpen: boolean, onClose: () => void) {
  const overlayId = useRef(Symbol("mzj-overlay"));
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const id = overlayId.current;
    openOverlayStack.push(id);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (openOverlayStack.at(-1) !== id) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      const index = openOverlayStack.lastIndexOf(id);
      if (index >= 0) openOverlayStack.splice(index, 1);
    };
  }, [isOpen]);
}
