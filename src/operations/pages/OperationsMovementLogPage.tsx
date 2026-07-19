import { useCallback, useEffect, useState } from "react";
import { DownloadSimple, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { useOperations } from "../OperationsContext";
import { downloadCsv, formatOperationsDate, operationsFetch, operationsQuery } from "../api";
import type { OperationsMovement } from "../types";

export function OperationsMovementLogPage() {
  const { meta, can } = useOperations();
  const [movements, setMovements] = useState<OperationsMovement[]>([]);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await operationsFetch<{ ok: boolean; movements: OperationsMovement[] }>(`/api/operations/movements${operationsQuery({ search, from, to, dateFrom, dateTo, limit: 2000 })}`);
      setMovements(payload.movements || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل سجل الحركات");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, from, search, to]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  function exportLog() {
    downloadCsv(
      "operations-movement-log.csv",
      ["التاريخ", "رقم الحركة", "رقم الطلب", "رقم الهيكل", "السيارة", "البيان", "الموديل", "من", "إلى", "الحالة السابقة", "الحالة الجديدة", "المنفذ", "الملاحظات"],
      movements.map((row) => [formatOperationsDate(row.created_at), row.batch_no, row.request_no, row.vin, row.car_name, row.statement, row.model_year, row.from_location_name, row.to_location_name, row.old_status_name || row.old_status, row.new_status_name || row.new_status, row.performed_by_name, row.note]),
    );
  }

  return (
    <div className="module-page ops-page">
      <header className="module-page-head ops-page-head">
        <div><h1>سجل الحركات</h1><p>سجل غير قابل للتعديل لجميع حركات السيارات المباشرة والحركات الناتجة عن طلبات النقل.</p></div>
        {can("operations.logs.export") ? <button type="button" className="ops-button secondary" onClick={exportLog} disabled={!movements.length}><DownloadSimple size={18} />تصدير السجل</button> : null}
      </header>
      {error ? <div className="ops-error"><WarningCircle size={19} weight="fill" /><span>{error}</span></div> : null}
      <section className="panel ops-list-panel">
        <div className="ops-toolbar movement-log">
          <label className="ops-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="الهيكل أو السيارة أو رقم الحركة أو الطلب..." /></label>
          <select value={from} onChange={(event) => setFrom(event.target.value)}><option value="">من كل المواقع</option>{meta?.locations.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select>
          <select value={to} onChange={(event) => setTo(event.target.value)}><option value="">إلى كل المواقع</option>{meta?.locations.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select>
          <label><span>من تاريخ</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
          <label><span>إلى تاريخ</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        </div>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead><tr><th>التاريخ</th><th>الحركة / الطلب</th><th>رقم الهيكل</th><th>السيارة</th><th>المسار</th><th>الحالة</th><th>المنفذ</th><th>الملاحظات</th></tr></thead>
            <tbody>
              {!loading && movements.length === 0 ? <tr><td colSpan={8} className="ops-table-empty">لا توجد حركات مطابقة.</td></tr> : null}
              {movements.map((row) => <tr key={row.id}><td>{formatOperationsDate(row.created_at)}</td><td><strong>{row.batch_no || "—"}</strong><small>{row.request_no || (row.movement_type === "request" ? "طلب نقل" : "حركة مباشرة")}</small></td><td><strong>{row.vin || "—"}</strong></td><td><strong>{row.car_name || "—"}</strong><small>{row.statement || "—"} • {row.model_year || "—"}</small></td><td>{row.from_location_name || "—"} ← {row.to_location_name || "—"}</td><td>{row.old_status_name || row.old_status || "—"} ← {row.new_status_name || row.new_status || "—"}</td><td>{row.performed_by_name || "—"}</td><td>{row.note || "—"}</td></tr>)}
            </tbody>
          </table>
        </div>
        {loading ? <div className="ops-loading-row">جاري تحميل السجل...</div> : <div className="ops-list-footer">عدد الحركات: {movements.length.toLocaleString("ar-SA")}</div>}
      </section>
    </div>
  );
}
