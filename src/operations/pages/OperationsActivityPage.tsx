import { useEffect, useState } from "react";
import { DownloadSimple, MagnifyingGlass } from "@phosphor-icons/react";
import { downloadCsv, formatOperationsDate, operationsFetch, operationsQuery } from "../api";
import { useOperations } from "../components/OperationsState";
import type { Movement } from "../types";

export function OperationsActivityPage() {
  const { meta, loading, error: metaError } = useOperations();
  const [rows, setRows] = useState<Movement[]>([]);
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    setFetching(true); setError("");
    operationsFetch<{ ok: true; rows: Movement[] }>(`/api/operations${operationsQuery({ resource: "movements", search, location, from, to })}`)
      .then((response) => { if (!cancelled) setRows(response.rows); })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "تعذر تحميل سجل الحركات"); })
      .finally(() => { if (!cancelled) setFetching(false); });
    return () => { cancelled = true; };
  }, [meta, search, location, from, to]);

  function exportRows() {
    downloadCsv(`MZJ-movements-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((row) => ({
      "التاريخ": formatOperationsDate(row.created_at),
      "رقم الهيكل": row.vin,
      "السيارة": row.car_name,
      "الموديل": row.model_year,
      "من": row.from_location_name,
      "إلى": row.to_location_name,
      "الحالة السابقة": meta?.statuses.find((item) => item.code === row.old_status)?.label || row.old_status,
      "الحالة الجديدة": meta?.statuses.find((item) => item.code === row.new_status)?.label || row.new_status,
      "نوع الحركة": row.movement_type === "request" ? "طلب نقل" : "حركة مباشرة",
      "رقم الطلب": row.request_no,
      "المستخدم": row.performed_by_name,
      "الملاحظة": row.note,
    })));
  }

  if (loading) return <div className="operations-loading-page">جاري تحميل الصفحة...</div>;
  if (metaError || !meta) return <div className="operations-alert error">{metaError || "تعذر تحميل الصفحة"}</div>;
  return <div className="operations-page"><header className="operations-page-head"><div><span className="operations-kicker">سجل غير قابل للضياع</span><h1>سجل الحركات</h1><p>كل تغيير مكان أو حالة، سواء حركة مباشرة أو ناتجًا عن طلب نقل.</p></div>{meta.permissions.canExportVehicles ? <button type="button" className="operations-secondary-button" onClick={exportRows}><DownloadSimple size={18} />تصدير السجل</button> : null}</header><section className="operations-toolbar activity-toolbar"><label className="operations-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="VIN أو سيارة أو مستخدم أو رقم طلب" /></label><select value={location} onChange={(event) => setLocation(event.target.value)}><option value="">كل الأماكن</option>{meta.locations.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select><label className="operations-date-field"><span>من</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="operations-date-field"><span>إلى</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label></section>{error ? <div className="operations-alert error">{error}</div> : null}<div className="operations-table-shell"><table className="operations-table movements-table"><thead><tr><th>التاريخ</th><th>رقم الهيكل</th><th>السيارة</th><th>من</th><th>إلى</th><th>الحالة السابقة</th><th>الحالة الجديدة</th><th>النوع</th><th>المستخدم</th><th>الملاحظة</th></tr></thead><tbody>{fetching ? <tr><td colSpan={10} className="operations-table-empty">جاري تحميل السجل...</td></tr> : null}{!fetching && !rows.length ? <tr><td colSpan={10} className="operations-table-empty">لا توجد حركات مطابقة.</td></tr> : null}{!fetching ? rows.map((row) => <tr key={row.id}><td><small>{formatOperationsDate(row.created_at)}</small></td><td><strong className="operations-vin">{row.vin}</strong>{row.request_no ? <small>{row.request_no}</small> : null}</td><td><strong>{row.car_name || "—"}</strong><small>{row.model_year || "—"}</small></td><td>{row.from_location_name || "—"}</td><td>{row.to_location_name || "—"}</td><td>{meta.statuses.find((item) => item.code === row.old_status)?.label || row.old_status || "—"}</td><td>{meta.statuses.find((item) => item.code === row.new_status)?.label || row.new_status || "—"}</td><td><span className="operations-type-badge">{row.movement_type === "request" ? "طلب نقل" : "حركة مباشرة"}</span></td><td>{row.performed_by_name || "—"}</td><td className="operations-note-cell">{row.note || "—"}</td></tr>) : null}</tbody></table></div></div>;
}
