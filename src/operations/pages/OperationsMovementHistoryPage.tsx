import { useCallback, useEffect, useState } from "react";
import { CaretLeft, CaretRight, DownloadSimple, WarningCircle } from "@phosphor-icons/react";
import { downloadCsv, formatOperationsDate, operationsFetch, operationsQuery } from "../api";
import { useOperationsMeta } from "../useOperationsMeta";

type Movement = {
  id: string; batch_id: string | null; request_id: string | null; old_status: string | null; new_status: string | null;
  note: string | null; status_note: string | null; reservation_shortage_location_note: string | null; performed_by_name: string | null;
  performed_branch: string | null; created_at: string; vin: string; car_name: string | null; from_location: string | null; to_location: string | null; request_no: string | null;
};

export function OperationsMovementHistoryPage() {
  const { meta, error: metaError } = useOperationsMeta();
  const [filters, setFilters] = useState({ search: "", fromDate: "", toDate: "", fromTime: "", toTime: "", fromLocationId: "", toLocationId: "", oldStatus: "", newStatus: "", performer: "", requestNo: "" });
  const [rows, setRows] = useState<Movement[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const payload = await operationsFetch<{ ok: true; movements: Movement[]; total: number }>(`/api/operations/movements${operationsQuery({ ...filters, page, limit: 40 })}`);
      setRows(payload.movements); setTotal(payload.total);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر تحميل سجل الحركات"); }
  }, [filters, page]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load]);
  const pages = Math.max(1, Math.ceil(total / 40));

  function update(key: keyof typeof filters, value: string) { setFilters((current) => ({ ...current, [key]: value })); setPage(1); }

  return (
    <div className="module-page operations-page">
      <header className="module-page-head"><div><h1>سجل الحركات</h1><p>سجل غير قابل للتعديل لكل حركة مع الفلاتر والتصدير حسب الصلاحية.</p></div><button type="button" className="operations-secondary" onClick={() => downloadCsv("operations-movements.csv", rows)}><DownloadSimple size={18} />تصدير النتائج</button></header>
      {metaError || error ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>{metaError || error}</span></div> : null}
      <section className="panel operations-filter-panel dense">
        <input value={filters.search} onChange={(event) => update("search", event.target.value)} placeholder="VIN أو اسم السيارة" />
        <input type="date" value={filters.fromDate} onChange={(event) => update("fromDate", event.target.value)} title="من تاريخ" />
        <input type="date" value={filters.toDate} onChange={(event) => update("toDate", event.target.value)} title="إلى تاريخ" />
        <input type="time" value={filters.fromTime} onChange={(event) => update("fromTime", event.target.value)} title="من ساعة" />
        <input type="time" value={filters.toTime} onChange={(event) => update("toTime", event.target.value)} title="إلى ساعة" />
        <select value={filters.fromLocationId} onChange={(event) => update("fromLocationId", event.target.value)}><option value="">من كل الأماكن</option>{meta?.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select value={filters.toLocationId} onChange={(event) => update("toLocationId", event.target.value)}><option value="">إلى كل الأماكن</option>{meta?.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select value={filters.oldStatus} onChange={(event) => update("oldStatus", event.target.value)}><option value="">كل الحالات السابقة</option>{meta?.statuses.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
        <select value={filters.newStatus} onChange={(event) => update("newStatus", event.target.value)}><option value="">كل الحالات الجديدة</option>{meta?.statuses.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
        <input value={filters.performer} onChange={(event) => update("performer", event.target.value)} placeholder="منفذ الحركة" />
        <input value={filters.requestNo} onChange={(event) => update("requestNo", event.target.value)} placeholder="رقم الطلب" />
      </section>
      <section className="panel operations-table-panel">
        <div className="operations-table-summary"><strong>{total.toLocaleString("ar-SA")} حركة</strong><span>الصفحة {page} من {pages}</span></div>
        <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>التاريخ والوقت</th><th>VIN</th><th>السيارة</th><th>من</th><th>إلى</th><th>الحالة السابقة</th><th>الحالة الجديدة</th><th>منفذ الحركة</th><th>الفرع</th><th>الملاحظات</th><th>ملاحظات الحالة</th><th>حجز - نواقص - تحديد مكان</th><th>رقم الطلب</th><th>Batch ID</th></tr></thead><tbody>
          {rows.length === 0 ? <tr><td colSpan={14} className="table-empty">لا توجد حركات مطابقة</td></tr> : rows.map((row) => <tr key={row.id}><td>{formatOperationsDate(row.created_at)}</td><td><strong>{row.vin}</strong></td><td>{row.car_name || "—"}</td><td>{row.from_location || "—"}</td><td>{row.to_location || "—"}</td><td>{row.old_status || "—"}</td><td>{row.new_status || "—"}</td><td>{row.performed_by_name || "—"}</td><td>{row.performed_branch || "—"}</td><td>{row.note || "—"}</td><td>{row.status_note || "—"}</td><td>{row.reservation_shortage_location_note || "—"}</td><td>{row.request_no || "—"}</td><td>{row.batch_id || "—"}</td></tr>)}
        </tbody></table></div>
        <div className="operations-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><CaretRight size={17} />السابق</button><button type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>التالي<CaretLeft size={17} /></button></div>
      </section>
    </div>
  );
}
