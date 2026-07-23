import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, FileArrowUp, MagnifyingGlass, RocketLaunch } from "@phosphor-icons/react";
import { formatMarketingDate, marketingFetch, marketingQuery, openMarketingFile } from "../api";
import { useMarketing } from "../MarketingContext";
import type { GenericRowsResponse } from "../types";
import { TaskDetailModal } from "../components/TaskDetailModal";

const text = (row: Record<string, unknown>, key: string) => String(row[key] ?? "");
const num = (row: Record<string, unknown>, key: string) => Number(row[key] ?? 0) || 0;

export function MarketingPublishPrepPage() {
  const { meta } = useMarketing();
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [platformId, setPlatformId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    try { const payload = await marketingFetch<GenericRowsResponse>(`/api/marketing${marketingQuery({ action: "publish_prep", search, status, platformId, departmentId })}`); setRows(payload.rows); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "تعذر تحميل تجهيز النشر"); }
  };
  useEffect(() => { void load(); }, []);
  const stats = useMemo(() => ({ all: rows.length, ready: rows.filter((row) => num(row, "progress") >= 100 && text(row, "final_file_id")).length, waitingDate: rows.filter((row) => !text(row, "due_date")).length, missing: rows.filter((row) => num(row, "progress") < 100 || !text(row, "final_file_id")).length, uploaded: rows.filter((row) => text(row, "final_file_id")).length }), [rows]);

  if (!meta) return null;
  return <div className="marketing-page">
    <header className="marketing-page-title"><div><h2>تجهيز النشر</h2><p>متابعة تجهيز المنشورات النهائية ورفع الملفات وجدولة النشر.</p></div><div className="marketing-title-actions"><button onClick={() => void load()}><ArrowClockwise />تحديث التاسكات</button><button onClick={() => window.print()}>عرض التقويم</button></div></header>
    <div className="marketing-stat-grid five"><article><span>كل التاسكات</span><strong>{stats.all}</strong><small>تاسكات تنفيذية</small></article><article><span>جاهز للنشر</span><strong>{stats.ready}</strong><small>مكتملة وجاهزة</small></article><article><span>بانتظار التاريخ</span><strong>{stats.waitingDate}</strong><small>مكتملة بدون تاريخ</small></article><article><span>ناقص</span><strong>{stats.missing}</strong><small>تحتاج استكمال</small></article><article><span>ملفات مرفوعة</span><strong>{stats.uploaded}</strong><small>الملفات النهائية</small></article></div>
    <section className="marketing-filter-bar"><label className="marketing-search"><MagnifyingGlass /><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder="بحث في التاسكات..." /></label><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">كل الحالات</option><option value="waiting_template">في انتظار اعتماد Task Template</option><option value="waiting_receipt">لم تبدأ</option><option value="active">نشطة</option><option value="completed">مكتملة</option></select><select value={platformId} onChange={(event) => setPlatformId(event.target.value)}><option value="">كل المنصات</option>{meta.platforms.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">كل الأقسام</option>{meta.departments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button className="primary" onClick={() => void load()}>تصفية</button></section>
    {error ? <div className="marketing-error">{error}</div> : null}
    <section className="marketing-task-board"><header><div><small>الملفات النهائية</small><h3>كل الملفات النهائية في مكان واحد</h3></div><b>{stats.uploaded}</b></header><div className="publish-task-grid">{rows.map((row) => <article key={text(row, "id")}><header><span className={`status-${text(row, "status")}`}>{text(row, "status")}</span><strong>{text(row, "task_no")}</strong></header><h4>{text(row, "instance_code")} - {text(row, "creative_name")}</h4><p>{text(row, "campaign_name")} — {text(row, "campaign_code")}</p><div className="marketing-mini-progress"><span style={{ width: `${Math.min(100, num(row, "progress"))}%` }} /><b>{Math.round(num(row, "progress"))}%</b></div><dl><div><dt>المسؤول</dt><dd>{text(row, "assigned_name")}</dd></div><div><dt>كاتب المحتوى</dt><dd>{text(row, "content_writer_name")}</dd></div><div><dt>القسم</dt><dd>{text(row, "department_name")}</dd></div><div><dt>موعد التسليم</dt><dd>{formatMarketingDate(text(row, "due_date"))}</dd></div></dl><div className="publish-task-actions"><button onClick={() => setSelected(text(row, "id"))}><RocketLaunch />تفاصيل</button>{text(row, "final_file_id") ? <button onClick={() => void openMarketingFile(text(row, "final_file_id"))}><FileArrowUp />فتح الملف</button> : null}</div></article>)}</div>{!rows.length ? <div className="marketing-empty">لا توجد تاسكات مطابقة للفلاتر الحالية.</div> : null}</section>
    <TaskDetailModal taskId={selected} onClose={() => setSelected(null)} onChanged={() => void load()} />
  </div>;
}
