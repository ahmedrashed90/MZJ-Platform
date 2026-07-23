import { useEffect, useMemo, useState } from "react";
import { Archive, CalendarBlank, Car, Coins, FileText, Megaphone, PencilSimple, RocketLaunch, Trash, UsersThree } from "@phosphor-icons/react";
import { marketingFetch, marketingPost } from "../api";
import type { CampaignDetailPayload } from "../types";
import { DepartmentBadge, formatDate, formatMoney, MarketingAlert, MarketingEmpty, MarketingLoading, ProgressBar, StatusBadge } from "./Ui";
import { useAuth } from "../../auth/AuthContext";
import { CampaignEditForm } from "./CampaignEditForm";

export function CampaignDetailView({ campaignId, onTaskOpen, onChanged }: { campaignId: string; onTaskOpen: (id: string) => void; onChanged?: () => void | Promise<void> }) {
  const { user } = useAuth();
  const [data, setData] = useState<CampaignDetailPayload | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "creatives" | "tasks" | "budget" | "schedule">("overview");
  const [editing, setEditing] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try { setData(await marketingFetch<CampaignDetailPayload>(`/api/marketing?resource=campaign&id=${encodeURIComponent(campaignId)}`)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحميل تفاصيل الحملة"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [campaignId]);

  const departmentProgress = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const task of data?.tasks || []) {
      const values = map.get(task.department_code) || [];
      values.push(Number(task.progress_percent || 0));
      map.set(task.department_code, values);
    }
    return [...map.entries()].map(([code, values]) => ({ code, progress: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length), total: values.length, started: values.filter((value) => value > 0).length }));
  }, [data]);

  async function campaignAction(action: "archive_campaign" | "release_campaign" | "delete_campaign") {
    const confirmation = action === "release_campaign" ? "تحرير الحملة للنشر؟" : action === "archive_campaign" ? "أرشفة الحملة؟" : "حذف الحملة من العرض؟";
    if (!window.confirm(confirmation)) return;
    setError(""); setMessage("");
    try {
      const result = await marketingPost<{ ok: true; message: string }>({ action, id: campaignId });
      setMessage(result.message); await load(); await onChanged?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تنفيذ الإجراء"); }
  }

  if (loading && !data) return <MarketingLoading label="جاري تحميل تفاصيل الحملة..." />;
  if (!data) return <MarketingAlert>{error || "الحملة غير متاحة"}</MarketingAlert>;
  const campaign = data.campaign;
  const totalBudget = data.budgets.reduce((sum, row) => sum + row.platforms.reduce((platformSum, platform) => platformSum + Number(platform.amount || 0), 0), 0);
  const canManage = Boolean(user?.roleCodes.some((code) => ["admin", "system_admin"].includes(code)) || user?.permissions.includes("marketing.campaigns.manage"));

  if (editing) return <CampaignEditForm data={data} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await load(); await onChanged?.(); }} />;

  return (
    <div className="marketing-campaign-detail">
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}
      <section className="marketing-campaign-detail-hero">
        <div><span>{campaign.campaign_code}</span><h3>{campaign.name}</h3><p>{campaign.objective || "بدون هدف مسجل"}</p><div><StatusBadge status={campaign.status} type="campaign" /><span>{campaign.source_type === "agenda" ? "أجندة" : campaign.campaign_type}</span></div></div>
        <div><ProgressBar value={campaign.progress_percent} label="الجاهزية الكلية" /><small>{formatDate(campaign.publish_start_date)} – {formatDate(campaign.publish_end_date)}</small></div>
      </section>

      <div className="marketing-detail-actions">
        {canManage && !campaign.released_at && campaign.status !== "archived" ? <button type="button" onClick={() => setEditing(true)}><PencilSimple size={17} />تعديل الحملة</button> : null}
        {canManage && Number(campaign.progress_percent) >= 100 && !campaign.released_at ? <button type="button" className="primary" onClick={() => void campaignAction("release_campaign")}><RocketLaunch size={17} />تحرير للنشر</button> : null}
        {canManage ? <button type="button" onClick={() => void campaignAction("archive_campaign")}><Archive size={17} />أرشفة</button> : null}
        {canManage ? <button type="button" className="danger" onClick={() => void campaignAction("delete_campaign")}><Trash size={17} />حذف</button> : null}
      </div>

      <nav className="marketing-detail-tabs">
        <button type="button" className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>نظرة عامة</button>
        <button type="button" className={tab === "creatives" ? "active" : ""} onClick={() => setTab("creatives")}>الكرييتيفات ({data.creatives.length})</button>
        <button type="button" className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>التاسكات ({data.tasks.length})</button>
        <button type="button" className={tab === "budget" ? "active" : ""} onClick={() => setTab("budget")}>الميزانية</button>
        <button type="button" className={tab === "schedule" ? "active" : ""} onClick={() => setTab("schedule")}>جدول النشر</button>
      </nav>

      {tab === "overview" ? <div className="marketing-detail-overview">
        <section className="marketing-detail-info-grid">
          <div><Megaphone size={20} /><small>نوع الحملة</small><strong>{campaign.campaign_type || "—"}</strong></div>
          <div><CalendarBlank size={20} /><small>تاريخ الطلب</small><strong>{formatDate(campaign.campaign_date)}</strong></div>
          <div><FileText size={20} /><small>Content Brief</small><strong>{campaign.content_brief || "—"}</strong></div>
          <div><Coins size={20} /><small>إجمالي الميزانية</small><strong>{formatMoney(totalBudget)}</strong></div>
          <div><UsersThree size={20} /><small>عدد التاسكات</small><strong>{data.tasks.length}</strong></div>
          <div><Car size={20} /><small>السيارات المرتبطة</small><strong>{data.creatives.reduce((sum, row) => sum + row.vehicles.length, 0)}</strong></div>
        </section>
        <section className="marketing-department-readiness">
          <h3>تقدم الأقسام</h3>
          <div>{departmentProgress.map((row) => <article key={row.code}><div><DepartmentBadge code={row.code} /><span>{row.started}/{row.total} تاسك بدأت</span></div><ProgressBar value={row.progress} /></article>)}</div>
        </section>
      </div> : null}

      {tab === "creatives" ? <div className="marketing-creative-detail-list">{data.creatives.length ? data.creatives.map((creative) => <article key={creative.id}>
        <header><div><span>{creative.instance_code}</span><h3>{creative.creative_name}</h3></div><DepartmentBadge code={creative.primary_department_code} /></header>
        {creative.notes ? <p>{creative.notes}</p> : null}
        <h4>التوزيع والعلاقات الدقيقة</h4>
        <div className="marketing-assignment-grid">{creative.assignments.map((assignment) => <div key={assignment.id}><DepartmentBadge code={assignment.department_code} /><strong>{assignment.execution_user_name}</strong><span>كاتب المحتوى: {assignment.content_user_name}</span><small>تسليم الكاتب: {formatDate(assignment.writer_due_date)} · التنفيذ: {formatDate(assignment.due_date)}</small>{assignment.department_note ? <p>{assignment.department_note}</p> : null}</div>)}</div>
        {creative.vehicles.length ? <><h4>السيارات</h4><div className="marketing-vehicle-chips">{creative.vehicles.map((vehicle) => <span key={vehicle.vehicle_id}>{vehicle.vin} · {vehicle.car_name} · {vehicle.exterior_color}/{vehicle.interior_color}</span>)}</div></> : null}
      </article>) : <MarketingEmpty title="لا توجد كرييتيفات" />}</div> : null}

      {tab === "tasks" ? <div className="marketing-detail-task-table"><table><thead><tr><th>التاسك</th><th>القسم</th><th>المسؤول</th><th>كاتب المحتوى</th><th>الحالة</th><th>التقدم</th><th>الاستلام</th><th></th></tr></thead><tbody>{data.tasks.map((task) => <tr key={task.id}><td><strong>{task.title}</strong><small>{task.task_code}</small></td><td><DepartmentBadge code={task.department_code} /></td><td>{task.assigned_to_name || "—"}</td><td>{task.paired_content_user_name || task.content_user_name || "—"}</td><td><StatusBadge status={task.status} /></td><td><ProgressBar compact value={task.progress_percent} /></td><td>{formatDate(task.due_at)}</td><td><button type="button" onClick={() => onTaskOpen(task.id)}>تفاصيل</button></td></tr>)}</tbody></table></div> : null}

      {tab === "budget" ? <div className="marketing-budget-detail"><div className="marketing-budget-total"><span>إجمالي الميزانية</span><strong>{formatMoney(totalBudget)}</strong></div>{data.budgets.length ? data.budgets.map((row) => <article key={row.id}><header><div><span>{row.instance_code}</span><h3>{row.creative_name}</h3></div><strong>{formatMoney(row.platforms.reduce((sum, platform) => sum + Number(platform.amount || 0), 0))}</strong></header><div><span>Funnel: {row.funnel_name || "—"}</span><span>عدد الإعلانات: {row.ads_count}</span><span>هدف المحتوى: {row.content_goal || "—"}</span><span>النتيجة المتوقعة: {row.expected_target || "—"}</span></div><footer>{row.platforms.map((platform) => <span key={platform.platform_id}>{platform.platform_name}: {formatMoney(platform.amount)}</span>)}</footer></article>) : <MarketingEmpty title="لا توجد ميزانية محفوظة" />}</div> : null}

      {tab === "schedule" ? <div className="marketing-schedule-detail">{data.schedule.length ? data.schedule.map((row) => <article key={row.id}><header><div><CalendarBlank size={20} /><span>{formatDate(row.publish_date)}</span></div><strong>{row.instance_code} · {row.creative_name}</strong></header><div>{row.targets.map((target) => <span key={target.id}>{target.platform_name} · {target.post_type_name} · {target.publish_time || "بدون وقت"} · {target.dimensions || "—"}</span>)}</div>{row.caption ? <p>{row.caption}</p> : null}</article>) : <MarketingEmpty title="لا توجد عناصر في جدول النشر" />}</div> : null}
    </div>
  );
}
