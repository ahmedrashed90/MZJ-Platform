import { useCallback, useEffect, useState } from "react";
import { ChartBar, DownloadSimple, WarningCircle } from "@phosphor-icons/react";
import { downloadCsv, operationsFetch, operationsQuery } from "../api";
import { useOperationsMeta } from "../useOperationsMeta";

type Row = { car_name: string; statement: string; model_year: string; location_id: string | null; location_name: string; status_code: string; status_name: string; total: number };
type Total = { label: string; total: number };

export function OperationsAllVehiclesPage() {
  const { meta, error: metaError } = useOperationsMeta();
  const [filters, setFilters] = useState({ carName: "", statement: "", modelYear: "", locationId: "", statusCode: "", minCount: 0 });
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Total[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const payload = await operationsFetch<{ ok: true; rows: Row[]; totals: Total[] }>(`/api/operations/reports${operationsQuery(filters)}`);
      setRows(payload.rows); setTotals(payload.totals);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر تحميل التقرير"); }
  }, [filters]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load]);

  const names = Array.from(new Set(rows.map((row) => row.car_name).filter((value) => value !== "—"))).sort();
  const statements = Array.from(new Set(rows.map((row) => row.statement).filter((value) => value !== "—"))).sort();
  const models = Array.from(new Set(rows.map((row) => row.model_year).filter((value) => value !== "—"))).sort().reverse();

  return (
    <div className="module-page operations-page">
      <header className="module-page-head"><div><h1>جميع السيارات</h1><p>تقرير مجمع حسب السيارة والبيان والموديل والمكان والحالة مع احترام صلاحيات الفروع.</p></div><button type="button" className="operations-secondary" onClick={() => downloadCsv("operations-all-vehicles.csv", rows)}><DownloadSimple size={18} />تصدير النتائج</button></header>
      {metaError || error ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>{metaError || error}</span></div> : null}
      <section className="operations-summary-cards">{totals.map((item) => <article key={item.label}><ChartBar size={23} weight="duotone" /><div><span>{item.label}</span><strong>{item.total.toLocaleString("ar-SA")}</strong></div></article>)}</section>
      <section className="panel operations-filter-panel">
        <select value={filters.carName} onChange={(event) => setFilters({ ...filters, carName: event.target.value })}><option value="">كل السيارات</option>{names.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={filters.statement} onChange={(event) => setFilters({ ...filters, statement: event.target.value })}><option value="">كل البيانات</option>{statements.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={filters.modelYear} onChange={(event) => setFilters({ ...filters, modelYear: event.target.value })}><option value="">كل الموديلات</option>{models.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={filters.locationId} onChange={(event) => setFilters({ ...filters, locationId: event.target.value })}><option value="">كل الأماكن</option>{meta?.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select value={filters.statusCode} onChange={(event) => setFilters({ ...filters, statusCode: event.target.value })}><option value="">كل الحالات</option>{meta?.statuses.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
        <input type="number" min={0} value={filters.minCount} onChange={(event) => setFilters({ ...filters, minCount: Number(event.target.value || 0) })} placeholder="الحد الأدنى" />
      </section>
      <section className="panel operations-table-panel"><div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>السيارة</th><th>البيان</th><th>الموديل</th><th>المكان</th><th>الحالة</th><th>العدد</th></tr></thead><tbody>
        {rows.length === 0 ? <tr><td colSpan={6} className="table-empty">لا توجد نتائج</td></tr> : rows.map((row, index) => <tr key={`${row.car_name}-${row.statement}-${row.model_year}-${row.location_id}-${row.status_code}-${index}`}><td>{row.car_name}</td><td>{row.statement}</td><td>{row.model_year}</td><td>{row.location_name}</td><td><span className={`operations-status status-${row.status_code}`}>{row.status_name}</span></td><td><strong>{row.total.toLocaleString("ar-SA")}</strong></td></tr>)}
      </tbody></table></div></section>
    </div>
  );
}
