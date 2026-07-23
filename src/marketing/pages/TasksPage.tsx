import { useEffect, useRef, useState } from "react";
import { CheckCircle, DownloadSimple, FileArrowUp, MagnifyingGlass, NotePencil, Play, SpinnerGap, X } from "@phosphor-icons/react";
import { useSearchParams } from "react-router-dom";
import {
  formatMarketingDate,
  marketingFetch,
  marketingQuery,
  openMarketingTaskFile,
  openMarketingTemplateVersion,
  uploadMarketingTaskFile,
} from "../api";
import type { MarketingMeta, MarketingTask } from "../types";
import { MarketingPageHeader } from "../components/MarketingPageHeader";
import { MarketingLoading, MarketingError } from "../components/MarketingLoading";
import { MarketingStatusBadge } from "../components/MarketingStatusBadge";
import { MarketingEmpty } from "../components/MarketingEmpty";

const buckets = [
  ["", "الكل"], ["pending_template", "جديدة"], ["ready", "جاهزة"], ["received", "تم الاستلام"],
  ["in_progress", "جاري العمل"], ["changes_requested", "مطلوب تعديل"], ["under_review", "تحت المراجعة"], ["completed", "منتهية"],
] as const;

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const [tasks, setTasks] = useState<MarketingTask[]>([]);
  const [meta, setMeta] = useState<MarketingMeta | null>(null);
  const [selected, setSelected] = useState<MarketingTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<"template" | "final" | "">("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState(params.get("status") || "");
  const [department, setDepartment] = useState(params.get("department") || "");
  const templateInput = useRef<HTMLInputElement>(null);
  const finalInput = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [taskResult, metaResult] = await Promise.all([
        marketingFetch<{ ok: boolean; tasks: MarketingTask[] }>(marketingQuery({ resource: "tasks", status, department })),
        meta ? Promise.resolve(meta) : marketingFetch<MarketingMeta>("resource=meta"),
      ]);
      setTasks(taskResult.tasks);
      setMeta(metaResult);
      const id = params.get("id");
      if (id) {
        const detail = await marketingFetch<{ ok: boolean; task: MarketingTask }>(`resource=task&id=${id}`);
        setSelected(detail.task);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحميل المهام");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [params]);

  function apply() {
    const next = new URLSearchParams();
    if (status) next.set("status", status);
    if (department) next.set("department", department);
    setParams(next);
  }

  async function refreshSelected() {
    if (!selected) return;
    const detail = await marketingFetch<{ ok: boolean; task: MarketingTask }>(`resource=task&id=${selected.id}`);
    setSelected(detail.task);
  }

  async function transition(nextStatus: string) {
    if (!selected) return;
    try {
      await marketingFetch("resource=task-transition", { method: "PATCH", body: JSON.stringify({ taskId: selected.id, nextStatus }) });
      await Promise.all([load(), refreshSelected()]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحديث المهمة");
    }
  }

  async function toggleAction(actionId: string, completed: boolean) {
    try {
      await marketingFetch("resource=task-action", { method: "PATCH", body: JSON.stringify({ actionId, completed }) });
      await Promise.all([load(), refreshSelected()]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تحديث الإجراء");
    }
  }

  async function submitTemplateFile(file: File) {
    if (!selected) return;
    setUploading("template");
    setError("");
    try {
      const upload = await uploadMarketingTaskFile(selected.id, file, "template");
      await marketingFetch("resource=task-template-submit", {
        method: "POST",
        body: JSON.stringify({
          taskId: selected.id,
          fileName: upload.originalName,
          fileKey: upload.storageKey,
          mimeType: upload.mimeType,
          fileSize: upload.fileSize,
          parsedData: {},
        }),
      });
      await Promise.all([load(), refreshSelected()]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر رفع Task Template");
    } finally {
      setUploading("");
      if (templateInput.current) templateInput.current.value = "";
    }
  }

  async function review(decision: "approved" | "changes_requested") {
    if (!selected) return;
    const notes = decision === "changes_requested" ? window.prompt("ملاحظات التعديل") || "" : "";
    try {
      await marketingFetch("resource=task-template-review", { method: "POST", body: JSON.stringify({ taskId: selected.id, decision, notes }) });
      await Promise.all([load(), refreshSelected()]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حفظ قرار المراجعة");
    }
  }

  async function addFinalFile(file: File) {
    if (!selected) return;
    setUploading("final");
    setError("");
    try {
      const upload = await uploadMarketingTaskFile(selected.id, file, "final");
      await marketingFetch("resource=task-file", {
        method: "POST",
        body: JSON.stringify({
          taskId: selected.id,
          fileRole: "final",
          storageKey: upload.storageKey,
          originalName: upload.originalName,
          mimeType: upload.mimeType,
          fileSize: upload.fileSize,
        }),
      });
      await Promise.all([load(), refreshSelected()]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر رفع الملف النهائي");
    } finally {
      setUploading("");
      if (finalInput.current) finalInput.current.value = "";
    }
  }

  async function openTaskFile(fileId: string, templateVersion = false) {
    try {
      if (templateVersion) await openMarketingTemplateVersion(fileId);
      else await openMarketingTaskFile(fileId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر فتح الملف");
    }
  }

  if (loading && !tasks.length && !selected) return <MarketingLoading label="جاري تحميل مهام التسويق..." />;
  return <div className="marketing-page">
    <MarketingPageHeader title="المتابعة والمهام" description="Task Template والتنفيذ والإجراءات والملفات النهائية، مرتبطة بالزوج الدقيق." />
    {error ? <MarketingError message={error} onRetry={() => void load()} /> : null}
    <div className="marketing-task-buckets">{buckets.map(([value, label]) => <button key={value} type="button" className={status === value ? "active" : ""} onClick={() => { setStatus(value); const next = new URLSearchParams(params); value ? next.set("status", value) : next.delete("status"); setParams(next); }}>{label}</button>)}</div>
    <div className="marketing-filter-bar"><label className="marketing-search"><MagnifyingGlass size={18} /><span>تصفية القسم</span></label><select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">كل الأقسام</option>{meta?.departments.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select><button className="marketing-button compact" type="button" onClick={apply}>تطبيق</button></div>
    <section className="marketing-panel">{tasks.length ? <div className="marketing-table-wrap"><table className="marketing-table"><thead><tr><th>المهمة</th><th>الحملة</th><th>المسؤول</th><th>الموعد</th><th>التقدم</th><th>الحالة</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.id} onClick={() => setParams((current) => { const next = new URLSearchParams(current); next.set("id", task.id); return next; })}><td><strong>{task.task_type === "content_template" ? "Task Template" : task.creative_type || task.department_code}</strong><small>{task.instance_code || task.pair_key?.slice(0, 10)}</small></td><td><strong>{task.campaign_name}</strong><small>{task.campaign_code}</small></td><td>{task.assigned_to_name || "—"}</td><td>{formatMarketingDate(task.due_at)}</td><td><div className="marketing-progress inline"><span><i style={{ width: `${task.progress_percent}%` }} /></span><b>{task.progress_percent}%</b></div></td><td><MarketingStatusBadge status={task.status} /></td></tr>)}</tbody></table></div> : <MarketingEmpty title="لا توجد مهام في هذا الفلتر" />}</section>
    {selected ? <div className="marketing-drawer-backdrop" onMouseDown={() => { setSelected(null); setParams((current) => { const next = new URLSearchParams(current); next.delete("id"); return next; }); }}><aside className="marketing-drawer wide" onMouseDown={(event) => event.stopPropagation()}><header><div><small>{selected.campaign_code} · {selected.instance_code}</small><h2>{selected.task_type === "content_template" ? "Task Template" : selected.creative_type || selected.department_code}</h2></div><button type="button" onClick={() => { setSelected(null); setParams((current) => { const next = new URLSearchParams(current); next.delete("id"); return next; }); }}><X size={20} /></button></header><div className="marketing-drawer-body">
      <div className="marketing-detail-grid"><article><span>الحملة</span><strong>{selected.campaign_name}</strong></article><article><span>المسؤول</span><strong>{selected.assigned_to_name || "—"}</strong></article><article><span>الموعد</span><strong>{formatMarketingDate(selected.due_at)}</strong></article><article><span>الحالة</span><MarketingStatusBadge status={selected.status} /></article></div>
      {selected.task_type === "content_template" ? <section><div className="marketing-subsection-title"><h3>إصدارات Task Template</h3><input ref={templateInput} hidden type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void submitTemplateFile(file); }} /><button type="button" disabled={uploading === "template"} onClick={() => templateInput.current?.click()}>{uploading === "template" ? <SpinnerGap className="marketing-spin" size={16} /> : <FileArrowUp size={16} />}{uploading === "template" ? "جاري الرفع" : "رفع نسخة"}</button></div><div className="marketing-mini-list">{selected.versions?.length ? selected.versions.map((version) => <article key={version.id}><div><strong>الإصدار {version.version_no}</strong><span>{version.original_file_name || "بدون ملف"} · {formatMarketingDate(version.submitted_at)}</span></div><button type="button" title="فتح الملف" onClick={() => void openTaskFile(String(version.id), true)}><DownloadSimple size={17} /></button></article>) : <MarketingEmpty title="لم يتم رفع Task Template" />}</div>{meta?.access.reviewTasks && selected.status === "template_submitted" ? <div className="marketing-inline-actions"><button className="marketing-button secondary" type="button" onClick={() => void review("changes_requested")}><NotePencil size={17} />طلب تعديل</button><button className="marketing-button" type="button" onClick={() => void review("approved")}><CheckCircle size={17} />اعتماد</button></div> : null}</section> : <>
        <section><div className="marketing-subsection-title"><h3>إجراءات التنفيذ</h3><span>{selected.progress_percent}%</span></div><div className="marketing-action-list">{selected.actions?.map((action) => <label key={action.id} className={action.status === "completed" ? "done" : ""}><input type="checkbox" checked={action.status === "completed"} onChange={(event) => void toggleAction(action.id, event.target.checked)} /><span><strong>{action.name}</strong><small>{action.weight}%{action.is_admin_only ? " · إجراء إداري" : ""}</small></span></label>)}</div></section>
        <section><div className="marketing-subsection-title"><h3>الملفات النهائية</h3><input ref={finalInput} hidden type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void addFinalFile(file); }} /><button type="button" disabled={uploading === "final"} onClick={() => finalInput.current?.click()}>{uploading === "final" ? <SpinnerGap className="marketing-spin" size={16} /> : <FileArrowUp size={16} />}{uploading === "final" ? "جاري الرفع" : "رفع ملف"}</button></div><div className="marketing-mini-list">{selected.files?.length ? selected.files.map((file) => <article key={file.id}><div><strong>{file.original_name}</strong><span>{file.mime_type || "ملف"} · {formatMarketingDate(file.created_at)}</span></div><button type="button" title="فتح الملف" onClick={() => void openTaskFile(file.id)}><DownloadSimple size={17} /></button></article>) : <MarketingEmpty title="لا يوجد ملف نهائي" />}</div></section>
      </>}
    </div><footer className="marketing-inline-actions">{selected.status === "ready" ? <button className="marketing-button" type="button" onClick={() => void transition("received")}><Play size={17} />استلام المهمة</button> : null}{selected.status === "received" ? <button className="marketing-button" type="button" onClick={() => void transition("in_progress")}><Play size={17} />بدء العمل</button> : null}{selected.status === "in_progress" ? <button className="marketing-button" type="button" onClick={() => void transition("under_review")}><CheckCircle size={17} />إرسال للمراجعة</button> : null}{meta?.access.reviewTasks && selected.status === "under_review" ? <button className="marketing-button" type="button" onClick={() => void transition("completed")}><CheckCircle size={17} />اعتماد وإنهاء</button> : null}{selected.task_type === "content_template" && selected.status === "template_approved" ? <button className="marketing-button" type="button" onClick={() => void transition("content_done")}><CheckCircle size={17} />تم الانتهاء</button> : null}</footer></aside></div> : null}
  </div>;
}
