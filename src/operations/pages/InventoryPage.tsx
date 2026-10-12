import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, FileXls, MagnifyingGlass, WarningCircle, CheckCircle, XCircle } from "@phosphor-icons/react";
import { exportExcel, operationsFetch, queryString } from "../api";
import { VehicleDetailModal } from "../components/VehicleDetailModal";
import { VehicleTable } from "../components/VehicleTable";
import type { VehicleRow } from "../types";
import { Modal } from "../../components/Modal";
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
  const [tajyeer, setTajyeer] = useState("");
  const [editingTajyeer, setEditingTajyeer] = useState<VehicleRow | null>(null);
  const [nextTajyeer, setNextTajyeer] = useState(false);
  const [savingTajyeer, setSavingTajyeer] = useState(false);
  const [tajyeerError, setTajyeerError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedVehicle, setSelectedVehicle] = useState<{ id: string; tab: "details" | "checks" } | null>(null);
  const pageSize = 50;
  const showAll = all && !archived;

  const params = useMemo(() => ({ resource: "vehicles", inventory: 1, search: appliedSearch, location, status, model, tajyeer, archived: archived ? 1 : undefined, all: showAll ? 1 : undefined, page, pageSize }), [appliedSearch, location, status, model, tajyeer, archived, showAll, page]);
  async function load() {
    setLoading(true); setError("");
    try { const payload = await operationsFetch<ListResponse>(`/api/operations${queryString(params)}`); setRows(payload.rows); setTotal(payload.total); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل المخزون"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [page, appliedSearch, location, status, model, tajyeer, archived, showAll]);
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
      const columnList: Array<{ key: string; label: string; read: (row: VehicleRow) => unknown }> = [
        { key: "vin", label: "الهيكل (VIN)", read: (row) => row.vin },
        { key: "car", label: "السيارة", read: (row) => row.car_name },
        { key: "statement", label: "البيان", read: (row) => row.statement },
        { key: "agent", label: "الوكيل", read: (row) => row.agent_name },
        { key: "interior", label: "اللون الداخلي", read: (row) => row.interior_color },
        { key: "exterior", label: "اللون الخارجي", read: (row) => row.exterior_color },
        { key: "model", label: "الموديل", read: (row) => row.model_year },
        { key: "plate", label: "اللوحة", read: (row) => row.plate_no },
        { key: "batch", label: "اسم الدفعة بالتاريخ", read: (row) => row.batch_no },
        { key: "location", label: "المكان", read: (row) => row.location_name },
        { key: "status", label: "الحالة", read: (row) => row.status_name },
        { key: "notes", label: "ملاحظات", read: (row) => row.state_note || "" },
        { key: "tajyeer", label: "التجيير", read: (row) => row.is_tajyeer ? "نعم" : "لا" },
        ...(["mats", "extinguisher", "safety_bag", "spare_tire", "remote", "screen", "radio", "ac", "camera", "sensor"] as const).map((code, index) => ({ key: "checks", label: ["فرشات", "طفاية", "شنطة", "اسبير", "ريموت", "شاشة", "مسجل", "مكيف", "كاميرا", "حساس"][index], read: (row: VehicleRow) => checkValue(row, code) })),
        { key: "financialApproval", label: "الموافقة المالية", read: (row) => row.financial_approved ? "نعم" : "لا" },
        { key: "administrativeApproval", label: "الموافقة الإدارية", read: (row) => row.administrative_approved ? "نعم" : "لا" },
        { key: "tracking", label: "Tracking", read: (row) => row.tracking_order_no },
      ];
      const visible = columnList.filter((item) => item.key === "vin" || meta.inventoryVisibleColumns.includes(item.key));
      exportExcel(`${archived ? "أرشيف-السيارات" : all ? "جميع-السيارات" : "مخزون-السيارات"}.xlsx`,
        visible.map((item) => item.label), allRows.map((row) => visible.map((item) => item.read(row))));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تصدير البيانات"); }
    finally { setLoading(false); }
  }

  async function saveTajyeer() {
    if (!editingTajyeer || savingTajyeer || !meta.permissions.canUpdateTajyeer) return;
    setSavingTajyeer(true); setTajyeerError("");
    try {
      await operationsFetch("/api/operations", { method: "POST", body: JSON.stringify({ action: "update_vehicle_tajyeer", id: editingTajyeer.id, isTajyeer: nextTajyeer }) });
      setEditingTajyeer(null);
      await load();
    } catch (failure) { setTajyeerError(failure instanceof Error ? failure.message : "تعذر حفظ التجيير"); }
    finally { setSavingTajyeer(false); }
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
          {meta.inventoryVisibleColumns.includes("tajyeer") ? <select value={tajyeer} aria-label="فلتر التجيير" onChange={(event) => { setTajyeer(event.target.value); setPage(1); }}><option value="">التجيير: الكل</option><option value="yes">نعم</option><option value="no">لا</option></select> : null}
          <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="الموديل" />
          <button type="button" onClick={() => { setPage(1); setAppliedSearch(search.trim()); }}><MagnifyingGlass size={17} />بحث</button>
        </div>
        <VehicleTable rows={rows} visibleColumns={meta.inventoryVisibleColumns} onOpen={(id, tab = "details") => setSelectedVehicle({ id, tab })} onTajyeer={meta.permissions.canUpdateTajyeer ? (row) => { setEditingTajyeer(row); setNextTajyeer(Boolean(row.is_tajyeer)); setTajyeerError(""); } : undefined} />
        <div className="operations-pagination"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>السابق</button><span>صفحة {page} من {Math.max(1, Math.ceil(total / pageSize))}</span><button type="button" disabled={page * pageSize >= total || loading} onClick={() => setPage((value) => value + 1)}>التالي</button></div>
      </section>
      <Modal open={Boolean(editingTajyeer)} title="التجيير" subtitle={editingTajyeer ? `${editingTajyeer.vin} · ${editingTajyeer.car_name || "سيارة"}` : undefined} onClose={() => { if (!savingTajyeer) setEditingTajyeer(null); }} className="operations-tajyeer-modal"
        footer={<><button type="button" disabled={savingTajyeer} onClick={() => setEditingTajyeer(null)}>إلغاء</button><button type="button" className="operations-primary-button" disabled={savingTajyeer} onClick={() => void saveTajyeer()}>{savingTajyeer ? "جاري الحفظ..." : "حفظ التجيير"}</button></>}>
        {tajyeerError ? <div className="operations-alert error"><WarningCircle size={18} />{tajyeerError}</div> : null}
        <p>حدد حالة التجيير للسيارة. يتم تسجيل المستخدم وتاريخ التعديل في سجل الإجراءات.</p>
        <div className="operations-tajyeer-options" role="group" aria-label="حالة التجيير">
          <button type="button" aria-pressed={nextTajyeer} className={`yes ${nextTajyeer ? "active" : ""}`} onClick={() => setNextTajyeer(true)}><CheckCircle size={20} weight="fill" /> نعم</button>
          <button type="button" aria-pressed={!nextTajyeer} className={`no ${!nextTajyeer ? "active" : ""}`} onClick={() => setNextTajyeer(false)}><XCircle size={20} weight="fill" /> لا</button>
        </div>
      </Modal>
      <VehicleDetailModal id={selectedVehicle?.id || null} initialTab={selectedVehicle?.tab || "details"} meta={meta} onClose={() => setSelectedVehicle(null)} onChanged={() => void load()} />
    </div>
  );
}
