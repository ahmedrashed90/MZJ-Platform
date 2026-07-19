import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Car,
  DownloadSimple,
  MagnifyingGlass,
  NotePencil,
  Package,
  Plus,
  Truck,
  WarningCircle,
} from "@phosphor-icons/react";
import { useOperations } from "../OperationsContext";
import { downloadCsv, formatOperationsDate, operationsFetch, operationsQuery } from "../api";
import type { OperationsVehicle, VehicleCounts } from "../types";
import { VehicleDetailsDrawer } from "../components/VehicleDetailsDrawer";
import { VehicleFormModal } from "../components/VehicleFormModal";

const emptyCounts: VehicleCounts = { active: 0, actual_inventory: 0, available_for_sale: 0, under_delivery: 0, has_notes: 0, archived: 0 };

export function OperationsInventoryPage() {
  const { meta, loading: metaLoading, error: metaError, can } = useOperations();
  const [vehicles, setVehicles] = useState<OperationsVehicle[]>([]);
  const [counts, setCounts] = useState<VehicleCounts>(emptyCounts);
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("");
  const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<OperationsVehicle | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await operationsFetch<{ ok: boolean; vehicles: OperationsVehicle[]; counts: VehicleCounts }>(
        `/api/operations/vehicles${operationsQuery({ search, location, status, archived, limit: 1200 })}`,
      );
      setVehicles(payload.vehicles || []);
      setCounts(payload.counts || emptyCounts);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل المخزون");
    } finally {
      setLoading(false);
    }
  }, [archived, location, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  const cards = useMemo(() => [
    { label: "الإجمالي الفعلي", value: counts.actual_inventory, icon: Package, key: "" },
    { label: "متاح للبيع", value: counts.available_for_sale, icon: Car, key: "available_for_sale" },
    { label: "مباع تحت التسليم", value: counts.under_delivery, icon: Truck, key: "under_delivery" },
    { label: "بها ملاحظات", value: counts.has_notes, icon: NotePencil, key: "has_notes" },
    { label: "المؤرشف", value: counts.archived, icon: Archive, key: "archived" },
  ], [counts]);

  function exportInventory() {
    downloadCsv(
      archived ? "operations-archive.csv" : "operations-inventory.csv",
      ["رقم الهيكل", "السيارة", "البيان", "الموديل", "الموقع", "الحالة", "اللون الخارجي", "اللون الداخلي", "اللوحة", "الدفعة", "الاعتماد المالي", "الاعتماد الإداري", "آخر تحديث"],
      vehicles.map((vehicle) => [
        vehicle.vin,
        vehicle.car_name,
        vehicle.statement,
        vehicle.model_year,
        vehicle.location_name,
        vehicle.status_name,
        vehicle.exterior_color,
        vehicle.interior_color,
        vehicle.plate_no,
        vehicle.batch_no,
        vehicle.financial_approved ? "مكتمل" : "غير مكتمل",
        vehicle.administrative_approved ? "مكتمل" : "غير مكتمل",
        formatOperationsDate(vehicle.updated_at),
      ]),
    );
  }

  function cardClick(key: string) {
    if (key === "archived") {
      setArchived(true);
      setStatus("");
      return;
    }
    setArchived(false);
    setStatus(key);
  }

  function vehicleChanged(changed: OperationsVehicle) {
    setVehicles((current) => current.map((item) => item.id === changed.id ? changed : item).filter((item) => item.is_archived === archived));
    void load();
  }

  return (
    <div className="module-page ops-page">
      <header className="module-page-head ops-page-head">
        <div>
          <h1>مخزون السيارات</h1>
          <p>عرض المخزون الفعلي، الحالات، الاعتمادات، النواقص، والحركات من قاعدة PostgreSQL.</p>
        </div>
        <div className="ops-head-actions">
          {can("operations.vehicles.export") ? <button type="button" className="ops-button secondary" onClick={exportInventory} disabled={!vehicles.length}><DownloadSimple size={18} />تصدير</button> : null}
          {can("operations.vehicles.create") ? <button type="button" className="ops-button primary" onClick={() => { setEditingVehicle(null); setFormOpen(true); }}><Plus size={18} />إضافة سيارة</button> : null}
        </div>
      </header>

      {metaError || error ? <div className="ops-error"><WarningCircle size={19} weight="fill" /><span>{metaError || error}</span></div> : null}

      <section className="ops-summary-grid">
        {cards.map(({ label, value, icon: Icon, key }) => (
          <button type="button" key={label} className={`ops-summary-card ${(key === "archived" ? archived : (!archived && status === key)) ? "active" : ""}`} onClick={() => cardClick(key)}>
            <span className="ops-summary-icon"><Icon size={23} weight="duotone" /></span>
            <span>{label}</span>
            <strong>{metaLoading || loading ? "—" : value.toLocaleString("ar-SA")}</strong>
          </button>
        ))}
      </section>

      <section className="panel ops-list-panel">
        <div className="ops-toolbar">
          <label className="ops-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث برقم الهيكل أو السيارة أو الفئة أو اللوحة..." /></label>
          <select value={location} onChange={(event) => setLocation(event.target.value)}><option value="">كل المواقع</option>{meta?.locations.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setArchived(false); }} disabled={archived}><option value="">كل الحالات</option>{meta?.statuses.filter((item) => item.code !== "archived").map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
          <label className="ops-switch"><input type="checkbox" checked={archived} onChange={(event) => { setArchived(event.target.checked); setStatus(""); }} /><span>عرض الأرشيف</span></label>
        </div>

        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead><tr><th>رقم الهيكل</th><th>السيارة</th><th>الموديل</th><th>الموقع</th><th>الحالة</th><th>الاعتمادات</th><th>التراكينج</th><th>آخر تحديث</th></tr></thead>
            <tbody>
              {!loading && vehicles.length === 0 ? <tr><td colSpan={8} className="ops-table-empty">لا توجد سيارات مطابقة للفلاتر الحالية.</td></tr> : null}
              {vehicles.map((vehicle) => (
                <tr key={vehicle.id} className="ops-clickable-row" onClick={() => setSelectedId(vehicle.id)}>
                  <td><strong>{vehicle.vin}</strong><small>{vehicle.plate_no || "—"}</small></td>
                  <td><strong>{vehicle.car_name || "—"}</strong><small>{vehicle.statement || "—"}</small></td>
                  <td>{vehicle.model_year || "—"}</td>
                  <td>{vehicle.location_name || "—"}</td>
                  <td><span className={`ops-status status-${vehicle.status_code}`}>{vehicle.status_name || vehicle.status_code}</span></td>
                  <td><div className="ops-mini-checks"><span className={vehicle.financial_approved ? "ok" : "missing"}>مالية</span><span className={vehicle.administrative_approved ? "ok" : "missing"}>إدارية</span></div></td>
                  <td><span className={`ops-tracking-state ${vehicle.tracking_completed ? "ok" : "pending"}`}>{vehicle.tracking_completed ? "مكتمل" : "غير مكتمل"}</span></td>
                  <td>{formatOperationsDate(vehicle.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading ? <div className="ops-loading-row">جاري تحميل بيانات المخزون...</div> : <div className="ops-list-footer">النتائج الظاهرة: {vehicles.length.toLocaleString("ar-SA")}</div>}
      </section>

      <VehicleDetailsDrawer
        vehicleId={selectedId}
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        onEdit={(vehicle) => { setEditingVehicle(vehicle); setFormOpen(true); }}
        onChanged={vehicleChanged}
      />
      <VehicleFormModal
        open={formOpen}
        vehicle={editingVehicle}
        onClose={() => setFormOpen(false)}
        onSaved={(vehicle) => { vehicleChanged(vehicle); setSelectedId(vehicle.id); }}
      />
    </div>
  );
}
