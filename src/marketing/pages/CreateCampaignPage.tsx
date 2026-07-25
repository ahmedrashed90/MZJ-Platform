import { useEffect, useMemo, useState } from "react";
import { getJSZip } from "../zip";
import { CalendarBlank, CheckCircle, FolderOpen, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { marketingFetch, marketingLocalDateKey, marketingQuery } from "../api";
import { CreativeEditor, newCreativeDraft } from "../components/CreativeEditor";
import { MarketingAlert, MarketingPage } from "../components/MarketingPage";
import { relationshipCsv } from "../templateExcel";
import type { CreativeDraft, MarketingMeta } from "../types";

const emptyMeta: MarketingMeta = { ok: true, users: [], departments: [], contentDepartmentId: "", actions: [], creativeTypes: [], campaignTypes: [], platforms: [], postTypes: [], funnels: [], cars: [], connections: [], permissions: { effective: [] } };
const steps = ["بيانات الحملة", "الكرييتيف", "الميزانية", "جدول النشر", "المراجعة والإنشاء"];
type Budget = { id: string; funnelId: string; creativeTempId: string; adsCount: number; contentGoal: string; expectedGoal: string; platformAmounts: Array<{ platformId: string; amount: number }> };
type Schedule = { id: string; date: string; creativeTempId: string; platforms: Array<{ platformId: string; postTypeIds: string[] }> };
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function datesBetween(start: string, end: string) {
  const result: string[] = [];
  if (!start || !end) return result;
  const current = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (current <= last && result.length < 370) {
    result.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return result;
}

function emptySchedule(date = ""): Schedule {
  return { id: uid(), date, creativeTempId: "", platforms: [] };
}

export function CreateCampaignPage() {
  const [meta, setMeta] = useState<MarketingMeta>(emptyMeta);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ campaignDate: marketingLocalDateKey(), publishStart: "", publishEnd: "", campaignTypeId: "", campaignCode: "", name: "", objective: "", requiredFromContent: "" });
  const [creatives, setCreatives] = useState<CreativeDraft[]>([newCreativeDraft()]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [schedule, setSchedule] = useState<Schedule[]>([]);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleDraft, setScheduleDraft] = useState<Schedule>(emptySchedule());
  const [editingScheduleId, setEditingScheduleId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    marketingFetch<MarketingMeta>(`/api/marketing${marketingQuery({ resource: "meta" })}`).then(setMeta).catch((failure) => setError(failure instanceof Error ? failure.message : "تعذر تحميل الإعدادات"));
  }, []);

  useEffect(() => {
    if (!form.publishStart) return;
    setScheduleDate((current) => current && current >= form.publishStart && (!form.publishEnd || current <= form.publishEnd) ? current : form.publishStart);
    setScheduleDraft((current) => ({ ...current, date: current.date || form.publishStart }));
  }, [form.publishStart, form.publishEnd]);

  async function campaignTypeChanged(id: string) {
    setForm((current) => ({ ...current, campaignTypeId: id, campaignCode: "" }));
    if (!id) return;
    try {
      const payload = await marketingFetch<{ code: string }>(`/api/marketing${marketingQuery({ resource: "campaign_code", campaignTypeId: id })}`);
      setForm((current) => current.campaignTypeId === id ? { ...current, campaignCode: payload.code } : current);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر توليد كود الحملة");
    }
  }

  function updateCreative(index: number, value: CreativeDraft) {
    setCreatives((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  }

  function creativeName(tempId: string) {
    const creative = creatives.find((item) => item.tempId === tempId);
    return meta.creativeTypes.find((item) => item.id === creative?.creativeTypeId)?.name || "—";
  }

  function platformName(id: string) {
    return meta.platforms.find((item) => item.id === id)?.name || "—";
  }

  const totalBudget = useMemo(() => budgets.reduce((sum, item) => sum + item.platformAmounts.reduce((part, platform) => part + Number(platform.amount || 0), 0), 0), [budgets]);
  const publishingDays = useMemo(() => datesBetween(form.publishStart, form.publishEnd), [form.publishStart, form.publishEnd]);
  const selectedDayPosts = useMemo(() => schedule.filter((item) => item.date === scheduleDate), [schedule, scheduleDate]);

  const relations = useMemo(() => creatives.flatMap((creative) => {
    const creativeLabel = meta.creativeTypes.find((item) => item.id === creative.creativeTypeId)?.name || "";
    const user = (id: string) => meta.users.find((item) => item.id === id)?.full_name || meta.users.find((item) => item.id === id)?.fullName || id;
    const rows: Record<string, unknown>[] = [];
    creative.primaryAssignments.forEach((assignment) => assignment.contentUserIds.forEach((contentId) => rows.push({ day: "", creative: creativeLabel, department: meta.creativeTypes.find((item) => item.id === creative.creativeTypeId)?.primary_department_name, user: user(assignment.userId), contentUser: user(contentId), dueOn: assignment.dueOn, note: assignment.note })));
    creative.optionalAssignments.forEach((group) => group.assignments.forEach((assignment) => assignment.contentUserIds.forEach((contentId) => rows.push({ day: "", creative: creativeLabel, department: meta.departments.find((item) => item.id === group.departmentId)?.name, user: user(assignment.userId), contentUser: user(contentId), dueOn: assignment.dueOn, note: assignment.note }))));
    return rows;
  }), [creatives, meta]);

  function validateCurrent() {
    if (step === 0 && (!form.campaignTypeId || !form.campaignCode || !form.name || !form.publishStart || !form.publishEnd)) return "أكمل بيانات الحملة الأساسية";
    if (step === 1 && (!creatives.length || creatives.some((item) => !item.creativeTypeId || !item.contentAssignments.length))) return "أكمل الكرييتيف وقسم المحتوى";
    return "";
  }

  function next() {
    const issue = validateCurrent();
    if (issue) { setError(issue); return; }
    setError("");
    setStep((current) => Math.min(4, current + 1));
  }

  function selectScheduleDate(date: string) {
    setScheduleDate(date);
    setEditingScheduleId("");
    setScheduleDraft(emptySchedule(date));
  }

  function toggleSchedulePlatform(platformId: string) {
    const selected = scheduleDraft.platforms.some((item) => item.platformId === platformId);
    setScheduleDraft((current) => ({
      ...current,
      platforms: selected ? current.platforms.filter((item) => item.platformId !== platformId) : [...current.platforms, { platformId, postTypeIds: [] }],
    }));
  }

  function toggleSchedulePostType(platformId: string, postTypeId: string) {
    setScheduleDraft((current) => ({
      ...current,
      platforms: current.platforms.map((item) => item.platformId === platformId ? {
        ...item,
        postTypeIds: item.postTypeIds.includes(postTypeId) ? item.postTypeIds.filter((id) => id !== postTypeId) : [...item.postTypeIds, postTypeId],
      } : item),
    }));
  }

  function saveScheduleItem() {
    const validPlatforms = scheduleDraft.platforms.filter((item) => item.postTypeIds.length);
    if (!scheduleDate || !scheduleDraft.creativeTempId || !validPlatforms.length) {
      setError("اختر اليوم والكرييتيف ومنصة واحدة على الأقل مع نوع النشر");
      return;
    }
    const value = { ...scheduleDraft, id: editingScheduleId || scheduleDraft.id || uid(), date: scheduleDate, platforms: validPlatforms };
    setSchedule((current) => editingScheduleId ? current.map((item) => item.id === editingScheduleId ? value : item) : [...current, value]);
    setEditingScheduleId("");
    setScheduleDraft(emptySchedule(scheduleDate));
    setError("");
  }

  function editScheduleItem(item: Schedule) {
    setScheduleDate(item.date);
    setEditingScheduleId(item.id);
    setScheduleDraft({ ...item, platforms: item.platforms.map((platform) => ({ ...platform, postTypeIds: [...platform.postTypeIds] })) });
  }

  async function create() {
    setLoading(true); setError(""); setMessage("");
    try {
      const result = await marketingFetch<{ message: string; id: string; code: string }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "create_campaign", ...form, creatives, budgets, schedule }) });
      setMessage(`${result.message} — ${result.code}`);
      setStep(0);
      setForm({ campaignDate: marketingLocalDateKey(), publishStart: "", publishEnd: "", campaignTypeId: "", campaignCode: "", name: "", objective: "", requiredFromContent: "" });
      setCreatives([newCreativeDraft()]); setBudgets([]); setSchedule([]); setScheduleDate(""); setScheduleDraft(emptySchedule());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر إنشاء الحملة");
    } finally { setLoading(false); }
  }

  async function createRawFolders() {
    setLoading(true); setError("");
    try {
      const payload = { monthKey: form.publishStart.slice(0, 7), campaignCode: form.campaignCode, campaignFolderName: `${form.campaignCode}-${form.name}`, creatives: creatives.map((creative, index) => ({ name: creativeName(creative.tempId), folderName: `${String(index + 1).padStart(2, "0")}-${creativeName(creative.tempId)}`, creativeInstanceId: creative.tempId, creativeIndex: index + 1, cars: creative.cars.map((car) => ({ id: car.id, name: `${car.car_name || "سيارة"}-${car.exterior_color || ""}-${car.interior_color || ""}` })), users: [...creative.primaryAssignments, ...creative.optionalAssignments.flatMap((group) => group.assignments)].map((assignment) => ({ uid: assignment.userId, name: meta.users.find((item) => item.id === assignment.userId)?.full_name || assignment.userId })) })) };
      const result = await marketingFetch<{ message?: string }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "create_raw_folders", payload }) });
      setMessage(result.message || "تم إنشاء فولدرات الخام");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر إنشاء فولدرات الخام");
    } finally { setLoading(false); }
  }

  async function downloadRelationsZip() {
    const JSZip = await getJSZip(); const zip = new JSZip(); zip.file("campaign-relationships.csv", relationshipCsv(relations));
    const blob = await zip.generateAsync({ type: "blob" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${form.campaignCode || "campaign"}-relationships.zip`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <MarketingPage title="إنشاء حملة" description="إنشاء الحملة والكرييتيف والميزانية وجدول النشر والتاسكات المرتبطة.">
    <div className="marketing-wizard-steps">{steps.map((label, index) => <button key={label} type="button" className={index === step ? "active" : index < step ? "done" : ""} onClick={() => index <= step && setStep(index)}><span>{index + 1}</span><b>{label}</b></button>)}</div>
    {error ? <MarketingAlert>{error}</MarketingAlert> : null}{message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}
    <section className="panel marketing-wizard-panel">
      {step === 0 ? <div className="marketing-form-grid"><label><span>تاريخ الحملة</span><input type="date" value={form.campaignDate} readOnly /></label><label><span>بداية النشر</span><input type="date" value={form.publishStart} onChange={(event) => setForm({ ...form, publishStart: event.target.value })} /></label><label><span>نهاية النشر</span><input type="date" value={form.publishEnd} min={form.publishStart} onChange={(event) => setForm({ ...form, publishEnd: event.target.value })} /></label><label><span>نوع الحملة</span><select value={form.campaignTypeId} onChange={(event) => void campaignTypeChanged(event.target.value)}><option value="">اختر نوع الحملة</option>{meta.campaignTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>كود الحملة</span><input value={form.campaignCode} readOnly /></label><label><span>اسم الحملة</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label className="full"><span>هدف الحملة</span><textarea rows={3} value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} /></label><label className="full"><span>المطلوب من كاتب المحتوى</span><textarea rows={4} value={form.requiredFromContent} onChange={(event) => setForm({ ...form, requiredFromContent: event.target.value })} /></label></div> : null}

      {step === 1 ? <div className="marketing-creatives-list">{creatives.map((creative, index) => <CreativeEditor key={creative.tempId} value={creative} meta={meta} onChange={(value) => updateCreative(index, value)} onDelete={() => setCreatives((current) => current.filter((_, itemIndex) => itemIndex !== index))} />)}<button type="button" className="marketing-add-block" onClick={() => setCreatives((current) => [...current, newCreativeDraft()])}><Plus size={18} />إضافة كرييتيف</button></div> : null}

      {step === 2 ? <div className="marketing-budget-editor">
        <header className="marketing-editor-page-head"><div><h2>الميزانية</h2><p>بنود الميزانية حسب Funnel والكرييتيف والمنصات والقيم.</p></div></header>
        <div className="marketing-budget-list">{budgets.map((budget, index) => {
          const total = budget.platformAmounts.reduce((sum, item) => sum + Number(item.amount || 0), 0);
          return <article key={budget.id} className="marketing-budget-item">
            <header><strong>بند الميزانية {index + 1}</strong><button type="button" className="icon-danger" onClick={() => setBudgets((current) => current.filter((item) => item.id !== budget.id))}><Trash size={17} /></button></header>
            <div className="marketing-budget-fields"><label><span>Funnel</span><select value={budget.funnelId} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, funnelId: event.target.value } : item))}><option value="">اختر Funnel</option>{meta.funnels.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label><span>المنتج / الكرييتيف</span><select value={budget.creativeTempId} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, creativeTempId: event.target.value } : item))}><option value="">اختر الكرييتيف</option>{creatives.map((item) => <option key={item.tempId} value={item.tempId}>{creativeName(item.tempId)}</option>)}</select></label><label><span>عدد الإعلانات</span><input type="number" min={1} value={budget.adsCount} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, adsCount: Number(event.target.value) || 1 } : item))} /></label><label><span>هدف المحتوى</span><input value={budget.contentGoal} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, contentGoal: event.target.value } : item))} /></label><label><span>الهدف المتوقع</span><input value={budget.expectedGoal} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, expectedGoal: event.target.value } : item))} /></label></div>
            <div className="marketing-budget-platforms">{meta.platforms.map((platform) => {
              const selected = budget.platformAmounts.find((item) => item.platformId === platform.id);
              return <section key={platform.id} className={selected ? "selected" : ""}><label><input type="checkbox" checked={Boolean(selected)} onChange={() => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, platformAmounts: selected ? item.platformAmounts.filter((part) => part.platformId !== platform.id) : [...item.platformAmounts, { platformId: platform.id, amount: 0 }] } : item))} /><strong>{platform.name}</strong></label><input type="number" min={0} disabled={!selected} placeholder={`قيمة ${platform.name}`} value={selected?.amount ?? ""} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, platformAmounts: item.platformAmounts.map((part) => part.platformId === platform.id ? { ...part, amount: Number(event.target.value) || 0 } : part) } : item))} /></section>;
            })}</div>
            <footer><span>إجمالي بند الميزانية</span><strong>{total.toLocaleString("ar-SA")} ر.س</strong></footer>
          </article>;
        })}</div>
        <button type="button" className="marketing-add-block" onClick={() => setBudgets((current) => [...current, { id: uid(), funnelId: "", creativeTempId: "", adsCount: 1, contentGoal: "", expectedGoal: "", platformAmounts: [] }])}><Plus size={18} />إضافة بند ميزانية</button>
        <div className="marketing-total-budget"><span>إجمالي الميزانية</span><strong>{totalBudget.toLocaleString("ar-SA")} ر.س</strong></div>
      </div> : null}

      {step === 3 ? <div className="marketing-publishing-schedule-editor">
        <header className="marketing-editor-page-head"><div><h2>جدول النشر</h2><p>حدد أيام النشر والكرييتيف والمنصات وأنواع النشر.</p></div><CalendarBlank size={24} weight="duotone" /></header>
        <div className="marketing-publishing-schedule-layout">
          <aside className="marketing-publishing-days"><h3>فترة النشر</h3><div>{publishingDays.map((date) => <button type="button" key={date} className={scheduleDate === date ? "active" : ""} onClick={() => selectScheduleDate(date)}><span>{new Date(`${date}T00:00:00Z`).toLocaleDateString("ar-SA", { weekday: "long" })}</span><strong>{new Date(`${date}T00:00:00Z`).toLocaleDateString("ar-SA", { day: "numeric", month: "numeric" })}</strong><small>{schedule.filter((item) => item.date === date).length} منشور</small></button>)}</div></aside>
          <main className="marketing-publishing-day-form"><div className="marketing-publishing-day-title"><div><h3>إعدادات يوم {scheduleDate || "—"}</h3><small>{editingScheduleId ? "تعديل المنشور المحدد" : "إضافة منشور جديد لليوم"}</small></div></div>
            <label><span>المنتج / الكرييتيف</span><select value={scheduleDraft.creativeTempId} onChange={(event) => setScheduleDraft({ ...scheduleDraft, creativeTempId: event.target.value })}><option value="">اختر الكرييتيف</option>{creatives.map((creative) => <option key={creative.tempId} value={creative.tempId}>{creativeName(creative.tempId)}</option>)}</select></label>
            <section className="marketing-publishing-platforms"><h4>منصات النشر</h4><div>{meta.platforms.map((platform) => {
              const selected = scheduleDraft.platforms.find((item) => item.platformId === platform.id);
              return <article key={platform.id} className={selected ? "selected" : ""}><label><input type="checkbox" checked={Boolean(selected)} onChange={() => toggleSchedulePlatform(platform.id)} /><strong>{platform.name}</strong></label>{selected ? <div className="marketing-chip-picker">{meta.postTypes.filter((post) => post.platform_id === platform.id).map((post) => <button type="button" key={post.id} className={selected.postTypeIds.includes(post.id) ? "selected" : ""} onClick={() => toggleSchedulePostType(platform.id, post.id)}>{post.name}</button>)}</div> : <small>اختر المنصة لعرض أنواع النشر</small>}</article>;
            })}</div></section>
            <div className="marketing-inline-actions"><button type="button" className="primary" onClick={saveScheduleItem}>{editingScheduleId ? <PencilSimple size={17} /> : <Plus size={17} />}{editingScheduleId ? "حفظ تعديل المنشور" : "إضافة لليوم"}</button>{editingScheduleId ? <button type="button" className="secondary" onClick={() => { setEditingScheduleId(""); setScheduleDraft(emptySchedule(scheduleDate)); }}>إلغاء التعديل</button> : null}</div>
            <section className="marketing-day-posts"><h4>جدول منشورات هذا اليوم</h4>{selectedDayPosts.length ? selectedDayPosts.map((item, index) => <article key={item.id}><div><strong>منشور {index + 1}</strong><span>{creativeName(item.creativeTempId)}</span><small>{item.platforms.map((platform) => `${platformName(platform.platformId)}: ${platform.postTypeIds.map((id) => meta.postTypes.find((post) => post.id === id)?.name).filter(Boolean).join("، ")}`).join(" | ")}</small></div><div><button type="button" className="secondary" onClick={() => editScheduleItem(item)}><PencilSimple size={15} />تعديل</button><button type="button" className="danger" onClick={() => setSchedule((current) => current.filter((part) => part.id !== item.id))}><Trash size={15} />حذف</button></div></article>) : <div className="marketing-empty small">لا توجد منشورات لهذا اليوم.</div>}</section>
          </main>
        </div>
      </div> : null}

      {step === 4 ? <div className="marketing-review"><div className="marketing-review-grid"><article><small>اسم الحملة</small><strong>{form.name}</strong></article><article><small>كود الحملة</small><strong>{form.campaignCode}</strong></article><article><small>الفترة</small><strong>{form.publishStart} — {form.publishEnd}</strong></article><article><small>الكرييتيفات</small><strong>{creatives.length}</strong></article><article><small>Task Templates</small><strong>{creatives.reduce((sum, item) => sum + item.contentAssignments.length, 0)}</strong></article><article><small>العلاقات</small><strong>{relations.length}</strong></article><article><small>بنود الميزانية</small><strong>{budgets.length}</strong></article><article><small>إجمالي الميزانية</small><strong>{totalBudget.toLocaleString("ar-SA")} ر.س</strong></article><article><small>جدول النشر</small><strong>{schedule.length}</strong></article></div><div className="marketing-review-table"><table><thead><tr><th>اليوم</th><th>الكرييتيف</th><th>المنصات</th></tr></thead><tbody>{schedule.map((item) => <tr key={item.id}><td>{item.date}</td><td>{creativeName(item.creativeTempId)}</td><td>{item.platforms.map((platform) => platformName(platform.platformId)).join("، ")}</td></tr>)}</tbody></table></div><div className="marketing-inline-actions"><button type="button" className="secondary" onClick={() => void createRawFolders()} disabled={loading}><FolderOpen size={17} />إنشاء فولدرات الخام</button><button type="button" className="secondary" onClick={() => void downloadRelationsZip()}>تحميل شيتات العلاقات ZIP</button><button type="button" className="primary" onClick={() => void create()} disabled={loading}><CheckCircle size={17} />{loading ? "جاري إنشاء الحملة..." : "إنشاء الحملة"}</button></div></div> : null}
      <footer className="marketing-wizard-footer">{step > 0 ? <button type="button" className="secondary" onClick={() => setStep((current) => current - 1)}>السابق</button> : <span />}{step < 4 ? <button type="button" className="primary" onClick={next}>التالي</button> : null}</footer>
    </section>
  </MarketingPage>;
}
