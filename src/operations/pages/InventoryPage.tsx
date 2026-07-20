import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, FileXls, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { exportExcel, operationsFetch, queryString } from "../api";
import { VehicleDetailModal } from "../components/VehicleDetailModal";
import { VehicleTable } from "../components/VehicleTable";
import type { VehicleRow } from "../types";
import { useOperations } from "../useOperations";

type ListResponse = { ok: boolean; rows: VehicleRow[]; total: number; page: number; pageSize: number };

export function InventoryPage({ archived = false, all = false }: { archived?: boolean; all?: boolean }) {
  const { meta } = useOperations();
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("");
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pageSize = 50;
  const showAll = all && !archived;

  const params = useMemo(() => ({ resource: "vehicles", search, location, status, model, archived: archived ? 1 : undefined, all: showAll ? 1 : undefined, page, pageSize }), [search, location, status, model, archived, showAll, page]);
  async function load() {
    setLoading(true); setError("");
    try { const payload = await operationsFetch<ListResponse>(`/api/operations${queryString(params)}`); setRows(payload.rows); setTotal(payload.total); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل المخزون"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [page, location, status, model, archived, showAll]);

  async function exportAll() {
    setLoading(true); setError("");
    try {
      const allRows: VehicleRow[] = [];
      const pages = Math.max(1, Math.ceil(total / 200));
      for (let current = 1; current <= pages; current += 1) {
        const payload = await operationsFetch<ListResponse>(`/api/operations${queryString({ ...params, page: current, pageSize: 200 })}`);
        allRows.push(...payload.rows);
      }
      exportExcel(`${archived ? "أرشيف-السيارات" : all ? "جميع-السيارات" : "مخزون-السيارات"}.xlsx`, ["رقم الهيكل","السيارة","البيان","موديل","داخلي","خارجي","المكان","الحالة"], allRows.map((row) => [row.vin,row.car_name,row.statement,row.model_year,row.interior_color,row.exterior_color,row.location_name,row.status_name]));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تصدير البيانات"); }
    finally { setLoading(false); }
  }

  const title = archived ? "أرشيف السيارات" : showAll ? "جميع السيارات" : "مخزون السيارات";
  const description = archived ? "السيارات المؤرشفة مع الحفاظ على تاريخها الكامل." : showAll ? "بحث وفلترة وعرض جميع بيانات السيارات المسجلة في PostgreSQL." : "عرض وفلاتر المخزون النشط الجاهز للعمل.";
  return (
    <div className="module-page operations-page">
      <header className="module-page-head"><div><h1>{title}</h1><p>{description}</p></div><div className="operations-header-actions"><span className="operations-count">{total.toLocaleString("ar-SA")}</span><button type="button" onClick={() => void load()} disabled={loading}><ArrowClockwise size={17} />تحديث</button>{meta.permissions.canExport ? <button type="button" onClick={() => void exportAll()} disabled={loading}><FileXls size={17} />تصدير Excel</button> : null}</div></header>
      {error ? <div className="operations-alert error"><WarningCircle size={18} />{error}</div> : null}
      <section className="panel operations-data-panel">
        <div className="operations-filters sticky">
          <label className="operations-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setPage(1); void load(); } }} placeholder="بحث جزئي برقم الهيكل أو السيارة أو البيان" /></label>
          <select value={location} onChange={(event) => { setLocation(event.target.value); setPage(1); }}><option value="">كل الأماكن</option>{meta.locations.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">كل الحالات</option>{meta.statuses.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
          <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="الموديل" />
          <button type="button" onClick={() => { setPage(1); void load(); }}><MagnifyingGlass size={17} />بحث</button>
        </div>
        <VehicleTable rows={rows} onOpen={setSelectedId} />
        <div className="operations-pagination"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>السابق</button><span>صفحة {page} من {Math.max(1, Math.ceil(total / pageSize))}</span><button type="button" disabled={page * pageSize >= total || loading} onClick={() => setPage((value) => value + 1)}>التالي</button></div>
      </section>
      <VehicleDetailModal id={selectedId} meta={meta} onClose={() => setSelectedId(null)} onChanged={() => void load()} />
    </div>
  );
}
