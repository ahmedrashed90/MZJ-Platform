import { useRef, useState } from "react";
import { FileCsv, FileXls, MagnifyingGlass, Plus, UploadSimple } from "@phosphor-icons/react";
import { operationsFetch, operationsQuery } from "../api";
import { VehicleEditorModal } from "../components/VehicleEditorModal";
import { useOperations } from "../components/OperationsState";
import type { Vehicle } from "../types";
import { readSpreadsheetRows } from "../spreadsheet";

export function OperationsManagePage() {
  const { meta, loading, error } = useOperations();
  const [editor, setEditor] = useState<string | "new" | null>(null);
  const [vin, setVin] = useState("");
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; updated: number; skipped: number; errors: Array<{ row: number; vin?: string; error: string }> } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function searchVehicle() {
    const normalized = vin.trim().toUpperCase();
    if (!normalized) return;
    setSearching(true); setMessage(null);
    try {
      const response = await operationsFetch<{ ok: true; vehicle: Vehicle }>(`/api/operations${operationsQuery({ resource: "vehicle", vin: normalized })}`);
      setEditor(response.vehicle.id);
    } catch (searchError) {
      setMessage({ type: "error", text: searchError instanceof Error ? searchError.message : "السيارة غير موجودة" });
    } finally { setSearching(false); }
  }

  async function importFile(file: File) {
    setImporting(true); setMessage(null); setImportResult(null);
    try {
      const rows = await readSpreadsheetRows(file);
      const response = await operationsFetch<{ ok: true; result: typeof importResult }>("/api/operations", { method: "POST", body: JSON.stringify({ action: "importVehicles", rows }) });
      setImportResult(response.result);
    } catch (importError) {
      setMessage({ type: "error", text: importError instanceof Error ? importError.message : "تعذر استيراد الملف" });
    } finally { setImporting(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  if (loading) return <div className="operations-loading-page">جاري تحميل الصفحة...</div>;
  if (error || !meta) return <div className="operations-alert error">{error || "تعذر تحميل الصفحة"}</div>;

  return (
    <div className="operations-page">
      <header className="operations-page-head"><div><span className="operations-kicker">الإدارة</span><h1>إدارة السيارات</h1><p>إضافة سيارة، الوصول المباشر برقم الهيكل، أو استيراد ملف المخزون.</p></div></header>
      {message ? <div className={`operations-alert ${message.type}`}>{message.text}</div> : null}
      <section className="operations-manage-grid">
        <article className="operations-action-card primary-card"><span className="operations-action-icon"><Plus size={28} /></span><div><h2>إضافة سيارة جديدة</h2><p>إدخال كل بيانات السيارة والتشييك والملاحظات والموافقات.</p></div><button type="button" disabled={!meta.permissions.canCreateVehicles} onClick={() => setEditor("new")}>فتح نموذج الإضافة</button></article>
        <article className="operations-action-card"><span className="operations-action-icon"><MagnifyingGlass size={28} /></span><div><h2>تعديل سيارة موجودة</h2><p>اكتب رقم الهيكل للوصول مباشرة إلى ملف السيارة الكامل.</p></div><div className="operations-inline-search"><input value={vin} onChange={(event) => setVin(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === "Enter") void searchVehicle(); }} placeholder="رقم الهيكل VIN" /><button type="button" disabled={searching || !meta.permissions.canUpdateVehicles} onClick={() => void searchVehicle()}>{searching ? "جاري البحث..." : "بحث وفتح"}</button></div></article>
        <article className="operations-action-card wide"><span className="operations-action-icon"><UploadSimple size={28} /></span><div><h2>استيراد المخزون</h2><p>يدعم XLSX وCSV. تتم المطابقة برقم الهيكل: الموجود يُحدّث والجديد يُضاف، مع عرض أخطاء كل صف منفردًا.</p></div><label className={`operations-file-button ${importing ? "disabled" : ""}`}><input ref={fileRef} type="file" accept=".xlsx,.csv" disabled={importing || !meta.permissions.canImportVehicles} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />{importing ? "جاري معالجة الملف..." : "اختيار ملف XLSX أو CSV"}</label><div className="operations-import-hints"><span><FileXls size={18} />Excel</span><span><FileCsv size={18} />CSV</span><small>الأعمدة الأساسية: رقم الهيكل، السيارة، الموديل، المكان، الحالة.</small></div></article>
      </section>
      {importResult ? <section className="operations-import-result"><div><article><span>تمت الإضافة</span><strong>{importResult.created}</strong></article><article><span>تم التحديث</span><strong>{importResult.updated}</strong></article><article><span>تم التجاوز</span><strong>{importResult.skipped}</strong></article></div>{importResult.errors.length ? <details open><summary>أخطاء الصفوف ({importResult.errors.length})</summary><div>{importResult.errors.slice(0, 200).map((item) => <p key={`${item.row}-${item.vin || ""}`}><b>صف {item.row}{item.vin ? ` - ${item.vin}` : ""}:</b> {item.error}</p>)}</div></details> : <div className="operations-alert success">تم استيراد الملف بدون أخطاء.</div>}</section> : null}
      {editor ? <VehicleEditorModal vehicleId={editor === "new" ? null : editor} onClose={() => setEditor(null)} onSaved={() => setMessage({ type: "success", text: "تم حفظ بيانات السيارة بنجاح" }) } /> : null}
    </div>
  );
}
