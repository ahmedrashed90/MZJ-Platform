import { useEffect, useMemo, useState } from "react";
import { Archive, ArrowSquareOut, CalendarBlank, DownloadSimple, Eye, FileArrowUp, FileImage, FilePdf, FileVideo, FileXls, FolderOpen, LinkSimple, Trash, WarningCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { downloadMarketingFile, marketingDate, marketingFetch, marketingQuery, uploadMarketingFile } from "../api";
import { MarketingAlert, MarketingPage, ProgressBar } from "../components/MarketingPage";
import { EngagementResultDetail } from "../components/EngagementResultDetail";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../systemAccess";

function excelXml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function downloadExcel(fileName: string, sheetName: string, headers: string[], rows: unknown[][]) {
  const rowXml = [headers, ...rows]
    .map((row) => `<Row>${row.map((value) => `<Cell><Data ss:Type="String">${excelXml(value)}</Data></Cell>`).join("")}</Row>`)
    .join("");
  const content = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${excelXml(sheetName)}"><Table>${rowXml}</Table></Worksheet></Workbook>`;
  const url = URL.createObjectURL(new Blob([content], { type: "application/vnd.ms-excel;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}


function formatFileSize(value: unknown) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return "حجم غير معروف";
  if (size < 1024) return `${size.toLocaleString("ar-SA")} بايت`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(1)} GB`;
}

function isVideoFile(file: any) {
  return /video|mp4|mov|webm/i.test(`${file?.mime_type || ""} ${file?.original_name || ""}`);
}

type ScheduleDisplayRow = {
  item: any;
  day: string;
  platform: string;
  daySpan: number;
  platformSpan: number;
  showDay: boolean;
  showPlatform: boolean;
  sourceIndex: number;
};

function buildScheduleRows(schedule: any[] | undefined): ScheduleDisplayRow[] {
  const rows: ScheduleDisplayRow[] = (Array.isArray(schedule) ? schedule : [])
    .map((item, sourceIndex) => ({
      item,
      day: marketingDate(item.publish_date),
      platform: item.platform_name || "—",
      daySpan: 0,
      platformSpan: 0,
      showDay: false,
      showPlatform: false,
      sourceIndex,
    }))
    .sort((a, b) => {
      const byDay = String(a.item.publish_date || "").localeCompare(String(b.item.publish_date || ""));
      if (byDay) return byDay;
      const byPlatform = a.platform.localeCompare(b.platform, "ar");
      return byPlatform || a.sourceIndex - b.sourceIndex;
    });

  let dayStart = 0;
  while (dayStart < rows.length) {
    let dayEnd = dayStart + 1;
    while (dayEnd < rows.length && rows[dayEnd].day === rows[dayStart].day) dayEnd += 1;
    rows[dayStart].showDay = true;
    rows[dayStart].daySpan = dayEnd - dayStart;

    let platformStart = dayStart;
    while (platformStart < dayEnd) {
      let platformEnd = platformStart + 1;
      while (platformEnd < dayEnd && rows[platformEnd].platform === rows[platformStart].platform) platformEnd += 1;
      rows[platformStart].showPlatform = true;
      rows[platformStart].platformSpan = platformEnd - platformStart;
      platformStart = platformEnd;
    }
    dayStart = dayEnd;
  }

  return rows;
}

export function MarketingDatabasePage() {
  const { user } = useAuth();
  const canDeleteCampaign = hasPermission(user, "marketing.campaign.delete");
  const canDeleteAgenda = hasPermission(user, "marketing.agenda.delete");
  const canArchive = hasPermission(user, "marketing.campaign.archive");
  const canUploadResults = hasPermission(user, "marketing.file.upload");
  const canEditCampaignLinks = hasPermission(user, "marketing.campaign.edit");
  const canEditAgendaLinks = hasPermission(user, "marketing.agenda.edit");
  const canDownloadFiles = hasPermission(user, "marketing.file.download");
  const [rows, setRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [links, setLinks] = useState<Array<{ platform: string; url: string }>>([]);
  const [detailView, setDetailView] = useState<"data" | "results">("data");
  const canEditLinks = selected?.source_type === "agenda" ? canEditAgendaLinks : canEditCampaignLinks;
  const scheduleRows = useMemo(() => buildScheduleRows(detail?.schedule), [detail]);
  const finalProductFiles = useMemo(() => {
    const tasks = Array.isArray(detail?.tasks) ? detail.tasks : [];
    const files = Array.isArray(detail?.files) ? detail.files : [];
    const activeFileIds = new Set(tasks.map((task: any) => String(task.final_file_id || "")).filter(Boolean));
    const activeGroupIds = new Set(tasks.map((task: any) => String(task.final_media_group_id || "")).filter(Boolean));
    return files
      .filter((file: any) => file.category === "final-file" && file.status === "ready")
      .filter((file: any) => activeFileIds.has(String(file.id || "")) || activeGroupIds.has(String(file.final_media_group_id || "")))
      .sort((a: any, b: any) => Number(a.order_index || 0) - Number(b.order_index || 0) || String(a.created_at || "").localeCompare(String(b.created_at || "")));
  }, [detail]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const payload = await marketingFetch<{ rows: any[] }>(`/api/marketing${marketingQuery({ resource: "database" })}`);
      setRows(payload.rows);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل قاعدة البيانات");
    } finally {
      setLoading(false);
    }
  }

  async function open(row: any) {
    setSelected(row);
    setDetailView("data");
    setLoading(true);
    setError("");
    try {
      const payload = await marketingFetch<any>(`/api/marketing${marketingQuery({ resource: "entity", sourceType: row.source_type, id: row.id })}`);
      setDetail(payload);
      setLinks(Array.isArray(payload.entity.links) ? payload.entity.links : []);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر عرض البيانات");
    } finally {
      setLoading(false);
    }
  }

  function closeDetail() {
    setSelected(null);
    setDetail(null);
    setDetailView("data");
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(
    () => rows.filter((row) => `${row.name} ${row.code} ${row.type}`.toLowerCase().includes(search.toLowerCase())),
    [rows, search],
  );

  async function saveLinks() {
    if (!selected) return;
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "save_links", sourceType: selected.source_type, id: selected.id, links }),
      });
      setMessage(result.message);
      await open(selected);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حفظ الروابط");
    }
  }

  async function uploadResult(file: File) {
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      const fileId = await uploadMarketingFile({ file, category: "campaign-result", sourceType: selected.source_type, sourceId: selected.id });
      await marketingFetch("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "save_result_file", sourceType: selected.source_type, id: selected.id, fileId }),
      });
      setMessage("تم حفظ ملف النتائج");
      await open(selected);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر رفع ملف النتائج");
    } finally {
      setLoading(false);
    }
  }

  async function action(actionName: string, row: any) {
    if (actionName === "delete_entity" && !window.confirm("تأكيد المسح؟")) return;
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: actionName, sourceType: row.source_type, id: row.id }),
      });
      setMessage(result.message);
      closeDetail();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الإجراء");
    }
  }

  function printDetail() {
    window.print();
  }

  function exportSchedule() {
    if (!detail) return;
    downloadExcel(
      `${selected?.name || "جدول النشر"}-جدول النشر.xls`,
      "جدول النشر",
      ["اليوم", "الكرييتيف", "المنصة", "نوع النشر", "الحالة"],
      detail.schedule.map((item: any) => [
        marketingDate(item.publish_date),
        item.creative_name || item.instance_code || "—",
        item.platform_name || "—",
        item.post_type_name || "—",
        item.status || "—",
      ]),
    );
  }

  function exportReview() {
    if (!detail) return;
    downloadExcel(
      `${selected?.name || "مراجعة"}-مراجعة.xls`,
      "مراجعة",
      ["الكرييتيف", "اليوزر", "القسم", "الحالة", "التقدم", "التاريخ المطلوب", "مختصر المطلوب"],
      detail.tasks.map((task: any) => [
        task.creative_name || "—",
        task.assigned_name || "—",
        task.department_name || "قسم المحتوى",
        task.status || "—",
        `${Number(task.progress || 0)}%`,
        marketingDate(task.due_at),
        task.note || task.title || "—",
      ]),
    );
  }

  function showProductFiles() {
    document.getElementById("marketing-product-files")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <MarketingPage
      title="قاعدة البيانات"
      description="الحملات والأجندات وملفات النتائج وروابط الحملة والأرشفة."
      actions={<input className="marketing-search" placeholder="بحث" value={search} onChange={(event) => setSearch(event.target.value)} />}
    >
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}

      <section className="panel marketing-table-panel">
        <div className="marketing-table-wrap">
          <table>
            <thead><tr><th>م</th><th>التاريخ</th><th>كود الحملة</th><th>اسم الحملة</th><th>نوع الحملة</th><th>الهدف من الحملة</th><th>تاريخ بداية الحملة</th><th>تاريخ نهاية الحملة</th><th>عرض البيانات</th><th>إجراءات</th></tr></thead>
            <tbody>
              {filtered.map((row, index) => <tr key={`${row.source_type}-${row.id}`}>
                <td>{index + 1}</td>
                <td>{marketingDate(row.record_date)}</td>
                <td>{row.code || "—"}</td>
                <td><strong>{row.name}</strong><small className="marketing-type-badge">{row.source_type === "agenda" ? "أجندة" : "حملة"}</small></td>
                <td>{row.type || "—"}</td>
                <td>{row.objective || "—"}</td>
                <td>{marketingDate(row.publish_start)}</td>
                <td>{marketingDate(row.publish_end)}</td>
                <td><button type="button" className="table-action" onClick={() => void open(row)}><Eye size={17} />عرض البيانات</button></td>
                <td><div className="marketing-row-actions">
                  {(row.source_type === "agenda" ? canDeleteAgenda : canDeleteCampaign) ? <button type="button" title="مسح" onClick={() => void action("delete_entity", row)}><Trash size={16} /></button> : null}
                  {canArchive ? <button type="button" title="أرشيف" onClick={() => void action("archive_entity", row)}><Archive size={16} /></button> : null}
                </div></td>
              </tr>)}
              {!loading && !filtered.length ? <tr><td colSpan={10}><div className="marketing-empty small">لا توجد بيانات.</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={Boolean(selected)}
        title={selected ? `عرض بيانات الحملة — ${selected.name}` : "عرض بيانات الحملة"}
        subtitle={selected?.code || undefined}
        onClose={closeDetail}
        className="marketing-database-modal marketing-database-modal-fullscreen"
      >
        {loading && !detail ? <div className="marketing-empty">جاري تحميل البيانات...</div> : null}
        {detail ? <div className="marketing-entity-detail marketing-database-workspace print-area">
          <div className="marketing-database-toolbar">
            <div className="marketing-detail-actions-top">
              <button type="button" className="marketing-detail-command files" onClick={showProductFiles}><FolderOpen size={19} weight="duotone" /><span><strong>عرض ملفات المنتجات</strong><small>الملفات النهائية المرفوعة</small></span></button>
              <button type="button" className="marketing-detail-command pdf" onClick={printDetail}><FilePdf size={19} weight="duotone" /><span><strong>تصدير PDF</strong><small>تقرير بيانات الحملة</small></span></button>
              <button type="button" className="marketing-detail-command schedule" onClick={exportSchedule}><CalendarBlank size={19} weight="duotone" /><span><strong>تصدير جدول النشر</strong><small>ملف Excel منظم</small></span></button>
              <button type="button" className="marketing-detail-command excel" onClick={exportReview}><FileXls size={19} weight="duotone" /><span><strong>تصدير مراجعة Excel</strong><small>التاسكات وحالة التنفيذ</small></span></button>
            </div>
          </div>

          <div className="marketing-database-view-tabs" role="tablist" aria-label="أقسام بيانات الحملة أو الأجندة">
            <button type="button" className={detailView === "data" ? "active" : ""} onClick={() => setDetailView("data")}>بيانات الحملة / الأجندة</button>
            <button type="button" className={detailView === "results" ? "active" : ""} onClick={() => setDetailView("results")}>نتائج النشر والتفاعل</button>
          </div>

          {detailView === "data" ? <>
          <section className="marketing-task-section marketing-database-section">
            <h3>بيانات الحملة كاملة</h3>
            <div className="marketing-detail-grid marketing-database-summary-grid">
              <div><small>التاريخ</small><strong>{marketingDate(detail.entity.campaign_date || detail.entity.created_at)}</strong></div>
              <div><small>تاريخ بداية الحملة</small><strong>{marketingDate(detail.entity.publish_start)}</strong></div>
              <div><small>تاريخ نهاية الحملة</small><strong>{marketingDate(detail.entity.publish_end)}</strong></div>
              <div><small>نوع الحملة</small><strong>{detail.entity.campaign_type_name || detail.entity.campaign_type || "أجندة"}</strong></div>
              <div><small>كود الحملة</small><strong>{detail.entity.campaign_code || detail.entity.month_key}</strong></div>
              <div><small>اسم الحملة</small><strong>{detail.entity.name}</strong></div>
              <div><small>هدف الحملة</small><strong>{detail.entity.objective || "—"}</strong></div>
              <div><small>المطلوب من كاتب المحتوى</small><strong>{detail.entity.required_from_content || "—"}</strong></div>
              <div><small>عدد التاسكات</small><strong>{detail.tasks.length}</strong></div>
              <div><small>عدد التاسكات المكتملة</small><strong>{detail.tasks.filter((task: any) => Number(task.progress) >= 100).length}</strong></div>
              <div><small>تاريخ الإنشاء</small><strong>{marketingDate(detail.entity.created_at, true)}</strong></div>
              <div><small>آخر تحديث</small><strong>{marketingDate(detail.entity.updated_at, true)}</strong></div>
            </div>
            <ProgressBar value={Number(detail.entity.progress || 0)} />
          </section>

          <section className="marketing-task-section marketing-database-section">
            <h3>التاسكات التنفيذية واليوزرات</h3>
            <div className="marketing-table-wrap marketing-database-table">
              <table>
                <thead><tr><th>الكرييتيف</th><th>اليوزر</th><th>القسم</th><th>الحالة</th><th>التقدم</th><th>التاريخ المطلوب</th><th>مختصر المطلوب</th></tr></thead>
                <tbody>
                  {detail.tasks.map((task: any) => <tr key={task.id}><td>{task.creative_name || "—"}</td><td>{task.assigned_name || "—"}</td><td>{task.department_name || "قسم المحتوى"}</td><td>{task.status}</td><td>{Number(task.progress).toLocaleString("ar-SA")}%</td><td>{marketingDate(task.due_at)}</td><td>{task.note || task.title || "—"}</td></tr>)}
                  {!detail.tasks.length ? <tr><td colSpan={7}><div className="marketing-empty small">لا توجد تاسكات تنفيذية.</div></td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="marketing-task-section marketing-database-section" id="marketing-product-files">
            <div className="marketing-database-section-heading"><div><h3>عرض ملفات المنتجات</h3><p>يعرض الملفات النهائية المعتمدة حاليًا فقط، بدون محاولات الرفع القديمة أو الملغاة.</p></div><strong>{finalProductFiles.length.toLocaleString("ar-SA")} ملف</strong></div>
            <div className="marketing-product-files-list">
              {canDownloadFiles ? finalProductFiles.map((file: any, index: number) => {
                const task = detail.tasks.find((item: any) => String(item.id) === String(file.task_id));
                const FileIcon = isVideoFile(file) ? FileVideo : FileImage;
                return <article key={file.id} className="marketing-product-file-row">
                  <span className="marketing-product-file-icon"><FileIcon size={24} weight="duotone" /></span>
                  <div className="marketing-product-file-info"><strong>{file.original_name || `ملف نهائي ${index + 1}`}</strong><small>{[task?.creative_name, task?.assigned_name, formatFileSize(file.file_size)].filter(Boolean).join(" • ")}</small></div>
                  <span className="marketing-product-file-order">{Number(file.order_index || 0) + 1}</span>
                  <button type="button" className="marketing-product-file-open" onClick={() => void downloadMarketingFile(file.id)}><ArrowSquareOut size={18} />فتح الملف</button>
                </article>;
              }) : null}
              {!finalProductFiles.length ? <div className="marketing-database-empty">لا توجد ملفات نهائية معتمدة لهذه الحملة.</div> : null}
            </div>
          </section>

          <div className="marketing-database-two-column">
            <section className="marketing-task-section marketing-database-section">
              <h3>عرض جدول النشر</h3>
              {scheduleRows.length ? <div className="marketing-table-wrap marketing-schedule-table-wrap">
                <table className="marketing-grouped-schedule-table">
                  <thead><tr><th>اليوم</th><th>المنصة</th><th>نوع النشر</th></tr></thead>
                  <tbody>{scheduleRows.map((row) => <tr key={`${row.item.id}-${row.sourceIndex}`}>
                    {row.showDay ? <td rowSpan={row.daySpan} className="marketing-schedule-day">{row.day}</td> : null}
                    {row.showPlatform ? <td rowSpan={row.platformSpan} className="marketing-schedule-platform">{row.platform}</td> : null}
                    <td>{row.item.post_type_name || "—"}</td>
                  </tr>)}</tbody>
                </table>
              </div> : <div className="marketing-database-empty">لا يوجد جدول نشر.</div>}
            </section>

            {selected?.source_type === "campaign" ? <section className="marketing-task-section marketing-database-section marketing-budget-detail-section">
              <div className="marketing-database-section-heading"><div><h3>عرض الميزانية</h3><p>تفاصيل كل بند حسب الـFunnel والكرييتيف والأهداف والمنصات.</p></div><strong>{detail.budgets.reduce((sum: number, item: any) => sum + Number(item.total || 0), 0).toLocaleString("ar-SA")} ر.س</strong></div>
              {detail.budgets.length ? <div className="marketing-budget-detail-list">
                {detail.budgets.map((item: any, index: number) => <article key={item.id} className="marketing-budget-detail-card">
                  <header><div><span>بند الميزانية {index + 1}</span><h4>{item.creative_name || "كرييتيف غير محدد"}</h4></div><strong>{Number(item.total || 0).toLocaleString("ar-SA")} ر.س</strong></header>
                  <div className="marketing-budget-detail-meta"><div><small>Funnel</small><b>{item.funnel_name || "—"}</b></div><div><small>عدد الإعلانات</small><b>{Number(item.ads_count || 0).toLocaleString("ar-SA")}</b></div><div><small>هدف المحتوى</small><b>{item.content_goal || "—"}</b></div><div><small>الهدف المتوقع</small><b>{item.expected_goal || "—"}</b></div></div>
                  <div className="marketing-budget-platform-details">{Array.isArray(item.platform_details) && item.platform_details.length ? item.platform_details.map((part: any, partIndex: number) => <div key={`${item.id}-${part.platformId || partIndex}`}><span>{part.platformName || "منصة"}</span><strong>{Number(part.amount || 0).toLocaleString("ar-SA")} ر.س</strong></div>) : <p>لم يتم توزيع مبلغ على منصات.</p>}</div>
                </article>)}
              </div> : <div className="marketing-database-empty">لا توجد ميزانية.</div>}
            </section> : null}
          </div>

          <div className="marketing-database-two-column">
            <section className="marketing-task-section marketing-database-section">
              <h3>عرض نتائج الحملة</h3>
              <div className="marketing-database-upload-state">
                {!detail.entity.result_file_id ? <p>لا يوجد ملف نتائج مرفوع.</p> : null}
                <div className="marketing-inline-actions">
                  {canUploadResults ? <label className="marketing-upload-button"><FileArrowUp size={17} />رفع ملف النتائج<input type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadResult(file); event.currentTarget.value = ""; }} /></label> : null}
                  {detail.entity.result_file_id && canDownloadFiles ? <button type="button" className="secondary" onClick={() => void downloadMarketingFile(detail.entity.result_file_id)}><DownloadSimple size={17} />عرض الملف المرفوع</button> : null}
                </div>
              </div>
            </section>

            <section className="marketing-task-section marketing-database-section">
              <h3>روابط الحملة</h3>
              {!links.length ? <div className="marketing-database-empty compact">لا توجد روابط حملة.</div> : null}
              {links.map((link, index) => <div className="marketing-link-row marketing-database-link-row" key={index}>
                <select value={link.platform} disabled={!canEditLinks} onChange={(event) => setLinks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, platform: event.target.value } : item))}>
                  <option value="">اختر المنصة</option>
                  <option value="Facebook">Facebook</option>
                  <option value="Instagram">Instagram</option>
                </select>
                <input dir="ltr" placeholder="https://" disabled={!canEditLinks} value={link.url} onChange={(event) => setLinks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))} />
                {canEditLinks ? <button type="button" className="icon-danger" onClick={() => setLinks((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash size={16} /></button> : null}
              </div>)}
              {canEditLinks ? <div className="marketing-inline-actions">
                <button type="button" className="secondary" onClick={() => setLinks((current) => [...current, { platform: "", url: "" }])}><LinkSimple size={17} />إضافة منصة ورابط</button>
                <button type="button" className="primary" onClick={() => void saveLinks()}>حفظ الروابط</button>
              </div> : null}
            </section>
          </div>

          {canArchive ? <section className="marketing-task-section marketing-database-section warning">
            <h3><WarningCircle size={20} />الأرشفة</h3>
            <p>لا يمكن أرشفة الحملة قبل رفع ملف نتائج الحملة وإضافة روابط الحملة.</p>
            <button type="button" className="secondary" onClick={() => void action("archive_entity", selected)}><Archive size={17} />أرشيف</button>
          </section> : null}
          </> : <section className="marketing-task-section marketing-database-section marketing-database-results-section">
            <div className="marketing-database-results-actions">
              <div><h3>نتائج النشر والتفاعل</h3><p>Facebook وInstagram حاليًا، مع تجهيز TikTok وSnapchat للربط اللاحق من نفس مصدر النتائج.</p></div>
              <a className="secondary-button" href={`/marketing/engagement?view=${selected?.source_type === "agenda" ? "agendas" : "campaigns"}&sourceType=${selected?.source_type || "campaign"}&sourceId=${selected?.id || ""}`}><ArrowSquareOut size={17} />فتح في صفحة تفاعل النشر</a>
            </div>
            <EngagementResultDetail result={detail.engagementResults} />
          </section>}
        </div> : null}
      </Modal>
    </MarketingPage>
  );
}
