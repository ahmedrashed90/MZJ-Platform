import { useEffect, useRef, useState } from "react";
import { FileArrowDown, FileArrowUp, FloppyDisk, MagnifyingGlass, Plus, WarningCircle } from "@phosphor-icons/react";
import { exportExcel, operationsFetch, queryString } from "../api";
import { parseExcelFile } from "../excel";
import type { VehicleRow } from "../types";
import { useOperations } from "../useOperations";

const emptyForm = { id: "", vin: "", carName: "", statement: "", agentName: "", exteriorColor: "", interiorColor: "", modelYear: "", plateNo: "", batchNo: "", locationId: "", statusCode: "available_for_sale", sourceType: "", notes: "", stateNote: "", shortageNote: "" };

export function VehicleManagementPage() {
  const { meta } = useOperations();
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<VehicleRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [importMode, setImportMode] = useState<"replace" | "add" | "update">("add");
  const [importReport, setImportReport] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function findVehicles() {
    if (!search.trim()) { setResults([]); return; }
    try { const payload = await operationsFetch<{ rows: VehicleRow[] }>(`/api/operations${queryString({ resource: "vehicles", search, pageSize: 20 })}`); setResults(payload.rows); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر البحث"); }
  }
  useEffect(() => { const timer = window.setTimeout(() => void findVehicles(), 300); return () => window.clearTimeout(timer); }, [search]);

  function edit(row: VehicleRow) {
    setForm({ id: row.id, vin: row.vin, carName: row.car_name || "", statement: row.statement || "", agentName: row.agent_name || "", exteriorColor: row.exterior_color || "", interiorColor: row.interior_color || "", modelYear: row.model_year || "", plateNo: row.plate_no || "", batchNo: row.batch_no || "", locationId: row.location_id || "", statusCode: row.status_code, sourceType: row.source_type || "", notes: row.notes || "", stateNote: row.state_note || "", shortageNote: row.shortage_note || "" });
    setResults([]); setSearch(row.vin);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      const action = form.id ? "update_vehicle" : "create_vehicle";
      const payload = await operationsFetch<{ message: string }>("/api/operations", { method: "POST", body: JSON.stringify({ action, ...form }) });
      setMessage(payload.message); setForm(emptyForm); setSearch("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر حفظ السيارة"); }
    finally { setSaving(false); }
  }

  function downloadTemplate() {
    exportExcel("قالب-استيراد-السيارات.xlsx", ["رقم الهيكل","السيارة","البيان","الوكيل","اللون الداخلي","اللون الخارجي","موديل","اللوحة","اسم الدفعة بالتاريخ","المكان","الحالة","ملاحظات في السيارة"], []);
  }

  async function importFile(file: File) {
    setSaving(true); setError(""); setMessage(""); setImportReport(null);
    try {
      const rows = await parseExcelFile(file) as Record<string, string>[];
      if (!rows.length) throw new Error("الملف لا يحتوي على صفوف قابلة للاستيراد. استخدم قالب Excel أو CSV.");
      const payload = await operationsFetch<{ message: string; report: any }>("/api/operations", { method: "POST", body: JSON.stringify({ action: "import_vehicles", mode: importMode, fileName: file.name, rows }) });
      setMessage(payload.message); setImportReport(payload.report);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر استيراد الملف"); }
    finally { setSaving(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  return (
    <div className="module-page operations-page">
      <header className="module-page-head"><div><h1>إدارة السيارات</h1><p>إضافة وتعديل البيانات الأساسية واستيراد المخزون بثلاثة أوضاع آمنة.</p></div></header>
      {error ? <div className="operations-alert error"><WarningCircle size={18} />{error}</div> : null}{message ? <div className="operations-alert success">{message}</div> : null}
      <div className="operations-management-grid">
        <section className="panel operations-form-panel">
          <div className="operations-section-title"><Plus size={21} /><div><h2>{form.id ? "تعديل بيانات السيارة" : "إضافة سيارة"}</h2><p>{form.id ? "يمكن تعديل بيانات السيارة وحالتها، بينما يظل تغيير المكان من فلو الحركة." : "يتم التحقق من رقم الهيكل والمكان والحالة قبل الحفظ."}</p></div></div>
          {form.id ? <button type="button" className="operations-reset-form" onClick={() => setForm(emptyForm)}>إلغاء التعديل وإضافة سيارة جديدة</button> : null}
          <form className="operations-form-grid" onSubmit={save}>
            <label><span>رقم الهيكل VIN</span><input required disabled={Boolean(form.id) && !meta.permissions.canEditVin} value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} /></label>
            <label><span>السيارة</span><input value={form.carName} onChange={(e) => setForm({ ...form, carName: e.target.value })} /></label>
            <label><span>البيان</span><input value={form.statement} onChange={(e) => setForm({ ...form, statement: e.target.value })} /></label>
            <label><span>الوكيل</span><input value={form.agentName} onChange={(e) => setForm({ ...form, agentName: e.target.value })} /></label>
            <label><span>اللون الداخلي</span><input value={form.interiorColor} onChange={(e) => setForm({ ...form, interiorColor: e.target.value })} /></label>
            <label><span>اللون الخارجي</span><input value={form.exteriorColor} onChange={(e) => setForm({ ...form, exteriorColor: e.target.value })} /></label>
            <label><span>الموديل</span><input value={form.modelYear} onChange={(e) => setForm({ ...form, modelYear: e.target.value })} /></label>
            <label><span>اللوحة</span><input value={form.plateNo} onChange={(e) => setForm({ ...form, plateNo: e.target.value })} /></label>
            <label><span>اسم الدفعة بالتاريخ</span><input value={form.batchNo} onChange={(e) => setForm({ ...form, batchNo: e.target.value })} /></label>
            <label><span>المكان</span><select required disabled={Boolean(form.id)} value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}><option value="">اختر المكان</option>{meta.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label><span>الحالة</span><select value={form.statusCode} onChange={(e) => setForm({ ...form, statusCode: e.target.value })}>{meta.statuses.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
            <label><span>المصدر</span><input value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value })} /></label>
            <label className="wide"><span>ملاحظات في السيارة</span><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
            <label className="wide"><span>حجز - نواقص - تحديد مكان</span><textarea value={form.shortageNote} onChange={(e) => setForm({ ...form, shortageNote: e.target.value })} /></label>
            <button className="operations-primary-button wide" type="submit" disabled={saving || (form.id ? !meta.permissions.canEditVehicle : !meta.permissions.canCreateVehicle)}><FloppyDisk size={18} />{saving ? "جاري الحفظ..." : "حفظ"}</button>
          </form>
        </section>

        <section className="panel operations-import-panel">
          <div className="operations-section-title operations-import-title">
            <FileArrowUp size={21} />
            <div>
              <h2>استيراد من Excel</h2>
              <p>اختر طريقة الاستيراد أولًا، ثم ارفع الملف. المكان والحالة للسيارات الموجودة لا يتغيران خارج فلو الحركة.</p>
            </div>
          </div>

          <div className="operations-import-modes" role="radiogroup" aria-label="طريقة استيراد السيارات">
            <label className={`operations-import-mode ${importMode === "replace" ? "selected" : ""}`}>
              <input type="radio" checked={importMode === "replace"} onChange={() => setImportMode("replace")} />
              <span className="operations-import-mode-copy">
                <b>استبدال كامل</b>
                <small>يُبقي السيارات الموجودة في الملف نشطة، ويعطّل غير الموجودة بدون حذف تاريخها.</small>
              </span>
            </label>
            <label className={`operations-import-mode ${importMode === "add" ? "selected" : ""}`}>
              <input type="radio" checked={importMode === "add"} onChange={() => setImportMode("add")} />
              <span className="operations-import-mode-copy">
                <b>إضافة فوق الحالي</b>
                <small>يضيف أرقام الهياكل الجديدة فقط، ولا يغيّر بيانات السيارات الموجودة.</small>
              </span>
            </label>
            <label className={`operations-import-mode ${importMode === "update" ? "selected" : ""}`}>
              <input type="radio" checked={importMode === "update"} onChange={() => setImportMode("update")} />
              <span className="operations-import-mode-copy">
                <b>تحديث من الشيت</b>
                <small>يحدّث بيانات السيارات الموجودة فقط، ولا يضيف أرقام هياكل جديدة.</small>
              </span>
            </label>
          </div>

          <div className="operations-import-actions">
            <button type="button" onClick={downloadTemplate}><FileArrowDown size={18} />تصدير قالب فارغ</button>
            <button type="button" className="primary" onClick={() => fileRef.current?.click()} disabled={saving || !meta.permissions.canImport}>
              <FileArrowUp size={18} />{saving ? "جاري الاستيراد..." : "اختيار الملف والاستيراد"}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.html,.csv,.txt" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
          </div>

          {importReport ? <div className="operations-import-report"><div><span>المقروء</span><b>{importReport.total}</b></div><div><span>المضاف</span><b>{importReport.inserted}</b></div><div><span>المحدث</span><b>{importReport.updated}</b></div><div><span>المتجاهل</span><b>{importReport.skipped}</b></div><div><span>الفاشل</span><b>{importReport.failed}</b></div>{importReport.deactivated !== undefined ? <div><span>خرج من النشط</span><b>{importReport.deactivated}</b></div> : null}<details><summary>تفاصيل التقرير</summary><pre>{JSON.stringify(importReport, null, 2)}</pre></details></div> : null}
        </section>
      </div>

      <section className="panel operations-search-edit-panel"><div className="operations-section-title"><MagnifyingGlass size={21} /><div><h2>البحث للتعديل</h2><p>ابحث برقم الهيكل أو السيارة ثم اختر السجل.</p></div></div><label className="operations-search"><MagnifyingGlass size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اكتب جزءًا من رقم الهيكل" /></label>{results.length ? <div className="operations-search-results">{results.map((row) => <button key={row.id} type="button" onClick={() => edit(row)}><b>{row.vin}</b><span>{row.car_name || "—"} · {row.location_name || "—"} · {row.status_name}</span></button>)}</div> : null}</section>
    </div>
  );
}
