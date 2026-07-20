import { useEffect, useState } from "react";
import { FileXls, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { exportExcel, formatOperationsDate, operationsFetch, queryString } from "../api";
import { useOperations } from "../useOperations";

type MovementRow = {
  id: string; batch_id?: string | null; transfer_request_id?: string | null; created_at: string; movement_type: string;
  old_status?: string | null; new_status?: string | null; note?: string | null; state_note?: string | null; shortage_note?: string | null;
  performed_by_name?: string | null; performed_by_role?: string | null; performed_by_branch?: string | null;
  vehicle_id: string; vin: string; car_name?: string | null; statement?: string | null;
  from_location_code?: string | null; from_location_name?: string | null; to_location_code?: string | null; to_location_name?: string | null;
};

export function MovementHistoryPage() {
  const { meta } = useOperations();
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: "", from: "", to: "", status: "", user: "", dateFrom: "", dateTo: "", timeFrom: "", timeTo: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pageSize = 50;

  async function load(targetPage = page, targetSize = pageSize) {
    setLoading(true); setError("");
    try { const payload = await operationsFetch<{ rows: MovementRow[]; total: number }>(`/api/operations${queryString({ resource: "movements", ...filters, page: targetPage, pageSize: targetSize })}`); if (targetSize === pageSize) { setRows(payload.rows); setTotal(payload.total); } return payload; }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل سجل الحركات"); throw failure; }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [page]);

  async function exportAll() {
    try {
      const all: MovementRow[] = [];
      for (let current = 1; current <= Math.max(1, Math.ceil(total / 200)); current += 1) all.push(...(await load(current, 200)).rows);
      exportExcel("سجل-الحركات.xlsx", ["التاريخ","الوقت","VIN","السيارة","المكان السابق","المكان الجديد","الحالة السابقة","الحالة الجديدة","منفذ الحركة","فرع المستخدم","الملاحظات","ملاحظات الحالة","حجز - نواقص - تحديد مكان","رقم الطلب","Batch ID"], all.map((row) => { const date = new Date(row.created_at); return [date.toLocaleDateString("ar-SA"),date.toLocaleTimeString("ar-SA"),row.vin,row.car_name,row.from_location_name,row.to_location_name,row.old_status,row.new_status,row.performed_by_name,row.performed_by_branch,row.note,row.state_note,row.shortage_note,row.transfer_request_id,row.batch_id]; }));
    } catch { /* error already shown */ }
  }

  return (
    <div className="module-page operations-page">
      <header className="module-page-head"><div><h1>سجل الحركات</h1><p>استعلام فعلي من PostgreSQL باستخدام عمود created_at المعتمد.</p></div><div className="operations-header-actions"><span className="operations-count">{total.toLocaleString("ar-SA")}</span>{meta.permissions.canExport ? <button type="button" onClick={() => void exportAll()}><FileXls size={17} />تصدير النتائج</button> : null}</div></header>
      {error ? <div className="operations-alert error"><WarningCircle size={18} />{error}</div> : null}
      <section className="panel operations-data-panel">
        <div className="operations-history-filters">
          <label className="operations-search"><MagnifyingGlass size={18} /><input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="VIN أو السيارة أو الملاحظة" /></label>
          <select value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })}><option value="">من كل الأماكن</option>{meta.locations.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select>
          <select value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })}><option value="">إلى كل الأماكن</option>{meta.locations.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">كل الحالات الجديدة</option>{meta.statuses.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
          <input value={filters.user} onChange={(e) => setFilters({ ...filters, user: e.target.value })} placeholder="المستخدم" />
          <label><span>من تاريخ</span><input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} /></label>
          <label><span>إلى تاريخ</span><input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} /></label>
          <label><span>من ساعة</span><input type="time" value={filters.timeFrom} onChange={(e) => setFilters({ ...filters, timeFrom: e.target.value })} /></label>
          <label><span>إلى ساعة</span><input type="time" value={filters.timeTo} onChange={(e) => setFilters({ ...filters, timeTo: e.target.value })} /></label>
          <button type="button" onClick={() => { setPage(1); void load(1); }}><MagnifyingGlass size={17} />تطبيق</button>
        </div>
        <div className="operations-table-scroll"><table className="operations-table movements"><thead><tr><th>التاريخ والوقت</th><th>VIN</th><th>السيارة</th><th>المكان السابق</th><th>المكان الجديد</th><th>الحالة السابقة</th><th>الحالة الجديدة</th><th>منفذ الحركة</th><th>الفرع</th><th>الملاحظات</th><th>ملاحظات الحالة</th><th>حجز - نواقص - تحديد مكان</th><th>رقم الطلب</th><th>Batch ID</th></tr></thead><tbody>{!rows.length ? <tr><td colSpan={14} className="table-empty">لا توجد حركات مطابقة</td></tr> : rows.map((row) => <tr key={row.id}><td>{formatOperationsDate(row.created_at)}</td><td>{row.vin}</td><td>{row.car_name || "—"}</td><td>{row.from_location_name || "—"}</td><td>{row.to_location_name || "—"}</td><td>{row.old_status || "—"}</td><td>{row.new_status || "—"}</td><td>{row.performed_by_name || "—"}</td><td>{row.performed_by_branch || "—"}</td><td>{row.note || "—"}</td><td>{row.state_note || "—"}</td><td>{row.shortage_note || "—"}</td><td>{row.transfer_request_id || "—"}</td><td>{row.batch_id || "—"}</td></tr>)}</tbody></table></div>
        <div className="operations-pagination"><button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>السابق</button><span>صفحة {page} من {Math.max(1, Math.ceil(total / pageSize))}</span><button disabled={page * pageSize >= total || loading} onClick={() => setPage((value) => value + 1)}>التالي</button></div>
      </section>
    </div>
  );
}
