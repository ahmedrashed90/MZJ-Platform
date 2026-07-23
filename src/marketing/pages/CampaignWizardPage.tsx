import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Plus, Trash } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { marketingFetch, todayInput } from "../api";
import type { CampaignDraft, CreativeDraft, MarketingMeta } from "../types";
import { MarketingPageHeader } from "../components/MarketingPageHeader";
import { MarketingLoading, MarketingError } from "../components/MarketingLoading";

function key() { return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
function emptyCreative(meta?: MarketingMeta | null): CreativeDraft {
  const catalog = meta?.creatives[0];
  return {
    clientKey: key(),
    catalogCreativeId: catalog?.id || "",
    creativeType: catalog?.code || "post",
    primaryDepartmentCode: catalog?.primary_department_code || "design",
    quantity: 1,
    contentUsers: [{ userId: "", dueAt: "", notes: "" }],
    executionAssignments: [{ departmentCode: catalog?.primary_department_code || "design", userId: "", dueAt: "", notes: "", writerLinks: [{ contentUserId: "", dueAt: "", notes: "" }] }],
    vehicles: [],
  };
}
function initialDraft(mode: "campaign" | "agenda"): CampaignDraft {
  const today = todayInput();
  return {
    sourceType: mode,
    campaignType: mode === "agenda" ? "agenda" : "sales",
    name: "",
    objective: "",
    contentBrief: "",
    requestDate: today,
    startsAt: today,
    endsAt: today,
    monthKey: today.slice(0, 7),
    creatives: [],
    budgetItems: [],
    scheduleItems: [],
  };
}

export function CampaignWizardPage({ mode = "campaign" }: { mode?: "campaign" | "agenda" }) {
  const navigate = useNavigate();
  const steps = mode === "agenda" ? ["بيانات الأجندة", "الأيام والكرييتيف", "المراجعة والإنشاء"] : ["بيانات الحملة", "الكرييتيف والتوزيع", "الميزانية", "جدول النشر", "المراجعة والحفظ"];
  const [step, setStep] = useState(0);
  const [meta, setMeta] = useState<MarketingMeta | null>(null);
  const [draft, setDraft] = useState<CampaignDraft>(() => initialDraft(mode));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    marketingFetch<MarketingMeta>("resource=meta").then((result) => {
      setMeta(result);
      setDraft((current) => ({ ...current, campaignType: mode === "agenda" ? "agenda" : current.campaignType || result.campaignTypes[0]?.code || "sales", creatives: current.creatives.length ? current.creatives : [emptyCreative(result)] }));
    }).catch((failure) => setError(failure instanceof Error ? failure.message : "تعذر تحميل إعدادات التسويق")).finally(() => setLoading(false));
  }, [mode]);

  const creativeOptions = useMemo(() => draft.creatives.map((creative, index) => ({ key: creative.clientKey, label: meta?.creatives.find((item) => item.id === creative.catalogCreativeId)?.name || `كرييتيف ${index + 1}` })), [draft.creatives, meta]);

  function patchCreative(index: number, patch: Partial<CreativeDraft>) {
    setDraft((current) => ({ ...current, creatives: current.creatives.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  }
  function removeCreative(index: number) {
    setDraft((current) => ({ ...current, creatives: current.creatives.filter((_, itemIndex) => itemIndex !== index) }));
  }
  function addBudget() {
    setDraft((current) => ({ ...current, budgetItems: [...current.budgetItems, { creativeClientKey: current.creatives[0]?.clientKey || "", funnelId: meta?.funnels[0]?.id || "", adsCount: 1, contentGoal: "", expectedTarget: "", rowTotal: 0, platforms: [] }] }));
  }
  function addSchedule() {
    setDraft((current) => ({ ...current, scheduleItems: [...current.scheduleItems, { creativeClientKey: current.creatives[0]?.clientKey || "", publishAt: `${current.startsAt}T16:00`, notes: "", targets: [] }] }));
  }
  function validateBasics() {
    if (!draft.name.trim() || !draft.startsAt || !draft.endsAt) return `أكمل اسم ${mode === "agenda" ? "الأجندة" : "الحملة"} وتواريخ البداية والنهاية`;
    if (new Date(draft.startsAt) > new Date(draft.endsAt)) return "تاريخ البداية لا يمكن أن يكون بعد تاريخ النهاية";
    return "";
  }
  function validateCreatives() {
    if (!draft.creatives.length) return "أضف كرييتيف واحدًا على الأقل";
    for (const creative of draft.creatives) {
      if (!creative.catalogCreativeId) return "اختر نوع كل كرييتيف";
      if (!creative.executionAssignments.length) return "أضف مستخدمًا تنفيذيًا لكل كرييتيف";
      for (const assignment of creative.executionAssignments) {
        if (!assignment.departmentCode || !assignment.userId) return "اختر القسم والمستخدم التنفيذي لكل توزيع";
        if (!assignment.writerLinks.length || assignment.writerLinks.some((link) => !link.contentUserId)) return "اربط كل مستخدم تنفيذي بكاتب محتوى واحد على الأقل";
      }
    }
    return "";
  }
  function validateBudget() {
    if (mode === "agenda") return "";
    if (!draft.budgetItems.length) return "أضف صف ميزانية واحدًا على الأقل";
    if (draft.budgetItems.some((item) => !item.creativeClientKey || !item.platforms.length)) return "اختر كرييتيف ومنصة واحدة على الأقل لكل صف ميزانية";
    return "";
  }
  function validateSchedule() {
    if (!draft.scheduleItems.length) return "أضف عنصر نشر واحدًا على الأقل";
    if (draft.scheduleItems.some((item) => !item.creativeClientKey || !item.publishAt || !item.targets.length || item.targets.some((target) => !target.platformId || !target.postTypeId))) return "أكمل الكرييتيف والتاريخ والمنصة ونوع النشر لكل عنصر";
    return "";
  }
  function validateCurrent() {
    if (step === 0) return validateBasics();
    if (step === 1) return validateCreatives() || (mode === "agenda" ? validateSchedule() : "");
    if (mode === "campaign" && step === 2) return validateBudget();
    if (mode === "campaign" && step === 3) return validateSchedule();
    return "";
  }
  function validateAll() {
    return validateBasics() || validateCreatives() || validateBudget() || validateSchedule();
  }
  function next() {
    const issue = validateCurrent();
    if (issue) { setError(issue); return; }
    setError(""); setStep((current) => Math.min(steps.length - 1, current + 1));
  }
  async function submit() {
    const issue = validateAll(); if (issue) { setError(issue); return; }
    setSaving(true); setError("");
    try {
      const payload = mode === "agenda" ? { ...draft, budgetItems: [], scheduleItems: draft.scheduleItems } : draft;
      const result = await marketingFetch<{ ok: boolean; campaign: { id: string } }>("resource=campaigns", { method: "POST", body: JSON.stringify(payload) });
      navigate(`/marketing/campaigns?id=${result.campaign.id}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر حفظ الحملة"); }
    finally { setSaving(false); }
  }

  if (loading || !meta) return <MarketingLoading label="جاري تجهيز نموذج التسويق..." />;

  const reviewStep = steps.length - 1;
  return (
    <div className="marketing-page">
      <MarketingPageHeader title={mode === "agenda" ? "إنشاء أجندة" : "إنشاء حملة"} description={mode === "agenda" ? "فلو الأجندة النهائي بثلاث خطوات، مع نفس نظام المهام والعلاقات." : "فلو الحملة النهائي بخمس خطوات، بدون طلب هيكل مستقل."} />
      {error ? <MarketingError message={error} /> : null}
      <div className="marketing-wizard-steps">{steps.map((label, index) => <button type="button" key={label} className={index === step ? "active" : index < step ? "done" : ""} onClick={() => index < step && setStep(index)}><i>{index < step ? <Check size={14} /> : index + 1}</i><span>{label}</span></button>)}</div>
      <section className="marketing-panel marketing-wizard-panel">
        {step === 0 ? <div className="marketing-form-grid">
          {mode === "agenda" ? <label><span>الشهر</span><input type="month" value={draft.monthKey} onChange={(event) => setDraft({ ...draft, monthKey: event.target.value })} /></label> : <label><span>تاريخ الطلب</span><input type="date" value={draft.requestDate} onChange={(event) => setDraft({ ...draft, requestDate: event.target.value })} /></label>}
          <label><span>{mode === "agenda" ? "اسم الأجندة" : "اسم الحملة"}</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={mode === "agenda" ? "أجندة شهر..." : "اسم الحملة"} /></label>
          {mode === "campaign" ? <label><span>نوع الحملة</span><select value={draft.campaignType} onChange={(event) => setDraft({ ...draft, campaignType: event.target.value })}>{meta.campaignTypes.filter((item) => item.code !== "agenda").map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select></label> : null}
          <label><span>بداية النشر</span><input type="date" value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} /></label>
          <label><span>نهاية النشر</span><input type="date" value={draft.endsAt} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} /></label>
          <label className="wide"><span>الهدف</span><textarea rows={3} value={draft.objective} onChange={(event) => setDraft({ ...draft, objective: event.target.value })} /></label>
          <label className="wide"><span>Content Brief / المطلوب</span><textarea rows={5} value={draft.contentBrief} onChange={(event) => setDraft({ ...draft, contentBrief: event.target.value })} /></label>
        </div> : null}

        {step === 1 ? <div className="marketing-builder-list">
          {draft.creatives.map((creative, creativeIndex) => {
            const catalog = meta.creatives.find((item) => item.id === creative.catalogCreativeId);
            return <article className="marketing-builder-card" key={creative.clientKey}>
              <header><div><b>كرييتيف {creativeIndex + 1}</b><small>{catalog?.name || "اختر النوع"}</small></div>{draft.creatives.length > 1 ? <button type="button" onClick={() => removeCreative(creativeIndex)}><Trash size={17} /></button> : null}</header>
              <div className="marketing-form-grid compact">
                <label><span>نوع الكرييتيف</span><select value={creative.catalogCreativeId} onChange={(event) => { const next = meta.creatives.find((item) => item.id === event.target.value); patchCreative(creativeIndex, { catalogCreativeId: event.target.value, creativeType: next?.code || "", primaryDepartmentCode: next?.primary_department_code || "", executionAssignments: creative.executionAssignments.map((assignment) => ({ ...assignment, departmentCode: next?.primary_department_code || assignment.departmentCode })) }); }}>{meta.creatives.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
                <label><span>العدد</span><input type="number" min={1} value={creative.quantity} onChange={(event) => patchCreative(creativeIndex, { quantity: Number(event.target.value) || 1 })} /></label>
                <label><span>القسم الأساسي</span><select value={creative.primaryDepartmentCode} onChange={(event) => patchCreative(creativeIndex, { primaryDepartmentCode: event.target.value })}>{meta.departments.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select></label>
              </div>
              <div className="marketing-subsection"><div className="marketing-subsection-title"><h3>المستخدمون التنفيذيون وربط كتاب المحتوى</h3><button type="button" onClick={() => patchCreative(creativeIndex, { executionAssignments: [...creative.executionAssignments, { departmentCode: creative.primaryDepartmentCode, userId: "", dueAt: "", notes: "", writerLinks: [{ contentUserId: "", dueAt: "", notes: "" }] }] })}><Plus size={16} />إضافة توزيع</button></div>
                {creative.executionAssignments.map((assignment, assignmentIndex) => <div className="marketing-assignment" key={`${creative.clientKey}-${assignmentIndex}`}>
                  <div className="marketing-form-grid compact">
                    <label><span>القسم</span><select value={assignment.departmentCode} onChange={(event) => patchCreative(creativeIndex, { executionAssignments: creative.executionAssignments.map((item, index) => index === assignmentIndex ? { ...item, departmentCode: event.target.value } : item) })}>{meta.departments.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select></label>
                    <label><span>المستخدم التنفيذي</span><select value={assignment.userId} onChange={(event) => patchCreative(creativeIndex, { executionAssignments: creative.executionAssignments.map((item, index) => index === assignmentIndex ? { ...item, userId: event.target.value } : item) })}><option value="">اختر المستخدم</option>{meta.users.filter((item) => !assignment.departmentCode || item.department_codes.includes(assignment.departmentCode) || meta.access.admin).map((item) => <option value={item.id} key={item.id}>{item.full_name}</option>)}</select></label>
                    <label><span>موعد التنفيذ</span><input type="datetime-local" value={assignment.dueAt} onChange={(event) => patchCreative(creativeIndex, { executionAssignments: creative.executionAssignments.map((item, index) => index === assignmentIndex ? { ...item, dueAt: event.target.value } : item) })} /></label>
                    <label className="wide"><span>ملاحظة القسم</span><input value={assignment.notes} onChange={(event) => patchCreative(creativeIndex, { executionAssignments: creative.executionAssignments.map((item, index) => index === assignmentIndex ? { ...item, notes: event.target.value } : item) })} /></label>
                  </div>
                  <div className="marketing-writer-links"><div className="marketing-subsection-title"><h4>كتاب المحتوى المرتبطون بهذا المستخدم</h4><button type="button" onClick={() => patchCreative(creativeIndex, { executionAssignments: creative.executionAssignments.map((item, index) => index === assignmentIndex ? { ...item, writerLinks: [...item.writerLinks, { contentUserId: "", dueAt: "", notes: "" }] } : item) })}><Plus size={15} />كاتب</button></div>
                    {assignment.writerLinks.map((link, writerIndex) => <div className="marketing-writer-row" key={`${assignmentIndex}-${writerIndex}`}><select value={link.contentUserId} onChange={(event) => patchCreative(creativeIndex, { executionAssignments: creative.executionAssignments.map((item, index) => index === assignmentIndex ? { ...item, writerLinks: item.writerLinks.map((writer, wi) => wi === writerIndex ? { ...writer, contentUserId: event.target.value } : writer) } : item) })}><option value="">اختر كاتب المحتوى</option>{meta.users.filter((item) => item.department_codes.includes("content") || meta.access.admin).map((item) => <option value={item.id} key={item.id}>{item.full_name}</option>)}</select><input type="datetime-local" value={link.dueAt} onChange={(event) => patchCreative(creativeIndex, { executionAssignments: creative.executionAssignments.map((item, index) => index === assignmentIndex ? { ...item, writerLinks: item.writerLinks.map((writer, wi) => wi === writerIndex ? { ...writer, dueAt: event.target.value } : writer) } : item) })} /><input placeholder="ملاحظة الكاتب" value={link.notes} onChange={(event) => patchCreative(creativeIndex, { executionAssignments: creative.executionAssignments.map((item, index) => index === assignmentIndex ? { ...item, writerLinks: item.writerLinks.map((writer, wi) => wi === writerIndex ? { ...writer, notes: event.target.value } : writer) } : item) })} />{assignment.writerLinks.length > 1 ? <button type="button" onClick={() => patchCreative(creativeIndex, { executionAssignments: creative.executionAssignments.map((item, index) => index === assignmentIndex ? { ...item, writerLinks: item.writerLinks.filter((_, wi) => wi !== writerIndex) } : item) })}><Trash size={16} /></button> : null}</div>)}
                  </div>
                  {creative.executionAssignments.length > 1 ? <button className="marketing-text-danger" type="button" onClick={() => patchCreative(creativeIndex, { executionAssignments: creative.executionAssignments.filter((_, index) => index !== assignmentIndex) })}>حذف هذا التوزيع</button> : null}
                </div>)}
              </div>
            </article>;
          })}
          <button className="marketing-add-card" type="button" onClick={() => setDraft((current) => ({ ...current, creatives: [...current.creatives, emptyCreative(meta)] }))}><Plus size={20} />إضافة كرييتيف جديد</button>
          {mode === "agenda" ? <AgendaScheduleBuilder draft={draft} setDraft={setDraft} meta={meta} creativeOptions={creativeOptions} /> : null}
        </div> : null}

        {mode === "campaign" && step === 2 ? <div className="marketing-builder-list"><div className="marketing-subsection-title"><div><h2>الميزانية</h2><p>كل صف مرتبط بـCreative Instance محدد.</p></div><button type="button" onClick={addBudget}><Plus size={16} />إضافة صف</button></div>{draft.budgetItems.map((item, index) => <article className="marketing-builder-card" key={index}><header><b>صف ميزانية {index + 1}</b><button type="button" onClick={() => setDraft((current) => ({ ...current, budgetItems: current.budgetItems.filter((_, itemIndex) => itemIndex !== index) }))}><Trash size={17} /></button></header><div className="marketing-form-grid compact"><label><span>الكرييتيف</span><select value={item.creativeClientKey} onChange={(event) => setDraft((current) => ({ ...current, budgetItems: current.budgetItems.map((row, i) => i === index ? { ...row, creativeClientKey: event.target.value } : row) }))}>{creativeOptions.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}</select></label><label><span>Funnel</span><select value={item.funnelId} onChange={(event) => setDraft((current) => ({ ...current, budgetItems: current.budgetItems.map((row, i) => i === index ? { ...row, funnelId: event.target.value } : row) }))}>{meta.funnels.map((funnel) => <option value={funnel.id} key={funnel.id}>{funnel.name}</option>)}</select></label><label><span>عدد الإعلانات</span><input type="number" min={0} value={item.adsCount} onChange={(event) => setDraft((current) => ({ ...current, budgetItems: current.budgetItems.map((row, i) => i === index ? { ...row, adsCount: Number(event.target.value) || 0 } : row) }))} /></label><label><span>إجمالي الصف</span><input type="number" min={0} value={item.rowTotal} onChange={(event) => setDraft((current) => ({ ...current, budgetItems: current.budgetItems.map((row, i) => i === index ? { ...row, rowTotal: Number(event.target.value) || 0 } : row) }))} /></label><label className="wide"><span>هدف المحتوى</span><input value={item.contentGoal} onChange={(event) => setDraft((current) => ({ ...current, budgetItems: current.budgetItems.map((row, i) => i === index ? { ...row, contentGoal: event.target.value } : row) }))} /></label><label className="wide"><span>النتيجة المتوقعة</span><input value={item.expectedTarget} onChange={(event) => setDraft((current) => ({ ...current, budgetItems: current.budgetItems.map((row, i) => i === index ? { ...row, expectedTarget: event.target.value } : row) }))} /></label></div><div className="marketing-platform-checks">{meta.platforms.map((platform) => { const selected = item.platforms.find((row) => row.platformId === platform.id); return <label key={platform.id}><input type="checkbox" checked={Boolean(selected)} onChange={(event) => setDraft((current) => ({ ...current, budgetItems: current.budgetItems.map((row, i) => i === index ? { ...row, platforms: event.target.checked ? [...row.platforms, { platformId: platform.id, amount: 0 }] : row.platforms.filter((entry) => entry.platformId !== platform.id) } : row) }))} /><span>{platform.name}</span>{selected ? <input type="number" min={0} value={selected.amount} onChange={(event) => setDraft((current) => ({ ...current, budgetItems: current.budgetItems.map((row, i) => i === index ? { ...row, platforms: row.platforms.map((entry) => entry.platformId === platform.id ? { ...entry, amount: Number(event.target.value) || 0 } : entry) } : row) }))} /> : null}</label>; })}</div></article>)}{!draft.budgetItems.length ? <button className="marketing-add-card" type="button" onClick={addBudget}><Plus size={20} />إضافة أول صف ميزانية</button> : null}<div className="marketing-total">إجمالي الميزانية: <strong>{draft.budgetItems.reduce((sum, item) => sum + Number(item.rowTotal || 0), 0).toLocaleString("ar-SA")} ر.س</strong></div></div> : null}

        {mode === "campaign" && step === 3 ? <ScheduleBuilder draft={draft} setDraft={setDraft} meta={meta} creativeOptions={creativeOptions} addSchedule={addSchedule} /> : null}

        {step === reviewStep ? <Review draft={draft} meta={meta} mode={mode} /> : null}

        <footer className="marketing-wizard-footer"><button type="button" className="marketing-button secondary" disabled={step === 0 || saving} onClick={() => { setError(""); setStep((current) => Math.max(0, current - 1)); }}><ArrowRight size={18} />السابق</button><span>الخطوة {step + 1} من {steps.length}</span>{step < reviewStep ? <button type="button" className="marketing-button" onClick={next}>التالي<ArrowLeft size={18} /></button> : <button type="button" className="marketing-button" disabled={saving} onClick={() => void submit()}><Check size={18} />{saving ? "جاري الإنشاء..." : mode === "agenda" ? "إنشاء الأجندة" : "حفظ وإنهاء"}</button>}</footer>
      </section>
    </div>
  );
}

function ScheduleBuilder({ draft, setDraft, meta, creativeOptions, addSchedule }: { draft: CampaignDraft; setDraft: React.Dispatch<React.SetStateAction<CampaignDraft>>; meta: MarketingMeta; creativeOptions: Array<{ key: string; label: string }>; addSchedule: () => void }) {
  return <div className="marketing-builder-list"><div className="marketing-subsection-title"><div><h2>جدول النشر</h2><p>أضف أكثر من عنصر في اليوم واربطه بالكرييتيف والمنصة ونوع النشر.</p></div><button type="button" onClick={addSchedule}><Plus size={16} />عنصر نشر</button></div>{draft.scheduleItems.map((item, index) => <article className="marketing-builder-card" key={index}><header><b>عنصر نشر {index + 1}</b><button type="button" onClick={() => setDraft((current) => ({ ...current, scheduleItems: current.scheduleItems.filter((_, i) => i !== index) }))}><Trash size={17} /></button></header><div className="marketing-form-grid compact"><label><span>الكرييتيف</span><select value={item.creativeClientKey} onChange={(event) => setDraft((current) => ({ ...current, scheduleItems: current.scheduleItems.map((row, i) => i === index ? { ...row, creativeClientKey: event.target.value } : row) }))}>{creativeOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label><label><span>التاريخ والوقت</span><input type="datetime-local" value={item.publishAt} onChange={(event) => setDraft((current) => ({ ...current, scheduleItems: current.scheduleItems.map((row, i) => i === index ? { ...row, publishAt: event.target.value } : row) }))} /></label><label className="wide"><span>ملاحظة</span><input value={item.notes} onChange={(event) => setDraft((current) => ({ ...current, scheduleItems: current.scheduleItems.map((row, i) => i === index ? { ...row, notes: event.target.value } : row) }))} /></label></div><div className="marketing-platform-targets">{meta.platforms.map((platform) => { const target = item.targets.find((row) => row.platformId === platform.id); const postTypes = meta.postTypes.filter((row) => row.platform_id === platform.id); return <div key={platform.id}><label><input type="checkbox" checked={Boolean(target)} onChange={(event) => setDraft((current) => ({ ...current, scheduleItems: current.scheduleItems.map((row, i) => i === index ? { ...row, targets: event.target.checked ? [...row.targets, { platformId: platform.id, postTypeId: postTypes[0]?.id || "", dimensions: postTypes[0]?.dimensions }] : row.targets.filter((entry) => entry.platformId !== platform.id) } : row) }))} /><span>{platform.name}</span></label>{target ? <select value={target.postTypeId} onChange={(event) => { const post = postTypes.find((row) => row.id === event.target.value); setDraft((current) => ({ ...current, scheduleItems: current.scheduleItems.map((row, i) => i === index ? { ...row, targets: row.targets.map((entry) => entry.platformId === platform.id ? { ...entry, postTypeId: event.target.value, dimensions: post?.dimensions } : entry) } : row) })); }}>{postTypes.length ? postTypes.map((post) => <option value={post.id} key={post.id}>{post.name}{post.dimensions ? ` · ${post.dimensions}` : ""}</option>) : <option value="">أضف نوع نشر من الإعدادات</option>}</select> : null}</div>; })}</div></article>)}{!draft.scheduleItems.length ? <button className="marketing-add-card" type="button" onClick={addSchedule}><Plus size={20} />إضافة أول عنصر نشر</button> : null}</div>;
}

function AgendaScheduleBuilder({ draft, setDraft, meta, creativeOptions }: { draft: CampaignDraft; setDraft: React.Dispatch<React.SetStateAction<CampaignDraft>>; meta: MarketingMeta; creativeOptions: Array<{ key: string; label: string }> }) {
  const add = () => setDraft((current) => ({ ...current, scheduleItems: [...current.scheduleItems, { creativeClientKey: current.creatives[0]?.clientKey || "", publishAt: `${current.startsAt}T16:00`, notes: "", targets: [] }] }));
  return <div className="marketing-agenda-schedule"><ScheduleBuilder draft={draft} setDraft={setDraft} meta={meta} creativeOptions={creativeOptions} addSchedule={add} /></div>;
}

function Review({ draft, meta, mode }: { draft: CampaignDraft; meta: MarketingMeta; mode: "campaign" | "agenda" }) {
  const pairs = draft.creatives.reduce((sum, creative) => sum + creative.executionAssignments.reduce((assignmentSum, assignment) => assignmentSum + assignment.writerLinks.length, 0), 0);
  return <div className="marketing-review"><div className="marketing-review-hero"><span>{mode === "agenda" ? "أجندة" : "حملة"}</span><h2>{draft.name || "بدون اسم"}</h2><p>{draft.startsAt} — {draft.endsAt}</p></div><div className="marketing-detail-grid"><article><span>الكرييتيفات</span><strong>{draft.creatives.length}</strong></article><article><span>الأزواج</span><strong>{pairs}</strong></article><article><span>مهام المحتوى</span><strong>{pairs}</strong></article><article><span>مهام التنفيذ</span><strong>{pairs}</strong></article><article><span>عناصر النشر</span><strong>{draft.scheduleItems.length}</strong></article><article><span>الميزانية</span><strong>{draft.budgetItems.reduce((sum, item) => sum + item.rowTotal, 0).toLocaleString("ar-SA")} ر.س</strong></article></div><section><h3>الكرييتيف والتوزيع</h3><div className="marketing-mini-list">{draft.creatives.map((creative, index) => <article key={creative.clientKey}><div><strong>{meta.creatives.find((item) => item.id === creative.catalogCreativeId)?.name || `كرييتيف ${index + 1}`}</strong><span>{creative.executionAssignments.length} توزيع · {creative.executionAssignments.reduce((sum, assignment) => sum + assignment.writerLinks.length, 0)} ربط محتوى</span></div></article>)}</div></section><section><h3>الهدف</h3><p>{draft.objective || "—"}</p></section><section><h3>المطلوب</h3><p>{draft.contentBrief || "—"}</p></section></div>;
}
