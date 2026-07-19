import { useEffect, useMemo, useRef, useState } from "react";
import { DownloadSimple, FileArrowUp, FloppyDisk, MagnifyingGlass, Plus, WarningCircle } from "@phosphor-icons/react";
import { operationsFetch, operationsQuery } from "../api";
import { downloadXlsx, readSpreadsheet } from "../excel";
import type { OperationsVehicle } from "../types";
import { useOperationsMeta } from "../useOperationsMeta";

const emptyForm = {
  id: "", vin: "", carName: "", statement: "", agentName: "", interiorColor: "", exteriorColor: "", modelYear: "", plateNo: "", batchNo: "",
  locationId: "", statusCode: "available_for_sale", notes: "", statusNote: "", reservationShortageLocationNote: "", sourceType: "", version: 0,
};

const headers = ["VIN","السيارة","البيان","الوكيل","اللون الداخلي","اللون الخارجي","الموديل","اللوحة","اسم الدفعة بالتاريخ","كود المكان","كود الحالة","ملاحظات في السيارة","ملاحظات الحالة","حجز - نواقص - تحديد مكان"];

function formFromVehicle(vehicle: OperationsVehicle) {
  return { id: vehicle.id, vin: vehicle.vin, carName: vehicle.car_name || "", statement: vehicle.statement || "", agentName: vehicle.agent_name || "", interiorColor: vehicle.interior_color || "", exteriorColor: vehicle.exterior_color || "", modelYear: vehicle.model_year || "", plateNo: vehicle.plate_no || "", batchNo: vehicle.batch_no || "", locationId: vehicle.location_id || "", statusCode: vehicle.status_code || "available_for_sale", notes: vehicle.notes || "", statusNote: vehicle.status_note || "", reservationShortageLocationNote: vehicle.reservation_shortage_location_note || "", sourceType: "", version: vehicle.version || 0 };
}

export function OperationsVehicleManagementPage() {
  const { meta, error: metaError } = useOperationsMeta();
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<OperationsVehicle[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [importReport, setImportReport] = useState<any>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedStatus = useMemo(() => meta?.statuses.find((item) => item.code === form.statusCode), [meta, form.statusCode]);

  useEffect(() => {
    if (search.trim().length < 2) { setResults([]); return; }
    const timer = window.setTimeout(() => {
      operationsFetch<{ vehicles: OperationsVehicle[] }>(`/api/operations/vehicles${operationsQuery({ mode: "suggest", search })}`).then((payload) => setResults(payload.vehicles)).catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      const payload = await operationsFetch<{ ok: true; vehicle: OperationsVehicle; message: string }>("/api/operations/vehicles", { method: "POST", body: JSON.stringify({ action: form.id ? "update" : "create", ...form }) });
      setMessage(payload.message); setForm(formFromVehicle(payload.vehicle)); setSearch(payload.vehicle.vin); setResults([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر حفظ السيارة"); }
    finally { setSaving(false); }
  }

  async function openVehicle(id: string) {
    try {
      const payload = await operationsFetch<{ vehicle: OperationsVehicle }>(`/api/operations/vehicles?id=${encodeURIComponent(id)}`);
      setForm(formFromVehicle(payload.vehicle)); setSearch(payload.vehicle.vin); setResults([]); setMessage(""); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر فتح السيارة"); }
  }

  async function downloadTemplate() {
    const row = Object.fromEntries(headers.map((header) => [header, ""]));
    downloadXlsx("MZJ-Operations-Vehicles-Template.xlsx", "السيارات", [row], headers);
  }

  async function exportData() {
    setSaving(true); setError("");
    try {
      const first = await operationsFetch<{ vehicles: OperationsVehicle[]; total: number }>("/api/operations/vehicles?page=1&limit=100&includeArchived=true");
      const all = [...first.vehicles];
      const pages = Math.ceil(first.total / 100);
      for (let page = 2; page <= pages; page += 1) {
        const payload = await operationsFetch<{ vehicles: OperationsVehicle[] }>(`/api/operations/vehicles?page=${page}&limit=100&includeArchived=true`);
        all.push(...payload.vehicles);
      }
      const rows = all.map((vehicle) => ({ VIN: vehicle.vin, السيارة: vehicle.car_name, البيان: vehicle.statement, الوكيل: vehicle.agent_name, "اللون الداخلي": vehicle.interior_color, "اللون الخارجي": vehicle.exterior_color, الموديل: vehicle.model_year, اللوحة: vehicle.plate_no, "اسم الدفعة بالتاريخ": vehicle.batch_no, المكان: vehicle.location_name, "كود المكان": vehicle.location_code, الحالة: vehicle.status_name, "كود الحالة": vehicle.status_code, "ملاحظات في السيارة": vehicle.notes, "ملاحظات الحالة": vehicle.status_note, "حجز - نواقص - تحديد مكان": vehicle.reservation_shortage_location_note, مؤرشف: vehicle.is_archived ? "نعم" : "لا" }));
      downloadXlsx("MZJ-Operations-Vehicles.xlsx", "السيارات", rows);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر تصدير البيانات"); }
    finally { setSaving(false); }
  }

  async function importFile(file: File) {
    setSaving(true); setError(""); setImportReport(null);
    try {
      const rawRows = await readSpreadsheet(file);
      const locationByCode = new Map(meta?.locations.map((item) => [item.code, item.id]));
      const rows = rawRows.map((row) => ({
        vin: String(row.VIN || row["الهيكل VIN"] || "").trim(), carName: row["السيارة"], statement: row["البيان"], agentName: row["الوكيل"], interiorColor: row["اللون الداخلي"], exteriorColor: row["اللون الخارجي"], modelYear: row["الموديل"], plateNo: row["اللوحة"], batchNo: row["اسم الدفعة بالتاريخ"], locationId: locationByCode.get(String(row["كود المكان"] || "").trim()) || String(row["locationId"] || ""), statusCode: String(row["كود الحالة"] || row["statusCode"] || "available_for_sale").trim(), notes: row["ملاحظات في السيارة"], statusNote: row["ملاحظات الحالة"], reservationShortageLocationNote: row["حجز - نواقص - تحديد مكان"],
      }));
      const payload = await operationsFetch<{ report: any; message: string }>("/api/operations/vehicles", { method: "POST", body: JSON.stringify({ action: "import", rows }) });
      setImportReport(payload.report); setMessage(payload.message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر استيراد الملف"); }
    finally { setSaving(false); if (fileInput.current) fileInput.current.value = ""; }
  }

  return (
    <div className="module-page operations-page">
      <header className="module-page-head"><div><h1>إدارة السيارات</h1><p>إضافة وتعديل واستيراد وتصدير السيارات مع الحفاظ على VIN كنص وسجل العمليات.</p></div></header>
      {metaError || error ? <div className="connection-banner"><WarningCircle size={20} weight="fill" /><span>{metaError || error}</span></div> : null}
      {message ? <div className="success-banner"><span>{message}</span></div> : null}
      <section className="panel operations-management-actions">
        <button type="button" onClick={() => { setForm(emptyForm); setSearch(""); setResults([]); }}><Plus size={18} />سيارة جديدة</button>
        <button type="button" onClick={() => void downloadTemplate()}><DownloadSimple size={18} />تصدير قالب فاضي</button>
        <button type="button" onClick={() => void exportData()} disabled={saving}><DownloadSimple size={18} />تصدير البيانات</button>
        <button type="button" onClick={() => fileInput.current?.click()} disabled={saving}><FileArrowUp size={18} />استيراد من Excel</button>
        <input ref={fileInput} hidden type="file" accept=".xlsx,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
      </section>

      <div className="operations-management-grid">
        <section className="panel operations-edit-card"><h2>{form.id ? `تعديل السيارة ${form.vin}` : "إضافة سيارة"}</h2><form className="operations-form" onSubmit={submit}>
          <label className="full"><span>الهيكل VIN</span><input required value={form.vin} onChange={(event) => setForm({ ...form, vin: event.target.value })} /></label>
          <label><span>السيارة</span><input value={form.carName} onChange={(event) => setForm({ ...form, carName: event.target.value })} /></label><label><span>البيان</span><input value={form.statement} onChange={(event) => setForm({ ...form, statement: event.target.value })} /></label>
          <label><span>الوكيل</span><input value={form.agentName} onChange={(event) => setForm({ ...form, agentName: event.target.value })} /></label><label><span>الموديل</span><input value={form.modelYear} onChange={(event) => setForm({ ...form, modelYear: event.target.value })} /></label>
          <label><span>اللون الداخلي</span><input value={form.interiorColor} onChange={(event) => setForm({ ...form, interiorColor: event.target.value })} /></label><label><span>اللون الخارجي</span><input value={form.exteriorColor} onChange={(event) => setForm({ ...form, exteriorColor: event.target.value })} /></label>
          <label><span>اللوحة</span><input value={form.plateNo} onChange={(event) => setForm({ ...form, plateNo: event.target.value })} /></label><label><span>اسم الدفعة بالتاريخ</span><input value={form.batchNo} onChange={(event) => setForm({ ...form, batchNo: event.target.value })} /></label>
          <label><span>المكان</span><select required value={form.locationId} onChange={(event) => setForm({ ...form, locationId: event.target.value })}><option value="">اختر المكان</option>{meta?.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>الحالة</span><select required value={form.statusCode} onChange={(event) => setForm({ ...form, statusCode: event.target.value })}>{meta?.statuses.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
          <label className="full"><span>ملاحظات في السيارة</span><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
          {selectedStatus?.requires_status_note ? <label className="full"><span>ملاحظات الحالة *</span><textarea required value={form.statusNote} onChange={(event) => setForm({ ...form, statusNote: event.target.value })} /></label> : <label className="full"><span>ملاحظات الحالة</span><textarea value={form.statusNote} onChange={(event) => setForm({ ...form, statusNote: event.target.value })} /></label>}
          <label className="full"><span>حجز - نواقص - تحديد مكان</span><textarea value={form.reservationShortageLocationNote} onChange={(event) => setForm({ ...form, reservationShortageLocationNote: event.target.value })} /></label>
          <button className="operations-primary full" type="submit" disabled={saving}><FloppyDisk size={19} />{saving ? "جاري الحفظ..." : "حفظ السيارة"}</button>
        </form></section>

        <section className="panel operations-search-card"><h2>البحث والتعديل</h2><label className="operations-search"><MagnifyingGlass size={19} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="اكتب جزءًا من VIN أو اسم السيارة" /></label><div className="operations-search-results">{results.map((vehicle) => <button type="button" key={vehicle.id} onClick={() => void openVehicle(vehicle.id)}><strong>{vehicle.vin}</strong><span>{vehicle.car_name || "—"} — {vehicle.statement || "—"}</span><small>{vehicle.location_name || "—"} · {vehicle.status_name || vehicle.status_code}</small></button>)}</div>
          {importReport ? <div className="operations-import-report"><h3>نتيجة الاستيراد</h3><div><span>المقروء: {importReport.read}</span><span>المضاف: {importReport.added}</span><span>المحدث: {importReport.updated}</span><span>الفاشل: {importReport.failed}</span></div>{importReport.errors?.length ? <table><thead><tr><th>الصف</th><th>VIN</th><th>السبب</th></tr></thead><tbody>{importReport.errors.map((item: any) => <tr key={`${item.row}-${item.vin}`}><td>{item.row}</td><td>{item.vin || "—"}</td><td>{item.error}</td></tr>)}</tbody></table> : null}</div> : null}
        </section>
      </div>
    </div>
  );
}
