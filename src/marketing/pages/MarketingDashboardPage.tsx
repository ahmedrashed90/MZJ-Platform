import { useEffect, useState } from "react";
import { CaretDown, CaretUp, CheckCircle, Eye, FileText, RocketLaunch, WarningCircle } from "@phosphor-icons/react";
import { marketingFetch, marketingPost } from "../api";
import { CampaignDetailModal } from "../components/CampaignDetailModal";
import { TaskDetailModal } from "../components/TaskDetailModal";
import { useMarketing } from "../MarketingContext";
import type { CampaignSummary, MarketingDashboard, MarketingTask } from "../types";

function Progress({ value }: { value: number }) {
  return <div className="marketing-progress"><span style={{ width: `${Math.max(0,Math.min(100,value))}%` }} /><b>{Math.round(value)}%</b></div>;
}

function TaskCard({ task, onOpen, onReceive }: { task: MarketingTask; onOpen: () => void; onReceive: () => void }) {
  const canReceive = !task.received_at && (task.task_kind === "template" || ["approved","completed"].includes(task.template_status || ""));
  return <article className="marketing-task-card">
    <header><div><strong>{task.instance_code} - {task.creative_name}</strong><small>{task.campaign_code}</small></div><span className={`marketing-status status-${task.status}`}>{task.status_label}</span></header>
    <Progress value={task.progress}/>
    <dl><div><dt>المسؤول</dt><dd>{task.assigned_name}</dd></div>{task.task_kind === "execution" ? <div><dt>كاتب المحتوى</dt><dd>{task.content_writer_name}</dd></div>:null}<div><dt>القسم</dt><dd>{task.department_name}</dd></div><div><dt>الموعد</dt><dd>{task.due_date || "—"}</dd></div></dl>
    <footer>{canReceive?<button type="button" className="receive" onClick={onReceive}><CheckCircle size={16}/>تم الاستلام</button>:null}<button type="button" onClick={onOpen}><Eye size={16}/>تفاصيل</button></footer>
  </article>;
}

function CampaignCard({ campaign, onOpen, onMove, canMove }: { campaign: CampaignSummary; onOpen: () => void; onMove?: () => void; canMove: boolean }) {
  const [open,setOpen]=useState(false);
  return <article className="marketing-readiness-card">
    <button type="button" className="marketing-readiness-head" onClick={()=>setOpen((value)=>!value)}><div><strong>{campaign.name}</strong><small>{campaign.campaign_code} · {Math.round(campaign.progress)}%</small></div><span>{campaign.tasks_count}</span>{open?<CaretUp size={18}/>:<CaretDown size={18}/>}</button>
    <Progress value={campaign.progress}/>
    {open?<div className="marketing-readiness-body"><div><span>الأقسام</span><b>{campaign.departments_count}</b></div><div><span>التاسكات</span><b>{campaign.tasks_count}</b></div><div><span>المستلمة</span><b>{campaign.received_count}</b></div><div><span>المكتملة</span><b>{campaign.completed_count}</b></div><button onClick={onOpen}><Eye size={16}/>عرض التفاصيل</button>{canMove&&campaign.progress>=100&&onMove?<button className="primary" onClick={onMove}><RocketLaunch size={16}/>نقل إلى قسم النشر</button>:null}</div>:null}
  </article>;
}

export function MarketingDashboardPage() {
  const { meta } = useMarketing();
  const [data,setData]=useState<MarketingDashboard|null>(null);
  const [error,setError]=useState("");
  const [openDepartment,setOpenDepartment]=useState<string|null>(null);
  const [taskId,setTaskId]=useState<string|null>(null);
  const [campaignId,setCampaignId]=useState<string|null>(null);

  const load=async()=>{setError("");try{setData(await marketingFetch<MarketingDashboard>("/api/marketing?action=dashboard"));}catch(loadError){setError(loadError instanceof Error?loadError.message:"تعذر تحميل لوحة التحكم");}};
  useEffect(()=>{void load();},[]);
  const receive=async(taskIdValue:string)=>{try{await marketingPost({action:"receive_task",taskId:taskIdValue});await load();}catch(actionError){setError(actionError instanceof Error?actionError.message:"تعذر تسجيل الاستلام");}};
  const move=async(campaignIdValue:string)=>{try{await marketingPost({action:"campaign_action",campaignId:campaignIdValue,campaignAction:"move_publish"});await load();}catch(actionError){setError(actionError instanceof Error?actionError.message:"تعذر نقل الحملة");}};

  return <div className="marketing-page marketing-dashboard-page">
    <header className="marketing-page-title"><div><h2>لوحة التحكم</h2><p>متابعة المطلوب وجاهزية الحملات وقسم النشر حسب صلاحيات المستخدم.</p></div></header>
    {error?<div className="marketing-error"><WarningCircle size={18}/>{error}</div>:null}
    {!data?<div className="marketing-loading">جاري تحميل التاسكات...</div>:<>
      <section className="marketing-dashboard-section"><header><div><FileText size={23}/><div><h3>TASK - المطلوب</h3><p>عرض التاسكات المسندة حسب القسم.</p></div></div><span>{data.pendingGroups.reduce((sum,group)=>sum+group.tasks.length,0)}</span></header>
        <div className="marketing-department-accordions">{data.pendingGroups.map((group)=><article key={group.departmentName}><button onClick={()=>setOpenDepartment(openDepartment===group.departmentName?null:group.departmentName)}><strong>{group.departmentName}</strong><span>{group.tasks.length}</span>{openDepartment===group.departmentName?<CaretUp/>:<CaretDown/>}</button>{openDepartment===group.departmentName?<div className="marketing-task-grid">{group.tasks.map((task)=><TaskCard key={task.id} task={task} onOpen={()=>setTaskId(task.id)} onReceive={()=>void receive(task.id)}/>)}</div>:null}</article>)}</div>
        {!data.pendingGroups.length?<div className="marketing-empty">لا توجد تاسكات مطلوبة حاليًا.</div>:null}
      </section>

      {meta?.permissions.reviewTemplates && data.reviewTasks.length?<section className="marketing-dashboard-section review"><header><div><WarningCircle size={23}/><div><h3>مراجعة Task Template</h3><p>نسخ رفعها كتاب المحتوى وتحتاج اعتمادًا أو طلب تعديل أو رفض.</p></div></div><span>{data.reviewTasks.length}</span></header><div className="marketing-task-grid">{data.reviewTasks.map((task)=><TaskCard key={task.id} task={task} onOpen={()=>setTaskId(task.id)} onReceive={()=>setTaskId(task.id)}/>)}</div></section>:null}

      <section className="marketing-dashboard-section"><header><div><CheckCircle size={23}/><div><h3>جاهزية المطلوب</h3><p>الحملات والأجندات التي بدأ تنفيذ تاسكاتها.</p></div></div><span>{data.readiness.length}</span></header><div className="marketing-readiness-grid">{data.readiness.map((campaign)=><CampaignCard key={campaign.id} campaign={campaign} onOpen={()=>setCampaignId(campaign.id)} canMove={Boolean(meta?.permissions.manageCampaigns)} onMove={()=>void move(campaign.id)}/>)}</div>{!data.readiness.length?<div className="marketing-empty">لا توجد حملات داخل جاهزية المطلوب.</div>:null}</section>

      <section className="marketing-dashboard-section publish"><header><div><RocketLaunch size={23}/><div><h3>قسم النشر</h3><p>الحملات المنقولة فعليًا بعد اكتمالها 100%.</p></div></div><span>{data.publishing.length}</span></header><div className="marketing-readiness-grid">{data.publishing.map((campaign)=><CampaignCard key={campaign.id} campaign={campaign} onOpen={()=>setCampaignId(campaign.id)} canMove={false}/>)}</div>{!data.publishing.length?<div className="marketing-empty">لا توجد حملات في قسم النشر.</div>:null}</section>
    </>}
    <TaskDetailModal taskId={taskId} onClose={()=>setTaskId(null)} onChanged={()=>void load()}/>
    <CampaignDetailModal campaignId={campaignId} onClose={()=>setCampaignId(null)} onChanged={()=>void load()}/>
  </div>;
}
