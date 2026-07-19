import { useCallback, useEffect, useRef, useState } from "react";
import { MagnifyingGlass, PencilSimple, Plus, UploadSimple, WarningCircle } from "@phosphor-icons/react";
import { useOperations } from "../OperationsContext";
import { formatOperationsDate, operationsFetch, operationsQuery, parseCsvText } from "../api";
import type { OperationsVehicle } from "../types";
import { VehicleDetailsDrawer } from "../components/VehicleDetailsDrawer";
import { VehicleFormModal } from "../components/VehicleFormModal";

export function OperationsVehiclesPage() {
  const { meta, can } = useOperations();
  const [vehicles, setVehicles] = useState<OperationsVehicle[]>([]);
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<OperationsVehicle | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await operationsFetch<{ ok: boolean; vehicles: OperationsVehicle[] }>(`/api/operations/vehicles${operationsQuery({ search, location, archived: false, limit: 1000 })}`);
      setVehicles(payload.vehicles || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل السيارات");
    } finally {
      setLoading(false);
    }
  }, [location, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  function changed(vehicle: OperationsVehicle) {
    setVehicles((current) => {
      const exists = current.some((item) => item.id === vehicle.id);
      return exists ? current.map((item) => item.id === vehicle.id ? vehicle : item) : [vehicle, ...current];
    });
    void load();
  }

  async function importCsv(file: File | null) {
    if (!file) return;
    setImporting(true);
    setError("");
    setMessage("");
    try {
      const parsed = parseCsvText(await file.text());
      if (parsed.length < 2) throw new Error("ملف CSV لا يحتوي على بيانات");
      const headers = parsed[0].map((header) => header.trim().toLowerCase().replace(/[\s_-]+/g, ""));
      const find = (row: string[], aliases: string[]) => {
        const index = headers.findIndex((header) => aliases.some((alias) => header === alias.toLowerCase().replace(/[\s_-]+/g, "")));
        return index >= 0 ? row[index] || "" : "";
      };
      const truthy = (value: string) => ["1", "true", "yes", "نعم", "موجود", "✓"].includes(String(value || "").trim().toLowerCase());
      const rows = parsed.slice(1).map((row) => ({
        vin: find(row, ["vin", "رقم الهيكل", "رقمالهيكل"]),
        carName: find(row, ["carName", "السيارة", "اسم السيارة"]),
        statement: find(row, ["statement", "البيان", "الفئة"]),
        agentName: find(row, ["agentName", "الوكيل"]),
        exteriorColor: find(row, ["exteriorColor", "اللون الخارجي"]),
        interiorColor: find(row, ["interiorColor", "اللون الداخلي"]),
        modelYear: find(row, ["modelYear", "الموديل", "سنة الموديل"]),
        plateNo: find(row, ["plateNo", "اللوحة", "رقم اللوحة"]),
        batchNo: find(row, ["batchNo", "الدفعة", "رقم الدفعة"]),
        location: find(row, ["location", "الموقع"]),
        status: find(row, ["status", "الحالة"]),
        sourceType: find(row, ["sourceType", "المصدر"]),
        locationNote: find(row, ["locationNote", "ملاحظة الموقع", "ملاحظات الموقع"]),
        shortageNote: find(row, ["shortageNote", "ملاحظات النواقص", "ملاحظة النقص"]),
        notes: find(row, ["notes", "ملاحظات", "ملاحظات السيارة"]),
        contents: Object.fromEntries((meta?.contents || []).map((item) => [item.key, truthy(find(row, [item.key, item.label]))])),
      })).filter((row) => row.vin);
      const result = await operationsFetch<{ ok: boolean; created: number; updated: number; errors: Array<{ row: number; vin: string; error: string }>; message: string }>("/api/operations/vehicles", {
        method: "POST",
        body: JSON.stringify({ action: "bulk_import", rows }),
      });
      const errorText = result.errors?.length ? ` — تعذر ${result.errors.length} صف` : "";
      setMessage(`تمت إضافة ${result.created} وتحديث ${result.updated}${errorText}`);
      await load();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "تعذر استيراد الملف");
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  return (
    <div className="module-page ops-page">
      <header className="module-page-head ops-page-head">
        <div><h1>إدارة السيارات</h1><p>إضافة وتعديل بيانات السيارات من نموذج موحد داخل المنصة.</p></div>
        <div className="ops-head-actions">
          {can("operations.vehicles.import") ? (<>
            <input ref={importInputRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => void importCsv(event.target.files?.[0] || null)} />
            <button type="button" className="ops-button secondary" disabled={importing} onClick={() => importInputRef.current?.click()}><UploadSimple size={18} />{importing ? "جاري الاستيراد..." : "استيراد CSV"}</button>
          </>) : null}
          {can("operations.vehicles.create") ? <button type="button" className="ops-button primary" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus size={18} />إضافة سيارة</button> : null}
        </div>
      </header>
      {error ? <div className="ops-error"><WarningCircle size={19} weight="fill" /><span>{error}</span></div> : null}
      {message ? <div className="ops-success">{message}</div> : null}
      <section className="panel ops-list-panel">
        <div className="ops-toolbar compact">
          <label className="ops-search"><MagnifyingGlass size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث برقم الهيكل أو السيارة..." /></label>
          <select value={location} onChange={(event) => setLocation(event.target.value)}><option value="">كل المواقع</option>{meta?.locations.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select>
        </div>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead><tr><th>رقم الهيكل</th><th>السيارة</th><th>الموديل</th><th>الموقع</th><th>الحالة</th><th>آخر تحديث</th><th>الإجراء</th></tr></thead>
            <tbody>
              {!loading && vehicles.length === 0 ? <tr><td colSpan={7} className="ops-table-empty">لا توجد سيارات.</td></tr> : null}
              {vehicles.map((vehicle) => <tr key={vehicle.id}>
                <td><button type="button" className="ops-text-button" onClick={() => setSelectedId(vehicle.id)}>{vehicle.vin}</button></td>
                <td><strong>{vehicle.car_name || "—"}</strong><small>{vehicle.statement || "—"}</small></td>
                <td>{vehicle.model_year || "—"}</td>
                <td>{vehicle.location_name || "—"}</td>
                <td><span className={`ops-status status-${vehicle.status_code}`}>{vehicle.status_name || vehicle.status_code}</span></td>
                <td>{formatOperationsDate(vehicle.updated_at)}</td>
                <td>{can("operations.vehicles.update") ? <button type="button" className="ops-icon-button" title="تعديل" onClick={() => { setEditing(vehicle); setFormOpen(true); }}><PencilSimple size={18} /></button> : "—"}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {loading ? <div className="ops-loading-row">جاري التحميل...</div> : null}
      </section>
      <VehicleDetailsDrawer vehicleId={selectedId} open={Boolean(selectedId)} onClose={() => setSelectedId(null)} onEdit={(vehicle) => { setEditing(vehicle); setFormOpen(true); }} onChanged={changed} />
      <VehicleFormModal open={formOpen} vehicle={editing} onClose={() => setFormOpen(false)} onSaved={changed} />
    </div>
  );
}
