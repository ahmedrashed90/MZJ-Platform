import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarBlank, CheckCircle, FolderOpen, Plus, Trash } from "@phosphor-icons/react";
import { useOutletContext } from "react-router-dom";
import { marketingFetch, marketingQuery, todayIso, uid } from "../api";
import type { DraftBudgetItem, DraftInstance, DraftPost, DraftScheduleItem } from "../types";
import type { MarketingOutletContext } from "../MarketingLayout";
import { Alert, ConfirmButton, Empty, PageHead } from "../components/Ui";
import { InstanceEditor } from "../components/InstanceEditor";

type CampaignFields = { campaignDate: string; publishStartDate: string; publishEndDate: string; campaignTypeId: string; name: string; objective: string; contentBrief: string };
const initialFields: CampaignFields = { campaignDate: todayIso(), publishStartDate: todayIso(), publishEndDate: todayIso(), campaignTypeId: "", name: "", objective: "", contentBrief: "" };

function createInstance(creativeId: string, primaryDepartmentId: string): DraftInstance {
  return { key: uid("creative"), creativeId, agendaDate: "", contentReceivedDate: "", contentNotes: "", writers: [], departments: [{ departmentId: primaryDepartmentId, isPrimary: true, dueDate: "", notes: "", assignments: [] }], vehicleIds: [], posts: [] };
}
function currency(value: number) { return new Intl.NumberFormat("ar-SA", { style: "currency", currency: "SAR", maximumFractionDigits: 2 }).format(value); }

export function CreateCampaignPage() {
  const { meta } = useOutletContext<MarketingOutletContext>();
  const [step, setStep] = useState(1);
  const [fields, setFields] = useState<CampaignFields>(initialFields);
  const [selectedCreativeId, setSelectedCreativeId] = useState("");
  const [instances, setInstances] = useState<DraftInstance[]>([]);
  const [budgetItems, setBudgetItems] = useState<DraftBudgetItem[]>([]);
  const [schedule, setSchedule] = useState<DraftScheduleItem[]>([]);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleInstanceKey, setScheduleInstanceKey] = useState("");
  const [schedulePosts, setSchedulePosts] = useState<DraftPost[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [createRaw, setCreateRaw] = useState(false);
  const [campaignCodePreview, setCampaignCodePreview] = useState("");
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!fields.campaignTypeId || !fields.campaignDate) { setCampaignCodePreview(""); return; }
    let cancelled = false;
    marketingFetch<{ ok: true; campaignCode: string }>(`/api/marketing${marketingQuery({ resource: "campaign_code_preview", campaignTypeId: fields.campaignTypeId, campaignDate: fields.campaignDate })}`)
      .then((result) => { if (!cancelled) setCampaignCodePreview(result.campaignCode); })
      .catch(() => { if (!cancelled) setCampaignCodePreview(""); });
    return () => { cancelled = true; };
  }, [fields.campaignDate, fields.campaignTypeId]);

  const budgetTotal = useMemo(() => budgetItems.reduce((sum, item) => sum + item.platformValues.reduce((platformSum, value) => platformSum + Number(value.amount || 0), 0), 0), [budgetItems]);
  const rangeDates = useMemo(() => {
    if (!fields.publishStartDate || !fields.publishEndDate || fields.publishEndDate < fields.publishStartDate) return [];
    const result: string[] = []; const cursor = new Date(`${fields.publishStartDate}T00:00:00`); const end = new Date(`${fields.publishEndDate}T00:00:00`);
    while (cursor <= end && result.length < 370) { result.push(cursor.toISOString().slice(0, 10)); cursor.setDate(cursor.getDate() + 1); }
    return result;
  }, [fields.publishStartDate, fields.publishEndDate]);

  function addCreative() {
    const creative = meta.creatives.find((item) => item.id === selectedCreativeId && item.is_active);
    if (!creative) return;
    setInstances((current) => [...current, createInstance(creative.id, creative.primary_department_id)]); setSelectedCreativeId("");
  }
  function addBudgetItem() {
    setBudgetItems((current) => [...current, { key: uid("budget"), funnelId: "", instanceKey: instances[0]?.key || "", adsCount: 0, contentGoal: "", expectedGoal: "", platformValues: [] }]);
  }
  function updateBudget(index: number, patch: Partial<DraftBudgetItem>) { setBudgetItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)); }
  function toggleBudgetPlatform(item: DraftBudgetItem, platformId: string) {
    const exists = item.platformValues.some((value) => value.platformId === platformId);
    return { ...item, platformValues: exists ? item.platformValues.filter((value) => value.platformId !== platformId) : [...item.platformValues, { platformId, amount: 0 }] };
  }
  function updateBudgetPlatform(item: DraftBudgetItem, platformId: string, amount: number) { return { ...item, platformValues: item.platformValues.map((value) => value.platformId === platformId ? { ...value, amount } : value) }; }
  function toggleSchedulePost(platformId: string, postTypeId: string) {
    const exists = schedulePosts.some((post) => post.platformId === platformId && post.postTypeId === postTypeId);
    setSchedulePosts((current) => exists ? current.filter((post) => !(post.platformId === platformId && post.postTypeId === postTypeId)) : [...current, { platformId, postTypeId }]);
  }
  function addScheduleItem() {
    if (!scheduleDate || !scheduleInstanceKey || !schedulePosts.length) { setError("اختر اليوم والكرييتيف والمنصة ونوع النشر."); return; }
    setSchedule((current) => {
      const existing = current.find((item) => item.publishDate === scheduleDate && item.instanceKey === scheduleInstanceKey);
      if (!existing) return [...current, { key: uid("schedule"), publishDate: scheduleDate, instanceKey: scheduleInstanceKey, posts: schedulePosts }];
      const merged = [...existing.posts];
      for (const post of schedulePosts) {
        if (!merged.some((item) => item.platformId === post.platformId && item.postTypeId === post.postTypeId)) merged.push(post);
      }
      return current.map((item) => item.key === existing.key ? { ...item, posts: merged } : item);
    });
    setSchedulePosts([]); setScheduleInstanceKey(""); setError("");
  }
  function validateStep(currentStep: number) {
    if (currentStep === 1) {
      if (!fields.name.trim() || !fields.campaignTypeId || !fields.campaignDate || !fields.publishStartDate || !fields.publishEndDate) return "أكمل بيانات الحملة الإلزامية.";
      if (fields.publishEndDate < fields.publishStartDate) return "تاريخ نهاية النشر يجب ألا يسبق البداية.";
    }
    if (currentStep === 2) {
      if (!instances.length) return "اختر كرييتيف واحدًا على الأقل.";
      for (const [index, instance] of instances.entries()) {
        if (!instance.writers.length) return `الكرييتيف رقم ${index + 1}: اختر كاتب محتوى.`;
        if (!instance.departments.length || instance.departments.some((department) => !department.assignments.length)) return `الكرييتيف رقم ${index + 1}: أكمل ربط اليوزرات بكتاب المحتوى في كل قسم.`;
      }
    }
    if (currentStep === 3 && budgetItems.some((item) => !item.instanceKey || !item.funnelId || !item.platformValues.length)) return "أكمل كل بنود الميزانية أو احذف البند غير المكتمل.";
    if (currentStep === 4 && !schedule.length) return "أضف منشورًا واحدًا على الأقل إلى جدول النشر.";
    return "";
  }
  function next() { const validation = validateStep(step); if (validation) { setError(validation); return; } setError(""); setStep((current) => Math.min(5, current + 1)); }
  function previous() { setError(""); setStep((current) => Math.max(1, current - 1)); }
  function reset(clearMessage = true) { setStep(1); setFields(initialFields); setInstances([]); setBudgetItems([]); setSchedule([]); setScheduleDate(""); setScheduleInstanceKey(""); setSchedulePosts([]); setSelectedCreativeId(""); setError(""); if (clearMessage) setMessage(""); setCreateRaw(false); setCampaignCodePreview(""); idempotencyKey.current = crypto.randomUUID(); }
  async function create() {
    for (const checkStep of [1, 2, 3, 4]) { const validation = validateStep(checkStep); if (validation) { setError(validation); setStep(checkStep); return; } }
    setBusy(true); setError(""); setMessage("");
    try {
      const payload = {
        action: "create_campaign", sourceKind: "campaign", ...fields, idempotencyKey: idempotencyKey.current,
        instances: instances.map((instance) => ({ ...instance, key: undefined })),
        budgetItems: budgetItems.map((item) => ({ ...item, key: undefined, instanceIndex: instances.findIndex((instance) => instance.key === item.instanceKey) })),
        schedule: schedule.map((item) => ({ ...item, key: undefined, instanceIndex: instances.findIndex((instance) => instance.key === item.instanceKey) })),
      };
      const response = await marketingFetch<{ ok: true; campaignId: string; campaignCode: string }>("/api/marketing", { method: "POST", body: JSON.stringify(payload) });
      let rawWarning = "";
      if (createRaw) {
        try { await marketingFetch("/api/marketing", { method: "POST", body: JSON.stringify({ action: "campaign_action", campaignAction: "create_raw_folders", campaignId: response.campaignId }) }); }
        catch (failure) { rawWarning = ` تم إنشاء الحملة، لكن تعذر إنشاء فولدرات الخام: ${failure instanceof Error ? failure.message : "خطأ غير معروف"}`; }
      }
      reset(false);
      setMessage(`تم إنشاء الحملة ${response.campaignCode} وإنشاء التاسكات بدون تكرار.${rawWarning}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر إنشاء الحملة"); }
    finally { setBusy(false); }
  }

  return <div className="marketing-page marketing-wizard-page">
    <PageHead title="إنشاء حملة" description="بيانات الحملة، الكرييتيف، الميزانية، جدول النشر، ثم المراجعة والإنشاء." />
    {error ? <Alert type="error">{error}</Alert> : null}{message ? <Alert type="success">{message}</Alert> : null}
    <div className="marketing-wizard-steps">{["بيانات الحملة", "الكرييتيف", "الميزانية", "جدول النشر", "المراجعة"].map((label, index) => <button type="button" key={label} className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""} onClick={() => { const target = index + 1; if (target < step) setStep(target); }}><span>{step > index + 1 ? <CheckCircle size={20} weight="fill" /> : index + 1}</span>{label}</button>)}</div>
    <section className="marketing-wizard-panel">
      {step === 1 ? <div className="marketing-form-grid"><label><span>تاريخ الحملة</span><input type="date" value={fields.campaignDate} onChange={(event) => setFields({ ...fields, campaignDate: event.target.value })} /></label><label><span>بداية النشر</span><input type="date" value={fields.publishStartDate} onChange={(event) => setFields({ ...fields, publishStartDate: event.target.value })} /></label><label><span>نهاية النشر</span><input type="date" value={fields.publishEndDate} onChange={(event) => setFields({ ...fields, publishEndDate: event.target.value })} /></label><label><span>نوع الحملة</span><select value={fields.campaignTypeId} onChange={(event) => setFields({ ...fields, campaignTypeId: event.target.value })}><option value="">اختر نوع الحملة</option>{meta.campaignTypes.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>كود الحملة</span><input readOnly value={campaignCodePreview} placeholder="يظهر تلقائيًا بعد اختيار نوع الحملة" /></label><label><span>اسم الحملة</span><input value={fields.name} onChange={(event) => setFields({ ...fields, name: event.target.value })} /></label><label className="wide"><span>هدف الحملة</span><textarea rows={3} value={fields.objective} onChange={(event) => setFields({ ...fields, objective: event.target.value })} /></label><label className="wide"><span>المطلوب من كاتب المحتوى</span><textarea rows={3} value={fields.contentBrief} onChange={(event) => setFields({ ...fields, contentBrief: event.target.value })} /></label></div> : null}
      {step === 2 ? <div><div className="marketing-add-row"><select value={selectedCreativeId} onChange={(event) => setSelectedCreativeId(event.target.value)}><option value="">اختر الكرييتيف</option>{meta.creatives.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ConfirmButton onClick={addCreative} disabled={!selectedCreativeId}><Plus size={17} />إضافة كرييتيف</ConfirmButton></div>{instances.map((instance, index) => <InstanceEditor key={instance.key} instance={instance} meta={meta} onChange={(nextInstance) => setInstances((current) => current.map((item, itemIndex) => itemIndex === index ? nextInstance : item))} onRemove={() => { setInstances((current) => current.filter((_, itemIndex) => itemIndex !== index)); setBudgetItems((current) => current.filter((item) => item.instanceKey !== instance.key)); setSchedule((current) => current.filter((item) => item.instanceKey !== instance.key)); }} />)}{!instances.length ? <Empty text="اختر كرييتيف واحدًا أو أكثر. يمكن إضافة نفس النوع أكثر من مرة كـInstances مستقلة." /> : null}</div> : null}
      {step === 3 ? <div><div className="marketing-section-title"><div><h2>الميزانية</h2><p>كل بند مرتبط بالـCreative Instance، وليس باسم الكرييتيف فقط.</p></div><ConfirmButton tone="secondary" onClick={addBudgetItem}><Plus size={17} />إضافة بند ميزانية</ConfirmButton></div>{budgetItems.map((item, index) => <article className="marketing-budget-card" key={item.key}><button type="button" className="marketing-remove-corner" onClick={() => setBudgetItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash size={17} /></button><div className="marketing-form-grid compact"><label><span>Funnel</span><select value={item.funnelId} onChange={(event) => updateBudget(index, { funnelId: event.target.value })}><option value="">اختر Funnel</option>{meta.funnels.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label><span>المنتج / الكرييتيف</span><select value={item.instanceKey} onChange={(event) => updateBudget(index, { instanceKey: event.target.value })}><option value="">اختر الكرييتيف</option>{instances.map((instance, instanceIndex) => <option key={instance.key} value={instance.key}>{meta.creatives.find((creative) => creative.id === instance.creativeId)?.name} #{instanceIndex + 1}</option>)}</select></label><label><span>عدد الإعلانات</span><input type="number" min="0" value={item.adsCount} onChange={(event) => updateBudget(index, { adsCount: Number(event.target.value) })} /></label><label><span>هدف المحتوى</span><input value={item.contentGoal} onChange={(event) => updateBudget(index, { contentGoal: event.target.value })} /></label><label><span>الهدف المتوقع</span><input value={item.expectedGoal} onChange={(event) => updateBudget(index, { expectedGoal: event.target.value })} /></label></div><div className="marketing-budget-platforms">{meta.platforms.filter((platform) => platform.is_active).map((platform) => { const selected = item.platformValues.find((value) => value.platformId === platform.id); return <label key={platform.id} className={selected ? "selected" : ""}><span><input type="checkbox" checked={Boolean(selected)} onChange={() => updateBudget(index, toggleBudgetPlatform(item, platform.id))} />{platform.name}</span><input type="number" min="0" placeholder="قيمة المنصة" disabled={!selected} value={selected?.amount || ""} onChange={(event) => updateBudget(index, updateBudgetPlatform(item, platform.id, Number(event.target.value)))} /></label>; })}</div><div className="marketing-budget-total">إجمالي البند: <b>{currency(item.platformValues.reduce((sum, value) => sum + Number(value.amount || 0), 0))}</b></div></article>)}{!budgetItems.length ? <Empty text="لا توجد بنود ميزانية. أضف بندًا واحدًا أو اترك الميزانية بلا بنود إذا لم تكن مطلوبة." /> : null}<div className="marketing-grand-total"><span>إجمالي الميزانية</span><strong>{currency(budgetTotal)}</strong></div></div> : null}
      {step === 4 ? <div className="marketing-schedule-builder"><div className="marketing-schedule-calendar"><h2>فترة النشر</h2><div>{rangeDates.map((date) => <button type="button" key={date} className={scheduleDate === date ? "active" : ""} onClick={() => setScheduleDate(date)}><b>{new Date(`${date}T00:00:00`).toLocaleDateString("ar-SA", { weekday: "short" })}</b><span>{date}</span><em>{schedule.filter((item) => item.publishDate === date).length} منشور</em></button>)}</div></div><div className="marketing-schedule-form"><label><span>اليوم</span><input type="date" min={fields.publishStartDate} max={fields.publishEndDate} value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} /></label><label><span>المنتج / الكرييتيف</span><select value={scheduleInstanceKey} onChange={(event) => setScheduleInstanceKey(event.target.value)}><option value="">اختر الكرييتيف</option>{instances.map((instance, index) => <option key={instance.key} value={instance.key}>{meta.creatives.find((creative) => creative.id === instance.creativeId)?.name} #{index + 1}</option>)}</select></label><div className="marketing-platform-picker">{meta.platforms.filter((platform) => platform.is_active).map((platform) => <article key={platform.id}><strong>{platform.name}</strong>{platform.post_types.filter((postType) => postType.is_active).map((postType) => <label key={postType.id}><input type="checkbox" checked={schedulePosts.some((post) => post.platformId === platform.id && post.postTypeId === postType.id)} onChange={() => toggleSchedulePost(platform.id, postType.id)} /><span>{postType.name}</span></label>)}</article>)}</div><ConfirmButton onClick={addScheduleItem}><Plus size={17} />إضافة اليوم</ConfirmButton></div><div className="marketing-schedule-table"><h3>منشورات جدول النشر</h3>{schedule.map((item) => <article key={item.key}><b>{item.publishDate}</b><span>{meta.creatives.find((creative) => creative.id === instances.find((instance) => instance.key === item.instanceKey)?.creativeId)?.name}</span><span>{item.posts.map((post) => `${meta.platforms.find((platform) => platform.id === post.platformId)?.name}: ${meta.platforms.flatMap((platform) => platform.post_types).find((postType) => postType.id === post.postTypeId)?.name}`).join("، ")}</span><button type="button" onClick={() => setSchedule((current) => current.filter((row) => row.key !== item.key))}><Trash size={16} /></button></article>)}</div></div> : null}
      {step === 5 ? <div className="marketing-review"><div className="marketing-review-grid"><section><h3>بيانات الحملة</h3><p><b>الاسم:</b> {fields.name}</p><p><b>نوع الحملة:</b> {meta.campaignTypes.find((item) => item.id === fields.campaignTypeId)?.name}</p><p><b>فترة النشر:</b> {fields.publishStartDate} — {fields.publishEndDate}</p><p><b>الهدف:</b> {fields.objective || "—"}</p><p><b>المطلوب من الكاتب:</b> {fields.contentBrief || "—"}</p></section><section><h3>الميزانية وجدول النشر</h3><p>بنود الميزانية: {budgetItems.length}</p><p>إجمالي الميزانية: {currency(budgetTotal)}</p><p>منشورات الجدول: {schedule.length}</p></section></div><section><h3>الكرييتيفات وتوزيع اليوزرات والسيارات</h3><div className="marketing-review-instances">{instances.map((instance, index) => <article key={instance.key}><b>N{String(index + 1).padStart(2, "0")} - {meta.creatives.find((creative) => creative.id === instance.creativeId)?.name}</b><p>كتاب المحتوى: {instance.writers.map((writer) => meta.users.find((person) => person.id === writer.userId)?.full_name).join("، ")}</p><p>الأقسام: {instance.departments.map((department) => meta.departments.find((item) => item.id === department.departmentId)?.name).join("، ")}</p><p>العلاقات: {instance.departments.reduce((sum, department) => sum + department.assignments.length, 0)}</p><p>السيارات: {instance.vehicleIds.length}</p></article>)}</div></section><label className="marketing-raw-option"><input type="checkbox" checked={createRaw} onChange={(event) => setCreateRaw(event.target.checked)} /><FolderOpen size={20} /><span><b>إنشاء فولدرات الخام</b><small>RAW-01 للخام وOUTPUT-02 للتسليم بعد حفظ الحملة، بدون أي Publisher محلي.</small></span></label></div> : null}
      <footer className="marketing-wizard-footer"><div>{step > 1 ? <ConfirmButton tone="secondary" onClick={previous}>السابق</ConfirmButton> : null}<ConfirmButton tone="secondary" onClick={reset}>مسح النموذج</ConfirmButton></div>{step < 5 ? <ConfirmButton onClick={next}>التالي</ConfirmButton> : <ConfirmButton onClick={() => void create()} disabled={busy}>{busy ? "جاري إنشاء الحملة..." : "إنشاء الحملة"}</ConfirmButton>}</footer>
    </section>
  </div>;
}
