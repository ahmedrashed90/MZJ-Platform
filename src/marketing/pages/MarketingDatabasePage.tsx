import { useEffect, useMemo, useState } from "react";
import { Archive, DownloadSimple, Eye, FileArrowUp, LinkSimple, Printer, Trash, WarningCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { downloadMarketingFile, marketingDate, marketingFetch, marketingQuery, uploadMarketingFile } from "../api";
import { MarketingAlert, MarketingPage, ProgressBar } from "../components/MarketingPage";

function excelXml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function downloadExcel(fileName: string, sheetName: string, headers: string[], rows: unknown[][]) {
  const rowXml = [headers, ...rows].map((row) => `<Row>${row.map((value) => `<Cell><Data ss:Type="String">${excelXml(value)}</Data></Cell>`).join("")}</Row>`).join("");
  const content = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${excelXml(sheetName)}"><Table>${rowXml}</Table></Worksheet></Workbook>`;
  const url = URL.createObjectURL(new Blob([content], { type: "application/vnd.ms-excel;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

export function MarketingDatabasePage() {
  const [rows, setRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [links, setLinks] = useState<Array<{ platform: string; url: string }>>([]);

  async function load() {
    setLoading(true); setError("");
    try { const payload = await marketingFetch<{ rows: any[] }>(`/api/marketing${marketingQuery({ resource: "database" })}`); setRows(payload.rows); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل قاعدة البيانات"); }
    finally { setLoading(false); }
  }
  async function open(row: any) {
    setSelected(row); setLoading(true); setError("");
    try { const payload = await marketingFetch<any>(`/api/marketing${marketingQuery({ resource: "entity", sourceType: row.source_type, id: row.id })}`); setDetail(payload); setLinks(Array.isArray(payload.entity.links) ? payload.entity.links : []); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر عرض البيانات"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => rows.filter((row) => `${row.name} ${row.code} ${row.type}`.toLowerCase().includes(search.toLowerCase())), [rows, search]);

  async function saveLinks() {
    if (!selected) return;
    try { const result = await marketingFetch<{ message: string }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "save_links", sourceType: selected.source_type, id: selected.id, links }) }); setMessage(result.message); await open(selected); await load(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر حفظ الروابط"); }
  }
  async function uploadResult(file: File) {
    if (!selected) return;
    setLoading(true); setError("");
    try { const fileId = await uploadMarketingFile({ file, category: "campaign-result", sourceType: selected.source_type, sourceId: selected.id }); await marketingFetch("/api/marketing", { method: "POST", body: JSON.stringify({ action: "save_result_file", sourceType: selected.source_type, id: selected.id, fileId }) }); setMessage("تم حفظ ملف النتائج"); await open(selected); await load(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر رفع ملف النتائج"); }
    finally { setLoading(false); }
  }
  async function action(actionName: string, row: any) {
    if (actionName === "delete_entity" && !window.confirm("تأكيد المسح؟")) return;
    try { const result = await marketingFetch<{ message: string }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: actionName, sourceType: row.source_type, id: row.id }) }); setMessage(result.message); setSelected(null); setDetail(null); await load(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الإجراء"); }
  }
  function printDetail() { window.print(); }
  function exportSchedule() {
    if (!detail) return;
    downloadExcel(`${selected?.name || "جدول النشر"}-جدول النشر.xls`, "جدول النشر", ["اليوم", "الكرييتيف", "المنصة", "نوع النشر", "الحالة"], detail.schedule.map((item: any) => [marketingDate(item.publish_date), item.creative_name || item.instance_code || "—", item.platform_name || "—", item.post_type_name || "—", item.status || "—"]));
  }
  function exportReview() {
    if (!detail) return;
    downloadExcel(`${selected?.name || "مراجعة"}-مراجعة.xls`, "مراجعة", ["الكرييتيف", "اليوزر", "القسم", "الحالة", "التقدم", "التاريخ المطلوب", "مختصر المطلوب"], detail.tasks.map((task: any) => [task.creative_name || "—", task.assigned_name || "—", task.department_name || "قسم المحتوى", task.status || "—", `${Number(task.progress || 0)}%`, marketingDate(task.due_at), task.note || task.title || "—"]));
  }
  function showProductFiles() { document.getElementById("marketing-product-files")?.scrollIntoView({ behavior: "smooth", block: "start" }); }

  return <MarketingPage title="قاعدة البيانات" description="الحملات والأجندات وملفات النتائج وروابط الحملة والأرشفة." actions={<input className="marketing-search" placeholder="بحث" value={search} onChange={(event) => setSearch(event.target.value)} />}>
    {error ? <MarketingAlert>{error}</MarketingAlert> : null}{message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}
    <section className="panel marketing-table-panel"><div className="marketing-table-wrap"><table><thead><tr><th>م</th><th>التاريخ</th><th>كود الحملة</th><th>اسم الحملة</th><th>نوع الحملة</th><th>الهدف من الحملة</th><th>تاريخ بداية الحملة</th><th>تاريخ نهاية الحملة</th><th>عرض البيانات</th><th>إجراءات</th></tr></thead><tbody>{filtered.map((row, index) => <tr key={`${row.source_type}-${row.id}`}><td>{index + 1}</td><td>{marketingDate(row.record_date)}</td><td>{row.code || "—"}</td><td><strong>{row.name}</strong><small className="marketing-type-badge">{row.source_type === "agenda" ? "أجندة" : "حملة"}</small></td><td>{row.type || "—"}</td><td>{row.objective || "—"}</td><td>{marketingDate(row.publish_start)}</td><td>{marketingDate(row.publish_end)}</td><td><button type="button" className="table-action" onClick={() => void open(row)}><Eye size={17} />عرض البيانات</button></td><td><div className="marketing-row-actions"><button type="button" title="مسح" onClick={() => void action("delete_entity", row)}><Trash size={16} /></button><button type="button" title="أرشيف" onClick={() => void action("archive_entity", row)}><Archive size={16} /></button></div></td></tr>)}{!loading && !filtered.length ? <tr><td colSpan={10}><div className="marketing-empty small">لا توجد بيانات.</div></td></tr> : null}</tbody></table></div></section>

    <Modal open={Boolean(selected)} title={selected ? `عرض البيانات — ${selected.name}` : "عرض البيانات"} subtitle={selected?.code || undefined} onClose={() => { setSelected(null); setDetail(null); }} className="marketing-database-modal">
      {loading && !detail ? <div className="marketing-empty">جاري تحميل البيانات...</div> : null}
      {detail ? <div className="marketing-entity-detail print-area">
        <div className="marketing-detail-actions-top"><button type="button" className="secondary" onClick={printDetail}><Printer size={17} />PDF</button><button type="button" className="secondary" onClick={exportSchedule}><DownloadSimple size={17} />جدول النشر</button><button type="button" className="secondary" onClick={exportReview}><DownloadSimple size={17} />مراجعة Excel</button><button type="button" className="secondary" onClick={showProductFiles}><DownloadSimple size={17} />ملفات المنتجات</button></div>
        <section className="marketing-task-section"><h3>بيانات الحملة كاملة</h3><div className="marketing-detail-grid"><div><small>التاريخ</small><strong>{marketingDate(detail.entity.campaign_date || detail.entity.created_at)}</strong></div><div><small>تاريخ بداية الحملة</small><strong>{marketingDate(detail.entity.publish_start)}</strong></div><div><small>تاريخ نهاية الحملة</small><strong>{marketingDate(detail.entity.publish_end)}</strong></div><div><small>نوع الحملة</small><strong>{detail.entity.campaign_type_name || detail.entity.campaign_type || "أجندة"}</strong></div><div><small>كود الحملة</small><strong>{detail.entity.campaign_code || detail.entity.month_key}</strong></div><div><small>اسم الحملة</small><strong>{detail.entity.name}</strong></div><div className="wide"><small>هدف الحملة</small><strong>{detail.entity.objective || "—"}</strong></div><div className="wide"><small>المطلوب من كاتب المحتوى</small><strong>{detail.entity.required_from_content || "—"}</strong></div><div><small>عدد التاسكات</small><strong>{detail.tasks.length}</strong></div><div><small>عدد التاسكات المكتملة</small><strong>{detail.tasks.filter((task: any) => Number(task.progress) >= 100).length}</strong></div><div><small>تاريخ الإنشاء</small><strong>{marketingDate(detail.entity.created_at, true)}</strong></div><div><small>آخر تحديث</small><strong>{marketingDate(detail.entity.updated_at, true)}</strong></div></div><ProgressBar value={Number(detail.entity.progress || 0)} /></section>

        <section className="marketing-task-section"><h3>التاسكات التنفيذية واليوزرات</h3><div className="marketing-table-wrap"><table><thead><tr><th>الكرييتيف</th><th>اليوزر</th><th>القسم</th><th>الحالة</th><th>التقدم</th><th>التاريخ المطلوب</th><th>مختصر المطلوب</th></tr></thead><tbody>{detail.tasks.map((task: any) => <tr key={task.id}><td>{task.creative_name || "—"}</td><td>{task.assigned_name || "—"}</td><td>{task.department_name || "قسم المحتوى"}</td><td>{task.status}</td><td>{Number(task.progress).toLocaleString("ar-SA")}%</td><td>{marketingDate(task.due_at)}</td><td>{task.note || task.title || "—"}</td></tr>)}</tbody></table></div></section>

        <section className="marketing-task-section" id="marketing-product-files"><h3>عرض ملفات المنتجات</h3><div className="marketing-files-list">{detail.files.filter((file: any) => file.category === "final-file").map((file: any) => <button key={file.id} type="button" onClick={() => void downloadMarketingFile(file.id)}><DownloadSimple size={17} />{file.original_name}</button>)}{!detail.files.some((file: any) => file.category === "final-file") ? <p>لا توجد ملفات نهائية مرفوعة.</p> : null}</div></section>

        <section className="marketing-task-section"><h3>عرض جدول النشر</h3><div className="marketing-table-wrap"><table><thead><tr><th>اليوم</th><th>الكرييتيف</th><th>المنصة</th><th>نوع النشر</th><th>الحالة</th></tr></thead><tbody>{detail.schedule.map((item: any) => <tr key={item.id}><td>{marketingDate(item.publish_date)}</td><td>{item.creative_name || item.instance_code || "—"}</td><td>{item.platform_name || "—"}</td><td>{item.post_type_name || "—"}</td><td>{item.status}</td></tr>)}</tbody></table></div></section>

        {selected?.source_type === "campaign" ? <section className="marketing-task-section"><h3>عرض الميزانية</h3><div className="marketing-table-wrap"><table><thead><tr><th>Funnel</th><th>الكرييتيف</th><th>المنصات</th><th>الإجمالي</th></tr></thead><tbody>{detail.budgets.map((item: any) => <tr key={item.id}><td>{item.funnel_name || "—"}</td><td>{item.creative_name || "—"}</td><td>{Array.isArray(item.platform_amounts) ? item.platform_amounts.map((part: any) => `${part.platformId}: ${Number(part.amount || 0).toLocaleString("ar-SA")}`).join("، ") : "—"}</td><td>{Number(item.total || 0).toLocaleString("ar-SA")} ر.س</td></tr>)}</tbody></table></div></section> : null}

        <section className="marketing-task-section"><h3>عرض نتائج الحملة</h3><div className="marketing-inline-actions"><label className="marketing-upload-button"><FileArrowUp size={17} />رفع ملف النتائج<input type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadResult(file); event.currentTarget.value = ""; }} /></label>{detail.entity.result_file_id ? <button type="button" className="secondary" onClick={() => void downloadMarketingFile(detail.entity.result_file_id)}><DownloadSimple size={17} />عرض الملف المرفوع</button> : null}</div></section>

        <section className="marketing-task-section"><h3>روابط الحملة</h3>{links.map((link, index) => <div className="marketing-link-row" key={index}><select value={link.platform} onChange={(event) => setLinks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, platform: event.target.value } : item))}><option value="">اختر المنصة</option><option value="Facebook">Facebook</option><option value="Instagram">Instagram</option></select><input dir="ltr" placeholder="https://" value={link.url} onChange={(event) => setLinks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))} /><button type="button" className="icon-danger" onClick={() => setLinks((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash size={16} /></button></div>)}<div className="marketing-inline-actions"><button type="button" className="secondary" onClick={() => setLinks((current) => [...current, { platform: "", url: "" }])}><LinkSimple size={17} />إضافة منصة ورابط</button><button type="button" className="primary" onClick={() => void saveLinks()}>حفظ الروابط</button></div></section>

        <section className="marketing-task-section warning"><h3><WarningCircle size={20} />الأرشفة</h3><p>لا يمكن أرشفة الحملة قبل رفع ملف نتائج الحملة وإضافة روابط الحملة.</p><button type="button" className="secondary" onClick={() => void action("archive_entity", selected)}><Archive size={17} />أرشيف</button></section>
      </div> : null}
    </Modal>
  </MarketingPage>;
}
