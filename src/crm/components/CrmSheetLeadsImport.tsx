import { useState } from "react";
import { ArrowClockwise, CheckCircle, FileArrowUp, FileXls, UsersThree } from "@phosphor-icons/react";
import { crmFetch, downloadCsv } from "../api";
import { readSheetLeads, type SheetLeadRow } from "../sheetLeadParser";
import { SHEET_LEAD_SOURCES } from "../../../shared/crm-sheet-sources";

type RowStatus = "created" | "existing" | "duplicate_in_file" | "invalid" | "failed";
type RowResult = SheetLeadRow & { status: RowStatus; assignedName?: string; branchCode?: string; storedSource?: string; reason?: string };
type ImportSummary = { total: number; created: number; existing: number; duplicateInFile: number; invalid: number; failed: number };
const EMPTY: ImportSummary = { total: 0, created: 0, existing: 0, duplicateInFile: 0, invalid: 0, failed: 0 };

function mergeSummaries(a: ImportSummary, b: ImportSummary): ImportSummary {
  return {
    total: a.total + b.total, created: a.created + b.created, existing: a.existing + b.existing,
    duplicateInFile: a.duplicateInFile + b.duplicateInFile, invalid: a.invalid + b.invalid, failed: a.failed + b.failed,
  };
}

function normalizedPhoneKey(value: string) {
  let digits = String(value || "").replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^05\d{8}$/.test(digits)) digits = `966${digits.slice(1)}`;
  else if (/^5\d{8}$/.test(digits)) digits = `966${digits}`;
  return digits;
}

const statusText: Record<RowStatus, string> = {
  created: "تمت الإضافة والتوزيع", existing: "مسجل مسبقًا - لم يتغير", duplicate_in_file: "مكرر داخل الشيت",
  invalid: "بيانات غير صالحة", failed: "تعذر التوزيع",
};

export function CrmSheetLeadsImport() {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<SheetLeadRow[]>([]);
  const sourceChoices = SHEET_LEAD_SOURCES.map((option) => option.name).join(" / ");
  const missingSources = rows.filter((row) => !row.source).length;
  const [serviceKey, setServiceKey] = useState<"" | "cash" | "finance">("");
  const [campaignName, setCampaignName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState("");
  const [results, setResults] = useState<RowResult[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  async function readFile(file?: File) {
    setError(""); setSummary(null); setResults([]); setDone(0); setRows([]); setFileName(file?.name || "");
    if (!file) return;
    setParsing(true);
    try {
      const parsed = await readSheetLeads(file);
      if (!parsed.length) throw new Error("الشيت فارغ، أو لا يحتوي على أسماء وأرقام جوال");
      setRows(parsed);
    } catch (reason) {
      setFileName("");
      setError(reason instanceof Error ? reason.message : "تعذر قراءة ملف الشيت");
    } finally { setParsing(false); }
  }

  async function importRows() {
    if (!serviceKey) { setError("حدد قسم التوزيع قبل الاستيراد: الكاش أو التمويل"); return; }
    if (!rows.length || importing) return;
    setImporting(true); setError(""); setResults([]); setSummary(null); setDone(0);
    const seen = new Set<string>();
    const unique: SheetLeadRow[] = [];
    const inFileDuplicates: RowResult[] = [];
    for (const row of rows) {
      const phoneKey = normalizedPhoneKey(row.phone);
      if (phoneKey && seen.has(phoneKey)) inFileDuplicates.push({ ...row, status: "duplicate_in_file", reason: "ظهر نفس رقم الجوال أكثر من مرة في الملف" });
      else { if (phoneKey) seen.add(phoneKey); unique.push(row); }
    }
    let all: RowResult[] = [...inFileDuplicates];
    let totals: ImportSummary = { ...EMPTY, total: inFileDuplicates.length, duplicateInFile: inFileDuplicates.length };
    setResults(all); setSummary(totals); setDone(inFileDuplicates.length);
    try {
      // Use bounded requests so the upload supports large recurring sheets within Vercel's limits.
      for (let index = 0; index < unique.length; index += 25) {
        const batch = unique.slice(index, index + 25);
        const response = await crmFetch<{ ok: boolean; rows: RowResult[]; summary: ImportSummary }>("/api/crm/sheet-leads", {
          method: "POST", body: JSON.stringify({ serviceKey, campaignName, rows: batch }),
        });
        all = all.concat(response.rows || []);
        totals = mergeSummaries(totals, response.summary);
        setDone(Math.min(rows.length, totals.total));
        setSummary({ ...totals });
        setResults([...all].sort((a, b) => a.rowNumber - b.rowNumber));
      }
    } catch (reason) {
      setError(`${reason instanceof Error ? reason.message : "فشل الاستيراد"}. يمكنك إعادة رفع نفس الشيت؛ النظام سيتخطى العملاء الذين تم توزيعهم بالفعل.`);
    } finally { setImporting(false); }
  }

  return (
    <section className="crm-panel crm-form-panel crm-sheet-leads-panel">
      <header><div><h2>إضافة ليد</h2><p>استيراد شيت موحد بالاسم ورقم الجوال والمصدر، وتوزيع العملاء الجدد فقط على المناديب.</p></div><FileArrowUp size={23} /></header>
      <div className="crm-form-grid crm-sheet-leads-fields">
        <label><span>القسم الذي يتم التوزيع على مناديبه</span><select value={serviceKey} onChange={(event) => setServiceKey(event.target.value as "" | "cash" | "finance")} disabled={importing}>
          <option value="">اختر قسم التوزيع</option><option value="cash">مبيعات الكاش</option><option value="finance">مبيعات التمويل</option>
        </select></label>
        <label><span>اسم الحملة (اختياري)</span><input value={campaignName} disabled={importing} onChange={(event) => setCampaignName(event.target.value)} placeholder="لتصنيف الليدز في CRM" maxLength={200}/></label>
        <label className="crm-field-wide"><span>ملف الليدز</span><input type="file" accept=".xlsx,.csv,.tsv" disabled={importing || parsing} onChange={(event) => { void readFile(event.target.files?.[0]); }} />
          <small>Excel أو CSV أو TSV — أعمدة الاسم والجوال والمصدر (Source). يمكنك رفع نفس الملف كاملًا كل مرة.</small>
          <small>{"\u0627\u0644\u0645\u0635\u062f\u0631 (Source) \u0627\u062e\u062a\u064a\u0627\u0631\u064a \u0644\u0644\u062a\u0648\u0627\u0641\u0642 \u0645\u0639 \u0627\u0644\u0645\u0644\u0641\u0627\u062a \u0627\u0644\u0642\u062f\u064a\u0645\u0629"} - {sourceChoices}</small>
        </label>
      </div>
      {error ? <div className="crm-inline-notice" role="alert">{error}</div> : null}
      {rows.length && missingSources ? <div className="crm-inline-notice" role="status">{missingSources} عميل بدون مصدر: سيظهر مصدرهم «ليد - استيراد شيت». أكمل المصادر لتقارير تسويق أدق.</div> : null}
      {rows.length ? <>
        <div className="crm-sheet-leads-summary"><span><FileXls size={18}/> {fileName}</span><strong>{rows.length.toLocaleString("ar-SA-u-nu-latn")} عميل في الملف</strong></div>
        <div className="crm-table-shell compact"><table className="crm-table"><thead><tr><th>الصف</th><th>اسم العميل</th><th>رقم الجوال</th><th>المصدر</th></tr></thead>
          <tbody>{rows.slice(0, 10).map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.customerName || "—"}</td><td dir="ltr">{row.phone || "—"}</td><td>{row.source || "ليد - استيراد شيت"}</td></tr>)}</tbody></table>
          {rows.length > 10 ? <p className="crm-sheet-preview-tail">معاينة أول 10 صفوف من الملف</p> : null}
        </div>
        <div className="crm-sheet-leads-controls">
          <span>العميل الموجود مسبقًا يظل على مندوبه وفرعه وحالته دون أي تغيير. التوزيع يخص الأرقام الجديدة فقط.</span>
          <button type="button" className="crm-primary-button" onClick={() => void importRows()} disabled={!serviceKey || importing || parsing}>
            {importing ? <ArrowClockwise size={18} className="crm-spin" /> : <UsersThree size={18}/>} {importing ? `جاري الاستيراد ${done} / ${rows.length}` : "استيراد وتوزيع العملاء الجدد"}
          </button>
        </div>
      </> : <div className="crm-sheet-leads-empty"><FileArrowUp size={30}/><span>{parsing ? "جاري قراءة الشيت..." : "اختر ملف الشيت لمعاينة العملاء قبل التوزيع"}</span></div>}
      {summary ? <section className="crm-sheet-leads-results">
        <header><h2>نتيجة الاستيراد</h2><div className="crm-sheet-results-actions"><span>{done} / {rows.length}</span><button type="button" className="crm-secondary-button" onClick={() => downloadCsv("crm-sheet-leads-import-results.csv", results.map((row) => ({ "رقم الصف": row.rowNumber, "اسم العميل": row.customerName, "رقم الجوال": row.phone, "مصدر الشيت": row.source || "ليد - استيراد شيت", "المصدر المحفوظ": row.status === "existing" ? row.storedSource || "—" : row.source || "ليد - استيراد شيت", "النتيجة": statusText[row.status], "المندوب": row.assignedName || "", "الفرع": row.branchCode || "", "ملاحظات": row.reason || "" })))}>تصدير نتيجة الاستيراد</button></div></header>
        <div className="crm-sheet-stat-grid">
          <div><span>تم توزيعهم الآن</span><strong>{summary.created}</strong></div>
          <div><span>موجودون مسبقًا (بدون تغيير)</span><strong>{summary.existing}</strong></div>
          <div><span>مكرر داخل الملف</span><strong>{summary.duplicateInFile}</strong></div>
          <div><span>غير صالح</span><strong>{summary.invalid}</strong></div>
          <div><span>تعذر إضافتهم</span><strong>{summary.failed}</strong></div>
        </div>
        {summary.total === rows.length && summary.failed === 0 ? <p className="crm-sheet-success"><CheckCircle size={18}/> تم فحص جميع الصفوف. لن يُعاد توزيع أي رقم موجود عند الاستيراد القادم.</p> : null}
        <div className="crm-table-shell compact"><table className="crm-table"><thead><tr><th>الصف</th><th>العميل</th><th>الجوال</th><th>مصدر الشيت</th><th>النتيجة</th><th>المندوب</th><th>الفرع</th><th>ملاحظات</th></tr></thead>
          <tbody>{results.slice(0, 200).map((row) => <tr key={`${row.rowNumber}-${row.phone}`}><td>{row.rowNumber}</td><td>{row.customerName || "—"}</td><td dir="ltr">{row.phone || "—"}</td><td>{row.source || "ليد - استيراد شيت"}</td><td>{statusText[row.status]}</td><td>{row.assignedName || "—"}</td><td>{row.branchCode || "—"}</td><td>{row.reason || "—"}</td></tr>)}</tbody></table>
          {results.length > 200 ? <p className="crm-sheet-preview-tail">تم عرض أول 200 نتيجة من {results.length}. جميع النتائج محسوبة في الملخص.</p> : null}
        </div>
      </section> : null}
    </section>
  );
}
