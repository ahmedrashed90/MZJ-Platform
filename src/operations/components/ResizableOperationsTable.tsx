import { useMemo, useState } from "react";

export type ResizableOperationsColumn<T> = {
  key: string;
  label: string;
  width: number;
  min: number;
  max: number;
  value?: (row: T) => unknown;
  render: (row: T) => React.ReactNode;
};

type Props<T> = {
  rows: T[];
  columns: ResizableOperationsColumn<T>[];
  rowKey: (row: T) => string;
  storageKey: string;
  emptyText: string;
  minTableWidth?: number;
  tableClassName?: string;
  helperText?: string;
};

function loadWidths<T>(storageKey: string, columns: ResizableOperationsColumn<T>[]) {
  const defaults = Object.fromEntries(columns.map((column) => [column.key, column.width]));
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}") as Record<string, number>;
    return Object.fromEntries(columns.map((column) => [
      column.key,
      Math.min(column.max, Math.max(column.min, Number(saved[column.key] || defaults[column.key]))),
    ]));
  } catch {
    return defaults;
  }
}

export function ResizableOperationsTable<T>({
  rows,
  columns,
  rowKey,
  storageKey,
  emptyText,
  minTableWidth = 1100,
  tableClassName = "",
  helperText = "اسحب العلامة بين الأعمدة يمينًا أو يسارًا لتغيير العرض، واضغط مرتين للضبط التلقائي.",
}: Props<T>) {
  const [widths, setWidths] = useState<Record<string, number>>(() => loadWidths(storageKey, columns));
  const tableWidth = useMemo(
    () => columns.reduce((sum, column) => sum + (widths[column.key] || column.width), 0),
    [columns, widths],
  );

  function persist(next: Record<string, number>) {
    setWidths(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  }

  function beginResize(event: React.PointerEvent<HTMLSpanElement>, column: ResizableOperationsColumn<T>) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widths[column.key] || column.width;
    let liveWidth = startWidth;
    document.body.classList.add("operations-column-resizing");

    const move = (moveEvent: PointerEvent) => {
      liveWidth = Math.min(column.max, Math.max(column.min, startWidth + (startX - moveEvent.clientX)));
      setWidths((current) => ({ ...current, [column.key]: liveWidth }));
    };
    const end = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.body.classList.remove("operations-column-resizing");
      setWidths((current) => {
        const next = { ...current, [column.key]: liveWidth };
        localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    };

    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end, { once: true });
  }

  function autoFit(column: ResizableOperationsColumn<T>) {
    const longest = Math.max(
      column.label.length,
      ...rows.slice(0, 200).map((row) => String(column.value?.(row) ?? "").length),
    );
    persist({ ...widths, [column.key]: Math.min(column.max, Math.max(column.min, longest * 8 + 40)) });
  }

  function reset() {
    persist(Object.fromEntries(columns.map((column) => [column.key, column.width])));
  }

  return (
    <div className="operations-table-shell operations-resizable-table-shell">
      <div className="operations-table-tools"><span>{helperText}</span><button type="button" onClick={reset}>إعادة ضبط الأعمدة</button></div>
      <div className="operations-table-scroll operations-selection-table-scroll">
        <table className={`operations-table operations-resizable-table ${tableClassName}`.trim()} style={{ width: `${Math.max(minTableWidth, tableWidth)}px`, minWidth: "100%" }}>
          <colgroup>{columns.map((column) => <col key={column.key} style={{ width: `${widths[column.key] || column.width}px` }} />)}</colgroup>
          <thead><tr>{columns.map((column) => (
            <th key={column.key}>
              <span>{column.label}</span>
              <span
                className="operations-column-resizer"
                role="separator"
                aria-orientation="vertical"
                aria-label={`تغيير عرض عمود ${column.label}`}
                onPointerDown={(event) => beginResize(event, column)}
                onDoubleClick={() => autoFit(column)}
              />
            </th>
          ))}</tr></thead>
          <tbody>
            {!rows.length ? <tr><td colSpan={columns.length} className="table-empty">{emptyText}</td></tr> : rows.map((row) => (
              <tr key={rowKey(row)}>{columns.map((column) => <td key={column.key}>{column.render(row)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
