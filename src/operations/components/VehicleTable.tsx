import { useMemo, useState } from "react";
import type { VehicleRow } from "../types";

type Column = {
  key: string;
  label: string;
  width: number;
  min: number;
  max: number;
  value: (row: VehicleRow) => unknown;
  render: (row: VehicleRow, onOpen: (id: string) => void) => React.ReactNode;
};

const STORAGE_KEY = "mzj.operations.vehicleTable.columnWidths.v1";

const columns: Column[] = [
  { key: "vin", label: "الهيكل VIN", width: 190, min: 135, max: 360, value: (row) => row.vin, render: (row, onOpen) => <button type="button" className="operations-vin-link" onClick={() => onOpen(row.id)}>{row.vin}</button> },
  { key: "car", label: "السيارة", width: 150, min: 110, max: 300, value: (row) => row.car_name, render: (row) => row.car_name || "—" },
  { key: "statement", label: "البيان", width: 150, min: 110, max: 320, value: (row) => row.statement, render: (row) => row.statement || "—" },
  { key: "agent", label: "الوكيل", width: 125, min: 95, max: 240, value: (row) => row.agent_name, render: (row) => row.agent_name || "—" },
  { key: "interior", label: "اللون الداخلي", width: 125, min: 95, max: 220, value: (row) => row.interior_color, render: (row) => row.interior_color || "—" },
  { key: "exterior", label: "اللون الخارجي", width: 125, min: 95, max: 220, value: (row) => row.exterior_color, render: (row) => row.exterior_color || "—" },
  { key: "model", label: "الموديل", width: 95, min: 80, max: 170, value: (row) => row.model_year, render: (row) => row.model_year || "—" },
  { key: "plate", label: "اللوحة", width: 110, min: 90, max: 200, value: (row) => row.plate_no, render: (row) => row.plate_no || "—" },
  { key: "batch", label: "اسم الدفعة بالتاريخ", width: 155, min: 125, max: 290, value: (row) => row.batch_no, render: (row) => row.batch_no || "—" },
  { key: "location", label: "المكان", width: 115, min: 90, max: 220, value: (row) => row.location_name, render: (row) => row.location_name || "—" },
  { key: "notes", label: "ملاحظات في السيارة", width: 175, min: 125, max: 420, value: (row) => row.notes, render: (row) => <span title={row.notes || ""}>{row.notes || "—"}</span> },
  { key: "shortage", label: "حجز - نواقص - تحديد مكان", width: 205, min: 150, max: 460, value: (row) => row.shortage_note, render: (row) => <span title={row.shortage_note || ""}>{row.shortage_note || "—"}</span> },
  { key: "status", label: "الحالة", width: 145, min: 115, max: 260, value: (row) => row.status_name || row.status_code, render: (row) => <span className={`operations-status status-${row.status_code}`}>{row.status_name || row.status_code}</span> },
  { key: "tracking", label: "Tracking", width: 190, min: 155, max: 320, value: (row) => row.tracking_order_no, render: (row) => row.tracking_order_id ? <button type="button" className="operations-tracking-open" onClick={() => window.location.assign(`/tracking?order=${encodeURIComponent(row.tracking_order_id || "")}`)}><span>{row.tracking_order_no || "فتح الطلب"}</span><b>{Math.max(0, Math.min(100, Number(row.tracking_progress || 0)))}%</b><i><span style={{ width: `${Math.max(0, Math.min(100, Number(row.tracking_progress || 0)))}%` }} /></i></button> : <span className="operations-muted-badge">لا يوجد طلب</span> },
  { key: "approvals", label: "الموافقات", width: 170, min: 135, max: 260, value: (row) => `${row.financial_approved ? "مالي تم" : "مالي لم يتم"} ${row.administrative_approved ? "إداري تم" : "إداري لم يتم"}`, render: (row) => <span className={row.financial_approved && row.administrative_approved ? "operations-ok-badge" : "operations-warn-badge"}>{row.financial_approved ? "مالي ✓" : "مالي —"} / {row.administrative_approved ? "إداري ✓" : "إداري —"}</span> },
  { key: "checks", label: "التشيك", width: 95, min: 80, max: 150, value: () => "عرض", render: (row, onOpen) => <button type="button" className="operations-inline-link" onClick={() => onOpen(row.id)}>عرض</button> },
  { key: "transfers", label: "طلبات النقل", width: 115, min: 95, max: 190, value: (row) => row.active_transfer_requests, render: (row) => Number(row.active_transfer_requests || 0) > 0 ? <span className="operations-warn-badge">{row.active_transfer_requests}</span> : <span className="operations-muted-badge">لا يوجد</span> },
  { key: "archive", label: "الأرشيف", width: 100, min: 85, max: 160, value: (row) => row.archived_at ? "مؤرشف" : "نشط", render: (row) => row.archived_at ? <span className="operations-ok-badge">مؤرشف</span> : <span className="operations-muted-badge">نشط</span> },
];

function initialWidths() {
  const defaults = Object.fromEntries(columns.map((column) => [column.key, column.width]));
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, number>;
    return Object.fromEntries(columns.map((column) => [column.key, Math.min(column.max, Math.max(column.min, Number(saved[column.key] || defaults[column.key]))) ]));
  } catch {
    return defaults;
  }
}

export function VehicleTable({ rows, onOpen, emptyText = "لا توجد سيارات مطابقة" }: { rows: VehicleRow[]; onOpen: (id: string) => void; emptyText?: string }) {
  const [widths, setWidths] = useState<Record<string, number>>(initialWidths);
  const tableWidth = useMemo(() => columns.reduce((sum, column) => sum + (widths[column.key] || column.width), 0), [widths]);

  function save(next: Record<string, number>) {
    setWidths(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function beginResize(event: React.PointerEvent<HTMLSpanElement>, column: Column) {
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
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end, { once: true });
  }

  function autoFit(column: Column) {
    const longest = Math.max(column.label.length, ...rows.slice(0, 200).map((row) => String(column.value(row) ?? "").length));
    save({ ...widths, [column.key]: Math.min(column.max, Math.max(column.min, longest * 8 + 36)) });
  }

  function resetWidths() {
    const defaults = Object.fromEntries(columns.map((column) => [column.key, column.width]));
    save(defaults);
  }

  return (
    <div className="operations-table-shell">
      <div className="operations-table-tools"><span>اسحب حد العمود لتغيير العرض، واضغط مرتين للضبط التلقائي.</span><button type="button" onClick={resetWidths}>إعادة ضبط الأعمدة</button></div>
      <div className="operations-table-scroll">
        <table className="operations-table" style={{ width: `${Math.max(1250, tableWidth)}px`, minWidth: "100%" }}>
          <colgroup>{columns.map((column) => <col key={column.key} style={{ width: `${widths[column.key] || column.width}px` }} />)}</colgroup>
          <thead><tr>{columns.map((column) => <th key={column.key} style={{ width: widths[column.key] || column.width }}><span>{column.label}</span><span className="operations-column-resizer" role="separator" aria-orientation="vertical" aria-label={`اسحب لتغيير عرض عمود ${column.label}`} title="اسحب يمينًا أو يسارًا لتغيير العرض — ضغطتان للضبط التلقائي" onPointerDown={(event) => beginResize(event, column)} onDoubleClick={() => autoFit(column)} /></th>)}</tr></thead>
          <tbody>
            {!rows.length ? <tr><td colSpan={columns.length} className="table-empty">{emptyText}</td></tr> : rows.map((row) => (
              <tr key={row.id}>{columns.map((column) => <td key={column.key}>{column.render(row, onOpen)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
