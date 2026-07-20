import { useEffect, useState } from "react";
import { DownloadSimple, MagnifyingGlass } from "@phosphor-icons/react";
import { downloadCsv, operationsFetch, operationsQuery } from "../api";
import { useOperations } from "../components/OperationsState";
import type { AvailabilityRow } from "../types";

export function OperationsAvailabilityPage() {
  const { meta, loading, error: metaError } = useOperations();
  const [rows, setRows] = useState<AvailabilityRow[]>([]);
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    setFetching(true); setError("");
    operationsFetch<{ ok: true; rows: AvailabilityRow[] }>(`/api/operations${operationsQuery({ resource: "availability", search, location })}`)
      .then((response) => { if (!cancelled) setRows(response.rows); })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "تعذر تحميل ملخص السيارات"); })
      .finally(() => { if (!cancelled) setFetching(false); });
    return () => { cancelled = true; };
  }, [meta, search, location]);

  function exportRows() {
    downloadCsv(`MZJ-availability-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((row) => ({
      "السيارة": row.car_name,
      "البيان": row.statement,
      "الموديل": row.model_year,
      "اللون الخارجي": row.exterior_color,
      "اللون الداخلي": row.interior_color,
      "الإجمالي": row.quantity,
      ...Object.fromEntries((meta?.locations || []).map((item) => [item.name, Number(row.location_counts?.[item.code] || 0)])),
    })));
  }

  if (loading) return <div className="operations-loading-page">جاري تحميل الصفحة...</div>;
  if (metaError || !meta) return <div className="operations-alert error">{metaError || "تعذر تحميل الصفحة"}</div>;
  const total = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);

  return <div className="operations-page"><header className="operations-page-head"><div><span className="operations-kicker">توافر المخزون</span><h1>كل السيارات</h1><p>تجميع السيارات حسب الاسم والبيان والموديل والألوان، مع استبعاد المباع تحت التسليم والمباع تم التسليم.</p></div>{meta.permissions.canExportVehicles ? <button type="button" className="operations-secondary-button" onClick={exportRows}><DownloadSimple size={18} />تصدير الملخص</button> : null}</header><section className="operations-stat-strip"><article><span>إجمالي السيارات المتاحة</span><strong>{total.toLocaleString("ar-SA")}</strong></article><article><span>عدد التركيبات</span><strong>{rows.length.toLocaleString("ar-SA")}</strong></article><article><span>المكان المحدد</span><strong>{meta.locations.find((item) => item.code === location)?.name || "كل الأماكن"}</strong></article></section><section className="operations-toolbar"><label className="operations-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالسيارة أو البيان أو الموديل أو اللون" /></label><select value={location} onChange={(event) => setLocation(event.target.value)}><option value="">كل الأماكن</option>{meta.locations.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select></section>{error ? <div className="operations-alert error">{error}</div> : null}<div className="operations-table-shell"><table className="operations-table availability-table"><thead><tr><th>السيارة</th><th>البيان</th><th>الموديل</th><th>اللون الخارجي</th><th>اللون الداخلي</th>{meta.locations.map((item) => <th key={item.id}>{item.name}</th>)}<th>الإجمالي</th></tr></thead><tbody>{fetching ? <tr><td colSpan={6 + meta.locations.length} className="operations-table-empty">جاري التحميل...</td></tr> : null}{!fetching && !rows.length ? <tr><td colSpan={6 + meta.locations.length} className="operations-table-empty">لا توجد نتائج مطابقة.</td></tr> : null}{!fetching ? rows.map((row, index) => <tr key={`${row.car_name}-${row.statement}-${row.model_year}-${row.exterior_color}-${row.interior_color}-${index}`}><td><strong>{row.car_name || "—"}</strong></td><td>{row.statement || "—"}</td><td>{row.model_year || "—"}</td><td>{row.exterior_color || "—"}</td><td>{row.interior_color || "—"}</td>{meta.locations.map((item) => <td key={item.id}><span className={Number(row.location_counts?.[item.code] || 0) ? "operations-count-pill" : "operations-count-zero"}>{Number(row.location_counts?.[item.code] || 0)}</span></td>)}<td><strong className="operations-total-count">{row.quantity}</strong></td></tr>) : null}</tbody></table></div></div>;
}
