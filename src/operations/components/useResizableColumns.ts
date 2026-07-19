import { useCallback, useEffect, useMemo, useState } from "react";

export type ResizableColumnDefinition = {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
};

type WidthMap = Record<string, number>;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function defaultWidths(columns: ResizableColumnDefinition[]) {
  return Object.fromEntries(columns.map((column) => [column.key, column.defaultWidth])) as WidthMap;
}

export function useResizableColumns(
  storageKey: string,
  columns: ResizableColumnDefinition[],
  tableContainer: React.RefObject<HTMLDivElement | null>,
) {
  const definitions = useMemo(() => new Map(columns.map((column) => [column.key, column])), [columns]);
  const [widths, setWidths] = useState<WidthMap>(() => {
    const defaults = defaultWidths(columns);
    if (typeof window === "undefined") return defaults;
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) || "{}") as WidthMap;
      for (const column of columns) {
        if (Number.isFinite(stored[column.key])) defaults[column.key] = clamp(Number(stored[column.key]), column.minWidth, column.maxWidth);
      }
    } catch {
      // Ignore invalid UI preferences and use the approved defaults.
    }
    return defaults;
  });

  useEffect(() => {
    setWidths((current) => {
      const next = defaultWidths(columns);
      for (const column of columns) {
        if (Number.isFinite(current[column.key])) next[column.key] = clamp(Number(current[column.key]), column.minWidth, column.maxWidth);
      }
      return next;
    });
  }, [columns]);

  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(widths)); } catch { /* UI preference only */ }
  }, [storageKey, widths]);

  const beginResize = useCallback((event: React.PointerEvent, key: string) => {
    const definition = definitions.get(key);
    if (!definition) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widths[key] || definition.defaultWidth;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const move = (moveEvent: PointerEvent) => {
      // The resize handle is on the visual left edge in RTL, so dragging left expands the column.
      const delta = startX - moveEvent.clientX;
      setWidths((current) => ({ ...current, [key]: clamp(startWidth + delta, definition.minWidth, definition.maxWidth) }));
    };
    const finish = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  }, [definitions, widths]);

  const autoFit = useCallback((key: string) => {
    const definition = definitions.get(key);
    const container = tableContainer.current;
    if (!definition || !container) return;
    const cells = [...container.querySelectorAll<HTMLElement>(`[data-column-key="${CSS.escape(key)}"]`)];
    const measured = cells.reduce((largest, cell) => Math.max(largest, cell.scrollWidth + 26), definition.minWidth);
    setWidths((current) => ({ ...current, [key]: clamp(measured, definition.minWidth, definition.maxWidth) }));
  }, [definitions, tableContainer]);

  const resetWidths = useCallback(() => setWidths(defaultWidths(columns)), [columns]);
  const totalWidth = columns.reduce((sum, column) => sum + (widths[column.key] || column.defaultWidth), 0);

  return { widths, totalWidth, beginResize, autoFit, resetWidths };
}
