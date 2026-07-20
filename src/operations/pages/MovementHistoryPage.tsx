import { useEffect, useState } from "react";
import { FileXls, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { MovementHistoryTable, type MovementHistoryRow } from "../components/MovementHistoryTable";
import { exportExcel, operationsFetch, queryString } from "../api";
import { useOperations } from "../useOperations";

export function MovementHistoryPage() {
  const { meta } = useOperations();
  const [rows, setRows] = useState<MovementHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: "", from: "", to: "", status: "", user: "", dateFrom: "", dateTo: "", timeFrom: "", timeTo: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pageSize = 50;

  async function fetchPage(targetPage: number, targetSize: number) {
    return operationsFetch<{ rows: MovementHistoryRow[]; total: number }>(`/api/operations${queryString({ resource: "movements", ...filters, page: targetPage, pageSize: targetSize })}`);
  }

  async function load(targetPage = page) {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchPage(targetPage, pageSize);
      setRows(payload.rows);
      setTotal(payload.total);
    } catch (failure) {
      setRows([]);
      setTotal(0);
      setError(failure instanceof Error ? failure.message : "تعذر تحميل سجل الحركات");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(page); }, [page]);

  async function applyFilters() {
    if (page !== 1) setPage(1);
    else await load(1);
  }

  async function exportAll() {
    setLoading(true);
    setError("");
    try {
      const first = await fetchPage(1, 200);
      const all = [...first.rows];
      const pages = Math.max(1, Math.ceil(first.total / 200));
      for (let current = 2; current <= pages; current += 1) all.push(...(await fetchPage(current, 200)).rows);
      exportExcel("سجل-الحركات.xlsx", ["التاريخ والوقت","VIN","السيارة","البيان","المكان السابق","المكان الجديد","الحالة السابقة","الحالة الجديدة","منفذ الحركة","فرع المستخدم","الملاحظات","ملاحظات الحالة","حجز - نواقص - تحديد مكان","رقم الطلب","Batch ID"], all.map((row) => [row.created_at,row.vin,row.car_name,row.statement,row.from_location_name,row.to_location_name,row.old_status_name || row.old_status,row.new_status_name || row.new_status,row.performed_by_name,row.performed_by_branch,row.note,row.state_note,row.shortage_note,row.transfer_request_id,row.batch_id]));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تصدير سجل الحركات");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="module-page operations-page operations-history-page">
      <header className="module-page-head"><div><h1>سجل الحركات</h1><p>عرض الحركات الفعلية المسجلة لكل سيارة مع الفلاتر والتصدير وتغيير عرض الأعمدة بالسحب.</p></div><div className="operations-header-actions"><span className="operations-count">{total.toLocaleString("ar-SA")}</span>{meta.permissions.canExport ? <button type="button" onClick={() => void exportAll()} disabled={loading}><FileXls size={17} />تصدير النتائج</button> : null}</div></header>
      {error ? <div className="operations-alert error"><WarningCircle size={18} />{error}</div> : null}
      <section className="panel operations-data-panel">
        <div className="operations-history-filters">
          <label className="operations-search"><MagnifyingGlass size={18} /><input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") void applyFilters(); }} placeholder="VIN أو السيارة أو البيان أو الملاحظة" /></label>
          <select value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })}><option value="">من كل الأماكن</option>{meta.locations.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select>
          <select value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })}><option value="">إلى كل الأماكن</option>{meta.locations.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select>
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">كل الحالات الجديدة</option>{meta.statuses.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
          <input value={filters.user} onChange={(event) => setFilters({ ...filters, user: event.target.value })} placeholder="المستخدم" />
          <label><span>من تاريخ</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} /></label>
          <label><span>إلى تاريخ</span><input type="date" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} /></label>
          <label><span>من ساعة</span><input type="time" value={filters.timeFrom} onChange={(event) => setFilters({ ...filters, timeFrom: event.target.value })} /></label>
          <label><span>إلى ساعة</span><input type="time" value={filters.timeTo} onChange={(event) => setFilters({ ...filters, timeTo: event.target.value })} /></label>
          <button type="button" onClick={() => void applyFilters()} disabled={loading}><MagnifyingGlass size={17} />تطبيق</button>
        </div>
        <MovementHistoryTable rows={rows} />
        <div className="operations-pagination"><button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>السابق</button><span>صفحة {page} من {Math.max(1, Math.ceil(total / pageSize))}</span><button disabled={page * pageSize >= total || loading} onClick={() => setPage((value) => value + 1)}>التالي</button></div>
      </section>
    </div>
  );
}
