import { useEffect, useMemo, useState } from "react";
import { CalendarBlank, CheckCircle, CurrencyCircleDollar, Plus, Trash } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { marketingFetch } from "../api";
import { CreativeEditor, newCreativeDraft } from "./CreativeEditor";
import { MarketingAlert } from "./MarketingPage";
import type { CreativeDraft, MarketingMeta } from "../types";

type BudgetDraft = {
  id: string;
  funnelId: string;
  adsCount: number;
  contentGoal: string;
  expectedGoal: string;
  platformAmounts: Array<{ platformId: string; amount: number }>;
};

type ScheduleDraft = {
  id: string;
  date: string;
  platforms: Array<{ platformId: string; postTypeIds: string[] }>;
};

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const asArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

function creativeDraftFromRow(row: any): CreativeDraft {
  return {
    tempId: String(row?.id || uid()),
    creativeTypeId: String(row?.creative_type_id || ""),
    quantity: Math.max(1, Number(row?.quantity || 1)),
    cars: asArray<any>(row?.cars),
    contentAssignments: asArray<any>(row?.content_assignments),
    primaryAssignments: asArray<any>(row?.primary_assignments),
    optionalAssignments: asArray<any>(row?.optional_assignments),
    platforms: asArray<any>(row?.platform_assignments),
    notes: row?.notes && typeof row.notes === "object" ? row.notes : {},
  };
}

function budgetsFromDetail(detail: any, creativeId: string): BudgetDraft[] {
  return asArray<any>(detail?.budgets)
    .filter((item) => String(item.creative_id || "") === creativeId)
    .map((item) => ({
      id: String(item.id || uid()),
      funnelId: String(item.funnel_id || ""),
      adsCount: Math.max(1, Number(item.ads_count || 1)),
      contentGoal: String(item.content_goal || ""),
      expectedGoal: String(item.expected_goal || ""),
      platformAmounts: asArray<any>(item.platform_amounts).map((part) => ({ platformId: String(part.platformId || ""), amount: Number(part.amount || 0) })),
    }));
}

function scheduleFromDetail(detail: any, creativeId: string): ScheduleDraft[] {
  const grouped = new Map<string, { date: string; platforms: Map<string, Set<string>> }>();
  for (const item of asArray<any>(detail?.schedule).filter((row) => String(row.creative_id || "") === creativeId)) {
    const date = String(item.publish_date || "").slice(0, 10);
    const signatureKey = `${date}|${String(item.group_id || item.id || "")}`;
    if (!grouped.has(signatureKey)) grouped.set(signatureKey, { date, platforms: new Map() });
    const group = grouped.get(signatureKey)!;
    const platformId = String(item.platform_id || "");
    const postTypeId = String(item.post_type_id || "");
    if (!platformId || !postTypeId) continue;
    if (!group.platforms.has(platformId)) group.platforms.set(platformId, new Set());
    group.platforms.get(platformId)!.add(postTypeId);
  }
  const unique = new Map<string, ScheduleDraft>();
  for (const group of grouped.values()) {
    const platforms = [...group.platforms.entries()].map(([platformId, ids]) => ({ platformId, postTypeIds: [...ids].sort() }));
    const signature = `${group.date}|${platforms.map((item) => `${item.platformId}:${item.postTypeIds.join(",")}`).sort().join("|")}`;
    if (!unique.has(signature)) unique.set(signature, { id: uid(), date: group.date, platforms });
  }
  return [...unique.values()];
}

function validateCreative(creative: CreativeDraft, meta: MarketingMeta) {
  const creativeType = meta.creativeTypes.find((item) => item.id === creative.creativeTypeId);
  if (!creative.creativeTypeId) return "اختر نوع الكرييتيف";
  if (!creative.contentAssignments.length) return "اختر يوزر قسم المحتوى";
  if (creativeType?.primary_department_id && !creative.primaryAssignments.length) return `اختر يوزر القسم الأساسي ${creativeType.primary_department_name || ""}`;
  const executions = [...creative.primaryAssignments, ...creative.optionalAssignments.flatMap((group) => group.assignments)];
  if (!executions.length) return "اختر يوزرًا تنفيذيًا واحدًا على الأقل";
  const contentIds = new Set(creative.contentAssignments.map((item) => item.userId));
  const links = executions.flatMap((item) => item.contentUserIds.filter((id) => contentIds.has(id)));
  if (contentIds.size === 1 && !links.length) return "اربط التاسك التنفيذي بكاتب المحتوى";
  if ([...contentIds].some((id) => !links.includes(id))) return "اربط كل Task Template بتاسك تنفيذي";
  return "";
}

export function EntityCreativeManager({
  open,
  source,
  detail,
  meta,
  creativeRow,
  onClose,
  onSaved,
}: {
  open: boolean;
  source: any;
  detail: any;
  meta: MarketingMeta;
  creativeRow?: any | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const sourceType = source?.source_type === "agenda" ? "agenda" : "campaign";
  const editing = Boolean(creativeRow?.id);
  const steps = sourceType === "campaign" ? ["الكرييتيف", "الميزانية", "جدول النشر", "المراجعة"] : ["الكرييتيف", "اليوم وجدول النشر", "المراجعة"];
  const [step, setStep] = useState(0);
  const [creative, setCreative] = useState<CreativeDraft>(newCreativeDraft());
  const [budgets, setBudgets] = useState<BudgetDraft[]>([]);
  const [schedule, setSchedule] = useState<ScheduleDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const draft = creativeRow ? creativeDraftFromRow(creativeRow) : newCreativeDraft();
    setCreative(draft);
    setBudgets(creativeRow ? budgetsFromDetail(detail, String(creativeRow.id)) : []);
    setSchedule(creativeRow ? scheduleFromDetail(detail, String(creativeRow.id)) : []);
    setStep(0);
    setError("");
  }, [open, creativeRow, detail]);

  const totalBudget = useMemo(() => budgets.reduce((sum, item) => sum + item.platformAmounts.reduce((part, platform) => part + Number(platform.amount || 0), 0), 0), [budgets]);
  const creativeName = meta.creativeTypes.find((item) => item.id === creative.creativeTypeId)?.name || "كرييتيف جديد";
  const publishStart = String(detail?.entity?.publish_start || "").slice(0, 10);
  const publishEnd = String(detail?.entity?.publish_end || "").slice(0, 10);

  function validateStep() {
    if (step === 0) return validateCreative(creative, meta);
    if (sourceType === "campaign" && step === 1) {
      if (!budgets.length) return "أضف بند ميزانية للكرييتيف";
      if (budgets.some((item) => !item.platformAmounts.length)) return "حدد منصة واحدة على الأقل لكل بند ميزانية";
    }
    const scheduleStep = sourceType === "campaign" ? 2 : 1;
    if (step === scheduleStep) {
      if (!schedule.length) return "أضف موعدًا واحدًا على الأقل في جدول النشر";
      if (schedule.some((item) => !item.date || !item.platforms.some((platform) => platform.postTypeIds.length))) return "أكمل تاريخ ومنصة ونوع النشر لكل موعد";
    }
    return "";
  }

  function next() {
    const issue = validateStep();
    if (issue) { setError(issue); return; }
    setError("");
    setStep((current) => Math.min(steps.length - 1, current + 1));
  }

  async function save() {
    const issue = validateCreative(creative, meta);
    if (issue) { setError(issue); setStep(0); return; }
    if (!schedule.length || schedule.some((item) => !item.date || !item.platforms.some((platform) => platform.postTypeIds.length))) {
      setError("أكمل جدول النشر قبل الحفظ");
      setStep(sourceType === "campaign" ? 2 : 1);
      return;
    }
    if (sourceType === "campaign" && (!budgets.length || budgets.some((item) => !item.platformAmounts.length))) {
      setError("أكمل ميزانية الكرييتيف قبل الحفظ");
      setStep(1);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({
          action: "save_entity_creative",
          sourceType,
          sourceId: source.id,
          creativeId: creativeRow?.id || undefined,
          creative,
          budgets: sourceType === "campaign" ? budgets : [],
          schedule,
        }),
      });
      await onSaved(result.message);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حفظ الكرييتيف");
    } finally {
      setBusy(false);
    }
  }

  function addBudget() {
    setBudgets((current) => [...current, { id: uid(), funnelId: "", adsCount: 1, contentGoal: "", expectedGoal: "", platformAmounts: [] }]);
  }

  function addSchedule() {
    setSchedule((current) => [...current, { id: uid(), date: sourceType === "agenda" ? publishStart : publishStart, platforms: [] }]);
  }

  return <Modal
    open={open}
    title={`${editing ? "تعديل" : "إضافة"} كرييتيف — ${source?.name || ""}`}
    subtitle={sourceType === "campaign" ? "الكرييتيف ثم الميزانية ثم جدول النشر" : "الكرييتيف ثم اليوم وجدول النشر"}
    onClose={() => !busy && onClose()}
    className="marketing-entity-creative-modal"
    level={2}
  >
    <div className={`marketing-wizard-steps ${steps.length === 3 ? "three" : "marketing-four-steps"}`}>
      {steps.map((label, index) => <button type="button" key={label} className={index === step ? "active" : index < step ? "done" : ""} onClick={() => index <= step && setStep(index)}><span>{index + 1}</span><b>{label}</b></button>)}
    </div>
    {error ? <MarketingAlert>{error}</MarketingAlert> : null}

    <section className="marketing-entity-creative-body">
      {step === 0 ? <div className="marketing-entity-creative-editor"><CreativeEditor value={creative} meta={meta} autoLinkSingleContentUser showTaskFlowSummary carsModal onChange={setCreative} onDelete={() => undefined} /></div> : null}

      {sourceType === "campaign" && step === 1 ? <div className="marketing-budget-list marketing-campaign-budget-step">
        <div className="marketing-campaign-step-head"><div className="marketing-campaign-step-icon"><CurrencyCircleDollar size={25} weight="duotone" /></div><div><h2>ميزانية الكرييتيف</h2><p>تُضاف أو تُحدّث داخل ميزانية نفس الحملة فقط.</p></div></div>
        {budgets.map((budget, index) => <article key={budget.id} className="marketing-budget-card">
          <header className="marketing-budget-card-head"><div><span>بند الميزانية</span><strong>{index + 1}</strong></div><button type="button" className="marketing-card-delete" onClick={() => setBudgets((current) => current.filter((item) => item.id !== budget.id))}><Trash size={18} /></button></header>
          <div className="marketing-budget-fields marketing-entity-budget-fields">
            <label><span>Funnel</span><select value={budget.funnelId} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, funnelId: event.target.value } : item))}><option value="">اختر Funnel</option>{meta.funnels.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label><span>الكرييتيف</span><input value={creativeName} readOnly /></label>
            <label><span>عدد الإعلانات</span><input type="number" min={1} value={budget.adsCount} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, adsCount: Math.max(1, Number(event.target.value) || 1) } : item))} /></label>
            <label><span>هدف المحتوى</span><input value={budget.contentGoal} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, contentGoal: event.target.value } : item))} /></label>
            <label><span>الهدف المتوقع</span><input value={budget.expectedGoal} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, expectedGoal: event.target.value } : item))} /></label>
          </div>
          <div className="marketing-budget-platforms">{meta.platforms.map((platform) => { const selected = budget.platformAmounts.find((item) => item.platformId === platform.id); return <section key={platform.id} className={selected ? "selected" : ""}><label className="marketing-budget-platform-head"><input type="checkbox" checked={Boolean(selected)} onChange={() => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, platformAmounts: selected ? item.platformAmounts.filter((part) => part.platformId !== platform.id) : [...item.platformAmounts, { platformId: platform.id, amount: 0 }] } : item))} /><strong>{platform.name}</strong></label><input type="number" min={0} disabled={!selected} value={selected?.amount ?? ""} placeholder={`قيمة ${platform.name}`} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, platformAmounts: item.platformAmounts.map((part) => part.platformId === platform.id ? { ...part, amount: Number(event.target.value) || 0 } : part) } : item))} /></section>; })}</div>
          <footer className="marketing-budget-card-total"><span>إجمالي البند</span><strong>{budget.platformAmounts.reduce((sum, item) => sum + Number(item.amount || 0), 0).toLocaleString("ar-SA")} ر.س</strong></footer>
        </article>)}
        <button type="button" className="marketing-add-block marketing-add-budget" onClick={addBudget}><Plus size={18} />إضافة بند ميزانية</button>
        <div className="marketing-total-budget"><span>إجمالي ميزانية الكرييتيف</span><strong>{totalBudget.toLocaleString("ar-SA")} ر.س</strong></div>
      </div> : null}

      {step === (sourceType === "campaign" ? 2 : 1) ? <div className="marketing-schedule-list marketing-campaign-schedule-step">
        <div className="marketing-campaign-step-head"><div className="marketing-campaign-step-icon"><CalendarBlank size={25} weight="duotone" /></div><div><h2>{sourceType === "agenda" ? "اليوم وجدول النشر" : "جدول نشر الكرييتيف"}</h2><p>الموعد والمنصات وأنواع النشر لهذا الكرييتيف فقط.</p></div></div>
        <div className="marketing-schedule-workspace">
          <aside className="marketing-schedule-period"><span>الفترة المتاحة</span><div><small>من</small><strong>{publishStart || "—"}</strong></div><div><small>إلى</small><strong>{publishEnd || "—"}</strong></div><div className="marketing-schedule-period-count"><small>المواعيد</small><strong>{schedule.length}</strong></div></aside>
          <div className="marketing-schedule-days">
            {schedule.map((item, index) => <article key={item.id} className="marketing-schedule-card">
              <header className="marketing-schedule-card-head"><div><span>موعد {index + 1}</span><strong>{item.date || "لم يتم تحديد اليوم"}</strong><small>{item.platforms.reduce((sum, platform) => sum + platform.postTypeIds.length, 0)} نوع نشر</small></div><button type="button" className="marketing-card-delete" onClick={() => setSchedule((current) => current.filter((part) => part.id !== item.id))}><Trash size={18} /></button></header>
              <div className="marketing-schedule-fields"><label><span>اليوم</span><input type="date" min={publishStart} max={publishEnd} value={item.date} onChange={(event) => setSchedule((current) => current.map((part) => part.id === item.id ? { ...part, date: event.target.value } : part))} /></label><label><span>الكرييتيف</span><input value={creativeName} readOnly /></label></div>
              <div className="marketing-schedule-platforms">{meta.platforms.map((platform) => { const selected = item.platforms.find((part) => part.platformId === platform.id); return <section key={platform.id} className={selected ? "selected" : ""}><label className="marketing-schedule-platform-head"><input type="checkbox" checked={Boolean(selected)} onChange={() => setSchedule((current) => current.map((part) => part.id === item.id ? { ...part, platforms: selected ? part.platforms.filter((value) => value.platformId !== platform.id) : [...part.platforms, { platformId: platform.id, postTypeIds: [] }] } : part))} /><strong>{platform.name}</strong></label>{selected ? <div className="marketing-chip-picker">{meta.postTypes.filter((post) => post.platform_id === platform.id).map((post) => <button type="button" key={post.id} className={selected.postTypeIds.includes(post.id) ? "selected" : ""} onClick={() => setSchedule((current) => current.map((part) => part.id === item.id ? { ...part, platforms: part.platforms.map((value) => value.platformId === platform.id ? { ...value, postTypeIds: value.postTypeIds.includes(post.id) ? value.postTypeIds.filter((id) => id !== post.id) : [...value.postTypeIds, post.id] } : value) } : part))}>{post.name}</button>)}</div> : <div className="marketing-schedule-platform-placeholder">اختر المنصة لعرض أنواع النشر</div>}</section>; })}</div>
            </article>)}
            <button type="button" className="marketing-add-block marketing-add-schedule" onClick={addSchedule}><Plus size={18} />إضافة موعد نشر</button>
          </div>
        </div>
      </div> : null}

      {step === steps.length - 1 ? <div className="marketing-review marketing-entity-creative-review">
        <div className="marketing-review-grid"><article><small>الإجراء</small><strong>{editing ? "تعديل كرييتيف" : "إضافة كرييتيف"}</strong></article><article><small>الكرييتيف</small><strong>{creativeName}</strong></article><article><small>العدد</small><strong>{creative.quantity}</strong></article><article><small>Task Templates</small><strong>{creative.contentAssignments.length}</strong></article><article><small>التاسكات التنفيذية</small><strong>{creative.primaryAssignments.length + creative.optionalAssignments.reduce((sum, group) => sum + group.assignments.length, 0)}</strong></article>{sourceType === "campaign" ? <article><small>إجمالي الميزانية</small><strong>{totalBudget.toLocaleString("ar-SA")} ر.س</strong></article> : null}<article><small>مواعيد النشر</small><strong>{schedule.length}</strong></article></div>
        {editing ? <MarketingAlert type="info">عند تغيير بيانات التكليف بعد اعتماد Task Template، تُنشأ مراجعة جديدة ويظل التاسك التنفيذي متوقفًا حتى إعادة الاعتماد.</MarketingAlert> : null}
        <button type="button" className="primary marketing-entity-creative-save" disabled={busy} onClick={() => void save()}><CheckCircle size={18} />{busy ? "جاري الحفظ..." : editing ? "حفظ تعديل الكرييتيف" : "إضافة الكرييتيف"}</button>
      </div> : null}
    </section>

    <footer className="marketing-wizard-footer marketing-entity-creative-footer">{step > 0 ? <button type="button" className="secondary" disabled={busy} onClick={() => setStep((current) => current - 1)}>السابق</button> : <span />}{step < steps.length - 1 ? <button type="button" className="primary" disabled={busy} onClick={next}>التالي</button> : null}</footer>
  </Modal>;
}
