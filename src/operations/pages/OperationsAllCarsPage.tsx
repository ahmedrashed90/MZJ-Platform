import { useCallback, useEffect, useState } from "react";
import { DownloadSimple, MagnifyingGlass, Table, WarningCircle } from "@phosphor-icons/react";
import { downloadCsv, formatOperationsDate, operationsFetch, operationsQuery } from "../api";
import type { AllCarsRow } from "../types";

export function OperationsAllCarsPage() {
  const [rows, setRows] = useState<AllCarsRow[]>([]);
  const [filters, setFilters] = useState<{ car_names?: string[]; statements?: string[]; model_years?: string[] }>({});
  const [totals, setTotals] = useState({ total: 0, availableForSale: 0, reserved: 0, hasNotes: 0 });
  const [search, setSearch] = useState("");
  const [carName, setCarName] = useState("");
  const [statement, setStatement] = useState("");
  const [modelYear, setModelYear] = useState("");
  const [minCount, setMinCount] = useState("0");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await operationsFetch<{ ok: boolean; rows: AllCarsRow[]; filters: typeof filters; totals: typeof totals }>(
        `/api/operations/reports${operationsQuery({ search, carName, statement, modelYear, minCount })}`,
      );
      setRows(payload.rows || []);
      setFilters(payload.filters || {});
      setTotals(payload.totals || { total: 0, availableForSale: 0, reserved: 0, hasNotes: 0 });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل التقرير");
    } finally {
      setLoading(false);
    }
  }, [carName, minCount, modelYear, search, statement]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  function exportRows() {
    downloadCsv(
      "operations-all-cars.csv",
      ["السيارة", "البيان", "الموديل", "الإجمالي", "متاح للبيع", "حجز", "بها ملاحظات", "المستودع", "الوكالة", "الصالة", "القادسية", "الملتقى", "آخر تحديث"],
      rows.map((row) => [row.car_name, row.statement, row.model_year, row.total, row.available_for_sale, row.reserved, row.has_notes, row.warehouse, row.agency, row.hall, row.qadisiyah, row.multaqa, formatOperationsDate(row.last_update)]),
    );
  }

  return (
    <div className="module-page ops-page">
      <header className="module-page-head ops-page-head">
        <div><h1>جميع السيارات</h1><p>تجميع المخزون الفعلي حسب السيارة والفئة والموديل مع توزيع الأعداد على المواقع.</p></div>
        <button type="button" className="ops-button secondary" onClick={exportRows} disabled={!rows.length}><DownloadSimple size={18} />تصدير التقرير</button>
      </header>
      {error ? <div className="ops-error"><WarningCircle size={19} weight="fill" /><span>{error}</span></div> : null}

      <section className="ops-summary-grid four">
        <div className="ops-summary-card static"><span className="ops-summary-icon"><Table size={22} weight="duotone" /></span><span>إجمالي السيارات</span><strong>{totals.total.toLocaleString("ar-SA")}</strong></div>
        <div className="ops-summary-card static"><span>متاح للبيع</span><strong>{totals.availableForSale.toLocaleString("ar-SA")}</strong></div>
        <div className="ops-summary-card static"><span>حجز</span><strong>{totals.reserved.toLocaleString("ar-SA")}</strong></div>
        <div className="ops-summary-card static"><span>بها ملاحظات</span><strong>{totals.hasNotes.toLocaleString("ar-SA")}</strong></div>
      </section>

      <section className="panel ops-list-panel">
        <div className="ops-toolbar reports">
          <label className="ops-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث عام..." /></label>
          <select value={carName} onChange={(event) => setCarName(event.target.value)}><option value="">كل السيارات</option>{filters.car_names?.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select value={statement} onChange={(event) => setStatement(event.target.value)}><option value="">كل الفئات</option>{filters.statements?.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select value={modelYear} onChange={(event) => setModelYear(event.target.value)}><option value="">كل الموديلات</option>{filters.model_years?.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <label className="ops-min-count"><span>حد أدنى</span><input type="number" min="0" value={minCount} onChange={(event) => setMinCount(event.target.value)} /></label>
        </div>
        <div className="ops-table-wrap">
          <table className="ops-table ops-report-table">
            <thead><tr><th>السيارة</th><th>البيان</th><th>الموديل</th><th>الإجمالي</th><th>متاح</th><th>حجز</th><th>ملاحظات</th><th>المستودع</th><th>الوكالة</th><th>الصالة</th><th>القادسية</th><th>الملتقى</th></tr></thead>
            <tbody>
              {!loading && rows.length === 0 ? <tr><td colSpan={12} className="ops-table-empty">لا توجد بيانات مطابقة.</td></tr> : null}
              {rows.map((row) => <tr key={`${row.car_name}-${row.statement}-${row.model_year}`}><td><strong>{row.car_name}</strong></td><td>{row.statement}</td><td>{row.model_year}</td><td><strong>{row.total}</strong></td><td>{row.available_for_sale}</td><td>{row.reserved}</td><td>{row.has_notes}</td><td>{row.warehouse}</td><td>{row.agency}</td><td>{row.hall}</td><td>{row.qadisiyah}</td><td>{row.multaqa}</td></tr>)}
            </tbody>
          </table>
        </div>
        {loading ? <div className="ops-loading-row">جاري تحميل التقرير...</div> : <div className="ops-list-footer">عدد التجميعات: {rows.length.toLocaleString("ar-SA")}</div>}
      </section>
    </div>
  );
}
