import { useEffect, useMemo, useState } from "react";
import { CheckCircle, DownloadSimple, FileArrowUp, FloppyDisk, SealCheck, WarningCircle, XCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { exportXlsx } from "../../operations/excel";
import { formatMarketingDate, marketingFetch, marketingPost, marketingQuery, openMarketingFile, parseTaskTemplateFile, uploadMarketingFile } from "../api";
import { useMarketing } from "../MarketingContext";
import type { TaskDetailResponse } from "../types";

function value(record: Record<string, unknown> | null | undefined, key: string) {
  return String(record?.[key] ?? "").trim();
}

export function TaskDetailModal({ taskId, onClose, onChanged }: { taskId: string | null; onClose: () => void; onChanged: () => void }) {
  const { meta } = useMarketing();
  const [data, setData] = useState<TaskDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");

  const load = async () => {
    if (!taskId) return;
    setLoading(true); setError("");
    try {
      setData(await marketingFetch<TaskDetailResponse>(`/api/marketing${marketingQuery({ action: "task_detail", id: taskId })}`));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل التاسك");
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [taskId]);

  const templateData = useMemo(() => {
    const raw = data?.approvedTemplate?.parsed_data;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  }, [data]);

  const act = async (body: Record<string, unknown>) => {
    setWorking(true); setError("");
    try { await marketingPost(body); await load(); onChanged(); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "تعذر تنفيذ الإجراء"); }
    finally { setWorking(false); }
  };

  const downloadTemplate = () => {
    if (!data) return;
    exportXlsx(
      `${data.task.task_no}-Task-Template.xlsx`,
      ["الاسم المقترح للكرييتيف", "الهدف", "الرسالة الأساسية", "الصوت", "CTA", "رقم المشهد", "عنوان المشهد", "شرح المشهد", "الفويس أوفر", "التكست", "السكريبت الأساسي", "Hook", "الكابشن", "الهاشتاج"],
      [["", "", "", "", "", "1", "", "", "", "", "", "", "", ""]],
      "Task Template",
    );
  };

  const uploadTemplate = async (file: File) => {
    if (!data) return;
    setWorking(true); setError("");
    try {
      const parsedData = await parseTaskTemplateFile(file);
      const fileId = await uploadMarketingFile("task", data.task.id, file, { fileKind: "task_template" });
      await marketingPost({ action: "submit_template", taskId: data.task.id, fileId, parsedData });
      await load(); onChanged();
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "تعذر رفع Task Template"); }
    finally { setWorking(false); }
  };

  const uploadFinal = async (file: File) => {
    if (!data) return;
    setWorking(true); setError("");
    try {
      const fileId = await uploadMarketingFile("task", data.task.id, file, { fileKind: "final_output" });
      await marketingPost({ action: "attach_final_file", taskId: data.task.id, fileId });
      await load(); onChanged();
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "تعذر رفع الملف النهائي"); }
    finally { setWorking(false); }
  };

  const canReceive = Boolean(data && !data.task.received_at && (data.task.task_kind === "template" || ["approved", "completed"].includes(data.task.template_status || "")));
  const canReview = Boolean(meta?.permissions.reviewTemplates && data?.task.task_kind === "template" && data.task.status === "template_review");
  const canUploadTemplate = Boolean(data?.task.task_kind === "template" && ["active", "revision_requested", "waiting_receipt"].includes(data.task.status));
  const canExecute = Boolean(data?.task.task_kind === "execution" && data.task.received_at);

  return (
    <Modal open={Boolean(taskId)} title={data ? `${data.task.task_kind === "template" ? "Task Template" : "تنفيذ"} - ${data.task.department_name}` : "تفاصيل التاسك"} subtitle={data?.task.task_no} onClose={onClose} className="marketing-task-modal">
      {loading ? <div className="marketing-loading">جاري تحميل التفاصيل...</div> : null}
      {error ? <div className="marketing-error"><WarningCircle size={18} />{error}</div> : null}
      {data ? <div className="marketing-task-detail">
        <section className="marketing-detail-grid">
          <div><span>الحملة / الأجندة</span><strong>{data.task.campaign_name}</strong><small>{data.task.campaign_code}</small></div>
          <div><span>نوع المصدر</span><strong>{data.task.source_kind === "agenda" ? "أجندة" : "حملة"}</strong></div>
          <div><span>الكرييتيف</span><strong>{data.task.instance_code} - {data.task.creative_name}</strong></div>
          <div><span>المسؤول</span><strong>{data.task.assigned_name}</strong></div>
          <div><span>كاتب المحتوى المرتبط</span><strong>{data.task.content_writer_name}</strong></div>
          <div><span>موعد التسليم</span><strong>{formatMarketingDate(data.task.due_date)}</strong></div>
          <div><span>تاريخ الاستلام الفعلي</span><strong>{formatMarketingDate(data.task.received_at, true)}</strong></div>
          <div><span>الحالة</span><strong>{data.task.status_label}</strong><small>{Math.round(data.task.progress)}%</small></div>
        </section>

        <section className="marketing-detail-panel">
          <h3>السيارات</h3>
          <div className="marketing-chip-list">{data.vehicles.length ? data.vehicles.map((vehicle) => <span key={value(vehicle,"id")}>{value(vehicle,"vin")} — {value(vehicle,"car_name")} — {value(vehicle,"statement")}</span>) : <em>لا توجد سيارات مختارة</em>}</div>
        </section>

        {templateData ? <section className="marketing-detail-panel">
          <h3>بيانات Task Template المعتمدة</h3>
          <div className="marketing-template-data-grid">
            {[['proposedName','الاسم المقترح للكرييتيف'],['objective','الهدف'],['mainMessage','الرسالة الأساسية'],['sound','الصوت'],['cta','CTA'],['script','السكريبت'],['hook','الهوك'],['caption','الكابشن'],['hashtags','الهاشتاج']].map(([key,label]) => <div key={key}><span>{label}</span><strong>{value(templateData,key) || "—"}</strong></div>)}
          </div>
          {Array.isArray(templateData.scenes) ? <div className="marketing-scenes-grid">{templateData.scenes.filter((scene): scene is Record<string, unknown> => Boolean(scene) && typeof scene === "object" && !Array.isArray(scene)).map((scene,index) => <article key={index}><b>{value(scene,"number") || index+1}</b><h4>{value(scene,"title") || "مشهد"}</h4><p>{value(scene,"description") || "—"}</p><small>الفويس أوفر: {value(scene,"voiceOver") || "—"}</small><small>التكست: {value(scene,"text") || "—"}</small></article>)}</div> : null}
        </section> : data.task.task_kind === "execution" ? <div className="marketing-warning">التاسك في انتظار اعتماد Task Template المرتبطة بكاتب المحتوى المحدد.</div> : null}

        <section className="marketing-detail-panel">
          <h3>إجراءات التكليف</h3>
          <div className="marketing-actions-list">{data.actions.map((action) => <label key={action.id} className={action.completed ? "done" : ""}>
            <input type="checkbox" checked={Boolean(action.completed)} disabled={working || !canExecute || (action.admin_only && !meta?.permissions.reviewTemplates)} onChange={(event) => void act({ action: "task_action", taskId: data.task.id, actionId: action.id, completed: event.target.checked })} />
            <span>{action.name}</span><b>{action.progress_weight}%</b>{action.admin_only ? <small>أدمن فقط</small> : null}
          </label>)}</div>
        </section>

        <section className="marketing-detail-panel">
          <h3>الملفات والنسخ</h3>
          <div className="marketing-file-list">{data.files.length ? data.files.map((file) => <button key={value(file,"id")} type="button" onClick={() => void openMarketingFile(value(file,"id"))}><DownloadSimple size={17}/><span>{value(file,"original_name")}</span><small>{formatMarketingDate(value(file,"created_at"),true)}</small></button>) : <em>لا توجد ملفات مرفوعة</em>}</div>
          {data.submissions.length ? <div className="marketing-submissions">{data.submissions.map((submission) => <article key={value(submission,"id")}><strong>النسخة {value(submission,"revision_no")}</strong><span>{value(submission,"status")}</span><button type="button" onClick={() => void openMarketingFile(value(submission,"file_id"))}>فتح الملف</button><p>{value(submission,"review_notes")}</p></article>)}</div> : null}
        </section>

        <div className="marketing-task-buttons">
          {canReceive ? <button disabled={working} type="button" className="primary" onClick={() => void act({ action: "receive_task", taskId: data.task.id })}><CheckCircle size={18}/>تم الاستلام</button> : null}
          {data.task.task_kind === "template" ? <button type="button" onClick={downloadTemplate}><DownloadSimple size={18}/>تحميل Task Template</button> : null}
          {canUploadTemplate ? <label className="marketing-upload-button"><FileArrowUp size={18}/><span>إرفاق Task Template Excel</span><input type="file" accept=".xlsx,.xls,.csv" disabled={working} onChange={(event) => { const file=event.target.files?.[0]; if(file) void uploadTemplate(file); event.currentTarget.value=""; }} /></label> : null}
          {data.task.task_kind === "execution" && canExecute ? <label className="marketing-upload-button"><FloppyDisk size={18}/><span>رفع الملف النهائي</span><input type="file" disabled={working} onChange={(event) => { const file=event.target.files?.[0]; if(file) void uploadFinal(file); event.currentTarget.value=""; }} /></label> : null}
        </div>

        {canReview ? <section className="marketing-review-box">
          <h3>مراجعة Task Template</h3>
          <textarea value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} placeholder="ملاحظات مدير النظام" />
          <div><button disabled={working} className="approve" onClick={() => void act({ action:"review_template",taskId:data.task.id,reviewAction:"approve",notes:reviewNotes })}><SealCheck size={18}/>اعتماد</button><button disabled={working} className="revision" onClick={() => void act({ action:"review_template",taskId:data.task.id,reviewAction:"request_revision",notes:reviewNotes })}><WarningCircle size={18}/>طلب تعديل</button><button disabled={working} className="reject" onClick={() => void act({ action:"review_template",taskId:data.task.id,reviewAction:"reject",notes:reviewNotes })}><XCircle size={18}/>رفض</button></div>
        </section> : null}
      </div> : null}
    </Modal>
  );
}
