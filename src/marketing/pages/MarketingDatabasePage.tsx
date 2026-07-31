import { useEffect, useMemo, useState } from "react";
import { Archive, ArrowSquareOut, CalendarBlank, DownloadSimple, Eye, FileArrowUp, FileImage, FilePdf, FileVideo, FileXls, FolderOpen, LinkSimple, PencilSimple, Plus, Trash, WarningCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { downloadMarketingFile, marketingDate, marketingFetch, marketingQuery, uploadMarketingFile } from "../api";
import { MarketingAlert, MarketingPage, ProgressBar } from "../components/MarketingPage";
import { EngagementResultDetail } from "../components/EngagementResultDetail";
import { EntityCreativeManager } from "../components/EntityCreativeManager";
import { marketingResultPlatformLabel } from "../engagementResults";
import { downloadMarketingReportXlsx, safeMarketingReportFilename } from "../reportXlsx";
import type { MarketingMeta } from "../types";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../systemAccess";

const emptyMeta: MarketingMeta = { ok: true, users: [], departments: [], contentDepartmentId: "", actions: [], creativeTypes: [], campaignTypes: [], platforms: [], postTypes: [], funnels: [], cars: [], connections: [], permissions: { effective: [] } };

function escapePrintHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function taskKindLabel(task: any) {
  return task?.task_kind === "task_template" ? "Task Template" : "تاسك تنفيذي";
}

function reportStatus(value: unknown) {
  const status = String(value || "").toLowerCase();
  if (status === "completed" || status === "done" || status === "approved" || status === "published") return "مكتمل";
  if (status === "in_progress" || status === "working") return "جاري التنفيذ";
  if (status === "rejected") return "مرفوض";
  if (status === "changes_requested" || status === "needs_changes") return "مطلوب تعديل";
  if (status === "waiting" || status === "pending" || status === "under_review") return "بانتظار التنفيذ";
  return String(value || "—");
}

function reportCount(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("ar-SA") : "0";
}

function budgetIncludesCreative(item: any, creativeId: unknown) {
  const target = String(creativeId || "");
  if (!target) return false;
  const linkedIds = Array.isArray(item?.creative_ids) ? item.creative_ids.map((id: unknown) => String(id || "")) : [];
  return linkedIds.includes(target) || String(item?.creative_id || "") === target;
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

type MarketingTaskReviewExportRow = Record<string, string | number> & {
  "م": number;
  "نوع التاسك": string;
  "الكرييتيف": string;
  "المسؤول": string;
  "كاتب المحتوى المرتبط": string;
  "القسم": string;
  "الحالة": string;
  "التقدم": string;
  "تاريخ التسليم": string;
  "حالة Task Template": string;
  "المطلوب": string;
  "الملف النهائي": string;
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
  const [meta, setMeta] = useState<MarketingMeta>(emptyMeta);
  const [creativeManager, setCreativeManager] = useState<{ open: boolean; row: any | null }>({ open: false, row: null });
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
  const canEditCreatives = selected?.source_type === "agenda" ? canEditAgendaLinks : canEditCampaignLinks;
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
    marketingFetch<MarketingMeta>(`/api/marketing${marketingQuery({ resource: "meta" })}`).then(setMeta).catch(() => undefined);
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

  async function creativeSaved(savedMessage: string) {
    setMessage(savedMessage);
    if (selected) await open(selected);
    await load();
  }

  function printDetail() {
    if (!selected || !detail) return;
    const popup = window.open("", "_blank", "width=1400,height=900");
    if (!popup) {
      setError("اسمح بفتح النافذة المنبثقة لتصدير PDF ثم أعد المحاولة");
      return;
    }

    const entityKind = selected.source_type === "agenda" ? "الأجندة" : "الحملة";
    const entityCode = detail.entity.campaign_code || detail.entity.month_key || selected.code || "—";
    const creatives = Array.isArray(detail.creatives) ? detail.creatives : [];
    const tasks = Array.isArray(detail.tasks) ? detail.tasks : [];
    const budgets = Array.isArray(detail.budgets) ? detail.budgets : [];
    const schedule = Array.isArray(detail.schedule) ? detail.schedule : [];
    const engagement = detail.engagementResults;
    const info = [
      ["الاسم", detail.entity.name || selected.name],
      ["الكود", entityCode],
      ["النوع", detail.entity.campaign_type_name || detail.entity.campaign_type || "أجندة"],
      ["الهدف", detail.entity.objective || "—"],
      ["تاريخ السجل", marketingDate(detail.entity.campaign_date || detail.entity.created_at)],
      ["بداية النشر", marketingDate(detail.entity.publish_start)],
      ["نهاية النشر", marketingDate(detail.entity.publish_end)],
      ["المطلوب من المحتوى", detail.entity.required_from_content || "—"],
      ["عدد الكرييتيفات", reportCount(creatives.length)],
      ["عدد التاسكات", reportCount(tasks.length)],
      ["التاسكات المكتملة", reportCount(tasks.filter((task: any) => Number(task.progress || 0) >= 100).length)],
      ["الملفات النهائية", reportCount(finalProductFiles.length)],
      ["روابط النشر", reportCount(links.length)],
      ["ملف النتائج", detail.entity.result_file_id ? "مرفق" : "غير مرفق"],
      ["نسبة التقدم", `${Number(detail.entity.progress || 0).toLocaleString("ar-SA")}%`],
    ];
    const creativeRows = creatives.map((creative: any, index: number) => {
      const creativeTasks = tasks.filter((task: any) => String(task.creative_id || "") === String(creative.id || ""));
      const templateCount = creativeTasks.filter((task: any) => task.task_kind === "task_template").length;
      const executionCount = creativeTasks.filter((task: any) => task.task_kind === "execution").length;
      const scheduleCount = schedule.filter((item: any) => String(item.creative_id || "") === String(creative.id || "")).length;
      const budgetTotal = budgets.filter((item: any) => budgetIncludesCreative(item, creative.id)).reduce((sum: number, item: any) => sum + Number(item.total || 0), 0);
      return `<tr><td>${index + 1}</td><td>${escapePrintHtml(creative.instance_code || "—")}</td><td>${escapePrintHtml(creative.creative_type_name || creative.name || creative.creative_type || "كرييتيف")}</td><td>${escapePrintHtml(creative.primary_department_name || "—")}</td><td>${reportCount(creative.quantity || 1)}</td><td>${reportCount(templateCount)}</td><td>${reportCount(executionCount)}</td><td>${reportCount(scheduleCount)}</td>${selected.source_type === "campaign" ? `<td>${Number(budgetTotal).toLocaleString("ar-SA")} ر.س</td>` : ""}</tr>`;
    }).join("");
    const taskRows = tasks.map((task: any, index: number) => `<tr><td>${index + 1}</td><td>${escapePrintHtml(taskKindLabel(task))}</td><td>${escapePrintHtml(task.creative_name || "—")}</td><td>${escapePrintHtml(task.assigned_name || "—")}</td><td>${escapePrintHtml(task.department_name || "قسم المحتوى")}</td><td>${escapePrintHtml(reportStatus(task.status))}</td><td>${Number(task.progress || 0).toLocaleString("ar-SA")}%</td><td>${escapePrintHtml(marketingDate(task.due_at))}</td><td>${escapePrintHtml(task.note || task.title || "—")}</td><td>${escapePrintHtml(task.template_status ? reportStatus(task.template_status) : "—")}</td><td>${escapePrintHtml(task.final_file_name || "—")}</td></tr>`).join("");
    const scheduleRowsHtml = schedule.map((item: any, index: number) => `<tr><td>${index + 1}</td><td>${escapePrintHtml(marketingDate(item.publish_date))}</td><td>${escapePrintHtml(item.creative_name || item.instance_code || "—")}</td><td>${escapePrintHtml(item.platform_name || "—")}</td><td>${escapePrintHtml(item.post_type_name || "—")}</td><td>${escapePrintHtml(reportStatus(item.status))}</td></tr>`).join("");
    const budgetRows = budgets.map((item: any, index: number) => `<tr><td>${index + 1}</td><td>${escapePrintHtml(item.creative_names || item.creative_name || "—")}</td><td>${escapePrintHtml(item.funnel_name || "—")}</td><td>${reportCount(item.ads_count)}</td><td>${escapePrintHtml(item.content_goal || "—")}</td><td>${escapePrintHtml(item.expected_goal || "—")}</td><td>${Number(item.total || 0).toLocaleString("ar-SA")} ر.س</td></tr>`).join("");
    const fileRows = finalProductFiles.map((file: any, index: number) => `<tr><td>${index + 1}</td><td>${escapePrintHtml(file.original_name || file.name || "—")}</td><td>${escapePrintHtml(file.mime_type || "—")}</td><td>${escapePrintHtml(formatFileSize(file.size || file.file_size))}</td><td>${escapePrintHtml(file.uploaded_by_name || file.created_by_name || "—")}</td><td>${escapePrintHtml(marketingDate(file.created_at, true))}</td></tr>`).join("");
    const linkRows = links.map((link, index) => `<tr><td>${index + 1}</td><td>${escapePrintHtml(marketingResultPlatformLabel(link.platform))}</td><td class="url">${escapePrintHtml(link.url || "—")}</td></tr>`).join("");
    const resultSummary = engagement?.summary;
    const resultCards = resultSummary ? [
      ["المنشورات", resultSummary.posts], ["المشاهدات", resultSummary.views], ["الإعجابات", resultSummary.likes],
      ["التعليقات", resultSummary.comments], ["المشاركات", resultSummary.shares], ["عملاء CRM", resultSummary.crmLeads],
      ["تم البيع", resultSummary.soldLeads], ["عدد المباع", resultSummary.soldQuantity],
    ].map(([label, value]) => `<article><span>${escapePrintHtml(label)}</span><strong>${reportCount(value)}</strong></article>`).join("") : "";
    const postRows = Array.isArray(engagement?.posts) ? engagement.posts.map((post: any, index: number) => `<tr><td>${index + 1}</td><td>${escapePrintHtml(marketingResultPlatformLabel(post.platform))}</td><td>${escapePrintHtml(post.creativeName || "—")}</td><td>${escapePrintHtml(post.postTypeName || "—")}</td><td>${escapePrintHtml(marketingDate(post.publishedAt, true))}</td><td>${reportCount(post.views)}</td><td>${reportCount(post.likes)}</td><td>${reportCount(post.comments)}</td><td>${reportCount(post.shares)}</td><td>${reportCount(post.crmLeads)}</td><td>${reportCount(post.soldLeads)}</td></tr>`).join("") : "";

    popup.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير ${escapePrintHtml(entityKind)} - ${escapePrintHtml(detail.entity.name || selected.name)}</title><style>
      @page{size:A4 landscape;margin:9mm}*{box-sizing:border-box}body{margin:0;color:#38231d;background:#fff;font-family:Tajawal,Arial,sans-serif;font-size:10px;line-height:1.55}.report{display:grid;gap:14px}.report-header{padding:18px 20px;border-radius:16px;color:#fff;background:linear-gradient(135deg,#7a3b2e,#b85b3f);display:flex;justify-content:space-between;align-items:flex-end;gap:20px}.report-header h1{margin:0 0 5px;font-size:24px}.report-header p{margin:0;color:#f9ddd3}.report-header .code{min-width:180px;padding:10px 13px;border:1px solid rgba(255,255,255,.28);border-radius:11px;background:rgba(255,255,255,.12);text-align:center;font-weight:900;font-size:14px}.section{break-inside:auto;border:1px solid #e7d7d0;border-radius:14px;overflow:hidden;background:#fff}.section-title{padding:11px 14px;border-bottom:1px solid #eadbd5;background:#faf5f2;display:flex;justify-content:space-between;align-items:center}.section-title h2{margin:0;font-size:15px}.section-title span{color:#866c64}.info-grid{padding:12px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.info-grid article,.kpis article{padding:9px 10px;border:1px solid #eaded9;border-radius:10px;background:#fffdfc;display:grid;gap:4px}.info-grid span,.kpis span{color:#816b64;font-size:9px;font-weight:800}.info-grid strong{font-size:11px;overflow-wrap:anywhere}.kpis{padding:12px;display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px}.kpis strong{font-size:17px;color:#7a3b2e}table{width:100%;border-collapse:collapse;page-break-inside:auto}thead{display:table-header-group}tr{page-break-inside:avoid}th,td{padding:7px 8px;border:1px solid #e5d8d2;text-align:right;vertical-align:top;overflow-wrap:anywhere}th{color:#fff;background:#7a3b2e;font-size:9px}td.url{direction:ltr;text-align:left;font-family:Arial,sans-serif;font-size:8px}tbody tr:nth-child(even) td{background:#fcf8f6}.empty{padding:18px;text-align:center;color:#89756e}.report-footer{padding-top:8px;border-top:1px solid #eaded9;color:#8b756e;display:flex;justify-content:space-between}.page-break{break-before:page}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.section{box-shadow:none}}
    </style></head><body><main class="report"><header class="report-header"><div><h1>تقرير ${escapePrintHtml(entityKind)}: ${escapePrintHtml(detail.entity.name || selected.name)}</h1><p>بيانات ${escapePrintHtml(entityKind)} والتاسكات وجدول النشر ونتائج النشر والتفاعل</p></div><div class="code">${escapePrintHtml(entityCode)}</div></header>
      <section class="section"><div class="section-title"><h2>بيانات ${escapePrintHtml(entityKind)}</h2><span>${escapePrintHtml(marketingDate(detail.entity.created_at, true))}</span></div><div class="info-grid">${info.map(([label, value]) => `<article><span>${escapePrintHtml(label)}</span><strong>${escapePrintHtml(value)}</strong></article>`).join("")}</div></section>
      <section class="section"><div class="section-title"><h2>الكرييتيفات</h2><span>${reportCount(creatives.length)} كرييتيف</span></div><table><thead><tr><th>م</th><th>الكود</th><th>الكرييتيف</th><th>القسم الأساسي</th><th>العدد</th><th>Task Template</th><th>تاسك تنفيذي</th><th>مواعيد النشر</th>${selected.source_type === "campaign" ? "<th>الميزانية</th>" : ""}</tr></thead><tbody>${creativeRows || `<tr><td colspan="${selected.source_type === "campaign" ? 9 : 8}" class="empty">لا توجد كرييتيفات</td></tr>`}</tbody></table></section>
      <section class="section"><div class="section-title"><h2>التاسكات</h2><span>${reportCount(tasks.length)} تاسك</span></div><table><thead><tr><th>م</th><th>نوع التاسك</th><th>الكرييتيف</th><th>المسؤول</th><th>القسم</th><th>الحالة</th><th>التقدم</th><th>التاريخ المطلوب</th><th>المطلوب</th><th>حالة الاعتماد</th><th>الملف النهائي</th></tr></thead><tbody>${taskRows || '<tr><td colspan="11" class="empty">لا توجد تاسكات</td></tr>'}</tbody></table></section>
      <section class="section"><div class="section-title"><h2>جدول النشر</h2><span>${reportCount(schedule.length)} صف</span></div><table><thead><tr><th>م</th><th>التاريخ</th><th>الكرييتيف</th><th>المنصة</th><th>نوع النشر</th><th>الحالة</th></tr></thead><tbody>${scheduleRowsHtml || '<tr><td colspan="6" class="empty">لا يوجد جدول نشر</td></tr>'}</tbody></table></section>
      ${selected.source_type === "campaign" ? `<section class="section"><div class="section-title"><h2>الميزانية</h2><span>${Number(budgets.reduce((sum: number, item: any) => sum + Number(item.total || 0), 0)).toLocaleString("ar-SA")} ر.س</span></div><table><thead><tr><th>م</th><th>الكرييتيف</th><th>Funnel</th><th>عدد الإعلانات</th><th>هدف المحتوى</th><th>الهدف المتوقع</th><th>الإجمالي</th></tr></thead><tbody>${budgetRows || '<tr><td colspan="7" class="empty">لا توجد ميزانية</td></tr>'}</tbody></table></section>` : ""}
      <section class="section"><div class="section-title"><h2>الملفات النهائية</h2><span>${reportCount(finalProductFiles.length)} ملف</span></div><table><thead><tr><th>م</th><th>اسم الملف</th><th>النوع</th><th>الحجم</th><th>تم الرفع بواسطة</th><th>تاريخ الرفع</th></tr></thead><tbody>${fileRows || '<tr><td colspan="6" class="empty">لا توجد ملفات نهائية معتمدة</td></tr>'}</tbody></table></section>
      <section class="section"><div class="section-title"><h2>روابط النشر</h2><span>${reportCount(links.length)} رابط</span></div><table><thead><tr><th>م</th><th>المنصة</th><th>الرابط</th></tr></thead><tbody>${linkRows || '<tr><td colspan="3" class="empty">لا توجد روابط نشر</td></tr>'}</tbody></table></section>
      <section class="section page-break"><div class="section-title"><h2>نتائج النشر والتفاعل</h2><span>${engagement ? `آخر مزامنة: ${escapePrintHtml(marketingDate(resultSummary?.lastSyncedAt, true))}` : "لا توجد نتائج"}</span></div>${engagement ? `<div class="kpis">${resultCards}</div><table><thead><tr><th>م</th><th>المنصة</th><th>الكرييتيف</th><th>نوع النشر</th><th>تاريخ النشر</th><th>مشاهدات</th><th>إعجابات</th><th>تعليقات</th><th>مشاركات</th><th>عملاء CRM</th><th>تم البيع</th></tr></thead><tbody>${postRows || '<tr><td colspan="11" class="empty">لا توجد منشورات</td></tr>'}</tbody></table>` : '<div class="empty">لا توجد بيانات نتائج لهذه الحملة أو الأجندة.</div>'}</section>
      <footer class="report-footer"><span>MZJ Platform</span><span>تاريخ التصدير: ${escapePrintHtml(new Date().toLocaleString("ar-SA"))}</span></footer></main><script>window.onload=()=>setTimeout(()=>window.print(),350)<\/script></body></html>`);
    popup.document.close();
    try { popup.opener = null; } catch { /* browser may block opener changes */ }
  }

  function exportSchedule() {
    if (!selected || !detail) return;
    const entityKind = selected.source_type === "agenda" ? "الأجندة" : "الحملة";
    const code = detail.entity.campaign_code || detail.entity.month_key || selected.code || "—";
    const rows = (Array.isArray(detail.schedule) ? detail.schedule : []).map((item: any, index: number) => ({
      "م": index + 1,
      "التاريخ": marketingDate(item.publish_date),
      "الكرييتيف": item.creative_name || item.instance_code || "—",
      "كود الكرييتيف": item.instance_code || "—",
      "المنصة": item.platform_name || "—",
      "نوع النشر": item.post_type_name || "—",
      "الحالة": reportStatus(item.status),
    }));
    downloadMarketingReportXlsx({
      filename: `${safeMarketingReportFilename(selected.name || "جدول النشر")}-جدول-النشر.xlsx`,
      sheetName: "جدول النشر",
      title: `جدول نشر ${entityKind}: ${selected.name}`,
      subtitle: `الكود: ${code} | الفترة: ${marketingDate(detail.entity.publish_start)} إلى ${marketingDate(detail.entity.publish_end)} | عدد الصفوف: ${rows.length.toLocaleString("ar-SA")}`,
      columns: [
        { key: "م", label: "م", width: 8, align: "center" },
        { key: "التاريخ", label: "التاريخ", width: 17, align: "center" },
        { key: "الكرييتيف", label: "الكرييتيف", width: 28 },
        { key: "كود الكرييتيف", label: "كود الكرييتيف", width: 20, align: "center" },
        { key: "المنصة", label: "المنصة", width: 18, align: "center" },
        { key: "نوع النشر", label: "نوع النشر", width: 24 },
        { key: "الحالة", label: "الحالة", width: 18, align: "center" },
      ],
      rows,
    });
  }

  function exportReview() {
    if (!selected || !detail) return;
    const entityKind = selected.source_type === "agenda" ? "الأجندة" : "الحملة";
    const code = detail.entity.campaign_code || detail.entity.month_key || selected.code || "—";
    const rows: MarketingTaskReviewExportRow[] = (Array.isArray(detail.tasks) ? detail.tasks : []).map(
      (task: any, index: number): MarketingTaskReviewExportRow => ({
        "م": index + 1,
        "نوع التاسك": taskKindLabel(task),
        "الكرييتيف": task.creative_name || "—",
        "المسؤول": task.assigned_name || "—",
        "كاتب المحتوى المرتبط": task.content_user_name || "—",
        "القسم": task.department_name || "قسم المحتوى",
        "الحالة": reportStatus(task.status),
        "التقدم": `${Number(task.progress || 0).toLocaleString("ar-SA")}%`,
        "تاريخ التسليم": marketingDate(task.due_at),
        "حالة Task Template": task.template_status ? reportStatus(task.template_status) : "—",
        "المطلوب": task.note || task.title || "—",
        "الملف النهائي": task.final_file_name || "—",
      }),
    );
    downloadMarketingReportXlsx({
      filename: `${safeMarketingReportFilename(selected.name || "مراجعة")}-مراجعة-التاسكات.xlsx`,
      sheetName: "مراجعة التاسكات",
      title: `مراجعة ${entityKind}: ${selected.name}`,
      subtitle: `الكود: ${code} | إجمالي التاسكات: ${rows.length.toLocaleString("ar-SA")} | المكتمل: ${rows.filter((row) => row["الحالة"] === "مكتمل").length.toLocaleString("ar-SA")}`,
      columns: [
        { key: "م", label: "م", width: 7, align: "center" },
        { key: "نوع التاسك", label: "نوع التاسك", width: 18, align: "center" },
        { key: "الكرييتيف", label: "الكرييتيف", width: 24 },
        { key: "المسؤول", label: "المسؤول", width: 23 },
        { key: "كاتب المحتوى المرتبط", label: "كاتب المحتوى المرتبط", width: 25 },
        { key: "القسم", label: "القسم", width: 20 },
        { key: "الحالة", label: "الحالة", width: 18, align: "center" },
        { key: "التقدم", label: "التقدم", width: 13, align: "center" },
        { key: "تاريخ التسليم", label: "تاريخ التسليم", width: 17, align: "center" },
        { key: "حالة Task Template", label: "حالة Task Template", width: 21, align: "center" },
        { key: "المطلوب", label: "المطلوب", width: 42 },
        { key: "الملف النهائي", label: "الملف النهائي", width: 30 },
      ],
      rows,
    });
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
                  {canArchive ? <button type="button" className="marketing-row-archive-button" title="أرشفة السجل" aria-label="أرشفة السجل" onClick={() => void action("archive_entity", row)}><Archive size={17} weight="duotone" /></button> : null}
                </div></td>
              </tr>)}
              {!loading && !filtered.length ? <tr><td colSpan={10}><div className="marketing-empty small">لا توجد بيانات.</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={Boolean(selected)}
        title={selected ? `عرض بيانات ${selected.source_type === "agenda" ? "الأجندة" : "الحملة"} — ${selected.name}` : "عرض البيانات"}
        subtitle={selected?.code || undefined}
        onClose={closeDetail}
        className="marketing-database-modal marketing-database-modal-fullscreen"
      >
        {loading && !detail ? <div className="marketing-empty">جاري تحميل البيانات...</div> : null}
        {detail ? <div className="marketing-entity-detail marketing-database-workspace print-area">
          <div className="marketing-database-toolbar">
            <div className="marketing-detail-actions-top">
              <button type="button" className="marketing-detail-command files" onClick={showProductFiles}><FolderOpen size={19} weight="duotone" /><span><strong>عرض ملفات المنتجات</strong><small>الملفات النهائية المرفوعة</small></span></button>
              <button type="button" className="marketing-detail-command pdf" onClick={printDetail}><FilePdf size={19} weight="duotone" /><span><strong>تصدير PDF كامل</strong><small>البيانات والتاسكات والنتائج</small></span></button>
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
            <h3>بيانات {selected?.source_type === "agenda" ? "الأجندة" : "الحملة"} كاملة</h3>
            <div className="marketing-detail-grid marketing-database-summary-grid">
              <div><small>التاريخ</small><strong>{marketingDate(detail.entity.campaign_date || detail.entity.created_at)}</strong></div>
              <div><small>تاريخ بداية النشر</small><strong>{marketingDate(detail.entity.publish_start)}</strong></div>
              <div><small>تاريخ نهاية النشر</small><strong>{marketingDate(detail.entity.publish_end)}</strong></div>
              <div><small>نوع السجل</small><strong>{detail.entity.campaign_type_name || detail.entity.campaign_type || "أجندة"}</strong></div>
              <div><small>كود السجل</small><strong>{detail.entity.campaign_code || detail.entity.month_key}</strong></div>
              <div><small>اسم السجل</small><strong>{detail.entity.name}</strong></div>
              <div><small>الهدف</small><strong>{detail.entity.objective || "—"}</strong></div>
              <div><small>المطلوب من كاتب المحتوى</small><strong>{detail.entity.required_from_content || "—"}</strong></div>
              <div><small>عدد التاسكات</small><strong>{detail.tasks.length}</strong></div>
              <div><small>عدد التاسكات المكتملة</small><strong>{detail.tasks.filter((task: any) => Number(task.progress) >= 100).length}</strong></div>
              <div><small>تاريخ الإنشاء</small><strong>{marketingDate(detail.entity.created_at, true)}</strong></div>
              <div><small>آخر تحديث</small><strong>{marketingDate(detail.entity.updated_at, true)}</strong></div>
            </div>
            <ProgressBar value={Number(detail.entity.progress || 0)} />
          </section>

          <section className="marketing-task-section marketing-database-section marketing-entity-creatives-section">
            <div className="marketing-database-section-heading">
              <div><h3>كرييتيفات {selected?.source_type === "agenda" ? "الأجندة" : "الحملة"}</h3><p>كل كرييتيف مرتبط بـ Task Template والتاسك التنفيذي والميزانية وجدول النشر حسب نوع السجل.</p></div>
              {canEditCreatives ? <button type="button" className="marketing-add-creative-button" onClick={() => setCreativeManager({ open: true, row: null })}>
                <span className="marketing-add-creative-button-icon"><Plus size={20} weight="bold" /></span>
                <span className="marketing-add-creative-button-copy"><strong>إضافة كرييتيف</strong><small>Task Template + تاسك تنفيذي</small></span>
              </button> : null}
            </div>
            {detail.creatives.length ? <div className="marketing-table-wrap marketing-entity-creatives-table-wrap">
              <table className="marketing-entity-creatives-table">
                <thead><tr><th>م</th><th>كود الكرييتيف</th><th>الكرييتيف</th><th>القسم الأساسي</th><th>العدد</th><th>Task Template</th><th>التاسكات التنفيذية</th><th>مواعيد النشر</th>{selected?.source_type === "campaign" ? <th>الميزانية</th> : null}<th>الإجراء</th></tr></thead>
                <tbody>{detail.creatives.map((creative: any, index: number) => {
                  const creativeTasks = detail.tasks.filter((task: any) => String(task.creative_id || "") === String(creative.id));
                  const templateTasks = creativeTasks.filter((task: any) => task.task_kind === "task_template");
                  const executionTasks = creativeTasks.filter((task: any) => task.task_kind === "execution");
                  const approvedTemplates = templateTasks.filter((task: any) => ["approved", "completed"].includes(String(task.template_status || task.status || "").toLowerCase())).length;
                  const completedExecution = executionTasks.filter((task: any) => Number(task.progress || 0) >= 100).length;
                  const scheduleCount = new Set(detail.schedule.filter((item: any) => String(item.creative_id || "") === String(creative.id)).map((item: any) => `${String(item.publish_date || "").slice(0, 10)}-${item.group_id || item.id}`)).size;
                  const budgetTotal = detail.budgets.filter((item: any) => budgetIncludesCreative(item, creative.id)).reduce((sum: number, item: any) => sum + Number(item.total || 0), 0);
                  return <tr key={creative.id}>
                    <td className="marketing-creative-index">{index + 1}</td>
                    <td><span className="marketing-creative-code">{creative.instance_code || `#${index + 1}`}</span></td>
                    <td><div className="marketing-creative-name-cell"><strong>{creative.creative_type_name || creative.name || creative.creative_type || "كرييتيف"}</strong><small>{creative.notes?.label || "مرتبط بنفس الحملة أو الأجندة"}</small></div></td>
                    <td>{creative.primary_department_name || "—"}</td>
                    <td><strong>{Number(creative.quantity || 1).toLocaleString("ar-SA")}</strong></td>
                    <td><div className="marketing-creative-counter"><strong>{templateTasks.length.toLocaleString("ar-SA")}</strong><small>{approvedTemplates.toLocaleString("ar-SA")} معتمد</small></div></td>
                    <td><div className="marketing-creative-counter"><strong>{executionTasks.length.toLocaleString("ar-SA")}</strong><small>{completedExecution.toLocaleString("ar-SA")} مكتمل</small></div></td>
                    <td><strong>{scheduleCount.toLocaleString("ar-SA")}</strong></td>
                    {selected?.source_type === "campaign" ? <td><strong>{budgetTotal.toLocaleString("ar-SA")} ر.س</strong></td> : null}
                    <td>{canEditCreatives ? <button type="button" className="marketing-creative-edit-button" onClick={() => setCreativeManager({ open: true, row: creative })}><PencilSimple size={17} />تعديل الكرييتيف</button> : <span className="marketing-readonly-label">عرض فقط</span>}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div> : <div className="marketing-database-empty compact">لا توجد كرييتيفات داخل هذا السجل.</div>}
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
                  <header><div><span>بند الميزانية {index + 1}</span><h4>{item.creative_names || item.creative_name || "كرييتيف غير محدد"}</h4></div><strong>{Number(item.total || 0).toLocaleString("ar-SA")} ر.س</strong></header>
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

          {canArchive ? <section className="marketing-archive-panel">
            <div className="marketing-archive-panel-icon"><Archive size={27} weight="duotone" /></div>
            <div className="marketing-archive-panel-copy">
              <span>إغلاق دورة العمل</span>
              <h3>أرشفة {selected?.source_type === "agenda" ? "الأجندة" : "الحملة"}</h3>
              <p><WarningCircle size={16} />تتاح الأرشفة بعد رفع ملف النتائج وإضافة رابط نشر واحد على الأقل.</p>
            </div>
            <button type="button" className="marketing-archive-button" onClick={() => void action("archive_entity", selected)}>
              <Archive size={19} weight="bold" /><span><strong>أرشفة السجل</strong><small>نقل السجل إلى الأرشيف</small></span>
            </button>
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

      {selected && detail ? <EntityCreativeManager
        open={creativeManager.open}
        source={selected}
        detail={detail}
        meta={meta}
        creativeRow={creativeManager.row}
        onClose={() => setCreativeManager({ open: false, row: null })}
        onSaved={creativeSaved}
      /> : null}
    </MarketingPage>
  );
}
