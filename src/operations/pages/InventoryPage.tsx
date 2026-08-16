import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, FileXls, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { exportExcel, operationsFetch, queryString } from "../api";
import { VehicleDetailModal } from "../components/VehicleDetailModal";
import { VehicleTable } from "../components/VehicleTable";
import type { VehicleRow } from "../types";
import { displayOperationsStateNote } from "../stateNote";
import { useOperations } from "../useOperations";

type ListResponse = { ok: boolean; rows: VehicleRow[]; total: number; page: number; pageSize: number };

export function InventoryPage({ archived = false, all = false }: { archived?: boolean; all?: boolean }) {
  const { meta } = useOperations();
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("");
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedVehicle, setSelectedVehicle] = useState<{ id: string; tab: "details" | "checks" } | null>(null);
  const pageSize = 50;
  const showAll = all && !archived;

  const params = useMemo(() => ({ resource: "vehicles", search: appliedSearch, location, status, model, archived: archived ? 1 : undefined, all: showAll ? 1 : undefined, page, pageSize }), [appliedSearch, location, status, model, archived, showAll, page]);
  async function load() {
    setLoading(true); setError("");
    try { const payload = await operationsFetch<ListResponse>(`/api/operations${queryString(params)}`); setRows(payload.rows); setTotal(payload.total); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل المخزون"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [page, appliedSearch, location, status, model, archived, showAll]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setAppliedSearch(search.trim());
    }, 320);
    return () => window.clearTimeout(timer);
  }, [search]);

  async function exportAll() {
    setLoading(true); setError("");
    try {
      const allRows: VehicleRow[] = [];
      const pages = Math.max(1, Math.ceil(total / 200));
      for (let current = 1; current <= pages; current += 1) {
        const payload = await operationsFetch<ListResponse>(`/api/operations${queryString({ ...params, page: current, pageSize: 200 })}`);
        allRows.push(...payload.rows);
      }
      const checkValue = (row: VehicleRow, code: string) => row.check_values?.[code] === "ok" ? "نعم" : row.check_values?.[code] === "missing" ? "لا" : "";
      exportExcel(
        `${archived ? "أرشيف-السيارات" : all ? "جميع-السيارات" : "مخزون-السيارات"}.xlsx`,
        [
          "الهيكل (VIN)","السيارة","البيان","الوكيل","اللون الداخلي","اللون الخارجي","موديل","اللوحة","اسم الدفعة بالتاريخ","المكان",
          "ملاحظات في السيارة","حجز - نواقص - تحديد مكان","الحالة","ملاحظات السيارات (تُفتح عند الحالة: بها ملاحظات)",
          "فرشات","طفاية","شنطة","اسبير","ريموت","شاشة","مسجل","مكيف","كاميرا","حساس",
          "الموافقة المالية","الموافقة الادارية","Tracking",
        ],
        allRows.map((row) => [
          row.vin,row.car_name,row.statement,row.agent_name,row.interior_color,row.exterior_color,row.model_year,row.plate_no,row.batch_no,row.location_name,
          row.notes,row.shortage_note,row.status_name,displayOperationsStateNote(row),
          checkValue(row,"mats"),checkValue(row,"extinguisher"),checkValue(row,"safety_bag"),checkValue(row,"spare_tire"),checkValue(row,"remote"),
          checkValue(row,"screen"),checkValue(row,"radio"),checkValue(row,"ac"),checkValue(row,"camera"),checkValue(row,"sensor"),
          row.financial_approved ? "نعم" : "لا",row.administrative_approved ? "نعم" : "لا",row.tracking_order_no || "",
        ]),
      );
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تصدير البيانات"); }
    finally { setLoading(false); }
  }

  return (
    <div className="module-page operations-page operations-inventory-list-page">
      <div className="operations-header-actions page-top-actions"><span className="operations-count">{total.toLocaleString("ar-SA-u-nu-latn")}</span><button type="button" onClick={() => void load()} disabled={loading}><ArrowClockwise size={17} />تحديث</button>{meta.permissions.canExport ? <button type="button" onClick={() => void exportAll()} disabled={loading}><FileXls size={17} />تصدير Excel</button> : null}</div>
      {error ? <div className="operations-alert error"><WarningCircle size={18} />{error}</div> : null}
      <section className="panel operations-data-panel">
        <div className="operations-filters sticky">
          <label className="operations-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث فوري برقم الهيكل أو السيارة أو البيان" /></label>
          <select value={location} onChange={(event) => { setLocation(event.target.value); setPage(1); }}><option value="">كل الأماكن</option>{meta.locations.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">كل الحالات</option>{meta.statuses.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
          <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="الموديل" />
          <button type="button" onClick={() => { setPage(1); setAppliedSearch(search.trim()); }}><MagnifyingGlass size={17} />بحث</button>
        </div>
        <VehicleTable rows={rows} onOpen={(id, tab = "details") => setSelectedVehicle({ id, tab })} />
        <div className="operations-pagination"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>السابق</button><span>صفحة {page} من {Math.max(1, Math.ceil(total / pageSize))}</span><button type="button" disabled={page * pageSize >= total || loading} onClick={() => setPage((value) => value + 1)}>التالي</button></div>
      </section>
      <VehicleDetailModal id={selectedVehicle?.id || null} initialTab={selectedVehicle?.tab || "details"} meta={meta} onClose={() => setSelectedVehicle(null)} onChanged={() => void load()} />
    </div>
  );
}
