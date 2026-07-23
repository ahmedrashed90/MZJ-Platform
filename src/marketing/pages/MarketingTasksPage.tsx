import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { CheckCircle, Clock, FileArrowUp, NotePencil, PaperPlaneTilt, Plus, WarningCircle, XCircle } from "@phosphor-icons/react";
import { marketingFetch, marketingMutation } from "../api";
import type { MarketingTask } from "../types";
import type { MarketingOutletContext } from "../MarketingLayout";
import { copyText, formatMarketingDate, statusTone, toLocalInput } from "../utils";

const blankTemplate = { proposedName: "", keyMessage: "", baseScript: "", hook: "", cta: "" };

export function MarketingTasksPage() {
  const { meta } = useOutletContext<MarketingOutletContext>();
  const [params] = useSearchParams();
  const campaignId = params.get("campaignId") || "";
  const [rows, setRows] = useState<MarketingTask[]>([]);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [forms, setForms] = useState<Record<string, any>>({});

  const canSeeAll = meta.access.isAdmin || meta.access.canApproveTasks || meta.access.canApproveTemplates;
  async function load() {
    setError("");
    try {
      const payload = await marketingFetch<{ ok: true; rows: MarketingTask[] }>(`/api/marketing?resource=tasks&all=${canSeeAll}&campaignId=${encodeURIComponent(campaignId)}&status=${encodeURIComponent(status)}&type=${encodeURIComponent(type)}`);
      setRows(payload.rows);
      setForms((current) => {
        const next = { ...current };
        for (const task of payload.rows) {
          next[task.id] ||= task.task_type === "task_template"
            ? { ...blankTemplate, ...(task.template_data || {}), notes: task.notes || "" }
            : { finalFilePath: task.final_file_path || task.output_path || "", finalFileName: task.final_file_name || "", notes: task.notes || "", dueAt: toLocalInput(task.due_at), actionText: "" };
        }
        return next;
      });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل التاسكات"); }
  }
  useEffect(() => { void load(); }, [status, type, campaignId]);
  const groups = useMemo(() => rows.reduce<Record<string, MarketingTask[]>>((acc, row) => { (acc[row.campaign_name || "حملة"] ||= []).push(row); return acc; }, {}), [rows]);

  function patch(taskId: string, key: string, value: string) { setForms((current) => ({ ...current, [taskId]: { ...(current[taskId] || {}), [key]: value } })); }
  async function submit(task: MarketingTask, action: string) {
    setBusy(task.id + action); setError(""); setMessage("");
    const form = forms[task.id] || {};
    const payload: any = { taskId: task.id, action, notes: form.notes };
    if (action.includes("template") || action === "save_template") payload.templateData = { proposedName: form.proposedName, keyMessage: form.keyMessage, baseScript: form.baseScript, hook: form.hook, cta: form.cta };
    if (action === "submit_execution") Object.assign(payload, { finalFilePath: form.finalFilePath, finalFileName: form.finalFileName });
    if (action === "set_due") payload.dueAt = form.dueAt;
    if (action === "add_action") payload.actionText = form.actionText;
    try { await marketingMutation("tasks", "PUT", payload); setMessage("تم تحديث التاسك بنجاح"); await load(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحديث التاسك"); }
    finally { setBusy(""); }
  }

  return <div className="module-page marketing-page">
    <header className="module-page-head"><div><h1>تاسكات التسويق</h1><p>Task Template والتنفيذ والاعتمادات حسب ارتباط كل كرييتيف.</p></div></header>
    <section className="panel marketing-toolbar"><select value={type} onChange={(e)=>setType(e.target.value)}><option value="">كل الأنواع</option><option value="task_template">Task Template</option><option value="execution">تنفيذ</option></select><select value={status} onChange={(e)=>setStatus(e.target.value)}><option value="">كل الحالات</option><option>في انتظار Task Template</option><option>في انتظار الاعتماد</option><option>مطلوب تعديل</option><option>جاهز للتنفيذ</option><option>تم الاستلام</option><option>تاسك معتمد</option></select></section>
    {error?<div className="connection-banner"><WarningCircle size={20}/><span>{error}</span></div>:null}{message?<div className="success-banner">{message}</div>:null}
    <div className="marketing-task-groups">{Object.entries(groups).map(([campaign,tasks])=><section key={campaign} className="panel marketing-task-group"><header><div><h2>{campaign}</h2><p>{tasks[0]?.campaign_code}</p></div><span>{tasks.length} تاسك</span></header><div className="marketing-task-card-list">{tasks.map((task)=>{
      const form=forms[task.id]||{}; const template=task.task_type==='task_template';
      return <article key={task.id} className="marketing-task-card"><header><div><span>{task.creative_name}</span><h3>{task.title}</h3><small>{meta.departmentLabels[task.department_code]||task.department_code} · {task.assigned_to_name||'بدون مسؤول'}</small></div><em className={`marketing-status ${statusTone(task.status)}`}>{task.status}</em></header>
        <div className="marketing-task-dates"><span><Clock size={15}/>موعد التسليم: {formatMarketingDate(task.due_at,true)}</span>{task.paired_content_user_name?<span>كاتب المحتوى المرتبط: {task.paired_content_user_name}</span>:null}</div>
        {template?<div className="marketing-template-form"><label><span>الاسم المقترح</span><input value={form.proposedName||''} onChange={(e)=>patch(task.id,'proposedName',e.target.value)}/></label><label><span>الرسالة الأساسية</span><textarea value={form.keyMessage||''} onChange={(e)=>patch(task.id,'keyMessage',e.target.value)}/></label><label className="wide"><span>السكريبت الأساسي</span><textarea rows={5} value={form.baseScript||''} onChange={(e)=>patch(task.id,'baseScript',e.target.value)}/></label><label><span>Hook</span><textarea value={form.hook||''} onChange={(e)=>patch(task.id,'hook',e.target.value)}/></label><label><span>CTA</span><textarea value={form.cta||''} onChange={(e)=>patch(task.id,'cta',e.target.value)}/></label></div>:<div className="marketing-execution-form"><div className="marketing-path-pair"><span><code>{task.raw_path||'—'}</code>{task.raw_path?<button onClick={()=>void copyText(task.raw_path!)}>نسخ الخام</button>:null}</span><span><code>{task.output_path||'—'}</code>{task.output_path?<button onClick={()=>void copyText(task.output_path!)}>نسخ التسليم</button>:null}</span></div>{(meta.access.canApproveTasks||meta.access.canManageCampaigns)&&['جاهز للتنفيذ','مطلوب تعديل'].includes(task.status)?<label><span>موعد التنفيذ بعد اعتماد المحتوى</span><input type="datetime-local" value={form.dueAt||''} onChange={(e)=>patch(task.id,'dueAt',e.target.value)}/><button onClick={()=>void submit(task,'set_due')}>حفظ الموعد</button></label>:null}<label><span>مسار أو رابط الملف النهائي</span><input value={form.finalFilePath||''} onChange={(e)=>patch(task.id,'finalFilePath',e.target.value)}/></label><label><span>اسم الملف</span><input value={form.finalFileName||''} onChange={(e)=>patch(task.id,'finalFileName',e.target.value)}/></label><label className="wide"><span>إضافة خطوة تنفيذ</span><div><input value={form.actionText||''} onChange={(e)=>patch(task.id,'actionText',e.target.value)} placeholder="اكتب الخطوة المنفذة"/><button onClick={()=>void submit(task,'add_action')}><Plus size={15}/>إضافة</button></div></label>{task.action_data?.length?<div className="marketing-actions-timeline">{task.action_data.map((item,index)=><span key={index}><b>{item.userName}</b>{item.text}<small>{formatMarketingDate(item.at,true)}</small></span>)}</div>:null}</div>}
        <label className="marketing-task-notes"><span>ملاحظات</span><textarea value={form.notes||''} onChange={(e)=>patch(task.id,'notes',e.target.value)}/></label>
        <footer>{template?<>{task.status!=='تاسك معتمد'?<button disabled={Boolean(busy)} onClick={()=>void submit(task,'save_template')}><NotePencil size={16}/>حفظ</button>:null}{task.status!=='تاسك معتمد'?<button className="primary" disabled={Boolean(busy)} onClick={()=>void submit(task,'submit_template')}><PaperPlaneTilt size={16}/>إرسال للاعتماد</button>:null}{meta.access.canApproveTemplates&&task.status==='في انتظار الاعتماد'?<><button className="success" onClick={()=>void submit(task,'approve_template')}><CheckCircle size={16}/>اعتماد</button><button className="danger" onClick={()=>void submit(task,'reject_template')}><XCircle size={16}/>إعادة للتعديل</button></>:null}</>:<>{['جاهز للتنفيذ','مطلوب تعديل'].includes(task.status)?<button className="primary" onClick={()=>void submit(task,'submit_execution')}><FileArrowUp size={16}/>رفع التسليم النهائي</button>:null}{meta.access.canApproveTasks&&task.status==='في انتظار الاعتماد'?<><button className="success" onClick={()=>void submit(task,'approve_execution')}><CheckCircle size={16}/>اعتماد الاستلام</button><button className="danger" onClick={()=>void submit(task,'reject_execution')}><XCircle size={16}/>إعادة للتعديل</button></>:null}</>}</footer>
      </article>})}</div></section>)}{rows.length===0?<div className="marketing-empty panel">لا توجد تاسكات مطابقة.</div>:null}</div>
  </div>;
}
