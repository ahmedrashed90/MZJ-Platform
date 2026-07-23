import { useMemo, useState } from "react";
import {
  Archive,
  FileArrowUp,
  FilePdf,
  FolderOpen,
  Link,
  PaperPlaneTilt,
  Table,
  Trash,
} from "@phosphor-icons/react";
import { formatDate, marketingFetch } from "../api";
import type { CampaignDetailResponse, MarketingMeta } from "../types";
import { openMarketingFile, uploadMarketingFile } from "./files";
import { downloadSpreadsheetXml } from "./exportFiles";
import { Alert, ConfirmButton, Empty, Modal, ProgressBar, StatusBadge } from "./Ui";

function money(value: number) {
  return new Intl.NumberFormat("ar-SA", { style: "currency", currency: "SAR" }).format(value);
}

function templateSummary(data: Record<string, unknown> | undefined) {
  if (!data) return "—";
  const preferredKeys = ["suggestedName", "creativeName", "goal", "objective", "mainMessage", "message", "caption", "hook", "script", "notes"];
  const pieces: string[] = [];
  for (const key of preferredKeys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) pieces.push(value.trim());
  }
  if (!pieces.length) {
    for (const value of Object.values(data)) {
      if (typeof value === "string" && value.trim()) pieces.push(value.trim());
      if (pieces.length >= 3) break;
    }
  }
  const unique = [...new Set(pieces)];
  const text = unique.slice(0, 3).join(" · ");
  return text.length > 220 ? `${text.slice(0, 217)}...` : text || "—";
}

type Props = {
  detail: CampaignDetailResponse;
  meta: MarketingMeta;
  onChanged?: () => Promise<void> | void;
  showAdminActions?: boolean;
};

type UserSummary = {
  key: string;
  name: string;
  department: string;
  total: number;
  notStarted: number;
  active: number;
  late: number;
  nearest: string;
  lastReceived: string;
};

export function CampaignDetailView({ detail, meta, onChanged, showAdminActions = true }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [resultFile, setResultFile] = useState<File | null>(null);
  const [platformId, setPlatformId] = useState("");
  const [url, setUrl] = useState("");
  const [showProductFiles, setShowProductFiles] = useState(false);

  const campaign = detail.campaign;
  const finalFiles = useMemo(
    () => detail.tasks.filter((task) => task.task_kind === "execution" && task.final_storage_key),
    [detail.tasks],
  );
  const budgetTotal = useMemo(
    () => detail.budgetItems.reduce(
      (sum, item) => sum + item.platform_values.reduce((value, platform) => value + Number(platform.amount || 0), 0),
      0,
    ),
    [detail.budgetItems],
  );
  const userSummary = useMemo<UserSummary[]>(() => {
    const map = new Map<string, UserSummary>();
    const now = new Date();
    for (const task of detail.tasks) {
      const key = `${task.assigned_to}:${task.department_id}`;
      const current = map.get(key) ?? {
        key,
        name: task.assigned_to_name,
        department: task.department_name,
        total: 0,
        notStarted: 0,
        active: 0,
        late: 0,
        nearest: "",
        lastReceived: "",
      };
      current.total += 1;
      if (!task.actual_received_at) current.notStarted += 1;
      if (["active", "received"].includes(task.status)) current.active += 1;
      if (task.due_date && new Date(task.due_date) < now && task.progress < 100) current.late += 1;
      if (task.due_date && (!current.nearest || task.due_date < current.nearest)) current.nearest = task.due_date;
      if (task.actual_received_at && (!current.lastReceived || task.actual_received_at > current.lastReceived)) {
        current.lastReceived = task.actual_received_at;
      }
      map.set(key, current);
    }
    return [...map.values()];
  }, [detail.tasks]);

  async function action(campaignAction: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await marketingFetch("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "campaign_action", campaignAction, campaignId: campaign.id, ...extra }),
      });
      setMessage("تم تنفيذ الإجراء بنجاح");
      await onChanged?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الإجراء");
    } finally {
      setBusy(false);
    }
  }

  async function uploadResult() {
    if (!resultFile) return;
    setBusy(true);
    setError("");
    try {
      const uploaded = await uploadMarketingFile(String(campaign.id), resultFile);
      await action("save_result", uploaded);
      setResultFile(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر رفع ملف النتائج");
      setBusy(false);
    }
  }

  async function addLink() {
    if (!platformId || !/^https?:\/\//i.test(url)) {
      setError("اختر المنصة وأدخل رابطًا صحيحًا.");
      return;
    }
    await action("add_link", { platformId, url });
    setUrl("");
  }

  function exportSchedule() {
    const rows = [
      ["التاريخ", "الكرييتيف", "المنصة", "نوع النشر"],
      ...detail.schedule.flatMap((item) => item.posts.map((post) => [
        item.publish_date,
        `${item.instance_code} - ${item.creative_name}`,
        post.platform_name,
        post.post_type_name,
      ])),
    ];
    downloadSpreadsheetXml(`${campaign.campaign_code}-schedule.xls`, "جدول النشر", rows);
  }

  function exportReview() {
    const rows = [
      ["رقم التاسك", "الكرييتيف", "اليوزر", "كاتب المحتوى", "القسم", "الحالة", "التقدم", "الموعد", "الاستلام", "ملخص المطلوب"],
      ...detail.tasks.map((task) => [
        task.task_no,
        `${task.instance_code} - ${task.creative_name}`,
        task.assigned_to_name,
        task.content_writer_name,
        task.department_name,
        task.status,
        task.progress,
        task.due_date || "",
        task.actual_received_at || "",
        templateSummary(task.approved_template_data),
      ]),
    ];
    downloadSpreadsheetXml(`${campaign.campaign_code}-review.xls`, "مراجعة الحملة", rows);
  }

  return (
    <div className="marketing-campaign-full-detail">
      {error ? <Alert type="error">{error}</Alert> : null}
      {message ? <Alert type="success">{message}</Alert> : null}

      <div className="marketing-detail-toolbar">
        <button type="button" onClick={() => setShowProductFiles(true)}>
          <FolderOpen size={18} />عرض ملفات المنتجات
        </button>
        <button type="button" onClick={() => window.print()}><FilePdf size={18} />تصدير PDF</button>
        <button type="button" onClick={exportSchedule}><Table size={18} />تصدير جدول النشر</button>
        <button type="button" onClick={exportReview}><Table size={18} />تصدير مراجعة Excel</button>
        {showAdminActions && meta.permissions.canManage ? (
          <>
            <button type="button" onClick={() => void action("create_raw_folders")} disabled={busy}>
              <FolderOpen size={18} />إنشاء فولدرات الخام
            </button>
            <button type="button" onClick={() => void action("archive")} disabled={busy}>
              <Archive size={18} />أرشيف
            </button>
            <button type="button" className="danger" onClick={() => void action("delete")} disabled={busy}>
              <Trash size={18} />مسح
            </button>
          </>
        ) : null}
      </div>

      <section className="marketing-detail-section">
        <h3>بيانات الحملة كاملة</h3>
        <div className="marketing-detail-grid">
          <div><small>تاريخ الحملة</small><strong>{formatDate(campaign.campaign_date)}</strong></div>
          <div><small>اسم الحملة</small><strong>{campaign.name}</strong></div>
          <div><small>كود الحملة</small><strong>{campaign.campaign_code}</strong></div>
          <div><small>نوع الحملة</small><strong>{String(campaign.campaign_type_name || (campaign.source_kind === "agenda" ? "أجندة" : "—"))}</strong></div>
          <div><small>هدف الحملة</small><strong>{String(campaign.objective || "—")}</strong></div>
          <div><small>بداية النشر</small><strong>{formatDate(campaign.publish_start_date)}</strong></div>
          <div><small>نهاية النشر</small><strong>{formatDate(campaign.publish_end_date)}</strong></div>
          <div><small>المطلوب من كاتب المحتوى</small><strong>{String(campaign.content_brief || "—")}</strong></div>
          <div><small>عدد التاسكات</small><strong>{campaign.tasks_count}</strong></div>
          <div><small>التاسكات المستلمة</small><strong>{campaign.received_tasks_count}</strong></div>
          <div><small>التاسكات المكتملة</small><strong>{campaign.completed_tasks_count}</strong></div>
          <div><small>تاريخ الإنشاء</small><strong>{formatDate(campaign.created_at, true)}</strong></div>
          <div><small>آخر تحديث</small><strong>{formatDate(campaign.updated_at, true)}</strong></div>
        </div>
        <ProgressBar value={detail.progress} />
      </section>

      <section className="marketing-detail-section">
        <h3>الكرييتيفات وتوزيع اليوزرات والسيارات</h3>
        <div className="marketing-instance-detail-list">
          {detail.instances.map((instance) => (
            <article key={instance.id}>
              <header><b>{instance.instance_code} - {instance.creative_name}</b><span>{instance.short_code}</span></header>
              <div><small>كتاب المحتوى</small><p>{instance.writers.map((writer) => writer.full_name).join("، ") || "—"}</p></div>
              <div>
                <small>الأقسام واليوزرات</small>
                {instance.departments.map((department) => (
                  <p key={department.id}>
                    <b>{department.department_name}</b>: {department.assignments.map((assignment) => `${assignment.executive_name} × ${assignment.content_writer_name}`).join("، ") || "—"}
                  </p>
                ))}
              </div>
              <div><small>السيارات</small><p>{instance.vehicles.map((vehicle) => `${vehicle.vin} · ${vehicle.car_name || vehicle.statement || "سيارة"}`).join("، ") || "—"}</p></div>
              <div><small>المنصات</small><p>{instance.posts.map((post) => `${post.platform_name}: ${post.post_type_name}`).join("، ") || "—"}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-detail-section">
        <h3>التاسكات التنفيذية واليوزرات</h3>
        <div className="marketing-table-wrap">
          <table className="marketing-table">
            <thead><tr><th>اليوزر</th><th>القسم</th><th>عدد التاسكات</th><th>لم تبدأ</th><th>نشطة</th><th>متأخرة</th><th>أقرب تاريخ</th><th>آخر استلام</th></tr></thead>
            <tbody>{userSummary.map((row) => (
              <tr key={row.key}><td>{row.name}</td><td>{row.department}</td><td>{row.total}</td><td>{row.notStarted}</td><td>{row.active}</td><td>{row.late}</td><td>{formatDate(row.nearest)}</td><td>{formatDate(row.lastReceived, true)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="marketing-table-wrap">
          <table className="marketing-table">
            <thead><tr><th>التاسك</th><th>رقم التاسك</th><th>اليوزر</th><th>كاتب المحتوى</th><th>القسم</th><th>الحالة</th><th>التقدم</th><th>التاريخ المطلوب</th><th>الاستلام الفعلي</th><th>ملخص المطلوب</th><th>الملف النهائي</th></tr></thead>
            <tbody>{detail.tasks.map((task) => (
              <tr key={task.id}>
                <td>{task.instance_code} - {task.creative_name}</td><td>{task.task_no}</td><td>{task.assigned_to_name}</td><td>{task.content_writer_name}</td><td>{task.department_name}</td><td><StatusBadge status={task.status} /></td><td>{task.progress}%</td><td>{formatDate(task.due_date)}</td><td>{formatDate(task.actual_received_at, true)}</td><td className="marketing-task-summary-cell">{templateSummary(task.approved_template_data)}</td>
                <td>{task.final_storage_key ? <button type="button" onClick={() => void openMarketingFile(task.final_storage_key || "")}><FolderOpen size={16} />فتح الملف</button> : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <div className="marketing-detail-columns">
        <section className="marketing-detail-section">
          <h3>عرض الميزانية</h3>
          {detail.budgetItems.length ? (
            <>
              <div className="marketing-table-wrap">
                <table className="marketing-table">
                  <thead><tr><th>Funnel</th><th>الكرييتيف</th><th>عدد الإعلانات</th><th>هدف المحتوى</th><th>الهدف المتوقع</th><th>المنصات والقيم</th></tr></thead>
                  <tbody>{detail.budgetItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.funnel_name || "—"}</td><td>{item.instance_code} - {item.creative_name}</td><td>{item.ads_count}</td><td>{item.content_goal || "—"}</td><td>{item.expected_goal || "—"}</td>
                      <td>{item.platform_values.map((platform) => `${platform.platform_name}: ${money(Number(platform.amount || 0))}`).join("، ")}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <strong className="marketing-total">إجمالي الميزانية: {money(budgetTotal)}</strong>
            </>
          ) : <Empty text="لا توجد بنود ميزانية." />}
        </section>

        <section className="marketing-detail-section">
          <h3>عرض جدول النشر</h3>
          {detail.schedule.length ? detail.schedule.map((item) => (
            <article className="marketing-schedule-row" key={item.id}>
              <b>{formatDate(item.publish_date)}</b>
              <span>{item.instance_code} - {item.creative_name}</span>
              <span>{item.posts.map((post) => `${post.platform_name}: ${post.post_type_name}`).join("، ")}</span>
            </article>
          )) : <Empty text="لا يوجد جدول نشر محفوظ." />}
        </section>
      </div>

      <div className="marketing-detail-columns">
        <section className="marketing-detail-section">
          <h3>عرض نتائج الحملة</h3>
          {campaign.result_storage_key ? (
            <button type="button" className="marketing-file-open" onClick={() => void openMarketingFile(String(campaign.result_storage_key))}>
              <FolderOpen size={18} />{String(campaign.result_file_name || "فتح ملف النتائج")}
            </button>
          ) : (
            <div className="marketing-file-row">
              <label><FileArrowUp size={18} /><span>{resultFile?.name || "اختيار ملف النتائج"}</span><input type="file" onChange={(event) => setResultFile(event.target.files?.[0] || null)} /></label>
              <ConfirmButton onClick={() => void uploadResult()} disabled={busy || !resultFile}>رفع ملف النتائج</ConfirmButton>
            </div>
          )}
        </section>

        <section className="marketing-detail-section">
          <h3>روابط الحملة</h3>
          <div className="marketing-inline-form">
            <select value={platformId} onChange={(event) => setPlatformId(event.target.value)}>
              <option value="">اختر المنصة</option>
              {meta.platforms.filter((platform) => platform.is_active).map((platform) => <option key={platform.id} value={platform.id}>{platform.name}</option>)}
            </select>
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="رابط المنصة" />
            <ConfirmButton onClick={() => void addLink()} disabled={busy}><Link size={17} />إضافة منصة ورابط</ConfirmButton>
          </div>
          {detail.links.map((item) => <a className="marketing-link-row" href={item.url} target="_blank" rel="noreferrer" key={item.id}><b>{item.platform_name}</b><span>{item.url}</span><small>{formatDate(item.created_at, true)}</small></a>)}
          {!detail.links.length ? <Empty text="لا توجد روابط حملة." /> : null}
        </section>
      </div>

      {showAdminActions && meta.permissions.canManage && detail.progress >= 100 && campaign.workflow_stage !== "publishing" ? (
        <ConfirmButton onClick={() => void action("move_to_publish")} disabled={busy}>
          <PaperPlaneTilt size={18} />نقل الحملة إلى قسم النشر
        </ConfirmButton>
      ) : null}

      <Modal
        open={showProductFiles}
        title="عرض ملفات المنتجات"
        subtitle={`${campaign.name} · ${campaign.campaign_code}`}
        onClose={() => setShowProductFiles(false)}
        wide
      >
        {finalFiles.length ? (
          <div className="marketing-product-files-list">
            {finalFiles.map((task) => (
              <article key={task.id}>
                <div><small>القسم</small><strong>{task.department_name}</strong></div>
                <div><small>الكرييتيف</small><strong>{task.instance_code} - {task.creative_name}</strong></div>
                <div><small>رقم التاسك</small><strong>{task.task_no}</strong></div>
                <div><small>اليوزر</small><strong>{task.assigned_to_name}</strong></div>
                <div><small>كاتب المحتوى</small><strong>{task.content_writer_name}</strong></div>
                <div><small>اسم الملف</small><strong>{task.final_file_name || "ملف نهائي"}</strong></div>
                <button type="button" onClick={() => void openMarketingFile(task.final_storage_key || "")}><FolderOpen size={18} />فتح الملف</button>
              </article>
            ))}
          </div>
        ) : <Empty text="لا توجد ملفات نهائية مرفوعة." />}
      </Modal>
    </div>
  );
}
