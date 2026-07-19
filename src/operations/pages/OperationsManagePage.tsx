import { useEffect, useMemo, useRef, useState } from "react";
import { FileXls, FloppyDisk, Plus, UploadSimple, X } from "@phosphor-icons/react";
import * as XLSX from "xlsx";
import { exportExcelFile, formatOperationsError, operationsFetch } from "../api";
import { useOperationsMeta } from "../useOperationsMeta";

const empty = {
  vin: "",
  carName: "",
  statement: "",
  agentName: "",
  interiorColor: "",
  exteriorColor: "",
  modelYear: "",
  plateNo: "",
  batchNo: "",
  locationId: "",
  statusCode: "available_for_sale",
  notes: "",
  statusNote: "",
};

type ImportMode = "replace" | "append" | "update";
type ImportRow = {
  vin: string;
  carName: string;
  statement: string;
  agentName: string;
  interiorColor: string;
  exteriorColor: string;
  modelYear: string;
  plateNo: string;
  batchNo: string;
  location: string;
  status: string;
  notes: string;
};
type ImportResult = {
  ok: boolean;
  batchId: string;
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  rows: Array<{ rowNumber: number; vin: string; status: string; action: string; error?: string }>;
};

const importModes: Array<{ value: ImportMode; title: string; description: string }> = [
  { value: "replace", title: "استبدال كامل", description: "يستبدل المخزون التشغيلي الحالي داخل نطاق صلاحيتك بعد نجاح التحقق من كل الصفوف." },
  { value: "append", title: "إضافة فوق الحالي", description: "يضيف السيارات الجديدة فقط، ويتجاوز أرقام الهياكل الموجودة دون تعديلها." },
  { value: "update", title: "تحديث من الشيت", description: "يحدّث بيانات السيارات الموجودة فقط، ولا ينشئ سيارات جديدة." },
];

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-–—./\\()]+/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه");
}

const headerAliases: Record<keyof ImportRow, string[]> = {
  vin: ["vin", "رقمالهيكل", "الهيكل", "رقمالشاسيه", "الشاسيه"],
  carName: ["السياره", "اسمالسياره", "car", "carname", "vehicle"],
  statement: ["البيان", "statement", "description", "الفئه"],
  agentName: ["الوكيل", "اسمالوكيل", "agent", "agentname"],
  interiorColor: ["اللونالداخلي", "داخلي", "interior", "interiorcolor"],
  exteriorColor: ["اللونالخارجي", "خارجي", "exterior", "exteriorcolor"],
  modelYear: ["الموديل", "موديل", "model", "modelyear", "year"],
  plateNo: ["اللوحه", "رقماللوحه", "plate", "plateno", "platenumber"],
  batchNo: ["اسمالدفعهبالتاريخ", "اسمالدفعه", "الدفعه", "batch", "batchno"],
  location: ["المكان", "الموقع", "location", "locationname", "locationcode"],
  status: ["الحاله", "status", "statusname", "statuscode"],
  notes: ["ملاحظاتالسياره", "الملاحظات", "ملاحظات", "notes", "vehiclenotes"],
};

function mapImportRow(source: Record<string, unknown>): ImportRow {
  const normalized = new Map<string, unknown>();
  for (const [key, value] of Object.entries(source)) normalized.set(normalizeHeader(key), value);
  const pick = (field: keyof ImportRow) => {
    const aliases = headerAliases[field].map(normalizeHeader);
    for (const alias of aliases) if (normalized.has(alias)) return String(normalized.get(alias) ?? "").trim();
    return "";
  };
  return {
    vin: pick("vin"),
    carName: pick("carName"),
    statement: pick("statement"),
    agentName: pick("agentName"),
    interiorColor: pick("interiorColor"),
    exteriorColor: pick("exteriorColor"),
    modelYear: pick("modelYear"),
    plateNo: pick("plateNo"),
    batchNo: pick("batchNo"),
    location: pick("location"),
    status: pick("status"),
    notes: pick("notes"),
  };
}

export function OperationsManagePage() {
  const { locations, statuses, error: metaError } = useOperationsMeta();
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("append");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [importError, setImportError] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const previewRows = useMemo(() => importRows.slice(0, 10), [importRows]);

  useEffect(() => {
    if (!importOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !importBusy) setImportOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [importOpen, importBusy]);

  function set(key: string, value: string) {
    setForm(current => ({ ...current, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operationsFetch("saveVehicle", { method: "POST", body: form });
      setMessage("تمت إضافة السيارة بنجاح");
      setForm(empty);
    } catch (caught) {
      setError(formatOperationsError(caught));
    } finally {
      setBusy(false);
    }
  }

  function template() {
    exportExcelFile(
      "قالب-استيراد-السيارات",
      ["VIN", "السيارة", "البيان", "الوكيل", "اللون الداخلي", "اللون الخارجي", "الموديل", "اللوحة", "اسم الدفعة بالتاريخ", "المكان", "الحالة", "ملاحظات السيارة"],
      [["000123", "", "", "", "", "", "", "", "", "", "متاح للبيع", ""]],
    );
  }

  function resetImport() {
    setImportRows([]);
    setImportFileName("");
    setImportError("");
    setImportResult(null);
    setReplaceConfirmed(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function readImportFile(file: File) {
    setImportError("");
    setImportResult(null);
    setReplaceConfirmed(false);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellText: true, cellDates: false });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error("الملف لا يحتوي على ورقة بيانات");
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "", raw: false });
      const mapped = rawRows.map(mapImportRow).filter(row => Object.values(row).some(Boolean));
      if (!mapped.length) throw new Error("لم يتم العثور على صفوف بيانات قابلة للقراءة");
      if (!mapped.some(row => row.vin)) throw new Error("لم يتم العثور على عمود رقم الهيكل VIN في الملف");
      setImportRows(mapped);
      setImportFileName(file.name);
    } catch (caught) {
      setImportRows([]);
      setImportFileName("");
      setImportError(caught instanceof Error ? caught.message : "تعذر قراءة ملف Excel");
    }
  }

  async function submitImport() {
    if (!importRows.length) {
      setImportError("اختر ملف Excel أولًا");
      return;
    }
    if (importMode === "replace" && !replaceConfirmed) {
      setImportError("يجب تأكيد الاستبدال الكامل قبل التنفيذ");
      return;
    }
    setImportBusy(true);
    setImportError("");
    setImportResult(null);
    try {
      const result = await operationsFetch<ImportResult>("importVehicles", {
        method: "POST",
        body: { mode: importMode, fileName: importFileName, rows: importRows },
      });
      setImportResult(result);
    } catch (caught) {
      setImportError(formatOperationsError(caught));
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <div className="operations-page">
      <header className="operations-page-head">
        <div>
          <h1>إدارة السيارات</h1>
          <p>إضافة وتعديل واستيراد وتصدير بيانات المخزون دون المساس بالحركات والموافقات.</p>
        </div>
        <div className="operations-head-actions">
          <button onClick={template}><FileXls />تصدير قالب Excel</button>
          <button className="operations-primary-action" onClick={() => { setImportOpen(true); resetImport(); }}><UploadSimple />استيراد من Excel</button>
        </div>
      </header>

      {error || metaError ? <div className="operations-error">{error || metaError}</div> : null}
      {message ? <div className="operations-success">{message}</div> : null}

      <section className="operations-card">
        <header><strong><Plus /> إضافة سيارة</strong></header>
        <div className="vehicle-form-grid">
          {[
            ["vin", "رقم الهيكل VIN"], ["carName", "السيارة"], ["statement", "البيان"], ["agentName", "الوكيل"],
            ["interiorColor", "اللون الداخلي"], ["exteriorColor", "اللون الخارجي"], ["modelYear", "الموديل"],
            ["plateNo", "اللوحة"], ["batchNo", "اسم الدفعة بالتاريخ"],
          ].map(([key, label]) => <label key={key}><span>{label}</span><input value={(form as Record<string, string>)[key]} onChange={event => set(key, event.target.value)} /></label>)}
          <label><span>المكان</span><select value={form.locationId} onChange={event => set("locationId", event.target.value)}><option value="">اختر المكان</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
          <label><span>الحالة</span><select value={form.statusCode} onChange={event => set("statusCode", event.target.value)}>{statuses.map(status => <option key={status.code} value={status.code}>{status.name}</option>)}</select></label>
          <label className="span-2"><span>ملاحظات السيارة</span><textarea value={form.notes} onChange={event => set("notes", event.target.value)} /></label>
          {form.statusCode === "has_notes" ? <label className="span-2"><span>ملاحظات الحالة</span><textarea value={form.statusNote} onChange={event => set("statusNote", event.target.value)} /></label> : null}
        </div>
        <button className="operations-main-button" disabled={busy || !form.vin || !form.locationId} onClick={() => void save()}><FloppyDisk />{busy ? "جاري الحفظ..." : "حفظ السيارة"}</button>
      </section>

      {importOpen ? (
        <div className="operations-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !importBusy) setImportOpen(false); }}>
          <section className="operations-modal operations-import-modal" role="dialog" aria-modal="true" aria-label="استيراد السيارات من Excel">
            <header>
              <div><h3>استيراد السيارات من Excel</h3><small>اختر وضع الاستيراد ثم راجع المعاينة قبل التنفيذ.</small></div>
              <button disabled={importBusy} onClick={() => setImportOpen(false)} aria-label="إغلاق"><X /></button>
            </header>

            <div className="operations-import-modes">
              {importModes.map(mode => (
                <button key={mode.value} className={importMode === mode.value ? "active" : ""} onClick={() => { setImportMode(mode.value); setReplaceConfirmed(false); setImportResult(null); }}>
                  <strong>{mode.title}</strong><span>{mode.description}</span>
                </button>
              ))}
            </div>

            <div className="operations-import-file">
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={event => { const file = event.target.files?.[0]; if (file) void readImportFile(file); }} />
              <button type="button" onClick={() => fileRef.current?.click()}><UploadSimple />اختيار ملف Excel</button>
              <div><strong>{importFileName || "لم يتم اختيار ملف"}</strong><small>{importRows.length ? `${importRows.length} صف مقروء` : "XLSX أو XLS أو CSV"}</small></div>
              {importRows.length ? <button className="operations-import-clear" onClick={resetImport}><X />مسح الملف</button> : null}
            </div>

            {importError ? <div className="operations-error">{importError}</div> : null}

            {importRows.length ? (
              <>
                <div className="operations-import-preview-head"><strong>معاينة أول {previewRows.length} صفوف</strong><span>يُعامل VIN كنص للحفاظ على الأصفار في بدايته.</span></div>
                <div className="operations-import-preview">
                  <table>
                    <thead><tr><th>VIN</th><th>السيارة</th><th>البيان</th><th>الوكيل</th><th>الداخلي</th><th>الخارجي</th><th>الموديل</th><th>اللوحة</th><th>الدفعة</th><th>المكان</th><th>الحالة</th></tr></thead>
                    <tbody>{previewRows.map((row, index) => <tr key={`${row.vin}-${index}`}><td>{row.vin || "—"}</td><td>{row.carName || "—"}</td><td>{row.statement || "—"}</td><td>{row.agentName || "—"}</td><td>{row.interiorColor || "—"}</td><td>{row.exteriorColor || "—"}</td><td>{row.modelYear || "—"}</td><td>{row.plateNo || "—"}</td><td>{row.batchNo || "—"}</td><td>{row.location || "—"}</td><td>{row.status || "متاح للبيع"}</td></tr>)}</tbody>
                  </table>
                </div>
              </>
            ) : null}

            {importMode === "replace" && importRows.length ? (
              <label className="operations-import-warning">
                <input type="checkbox" checked={replaceConfirmed} onChange={event => setReplaceConfirmed(event.target.checked)} />
                <span><strong>أؤكد الاستبدال الكامل.</strong> لن يبدأ حذف السيارات غير الموجودة في الملف إلا بعد نجاح التحقق من جميع الصفوف، ولن يتم حذف التاريخ التشغيلي.</span>
              </label>
            ) : null}

            {importResult ? (
              <section className="operations-import-report">
                <header><strong>نتيجة الاستيراد</strong><span>Batch ID: {importResult.batchId}</span></header>
                <div><b>{importResult.total}<small>إجمالي الصفوف</small></b><b>{importResult.inserted}<small>تمت إضافتها</small></b><b>{importResult.updated}<small>تم تحديثها</small></b><b>{importResult.skipped}<small>تم تجاوزها</small></b><b className={importResult.failed ? "failed" : ""}>{importResult.failed}<small>فشلت</small></b></div>
                {importResult.rows.some(row => row.error) ? <div className="operations-import-errors">{importResult.rows.filter(row => row.error).slice(0, 100).map(row => <p key={row.rowNumber}><strong>صف {row.rowNumber} — {row.vin || "بدون VIN"}:</strong> {row.error}</p>)}</div> : null}
              </section>
            ) : null}

            <footer className="operations-import-actions">
              <button disabled={importBusy} onClick={() => setImportOpen(false)}>إلغاء</button>
              <button className="operations-main-button" disabled={importBusy || !importRows.length || (importMode === "replace" && !replaceConfirmed)} onClick={() => void submitImport()}>
                <UploadSimple />{importBusy ? "جاري تنفيذ الاستيراد..." : "تنفيذ الاستيراد"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
