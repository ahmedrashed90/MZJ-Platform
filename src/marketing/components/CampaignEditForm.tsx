import { useMemo, useState } from "react";
import { Plus, Trash } from "@phosphor-icons/react";
import { marketingPost } from "../api";
import type { CampaignDetailPayload } from "../types";
import { useMarketingMeta } from "../MarketingLayout";
import { MarketingAlert, formatMoney } from "./Ui";

type AssignmentDraft = { id: string; dueDate: string; writerDueDate: string; departmentNote: string; contentNote: string };
type BudgetDraft = { key: string; creativeId: string; funnelId: string; adsCount: string; contentGoal: string; expectedTarget: string; platforms: Array<{ key: string; platformId: string; amount: string }> };
type ScheduleDraft = { key: string; creativeId: string; publishDate: string; caption: string; hashtags: string; targets: Array<{ key: string; platformId: string; postTypeId: string; publishTime: string }> };

function key(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }
function dateInput(value?: string | null) { return value ? String(value).slice(0, 10) : ""; }
function timeInput(value?: string | null) { return value ? String(value).slice(0, 5) : ""; }

export function CampaignEditForm({ data, onSaved, onCancel }: { data: CampaignDetailPayload; onSaved: () => void | Promise<void>; onCancel: () => void }) {
  const { meta } = useMarketingMeta();
  const [campaign, setCampaign] = useState({
    version: data.campaign.version,
    name: data.campaign.name,
    objective: data.campaign.objective || "",
    contentBrief: data.campaign.content_brief || "",
    campaignDate: dateInput(data.campaign.campaign_date),
    publishStartDate: dateInput(data.campaign.publish_start_date),
    publishEndDate: dateInput(data.campaign.publish_end_date),
    structureDeadline: dateInput(data.campaign.structure_deadline),
  });
  const [assignments, setAssignments] = useState<AssignmentDraft[]>(data.creatives.flatMap((creative) => creative.assignments.map((assignment) => ({
    id: assignment.id,
    dueDate: dateInput(assignment.due_date),
    writerDueDate: dateInput(assignment.writer_due_date),
    departmentNote: assignment.department_note || "",
    contentNote: assignment.content_note || "",
  }))));
  const [budgets, setBudgets] = useState<BudgetDraft[]>(data.budgets.map((budget) => ({
    key: budget.id,
    creativeId: budget.creative_id,
    funnelId: budget.funnel_id || "",
    adsCount: String(budget.ads_count || 1),
    contentGoal: budget.content_goal || "",
    expectedTarget: budget.expected_target || "",
    platforms: budget.platforms.map((platform) => ({ key: `${budget.id}_${platform.platform_id}`, platformId: platform.platform_id, amount: String(platform.amount || 0) })),
  })));
  const [schedule, setSchedule] = useState<ScheduleDraft[]>(data.schedule.map((item) => ({
    key: item.id,
    creativeId: item.creative_id,
    publishDate: dateInput(item.publish_date),
    caption: item.caption || "",
    hashtags: item.hashtags || "",
    targets: item.targets.map((target) => ({ key: target.id, platformId: target.platform_id, postTypeId: target.post_type_id, publishTime: timeInput(target.publish_time) })),
  })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const totalBudget = useMemo(() => budgets.reduce((sum, budget) => sum + budget.platforms.reduce((platformSum, platform) => platformSum + Number(platform.amount || 0), 0), 0), [budgets]);

  function assignmentLabel(id: string) {
    for (const creative of data.creatives) {
      const assignment = creative.assignments.find((item) => item.id === id);
      if (assignment) return `${creative.instance_code} · ${creative.creative_name} · ${assignment.execution_user_name} × ${assignment.content_user_name}`;
    }
    return id;
  }

  async function save() {
    setBusy(true); setError("");
    try {
      if (!campaign.name.trim() || !campaign.campaignDate || !campaign.publishStartDate || !campaign.publishEndDate) throw new Error("أكمل اسم الحملة وتواريخها");
      if (campaign.publishStartDate > campaign.publishEndDate) throw new Error("تاريخ بداية النشر يجب ألا يتجاوز تاريخ النهاية");
      await marketingPost({
        action: "update_campaign",
        id: data.campaign.id,
        payload: {
          campaign,
          assignments,
          budgets: budgets.map((budget) => ({ ...budget, platforms: budget.platforms.map(({ platformId, amount }) => ({ platformId, amount })) })),
          schedule: schedule.map((item) => ({
            creativeId: item.creativeId, publishDate: item.publishDate, caption: item.caption, hashtags: item.hashtags,
            targets: item.targets.map(({ platformId, postTypeId, publishTime }) => ({ platformId, postTypeId, publishTime })),
          })),
        },
      });
      await onSaved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر تحديث الحملة"); }
    finally { setBusy(false); }
  }

  return <div className="marketing-campaign-edit">
    {error ? <MarketingAlert>{error}</MarketingAlert> : null}
    <section className="marketing-panel"><h3>بيانات الحملة</h3><div className="marketing-form-grid cols-3">
      <label className="marketing-field"><span>اسم الحملة</span><input value={campaign.name} onChange={(event) => setCampaign({ ...campaign, name: event.target.value })} /></label>
      <label className="marketing-field"><span>تاريخ الطلب</span><input type="date" value={campaign.campaignDate} onChange={(event) => setCampaign({ ...campaign, campaignDate: event.target.value })} /></label>
      <label className="marketing-field"><span>موعد Task Template الافتراضي</span><input type="date" value={campaign.structureDeadline} onChange={(event) => setCampaign({ ...campaign, structureDeadline: event.target.value })} /></label>
      <label className="marketing-field"><span>بداية النشر</span><input type="date" value={campaign.publishStartDate} onChange={(event) => setCampaign({ ...campaign, publishStartDate: event.target.value })} /></label>
      <label className="marketing-field"><span>نهاية النشر</span><input type="date" value={campaign.publishEndDate} onChange={(event) => setCampaign({ ...campaign, publishEndDate: event.target.value })} /></label>
      <label className="marketing-field wide"><span>هدف الحملة</span><textarea value={campaign.objective} onChange={(event) => setCampaign({ ...campaign, objective: event.target.value })} /></label>
      <label className="marketing-field wide"><span>المطلوب من كاتب المحتوى</span><textarea value={campaign.contentBrief} onChange={(event) => setCampaign({ ...campaign, contentBrief: event.target.value })} /></label>
    </div></section>

    <section className="marketing-panel"><h3>مواعيد وملاحظات التوزيع</h3><div className="marketing-stack">{assignments.map((assignment) => <article className="marketing-edit-assignment" key={assignment.id}><strong>{assignmentLabel(assignment.id)}</strong><div className="marketing-form-grid cols-2"><label className="marketing-field"><span>تسليم الكاتب</span><input type="date" value={assignment.writerDueDate} onChange={(event) => setAssignments((rows) => rows.map((row) => row.id === assignment.id ? { ...row, writerDueDate: event.target.value } : row))} /></label><label className="marketing-field"><span>تسليم التنفيذ</span><input type="date" value={assignment.dueDate} onChange={(event) => setAssignments((rows) => rows.map((row) => row.id === assignment.id ? { ...row, dueDate: event.target.value } : row))} /></label><label className="marketing-field"><span>ملاحظة المحتوى</span><textarea value={assignment.contentNote} onChange={(event) => setAssignments((rows) => rows.map((row) => row.id === assignment.id ? { ...row, contentNote: event.target.value } : row))} /></label><label className="marketing-field"><span>ملاحظة القسم</span><textarea value={assignment.departmentNote} onChange={(event) => setAssignments((rows) => rows.map((row) => row.id === assignment.id ? { ...row, departmentNote: event.target.value } : row))} /></label></div></article>)}</div></section>

    {data.campaign.source_type === "campaign" ? <section className="marketing-panel"><div className="marketing-panel-head"><div><h3>الميزانية</h3><p>الكرييتيف مرتبط بالـInstance ID وليس الاسم.</p></div><button type="button" className="marketing-button secondary" onClick={() => setBudgets((rows) => [...rows, { key: key("budget"), creativeId: "", funnelId: "", adsCount: "1", contentGoal: "", expectedTarget: "", platforms: [{ key: key("platform"), platformId: "", amount: "0" }] }])}><Plus />بند ميزانية</button></div><div className="marketing-stack">{budgets.map((budget) => <article className="marketing-edit-budget" key={budget.key}><div className="marketing-form-grid cols-3"><label className="marketing-field"><span>الكرييتيف</span><select value={budget.creativeId} onChange={(event) => setBudgets((rows) => rows.map((row) => row.key === budget.key ? { ...row, creativeId: event.target.value } : row))}><option value="">اختر</option>{data.creatives.map((creative) => <option key={creative.id} value={creative.id}>{creative.instance_code} · {creative.creative_name}</option>)}</select></label><label className="marketing-field"><span>Funnel</span><select value={budget.funnelId} onChange={(event) => setBudgets((rows) => rows.map((row) => row.key === budget.key ? { ...row, funnelId: event.target.value } : row))}><option value="">بدون Funnel</option>{meta.funnels.map((funnel) => <option key={funnel.id} value={funnel.id}>{funnel.name}</option>)}</select></label><label className="marketing-field"><span>عدد الإعلانات</span><input type="number" min="1" value={budget.adsCount} onChange={(event) => setBudgets((rows) => rows.map((row) => row.key === budget.key ? { ...row, adsCount: event.target.value } : row))} /></label><label className="marketing-field"><span>هدف المحتوى</span><input value={budget.contentGoal} onChange={(event) => setBudgets((rows) => rows.map((row) => row.key === budget.key ? { ...row, contentGoal: event.target.value } : row))} /></label><label className="marketing-field"><span>النتيجة المستهدفة</span><input value={budget.expectedTarget} onChange={(event) => setBudgets((rows) => rows.map((row) => row.key === budget.key ? { ...row, expectedTarget: event.target.value } : row))} /></label><button type="button" className="marketing-button danger" onClick={() => setBudgets((rows) => rows.filter((row) => row.key !== budget.key))}><Trash />حذف البند</button></div>{budget.platforms.map((platform) => <div className="marketing-target-row" key={platform.key}><label className="marketing-field"><span>المنصة</span><select value={platform.platformId} onChange={(event) => setBudgets((rows) => rows.map((row) => row.key === budget.key ? { ...row, platforms: row.platforms.map((item) => item.key === platform.key ? { ...item, platformId: event.target.value } : item) } : row))}><option value="">اختر</option>{meta.platforms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="marketing-field"><span>القيمة</span><input type="number" min="0" step="0.01" value={platform.amount} onChange={(event) => setBudgets((rows) => rows.map((row) => row.key === budget.key ? { ...row, platforms: row.platforms.map((item) => item.key === platform.key ? { ...item, amount: event.target.value } : item) } : row))} /></label><button type="button" className="marketing-button danger" onClick={() => setBudgets((rows) => rows.map((row) => row.key === budget.key ? { ...row, platforms: row.platforms.filter((item) => item.key !== platform.key) } : row))}><Trash /></button></div>)}<button type="button" className="marketing-button small" onClick={() => setBudgets((rows) => rows.map((row) => row.key === budget.key ? { ...row, platforms: [...row.platforms, { key: key("platform"), platformId: "", amount: "0" }] } : row))}><Plus />منصة</button></article>)}</div><div className="marketing-budget-total"><span>إجمالي الميزانية</span><strong>{formatMoney(totalBudget)}</strong></div></section> : null}

    <section className="marketing-panel"><div className="marketing-panel-head"><div><h3>جدول النشر</h3><p>لن يسمح السيرفر بتغييره بعد بدء نشر أي Target.</p></div><button type="button" className="marketing-button secondary" onClick={() => setSchedule((rows) => [...rows, { key: key("schedule"), creativeId: "", publishDate: campaign.publishStartDate, caption: "", hashtags: "", targets: [{ key: key("target"), platformId: "", postTypeId: "", publishTime: "" }] }])}><Plus />عنصر نشر</button></div><div className="marketing-stack">{schedule.map((item) => <article className="marketing-edit-schedule" key={item.key}><div className="marketing-form-grid cols-3"><label className="marketing-field"><span>التاريخ</span><input type="date" min={campaign.publishStartDate} max={campaign.publishEndDate} value={item.publishDate} onChange={(event) => setSchedule((rows) => rows.map((row) => row.key === item.key ? { ...row, publishDate: event.target.value } : row))} /></label><label className="marketing-field"><span>الكرييتيف</span><select value={item.creativeId} onChange={(event) => setSchedule((rows) => rows.map((row) => row.key === item.key ? { ...row, creativeId: event.target.value } : row))}><option value="">اختر</option>{data.creatives.map((creative) => <option key={creative.id} value={creative.id}>{creative.instance_code} · {creative.creative_name}</option>)}</select></label><label className="marketing-field"><span>Caption</span><input value={item.caption} onChange={(event) => setSchedule((rows) => rows.map((row) => row.key === item.key ? { ...row, caption: event.target.value } : row))} /></label><label className="marketing-field"><span>Hashtags</span><input value={item.hashtags} onChange={(event) => setSchedule((rows) => rows.map((row) => row.key === item.key ? { ...row, hashtags: event.target.value } : row))} /></label><button type="button" className="marketing-button danger" onClick={() => setSchedule((rows) => rows.filter((row) => row.key !== item.key))}><Trash />حذف العنصر</button></div>{item.targets.map((target) => <div className="marketing-target-row" key={target.key}><label className="marketing-field"><span>المنصة</span><select value={target.platformId} onChange={(event) => setSchedule((rows) => rows.map((row) => row.key === item.key ? { ...row, targets: row.targets.map((value) => value.key === target.key ? { ...value, platformId: event.target.value, postTypeId: "" } : value) } : row))}><option value="">اختر</option>{meta.platforms.map((platform) => <option key={platform.id} value={platform.id}>{platform.name}</option>)}</select></label><label className="marketing-field"><span>نوع النشر</span><select value={target.postTypeId} onChange={(event) => setSchedule((rows) => rows.map((row) => row.key === item.key ? { ...row, targets: row.targets.map((value) => value.key === target.key ? { ...value, postTypeId: event.target.value } : value) } : row))}><option value="">اختر</option>{meta.postTypes.filter((type) => type.platform_id === target.platformId).map((type) => <option key={type.id} value={type.id}>{type.name} {type.dimensions ? `· ${type.dimensions}` : ""}</option>)}</select></label><label className="marketing-field"><span>الوقت</span><input type="time" value={target.publishTime} onChange={(event) => setSchedule((rows) => rows.map((row) => row.key === item.key ? { ...row, targets: row.targets.map((value) => value.key === target.key ? { ...value, publishTime: event.target.value } : value) } : row))} /></label><button type="button" className="marketing-button danger" onClick={() => setSchedule((rows) => rows.map((row) => row.key === item.key ? { ...row, targets: row.targets.filter((value) => value.key !== target.key) } : row))}><Trash /></button></div>)}<button type="button" className="marketing-button small" onClick={() => setSchedule((rows) => rows.map((row) => row.key === item.key ? { ...row, targets: [...row.targets, { key: key("target"), platformId: "", postTypeId: "", publishTime: "" }] } : row))}><Plus />منصة ونوع نشر</button></article>)}</div></section>

    <div className="marketing-wizard-actions"><button type="button" className="marketing-button" disabled={busy} onClick={onCancel}>إلغاء</button><button type="button" className="marketing-button primary" disabled={busy} onClick={() => void save()}>{busy ? "جاري الحفظ..." : "حفظ التعديلات"}</button></div>
  </div>;
}
