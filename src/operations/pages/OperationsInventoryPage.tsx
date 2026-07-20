import { useEffect, useState } from "react";
import { Archive, DownloadSimple, Eye, MagnifyingGlass, Plus, SpinnerGap } from "@phosphor-icons/react";
import { downloadCsv, formatOperationsDate, operationsFetch, operationsQuery } from "../api";
import { VehicleEditorModal } from "../components/VehicleEditorModal";
import { useOperations } from "../components/OperationsState";
import type { Vehicle } from "../types";

export function OperationsInventoryPage() {
  const { meta, loading: metaLoading, error: metaError } = useOperations();
  const [rows, setRows] = useState<Vehicle[]>([]);
  const [total, setTotal] = useState(0);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("");
  const [model, setModel] = useState("");
  const [archive, setArchive] = useState("active");
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<string | "new" | null>(null);
  const [version, setVersion] = useState(0);
  const pageSize = 100;

  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    setLoading(true); setError("");
    operationsFetch<{ ok: true; rows: Vehicle[]; total: number; models: string[] }>(`/api/operations${operationsQuery({ resource: "vehicles", search, location, status, model, archive, page, pageSize })}`)
      .then((response) => { if (!cancelled) { setRows(response.rows); setTotal(response.total); setModels(response.models); } })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "تعذر تحميل السيارات"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [meta, search, location, status, model, archive, page, version]);

  function exportRows() {
    downloadCsv(`MZJ-operations-vehicles-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((vehicle) => ({
      "رقم الهيكل": vehicle.vin,
      "السيارة": vehicle.car_name,
      "البيان": vehicle.statement,
      "الوكيل": vehicle.agent_name,
      "الموديل": vehicle.model_year,
      "اللون الخارجي": vehicle.exterior_color,
      "اللون الداخلي": vehicle.interior_color,
      "اللوحة": vehicle.plate_no,
      "الدفعة": vehicle.batch_no,
      "المكان": vehicle.location_name,
      "الحالة": vehicle.status_label || vehicle.status_code,
      "ملاحظات المكان": vehicle.location_note,
      "النواقص": vehicle.shortage_note,
      "ملاحظات السيارة": vehicle.car_note,
      "الموافقة المالية": vehicle.financial_approved ? "نعم" : "لا",
      "الموافقة الإدارية": vehicle.administrative_approved ? "نعم" : "لا",
      "مرتبط بالتتبع": vehicle.has_tracking ? "نعم" : "لا",
      "مؤرشف": vehicle.is_archived ? "نعم" : "لا",
    })));
  }

  if (metaLoading) return <div className="operations-loading-page"><SpinnerGap className="spin" size={25} />جاري تجهيز نظام العمليات...</div>;
  if (metaError || !meta) return <div className="operations-alert error">{metaError || "تعذر فتح نظام العمليات"}</div>;

  return (
    <div className="operations-page">
      <header className="operations-page-head">
        <div><span className="operations-kicker">المخزون الفعلي</span><h1>قاعدة السيارات</h1><p>عرض كل رقم هيكل مع الموقع والحالة والموافقات والنواقص وسجل الحركة.</p></div>
        <div className="operations-head-actions">
          {meta.permissions.canExportVehicles ? <button type="button" className="operations-secondary-button" onClick={exportRows}><DownloadSimple size={18} />تصدير النتائج</button> : null}
          {meta.permissions.canCreateVehicles ? <button type="button" className="operations-primary-button" onClick={() => setEditor("new")}><Plus size={18} />إضافة سيارة</button> : null}
        </div>
      </header>

      <section className="operations-stat-strip">
        <article><span>إجمالي النتائج</span><strong>{total.toLocaleString("ar-SA")}</strong></article>
        <article><span>المعروض الآن</span><strong>{rows.length.toLocaleString("ar-SA")}</strong></article>
        <article><span>موافقات مكتملة</span><strong>{rows.filter((row) => row.financial_approved && row.administrative_approved).length.toLocaleString("ar-SA")}</strong></article>
        <article><span>بها نواقص</span><strong>{rows.filter((row) => Boolean(row.shortage_note)).length.toLocaleString("ar-SA")}</strong></article>
      </section>

      <section className="operations-toolbar">
        <label className="operations-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="بحث برقم الهيكل أو السيارة أو اللوحة أو الملاحظة" /></label>
        <select value={location} onChange={(event) => { setLocation(event.target.value); setPage(1); }}><option value="">كل الأماكن</option>{meta.locations.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select>
        <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">كل الحالات</option>{meta.statuses.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select>
        <select value={model} onChange={(event) => { setModel(event.target.value); setPage(1); }}><option value="">كل الموديلات</option>{models.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={archive} onChange={(event) => { setArchive(event.target.value); setPage(1); }}><option value="active">السيارات الحالية</option><option value="archived">الأرشيف</option><option value="all">الكل</option></select>
      </section>

      {error ? <div className="operations-alert error">{error}</div> : null}
      <div className="operations-table-shell">
        <table className="operations-table vehicles-table">
          <thead><tr><th>رقم الهيكل</th><th>السيارة</th><th>الألوان</th><th>الموديل</th><th>المكان</th><th>الحالة</th><th>الموافقات</th><th>النواقص</th><th>التحديث</th><th>الإجراء</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={10} className="operations-table-empty"><SpinnerGap className="spin" size={22} /> جاري تحميل البيانات...</td></tr> : null}
            {!loading && !rows.length ? <tr><td colSpan={10} className="operations-table-empty">لا توجد سيارات مطابقة للفلاتر الحالية.</td></tr> : null}
            {!loading ? rows.map((vehicle) => (
              <tr key={vehicle.id} className={vehicle.is_archived ? "archived" : ""}>
                <td><strong className="operations-vin">{vehicle.vin}</strong><small>{vehicle.plate_no || "بدون لوحة"}</small></td>
                <td><strong>{vehicle.car_name || "—"}</strong><small>{vehicle.statement || vehicle.agent_name || "—"}</small></td>
                <td><span>{vehicle.exterior_color || "—"}</span><small>داخلي: {vehicle.interior_color || "—"}</small></td>
                <td>{vehicle.model_year || "—"}</td>
                <td><span className="operations-location-badge">{vehicle.location_name || "غير محدد"}</span></td>
                <td><span className={`operations-status-badge status-${vehicle.status_code}`}>{vehicle.status_label || vehicle.status_code}</span></td>
                <td><div className="operations-approval-dots"><span className={vehicle.financial_approved ? "ok" : "missing"}>مالية</span><span className={vehicle.administrative_approved ? "ok" : "missing"}>إدارية</span></div></td>
                <td>{vehicle.shortage_note ? <span className="operations-shortage" title={vehicle.shortage_note}>يوجد نقص</span> : <span className="operations-clear">لا يوجد</span>}</td>
                <td><small>{formatOperationsDate(vehicle.updated_at)}</small></td>
                <td><button type="button" className="operations-row-button" onClick={() => setEditor(vehicle.id)}><Eye size={16} />عرض</button></td>
              </tr>
            )) : null}
          </tbody>
        </table>
      </div>
      <footer className="operations-pagination"><span>صفحة {page} من {Math.max(1, Math.ceil(total / pageSize))}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>السابق</button><button type="button" disabled={page * pageSize >= total} onClick={() => setPage((value) => value + 1)}>التالي</button></div></footer>
      {archive === "archived" ? <div className="operations-note"><Archive size={17} />السيارات المؤرشفة محفوظة بالكامل ولا تُحذف من قاعدة البيانات.</div> : null}
      {editor ? <VehicleEditorModal vehicleId={editor === "new" ? null : editor} onClose={() => setEditor(null)} onSaved={() => setVersion((value) => value + 1)} /> : null}
    </div>
  );
}
