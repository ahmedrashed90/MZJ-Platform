import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, Trash } from "@phosphor-icons/react";
import type { OperationsVehicle } from "../types";

const STORAGE_KEY = "mzj.operations.vehicleTable.widths.v1";
const MIN_WIDTH = 92;
const MAX_WIDTH = 420;

type Column = { key: string; label: string; width: number };

const BASE_COLUMNS: Column[] = [
  { key: "vin", label: "الهيكل VIN", width: 150 },
  { key: "car", label: "السيارة", width: 150 },
  { key: "statement", label: "البيان", width: 145 },
  { key: "agent", label: "الوكيل", width: 120 },
  { key: "interior", label: "اللون الداخلي", width: 120 },
  { key: "exterior", label: "اللون الخارجي", width: 120 },
  { key: "model", label: "الموديل", width: 100 },
  { key: "plate", label: "اللوحة", width: 110 },
  { key: "batch", label: "اسم الدفعة بالتاريخ", width: 165 },
  { key: "location", label: "المكان", width: 125 },
  { key: "notes", label: "ملاحظات في السيارة", width: 210 },
  { key: "shortage", label: "حجز - نواقص - تحديد مكان", width: 225 },
  { key: "status", label: "الحالة", width: 145 },
  { key: "tracking", label: "Tracking", width: 155 },
  { key: "approvals", label: "الموافقات", width: 165 },
  { key: "checks", label: "التشيك", width: 100 },
  { key: "transfers", label: "طلبات النقل", width: 120 },
  { key: "archive", label: "الأرشيف", width: 105 },
  { key: "actions", label: "الإجراءات", width: 100 },
];

function trackingText(vehicle: OperationsVehicle) {
  if (!vehicle.tracking_order_id) return "لا يوجد طلب";
  if (vehicle.tracking_archived || vehicle.tracking_status === "completed") return "مكتمل — 100%";
  const total = Number(vehicle.total_stages || 0);
  const done = Number(vehicle.completed_stages || 0);
  const percent = total ? Math.round(done / total * 100) : 0;
  return `${vehicle.tracking_status === "not_started" ? "لم يبدأ" : "قيد التنفيذ"} — ${percent}%`;
}

function initialWidths() {
  const defaults = Object.fromEntries(BASE_COLUMNS.map((column) => [column.key, column.width]));
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return { ...defaults, ...saved } as Record<string, number>;
  } catch {
    return defaults;
  }
}

export function VehicleTable({ vehicles, loading, onOpen, onDelete, showActions = true }: { vehicles: OperationsVehicle[]; loading: boolean; onOpen: (vehicle: OperationsVehicle) => void; onDelete?: (vehicle: OperationsVehicle) => void; showActions?: boolean }) {
  const [widths, setWidths] = useState<Record<string, number>>(initialWidths);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const columns = useMemo(() => BASE_COLUMNS.filter((column) => showActions || column.key !== "actions"), [showActions]);
  const tableWidth = columns.reduce((total, column) => total + (widths[column.key] || column.width), 0);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  }, [widths]);

  function syncScroll(source: "top" | "body") {
    if (syncingRef.current) return;
    const from = source === "top" ? topScrollRef.current : bodyScrollRef.current;
    const to = source === "top" ? bodyScrollRef.current : topScrollRef.current;
    if (!from || !to) return;
    syncingRef.current = true;
    to.scrollLeft = from.scrollLeft;
    requestAnimationFrame(() => { syncingRef.current = false; });
  }

  function beginResize(event: React.PointerEvent<HTMLSpanElement>, key: string) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widths[key] || BASE_COLUMNS.find((column) => column.key === key)?.width || 120;
    const direction = document.documentElement.dir === "rtl" ? -1 : 1;
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (moveEvent.clientX - startX) * direction));
      setWidths((current) => ({ ...current, [key]: Math.round(next) }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function autoFit(key: string) {
    const column = BASE_COLUMNS.find((item) => item.key === key);
    if (!column) return;
    const values = vehicles.slice(0, 120).map((vehicle) => {
      if (key === "vin") return vehicle.vin;
      if (key === "car") return vehicle.car_name;
      if (key === "statement") return vehicle.statement;
      if (key === "agent") return vehicle.agent_name;
      if (key === "interior") return vehicle.interior_color;
      if (key === "exterior") return vehicle.exterior_color;
      if (key === "model") return vehicle.model_year;
      if (key === "plate") return vehicle.plate_no;
      if (key === "batch") return vehicle.batch_no;
      if (key === "location") return vehicle.location_name;
      if (key === "notes") return vehicle.notes;
      if (key === "shortage") return vehicle.shortage_location_note;
      if (key === "status") return vehicle.status_name;
      if (key === "tracking") return trackingText(vehicle);
      return column.label;
    });
    const longest = Math.max(column.label.length, ...values.map((value) => String(value || "").length));
    setWidths((current) => ({ ...current, [key]: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, longest * 8 + 38)) }));
  }

  function resetWidths() {
    setWidths(Object.fromEntries(BASE_COLUMNS.map((column) => [column.key, column.width])));
  }

  return <div className="operations-table-shell">
    <div className="operations-table-tools"><span>اسحب حدود الأعمدة لتغيير العرض، واضغط مرتين للضبط التلقائي.</span><button type="button" onClick={resetWidths}>إعادة ضبط المقاسات</button></div>
    <div className="operations-table-top-scroll" ref={topScrollRef} onScroll={() => syncScroll("top")} aria-hidden="true"><div style={{ width: tableWidth }} /></div>
    <div className="operations-table-wrap" ref={bodyScrollRef} onScroll={() => syncScroll("body")}>
      <table className="operations-table" style={{ width: tableWidth, minWidth: "100%", tableLayout: "fixed" }}>
        <colgroup>{columns.map((column) => <col key={column.key} style={{ width: widths[column.key] || column.width }} />)}</colgroup>
        <thead><tr>{columns.map((column) => <th key={column.key}><span>{column.label}</span><span className="operations-column-resizer" onPointerDown={(event) => beginResize(event, column.key)} onDoubleClick={() => autoFit(column.key)} /></th>)}</tr></thead>
        <tbody>
          {!loading && vehicles.length === 0 ? <tr><td colSpan={columns.length} className="table-empty">لا توجد سيارات مطابقة</td></tr> : null}
          {vehicles.map((vehicle) => <tr key={vehicle.id}>
            <td><button type="button" className="operations-vin-link" onClick={() => onOpen(vehicle)}>{vehicle.vin}</button></td>
            <td>{vehicle.car_name || "—"}</td><td>{vehicle.statement || "—"}</td><td>{vehicle.agent_name || "—"}</td><td>{vehicle.interior_color || "—"}</td><td>{vehicle.exterior_color || "—"}</td><td>{vehicle.model_year || "—"}</td><td>{vehicle.plate_no || "—"}</td><td>{vehicle.batch_no || "—"}</td>
            <td>{vehicle.location_name || "—"}</td><td className="operations-note-cell" title={vehicle.notes || ""}>{vehicle.notes || "—"}</td><td className="operations-note-cell" title={vehicle.shortage_location_note || ""}>{vehicle.shortage_location_note || "—"}</td>
            <td><span className={`operations-badge status-${vehicle.status_code}`}>{vehicle.status_name || vehicle.status_code}</span></td>
            <td><span className={`operations-badge ${vehicle.tracking_order_id?"tracking-active":"muted"}`}>{trackingText(vehicle)}</span></td>
            <td><span className={`operations-badge ${vehicle.financial_approved&&vehicle.administrative_approved?"success":"warning"}`}>{vehicle.financial_approved?"مالي ✓":"مالي —"} / {vehicle.administrative_approved?"إداري ✓":"إداري —"}</span></td>
            <td><button type="button" className="operations-inline-button" onClick={() => onOpen(vehicle)}>عرض</button></td>
            <td>{vehicle.has_active_transfer?<span className="operations-badge warning">طلب جارٍ</span>:<span className="operations-badge muted">لا يوجد</span>}</td>
            <td>{vehicle.archived_at?<span className="operations-badge archived">مؤرشفة</span>:<span className="operations-badge muted">نشطة</span>}</td>
            {showActions?<td><div className="operations-row-actions"><button type="button" onClick={() => onOpen(vehicle)} title="عرض"><Eye size={16}/></button>{onDelete?<button type="button" className="danger" onClick={() => onDelete(vehicle)} title="مسح السيارة"><Trash size={16}/></button>:null}</div></td>:null}
          </tr>)}
        </tbody>
      </table>
      {loading?<div className="operations-loading-row">جاري تحميل السيارات...</div>:null}
    </div>
  </div>;
}
