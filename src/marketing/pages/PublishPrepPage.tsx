import { useEffect, useMemo, useState } from "react";
import { FileArrowUp, Funnel, PaperPlaneTilt } from "@phosphor-icons/react";
import { useOutletContext } from "react-router-dom";
import { formatDate, marketingFetch } from "../api";
import type { DashboardResponse, DashboardTask } from "../types";
import type { MarketingOutletContext } from "../MarketingLayout";
import { openMarketingFile } from "../components/files";
import { Alert, Empty, PageHead, ProgressBar, StatusBadge } from "../components/Ui";

type PrepStatus = "ready" | "waiting_date" | "missing" | "uploaded";

type PreparedTask = {
  task: DashboardTask;
  status: PrepStatus;
  statusLabel: string;
  missing: string[];
  caption: string;
  hashtags: string;
};

function text(value: unknown) { return String(value ?? "").trim(); }

function prepareTask(task: DashboardTask): PreparedTask {
  const caption = text(task.approved_template_data?.caption);
  const hashtags = text(task.approved_template_data?.hashtags);
  const missing: string[] = [];
  if (task.progress < 100) missing.push("اكتمال التاسك 100%");
  if (!task.final_storage_key) missing.push("الملف النهائي");
  if (!task.publish_dates.length) missing.push("تاريخ النشر");
  if (!task.publishing_posts.length) missing.push("المنصات وأنواع النشر");
  if (!caption) missing.push("الكابشن");
  if (!hashtags) missing.push("الهاشتاج");
  if (!missing.length) return { task, status: "ready", statusLabel: "جاهز للنشر", missing, caption, hashtags };
  if (task.final_storage_key && task.progress >= 100 && !task.publish_dates.length) return { task, status: "waiting_date", statusLabel: "بانتظار التاريخ", missing, caption, hashtags };
  if (task.final_storage_key) return { task, status: "uploaded", statusLabel: "تم رفع الملف النهائي", missing, caption, hashtags };
  return { task, status: "missing", statusLabel: "ناقص", missing, caption, hashtags };
}

export function PublishPrepPage() {
  const { meta } = useOutletContext<MarketingOutletContext>();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [status, setStatus] = useState("");
  const [department, setDepartment] = useState("");
  const [platform, setPlatform] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    marketingFetch<DashboardResponse>("/api/marketing?resource=dashboard")
      .then(setData)
      .catch((failure) => setError(failure instanceof Error ? failure.message : "تعذر تحميل تجهيز النشر"));
  }, []);

  const prepared = useMemo(
    () => (data?.tasks || []).filter((task) => task.task_kind === "execution").map(prepareTask),
    [data],
  );
  const filtered = useMemo(() => prepared.filter((item) => {
    const task = item.task;
    if (status && item.status !== status) return false;
    if (department && task.department_id !== department) return false;
    if (platform && !task.platform_ids.includes(platform)) return false;
    if (search && !`${task.task_no} ${task.campaign_name} ${task.creative_name} ${task.assigned_to_name} ${item.caption} ${item.hashtags}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [department, platform, prepared, search, status]);

  const ready = prepared.filter((item) => item.status === "ready").length;
  const waitingDate = prepared.filter((item) => item.status === "waiting_date").length;
  const missing = prepared.filter((item) => item.status === "missing").length;
  const uploaded = prepared.filter((item) => item.task.final_storage_key).length;

  return (
    <div className="marketing-page">
      <PageHead title="تجهيز النشر" description="متابعة تجهيز المنشورات النهائية وملفات الحملات والأجندات وجدول النشر." />
      {error ? <Alert type="error">{error}</Alert> : null}
      <div className="marketing-summary-cards publish">
        <div><span>كل التاسكات</span><b>{prepared.length}</b><small>تاسكات تنفيذية</small></div>
        <div><span>جاهز للنشر</span><b>{ready}</b><small>مكتملة وجاهزة</small></div>
        <div><span>بانتظار التاريخ</span><b>{waitingDate}</b><small>مكتملة بدون تاريخ</small></div>
        <div><span>ناقص</span><b>{missing}</b><small>تحتاج استكمال</small></div>
        <div><span>ملفات مرفوعة</span><b>{uploaded}</b><small>الملفات النهائية</small></div>
      </div>
      <section className="marketing-filter-bar">
        <Funnel size={20} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث في التاسكات..." />
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">كل الحالات</option>
          <option value="ready">جاهز للنشر</option>
          <option value="waiting_date">بانتظار التاريخ</option>
          <option value="uploaded">تم رفع الملف النهائي</option>
          <option value="missing">ناقص</option>
        </select>
        <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
          <option value="">كل المنصات</option>
          {meta.platforms.filter((item) => item.is_active).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
        <select value={department} onChange={(event) => setDepartment(event.target.value)}>
          <option value="">كل الأقسام</option>
          {meta.departments.filter((item) => item.is_active && !item.is_content).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
      </section>
      <section className="marketing-final-files">
        <header><div><small>الملفات النهائية</small><h2>كل ملفات التجهيز في مكان واحد</h2></div><span>{filtered.length}</span></header>
        {filtered.map(({ task, statusLabel, missing: missingFields, caption, hashtags }) => (
          <article key={task.id}>
            <div><PaperPlaneTilt size={23} /><div><strong>{task.instance_code} - {task.creative_name}</strong><small>{task.campaign_name} · {task.task_no}</small></div></div>
            <span>{task.department_name}</span>
            <span>{task.assigned_to_name}</span>
            <StatusBadge status={task.status} />
            <ProgressBar value={task.progress} />
            <div className="marketing-prep-meta">
              <small>{task.publish_dates.length ? `تاريخ النشر: ${task.publish_dates.map((value) => formatDate(value)).join("، ")}` : "تاريخ النشر غير محدد"}</small>
              <small>{task.publishing_posts.length ? task.publishing_posts.map((post) => `${post.platform_name}: ${post.post_type_name}`).join("، ") : "لا توجد منصات وأنواع نشر"}</small>
              <small>{caption ? `الكابشن: ${caption}` : "الكابشن غير مكتمل"}</small>
              <small>{hashtags ? `الهاشتاج: ${hashtags}` : "الهاشتاج غير مكتمل"}</small>
              <b>{statusLabel}</b>
              {missingFields.length ? <em>الناقص: {missingFields.join("، ")}</em> : null}
            </div>
            {task.final_storage_key ? <button type="button" onClick={() => void openMarketingFile(task.final_storage_key || "")}><FileArrowUp size={17} />فتح الملف النهائي</button> : <em>لا يوجد ملف نهائي</em>}
          </article>
        ))}
        {!filtered.length ? <Empty text="لا توجد تاسكات مطابقة للفلاتر الحالية." /> : null}
      </section>
    </div>
  );
}
