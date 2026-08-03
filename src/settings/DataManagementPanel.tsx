import { useMemo, useRef, useState } from "react";
import {
  CheckCircle,
  Database,
  DownloadSimple,
  FileArrowDown,
  FileArrowUp,
  ShieldCheck,
  Trash,
  UploadSimple,
  UsersThree,
  WarningOctagon,
} from "@phosphor-icons/react";
import { readXlsx } from "../crm/xlsxReader";
import { downloadXlsx } from "../crm/xlsx";

type DepartmentKey = "cash" | "finance" | "service";
type DepartmentDefinition = { key: DepartmentKey; label: string; sheetName: string; description: string };
type ImportError = { row: number; reason: string };
type ImportResult = { received: number; imported: number; updated: number; unchanged: number; duplicates: number; skipped: number; errors: ImportError[] };
type Notice = { tone: "success" | "error" | "warning"; text: string } | null;

const RESET_PHRASE = "مسح كل البيانات التجريبية";
const IMPORT_BATCH_SIZE = 200;
const RESTORE_CHUNK_SIZE = 850 * 1024;
const CUSTOMER_EXPORT_COLUMNS = [
  "رقم داخلي",
  "اسم العميل",
  "رقم الجوال",
  "القسم",
  "الفرع",
  "المصدر",
  "اسم السيارة",
  "الفئة",
  "الحالة",
  "نوع البيع",
  "المندوب",
  "عدد المباع",
  "ملاحظات",
  "ملاحظات الحالة",
  "تاريخ التسجيل",
  "آخر تحديث",
];

const departments: DepartmentDefinition[] = [
  { key: "cash", label: "عملاء الكاش", sheetName: "عملاء الكاش", description: "مبيعات الكاش وفروعها فقط" },
  { key: "finance", label: "عملاء التمويل", sheetName: "عملاء التمويل", description: "مبيعات التمويل فقط — بدون إسناد كول سنتر" },
  { key: "service", label: "خدمة العملاء", sheetName: "خدمة العملاء", description: "طلبات وعملاء خدمة العملاء فقط" },
];

async function responseJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error || "تعذر تنفيذ العملية");
  return payload;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function contentDispositionFilename(value: string | null) {
  const match = String(value || "").match(/filename="?([^";]+)"?/i);
  return match?.[1] || "MZJ-Platform-backup.mzjbackup.gz";
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const block = 0x8000;
  for (let index = 0; index < bytes.length; index += block) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(bytes.length, index + block)));
  }
  return btoa(binary);
}

function emptyImportResult(): ImportResult {
  return { received: 0, imported: 0, updated: 0, unchanged: 0, duplicates: 0, skipped: 0, errors: [] };
}

export function DataManagementPanel() {
  const fileInputs = useRef<Partial<Record<DepartmentKey, HTMLInputElement | null>>>({});
  const restoreInput = useRef<HTMLInputElement | null>(null);
  const [working, setWorking] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [importResult, setImportResult] = useState<{ department: DepartmentKey; result: ImportResult } | null>(null);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const resetReady = resetConfirmation === RESET_PHRASE;
  const busy = Boolean(working);

  const importRules = useMemo(() => [
    "القسم يُفرض من زر الاستيراد المختار، ولا تؤثر خانة القسم داخل الشيت.",
    "ملفا الكاش والتمويل المصدّران من هذه الصفحة يحدّثان العملاء الموجودين فقط، ولا يضيفان أي عميل جديد.",
    "المطابقة تتم بالرقم الداخلي الموجود في ملف التصدير، ويُستخدم رقم الجوال فقط عند غياب الرقم الداخلي.",
    "عندما تكون الحالة تم البيع، يؤخذ تاريخ تم البيع من عمود آخر تحديث، بما في ذلك التاريخ العربي مثل ١٩/٥/٢٠٢٦، ٥:٥٢:٤٨ م.",
    "الصفوف غير الموجودة في قاعدة البيانات تُستبعد مع توضيح رقم الصف، بدون إنشاء عميل بديل.",
    "الصفوف التي حالتها ليست تم البيع تظل بدون تغيير عند إعادة استيراد ملف الكاش أو التمويل.",
    "استيراد خدمة العملاء يظل بنفس منطق النقل القديم بدون أي تغيير.",
  ], []);

  async function exportDepartment(department: DepartmentDefinition) {
    setWorking(`export-${department.key}`);
    setNotice(null);
    try {
      const response = await fetch(`/api/data-management?action=export_customers&department=${department.key}`, { credentials: "include", cache: "no-store" });
      const payload = await responseJson(response);
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      downloadXlsx(`MZJ-${department.sheetName}-${new Date().toISOString().slice(0, 10)}.xlsx`, rows, department.sheetName, CUSTOMER_EXPORT_COLUMNS);
      setNotice({ tone: "success", text: `تم تجهيز ملف ${department.label} ويحتوي على ${rows.length.toLocaleString("ar-SA")} عميل.` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "تعذر تصدير العملاء" });
    } finally {
      setWorking("");
    }
  }

  async function importDepartment(department: DepartmentDefinition, file: File) {
    setWorking(`import-${department.key}`);
    setNotice(null);
    setImportResult(null);
    try {
      const rows = await readXlsx(file);
      if (!rows.length) throw new Error("الشيت لا يحتوي على صفوف عملاء قابلة للقراءة");
      const total = emptyImportResult();
      for (let offset = 0; offset < rows.length; offset += IMPORT_BATCH_SIZE) {
        const batch = rows.slice(offset, offset + IMPORT_BATCH_SIZE);
        const response = await fetch(`/api/data-management?action=import_customers&department=${department.key}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: batch, startRow: offset + 2 }),
        });
        const payload = await responseJson(response);
        const result = payload.result as ImportResult;
        total.received += Number(result?.received || 0);
        total.imported += Number(result?.imported || 0);
        total.updated += Number(result?.updated || 0);
        total.unchanged += Number(result?.unchanged || 0);
        total.duplicates += Number(result?.duplicates || 0);
        total.skipped += Number(result?.skipped || 0);
        total.errors.push(...(Array.isArray(result?.errors) ? result.errors : []));
      }
      setImportResult({ department: department.key, result: total });
      setNotice({
        tone: "success",
        text: department.key === "service"
          ? `اكتمل استيراد ${department.label}: تمت إضافة ${total.imported.toLocaleString("ar-SA")} عميل بدون تعديل أي عميل موجود.`
          : `اكتمل تحديث ${department.label}: تم تحديث تاريخ تم البيع لـ ${total.updated.toLocaleString("ar-SA")} عميل، ولم تتم إضافة أي عميل جديد.`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "تعذر استيراد ملف العملاء" });
    } finally {
      setWorking("");
      const input = fileInputs.current[department.key];
      if (input) input.value = "";
    }
  }

  async function createBackup() {
    setWorking("backup");
    setNotice(null);
    try {
      const response = await fetch("/api/data-management?action=backup", { credentials: "include", cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "تعذر إنشاء النسخة الاحتياطية");
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error("تم إنشاء ملف نسخة احتياطية فارغ");
      downloadBlob(blob, contentDispositionFilename(response.headers.get("Content-Disposition")));
      setNotice({ tone: "success", text: "تم إنشاء وتنزيل نسخة احتياطية كاملة لقاعدة بيانات المنصة." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "تعذر إنشاء النسخة الاحتياطية" });
    } finally {
      setWorking("");
    }
  }

  async function restoreBackup(file: File) {
    if (!window.confirm("سيتم استبدال بيانات الأنظمة بالبيانات الموجودة داخل النسخة الاحتياطية. هل تريد الاستمرار؟")) {
      if (restoreInput.current) restoreInput.current.value = "";
      return;
    }
    setWorking("restore");
    setNotice(null);
    setRestoreProgress(0);
    try {
      if (!/\.gz$/i.test(file.name)) throw new Error("ارفع ملف النسخة الاحتياطية الأصلي بصيغة .mzjbackup.gz");
      if (file.size > 30 * 1024 * 1024) throw new Error("حجم النسخة الاحتياطية أكبر من الحد المسموح 30MB");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const total = Math.ceil(bytes.length / RESTORE_CHUNK_SIZE);
      if (!total || total > 100) throw new Error("حجم النسخة الاحتياطية غير مدعوم");
      const uploadId = crypto.randomUUID();
      for (let index = 0; index < total; index += 1) {
        const chunk = bytes.subarray(index * RESTORE_CHUNK_SIZE, Math.min(bytes.length, (index + 1) * RESTORE_CHUNK_SIZE));
        const response = await fetch("/api/data-management?action=restore_chunk", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId, index, total, data: bytesToBase64(chunk) }),
        });
        await responseJson(response);
        setRestoreProgress(Math.round(((index + 1) / total) * 85));
      }
      const commit = await fetch("/api/data-management?action=restore_commit", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId }),
      });
      const payload = await responseJson(commit);
      setRestoreProgress(100);
      setNotice({ tone: "success", text: payload.message || "تم استيراد النسخة الاحتياطية واستعادة قاعدة البيانات بنجاح." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "تعذر استيراد النسخة الاحتياطية" });
    } finally {
      setWorking("");
      if (restoreInput.current) restoreInput.current.value = "";
    }
  }

  async function resetTestData() {
    if (!resetReady || !window.confirm("سيتم حذف العملاء والسيارات وطلبات التتبع والحملات والأجندات نهائيًا. هل أنت متأكد؟")) return;
    setWorking("reset");
    setNotice(null);
    try {
      const response = await fetch("/api/data-management?action=reset_test_data", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: resetConfirmation }),
      });
      const payload = await responseJson(response);
      setResetConfirmation("");
      setNotice({ tone: "success", text: payload.message || "تم مسح البيانات التجريبية المطلوبة." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "تعذر مسح البيانات التجريبية" });
    } finally {
      setWorking("");
    }
  }

  return (
    <div className="data-management-panel">
      <section className="data-management-hero">
        <span className="data-management-hero-icon"><Database size={31} weight="duotone" /></span>
        <div>
          <small>إدارة مركزية — مدير النظام فقط</small>
          <h2>البيانات والنسخ الاحتياطية</h2>
          <p>تصدير واستيراد عملاء الأقسام، إنشاء نسخة احتياطية شاملة، وإزالة بيانات التشغيل التجريبية بدون المساس بالمستخدمين أو الأدوار أو الصلاحيات.</p>
        </div>
        <span className="data-management-admin-badge"><ShieldCheck size={17} weight="fill" /> محمي بصلاحية مدير النظام</span>
      </section>

      {notice ? <div className={`data-management-notice ${notice.tone}`}>{notice.tone === "success" ? <CheckCircle size={21} weight="fill" /> : <WarningOctagon size={21} weight="fill" />}<span>{notice.text}</span></div> : null}

      <section className="data-management-section">
        <header className="data-management-section-head">
          <span><UsersThree size={23} weight="duotone" /></span>
          <div><h3>نقل عملاء النظام القديم</h3><p>كل قسم له ملف مستقل وزر مستقل لمنع اختلاط العملاء بين الإدارات.</p></div>
        </header>
        <div className="data-management-import-rules">
          <strong>شروط الاستيراد الآمن</strong>
          <div>{importRules.map((rule) => <span key={rule}><CheckCircle size={15} weight="fill" />{rule}</span>)}</div>
        </div>
        <div className="data-management-department-grid">
          {departments.map((department) => (
            <article key={department.key} className={`data-management-department-card ${department.key}`}>
              <div><strong>{department.label}</strong><small>{department.description}</small></div>
              <div className="data-management-card-actions">
                <button type="button" onClick={() => void exportDepartment(department)} disabled={busy}><DownloadSimple size={18} />{working === `export-${department.key}` ? "جاري التصدير..." : "تصدير Excel"}</button>
                <button type="button" className="primary" onClick={() => fileInputs.current[department.key]?.click()} disabled={busy}><UploadSimple size={18} />{working === `import-${department.key}` ? "جاري الاستيراد..." : "استيراد Excel"}</button>
                <input
                  ref={(node) => { fileInputs.current[department.key] = node; }}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  hidden
                  onChange={(event) => { const file = event.target.files?.[0]; if (file) void importDepartment(department, file); }}
                />
              </div>
            </article>
          ))}
        </div>
        {importResult ? (
          <div className="data-management-import-result">
            <div><span>تمت القراءة</span><strong>{importResult.result.received.toLocaleString("ar-SA")}</strong></div>
            <div className="success"><span>{importResult.department === "service" ? "تمت الإضافة" : "تم التحديث"}</span><strong>{(importResult.department === "service" ? importResult.result.imported : importResult.result.updated).toLocaleString("ar-SA")}</strong></div>
            <div><span>{importResult.department === "service" ? "مكرر بدون تعديل" : "بدون تغيير"}</span><strong>{(importResult.department === "service" ? importResult.result.duplicates : importResult.result.unchanged).toLocaleString("ar-SA")}</strong></div>
            <div className={importResult.result.skipped ? "warning" : ""}><span>صفوف مستبعدة</span><strong>{importResult.result.skipped.toLocaleString("ar-SA")}</strong></div>
            {importResult.result.errors.length ? <details><summary>عرض أسباب الاستبعاد</summary><div>{importResult.result.errors.slice(0, 80).map((item, index) => <p key={`${item.row}-${index}`}><b>الصف {item.row.toLocaleString("ar-SA")}</b><span>{item.reason}</span></p>)}</div></details> : null}
          </div>
        ) : null}
      </section>

      <section className="data-management-section">
        <header className="data-management-section-head">
          <span><ShieldCheck size={23} weight="duotone" /></span>
          <div><h3>النسخة الاحتياطية الكاملة</h3><p>تشمل بيانات الأنظمة والإعدادات والمستخدمين والصلاحيات والسجلات الموجودة داخل قاعدة البيانات.</p></div>
        </header>
        <div className="data-management-backup-grid">
          <article>
            <span className="data-management-action-icon"><FileArrowDown size={27} weight="duotone" /></span>
            <div><strong>إنشاء نسخة احتياطية</strong><p>ينتج ملفًا مضغوطًا واحدًا يحفظ تفاصيل قاعدة البيانات كاملة، مع استبعاد جلسات تسجيل الدخول وملفات الرفع المؤقتة فقط.</p></div>
            <button type="button" onClick={() => void createBackup()} disabled={busy}><DownloadSimple size={18} />{working === "backup" ? "جاري إنشاء النسخة..." : "إنشاء وتنزيل النسخة"}</button>
          </article>
          <article>
            <span className="data-management-action-icon"><FileArrowUp size={27} weight="duotone" /></span>
            <div><strong>استيراد نسخة احتياطية</strong><p>يتحقق من صيغة الملف ويعيد البيانات في ترتيب يحافظ على العلاقات بين الأنظمة.</p></div>
            <button type="button" className="primary" onClick={() => restoreInput.current?.click()} disabled={busy}><UploadSimple size={18} />{working === "restore" ? `جاري الاستعادة ${restoreProgress}%` : "اختيار ملف واستعادة"}</button>
            <input ref={restoreInput} type="file" accept=".gz,application/gzip" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void restoreBackup(file); }} />
            {working === "restore" ? <div className="data-management-progress"><span style={{ width: `${restoreProgress}%` }} /></div> : null}
          </article>
        </div>
      </section>

      <section className="data-management-section danger-zone">
        <header className="data-management-section-head">
          <span><WarningOctagon size={23} weight="fill" /></span>
          <div><h3>مسح بيانات التشغيل التجريبية</h3><p>إجراء نهائي يمسح العملاء والسيارات وطلبات التتبع والحملات والأجندات والبيانات التابعة لها فقط.</p></div>
        </header>
        <div className="data-management-reset-box">
          <div className="data-management-reset-protection">
            <ShieldCheck size={22} weight="duotone" />
            <div><strong>المستخدمون والصلاحيات محمية</strong><span>لا يتم حذف أي مستخدم أو دور أو صلاحية أو إعداد وصول.</span></div>
          </div>
          <label><span>للتأكيد اكتب: <b>{RESET_PHRASE}</b></span><input value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} placeholder={RESET_PHRASE} autoComplete="off" /></label>
          <button type="button" className="danger" onClick={() => void resetTestData()} disabled={busy || !resetReady}><Trash size={19} weight="bold" />{working === "reset" ? "جاري مسح البيانات..." : "مسح كل البيانات التجريبية"}</button>
        </div>
      </section>
    </div>
  );
}
