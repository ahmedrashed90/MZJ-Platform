import { useEffect, useMemo, useState } from "react";
import { Archive, DownloadSimple, FileArrowUp, FolderOpen, LinkSimple, Printer, RocketLaunch, Trash } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { exportXlsx } from "../../operations/excel";
import { formatMarketingDate, marketingFetch, marketingPost, marketingQuery, openMarketingFile, uploadMarketingFile } from "../api";
import { useMarketing } from "../MarketingContext";
import type { CampaignDetailResponse } from "../types";

function text(record: Record<string, unknown> | undefined, key: string) { return String(record?.[key] ?? "").trim(); }
function number(record: Record<string, unknown> | undefined, key: string) { return Number(record?.[key] ?? 0) || 0; }

export function CampaignDetailModal({ campaignId, onClose, onChanged }: { campaignId: string | null; onClose: () => void; onChanged: () => void }) {
  const { meta } = useMarketing();
  const [data, setData] = useState<CampaignDetailResponse | null>(null);
  const [tab, setTab] = useState<"overview"|"tasks"|"schedule"|"budget"|"files">("overview");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [platformId, setPlatformId] = useState("");
  const [url, setUrl] = useState("");

  const load = async () => {
    if (!campaignId) return;
    setError("");
    try { setData(await marketingFetch<CampaignDetailResponse>(`/api/marketing${marketingQuery({ action:"campaign_detail",id:campaignId })}`)); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "تعذر تحميل بيانات الحملة"); }
  };
  useEffect(() => { setData(null); setTab("overview"); void load(); }, [campaignId]);

  const instanceById = useMemo(() => new Map((data?.instances || []).map((item) => [text(item,"id"),item])), [data]);
  const totalBudget = useMemo(() => (data?.budgetPlatforms || []).reduce((sum,row) => sum + number(row,"amount"),0), [data]);

  const action = async (body: Record<string, unknown>) => {
    setWorking(true); setError("");
    try { await marketingPost(body); await load(); onChanged(); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "تعذر تنفيذ الإجراء"); }
    finally { setWorking(false); }
  };

  const exportSchedule = () => {
    if (!data) return;
    const rows = data.schedule.flatMap((item) => {
      const related = data.schedulePlatforms.filter((platform) => text(platform,"schedule_item_id") === text(item,"id"));
      return related.length ? related.map((platform) => [text(item,"publish_date"),`${text(item,"instance_code")} - ${text(item,"creative_name")}`,text(platform,"platform_name"),text(platform,"publish_type_name"),text(platform,"dimensions")]) : [[text(item,"publish_date"),`${text(item,"instance_code")} - ${text(item,"creative_name")}`,"—","—","—"]];
    });
    exportXlsx(`${data.campaign.campaign_code}-publish-schedule.xlsx`,["التاريخ","الكرييتيف","المنصة","نوع النشر","الأبعاد"],rows,"جدول النشر");
  };

  const exportReview = () => {
    if (!data) return;
    exportXlsx(`${data.campaign.campaign_code}-review.xlsx`,["رقم التاسك","النوع","الكرييتيف","القسم","المسؤول","كاتب المحتوى","الحالة","التقدم","موعد التسليم","تاريخ الاستلام"],data.tasks.map((task) => [task.task_no,task.task_kind,`${task.instance_code} - ${task.creative_name}`,task.department_name,task.assigned_name,task.content_writer_name,task.status_label,`${task.progress}%`,task.due_date || "",task.received_at || ""]),"مراجعة الحملة");
  };

  const uploadResult = async (file: File) => {
    if (!data) return;
    setWorking(true); setError("");
    try { const fileId=await uploadMarketingFile("campaign",data.campaign.id,file,{fileKind:"campaign_result"}); await marketingPost({action:"attach_campaign_file",campaignId:data.campaign.id,fileId,fileKind:"result"}); await load(); onChanged(); }
    catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "تعذر رفع ملف النتائج"); }
    finally { setWorking(false); }
  };

  return <Modal open={Boolean(campaignId)} title={data?.campaign.name || "عرض بيانات الحملة"} subtitle={data?.campaign.campaign_code} onClose={onClose} className="marketing-campaign-modal">
    {error ? <div className="marketing-error">{error}</div> : null}
    {!data ? <div className="marketing-loading">جاري تحميل بيانات الحملة...</div> : <div className="marketing-campaign-detail">
      <div className="marketing-detail-toolbar">
        <button type="button" onClick={onClose}>إغلاق</button>
        <button type="button" onClick={() => window.print()}><Printer size={17}/>تصدير PDF</button>
        <button type="button" onClick={exportSchedule}><DownloadSimple size={17}/>تصدير جدول النشر</button>
        <button type="button" onClick={exportReview}><DownloadSimple size={17}/>تصدير مراجعة Excel</button>
        <button type="button" onClick={() => setTab("files")}><FolderOpen size={17}/>عرض ملفات المنتجات</button>
      </div>
      <nav className="marketing-detail-tabs">
        <button className={tab==="overview"?"active":""} onClick={() => setTab("overview")}>بيانات كاملة</button>
        <button className={tab==="tasks"?"active":""} onClick={() => setTab("tasks")}>التاسكات واليوزرات</button>
        <button className={tab==="schedule"?"active":""} onClick={() => setTab("schedule")}>جدول النشر</button>
        <button className={tab==="budget"?"active":""} onClick={() => setTab("budget")}>الميزانية</button>
        <button className={tab==="files"?"active":""} onClick={() => setTab("files")}>الملفات والنتائج</button>
      </nav>

      {tab === "overview" ? <>
        <section className="marketing-detail-panel"><h3>بيانات الحملة كاملة</h3><div className="marketing-detail-grid">
          <div><span>تاريخ الحملة</span><strong>{formatMarketingDate(data.campaign.campaign_date)}</strong></div><div><span>اسم الحملة</span><strong>{data.campaign.name}</strong></div><div><span>كود الحملة</span><strong>{data.campaign.campaign_code}</strong></div><div><span>نوع الحملة</span><strong>{data.campaign.campaign_type || (data.campaign.source_kind==="agenda"?"أجندة":"—")}</strong></div><div><span>هدف الحملة</span><strong>{data.campaign.objective || "—"}</strong></div><div><span>بداية النشر</span><strong>{formatMarketingDate(data.campaign.publish_start)}</strong></div><div><span>نهاية النشر</span><strong>{formatMarketingDate(data.campaign.publish_end)}</strong></div><div><span>المطلوب من كاتب المحتوى</span><strong>{data.campaign.content_request || "—"}</strong></div><div><span>عدد التاسكات</span><strong>{data.campaign.tasks_count}</strong></div><div><span>التاسكات المستلمة</span><strong>{data.campaign.received_count}</strong></div><div><span>التاسكات المكتملة</span><strong>{data.campaign.completed_count}</strong></div><div><span>آخر تحديث</span><strong>{formatMarketingDate(data.campaign.updated_at,true)}</strong></div>
        </div></section>
        <section className="marketing-detail-panel"><h3>الكرييتيفات وتوزيع اليوزرات والسيارات</h3><div className="marketing-instance-table"><table><thead><tr><th>الكرييتيف</th><th>المحتوى</th><th>القسم الأساسي والاختياري</th><th>السيارات</th><th>المنصات</th></tr></thead><tbody>{data.instances.map((instance) => {
          const id=text(instance,"id"); const content=data.contentUsers.filter((item)=>text(item,"creative_instance_id")===id); const sections=data.sections.filter((item)=>text(item,"creative_instance_id")===id); const cars=data.vehicles.filter((item)=>text(item,"creative_instance_id")===id); const platforms=data.instancePlatforms.filter((item)=>text(item,"creative_instance_id")===id);
          return <tr key={id}><td><strong>{text(instance,"instance_code")} - {text(instance,"creative_name")}</strong><small>{text(instance,"short_code")}</small></td><td>{content.map((item)=>text(item,"full_name")).join("، ")||"—"}</td><td>{sections.map((section)=>`${text(section,"department_name")}: ${data.sectionUsers.filter((item)=>text(item,"instance_section_id")===text(section,"id")).map((item)=>text(item,"full_name")).join("، ")}`).join(" | ")||"—"}</td><td>{cars.map((car)=>`${text(car,"vin")} ${text(car,"car_name")}`).join("، ")||"—"}</td><td>{platforms.map((p)=>text(p,"platform_name")).join("، ")||"—"}</td></tr>;
        })}</tbody></table></div></section>
      </> : null}

      {tab === "tasks" ? <section className="marketing-detail-panel"><h3>التاسكات التنفيذية واليوزرات</h3><div className="marketing-instance-table"><table><thead><tr><th>التاسك</th><th>اليوزر</th><th>كاتب المحتوى</th><th>القسم</th><th>الحالة</th><th>التقدم</th><th>المطلوب</th><th>الاستلام</th></tr></thead><tbody>{data.tasks.map((task)=><tr key={task.id}><td><strong>{task.task_no}</strong><small>{task.instance_code} - {task.creative_name}</small></td><td>{task.assigned_name}</td><td>{task.content_writer_name}</td><td>{task.department_name}</td><td>{task.status_label}</td><td>{Math.round(task.progress)}%</td><td>{formatMarketingDate(task.due_date)}</td><td>{formatMarketingDate(task.received_at,true)}</td></tr>)}</tbody></table></div></section> : null}

      {tab === "schedule" ? <section className="marketing-detail-panel"><h3>عرض جدول النشر</h3><div className="marketing-instance-table"><table><thead><tr><th>التاريخ</th><th>الكرييتيف</th><th>المنصة</th><th>أنواع النشر</th></tr></thead><tbody>{data.schedule.map((item) => {
        const related=data.schedulePlatforms.filter((p)=>text(p,"schedule_item_id")===text(item,"id")); return <tr key={text(item,"id")}><td>{formatMarketingDate(text(item,"publish_date"))}</td><td>{text(item,"instance_code")} - {text(item,"creative_name")}</td><td>{[...new Set(related.map((p)=>text(p,"platform_name")))].join("، ")||"—"}</td><td>{related.map((p)=>`${text(p,"publish_type_name")} ${text(p,"dimensions")}`).join("، ")||"—"}</td></tr>;
      })}</tbody></table></div></section> : null}

      {tab === "budget" ? <section className="marketing-detail-panel"><h3>عرض الميزانية</h3><div className="marketing-instance-table"><table><thead><tr><th>Funnel</th><th>الكرييتيف</th><th>المنصة</th><th>قيمة المنصة</th></tr></thead><tbody>{data.budgets.flatMap((item)=>{const platforms=data.budgetPlatforms.filter((p)=>text(p,"budget_item_id")===text(item,"id"));return platforms.length?platforms.map((p)=><tr key={`${text(item,"id")}-${text(p,"platform_id")}`}><td>{text(item,"funnel")}</td><td>{text(item,"instance_code")} - {text(item,"creative_name")}</td><td>{text(p,"platform_name")}</td><td>{number(p,"amount").toLocaleString("ar-SA")} ر.س</td></tr>):[<tr key={text(item,"id")}><td>{text(item,"funnel")}</td><td>{text(item,"instance_code")} - {text(item,"creative_name")}</td><td>—</td><td>0 ر.س</td></tr>]})}</tbody><tfoot><tr><th colSpan={3}>إجمالي ميزانية الحملة</th><th>{totalBudget.toLocaleString("ar-SA")} ر.س</th></tr></tfoot></table></div></section> : null}

      {tab === "files" ? <div className="marketing-files-grid">
        <section className="marketing-detail-panel"><h3>عرض ملفات المنتجات</h3><div className="marketing-file-list">{data.tasks.filter((task)=>task.final_file_id).map((task)=><button key={task.id} onClick={()=>void openMarketingFile(task.final_file_id || "")}><FolderOpen size={18}/><span>{task.department_name} — {task.instance_code} - {task.creative_name}</span><small>{task.assigned_name} / {task.content_writer_name}</small></button>)}{!data.tasks.some((task)=>task.final_file_id)?<em>لا توجد ملفات نهائية مرفوعة</em>:null}</div></section>
        <section className="marketing-detail-panel"><h3>نتائج الحملة</h3><div className="marketing-file-list">{data.files.filter((file)=>text(file,"owner_type")==="campaign").map((file)=><button key={text(file,"id")} onClick={()=>void openMarketingFile(text(file,"id"))}><DownloadSimple size={18}/><span>{text(file,"original_name")}</span></button>)}</div><label className="marketing-upload-button"><FileArrowUp size={18}/><span>رفع ملف النتائج</span><input type="file" disabled={working} onChange={(event)=>{const file=event.target.files?.[0];if(file)void uploadResult(file);event.currentTarget.value="";}}/></label></section>
        <section className="marketing-detail-panel"><h3>روابط الحملة</h3><div className="marketing-file-list">{data.links.map((link)=><a key={text(link,"id")} href={text(link,"url")} target="_blank" rel="noreferrer"><LinkSimple size={18}/><span>{text(link,"platform_name")}</span><small>{text(link,"url")}</small></a>)}</div><div className="marketing-link-form"><select value={platformId} onChange={(event)=>setPlatformId(event.target.value)}><option value="">اختر المنصة</option>{meta?.platforms.filter((p)=>p.is_active).map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select><input value={url} onChange={(event)=>setUrl(event.target.value)} placeholder="رابط المنصة"/><button disabled={!platformId||!url||working} onClick={()=>void action({action:"add_campaign_link",campaignId:data.campaign.id,platformId,url})}>إضافة منصة ورابط</button></div></section>
      </div> : null}

      {meta?.permissions.manageCampaigns ? <div className="marketing-admin-actions">
        {data.campaign.progress >= 100 && data.campaign.status !== "publish" ? <button className="primary" disabled={working} onClick={()=>void action({action:"campaign_action",campaignId:data.campaign.id,campaignAction:"move_publish"})}><RocketLaunch size={18}/>نقل الحملة إلى قسم النشر</button>:null}
        <button disabled={working} onClick={()=>void action({action:"create_raw_folders",campaignId:data.campaign.id})}><FolderOpen size={18}/>إنشاء فولدرات الخام</button>
        <button disabled={working} onClick={()=>void action({action:"campaign_action",campaignId:data.campaign.id,campaignAction:data.campaign.archived_at?"restore":"archive"})}><Archive size={18}/>{data.campaign.archived_at?"استرجاع":"أرشيف"}</button>
        <button className="danger" disabled={working} onClick={()=>{if(window.confirm("سيتم حذف السجل من نظام التسويق. هل أنت متأكد؟"))void action({action:"campaign_action",campaignId:data.campaign.id,campaignAction:"delete"});}}><Trash size={18}/>مسح</button>
      </div> : null}
    </div>}
  </Modal>;
}
