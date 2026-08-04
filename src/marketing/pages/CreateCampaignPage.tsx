import { useEffect, useMemo, useState } from "react";
import { getJSZip } from "../zip";
import { CalendarBlank, CheckCircle, CurrencyCircleDollar, FolderOpen, Plus, Trash } from "@phosphor-icons/react";
import { marketingFetch, marketingLocalDateKey, marketingQuery } from "../api";
import { CreativeEditor, newCreativeDraft } from "../components/CreativeEditor";
import { CreativeMultiPicker } from "../components/CreativeMultiPicker";
import { MarketingAlert, MarketingPage } from "../components/MarketingPage";
import { relationshipCsv } from "../templateExcel";
import { compactExecutionFolderCreation } from "../executionFolders";
import type { CreativeDraft, ExecutionFolderCreation, MarketingMeta, RawFolderRequest, RawFolderResult } from "../types";

const emptyMeta: MarketingMeta = { ok: true, users: [], departments: [], contentDepartmentId: "", actions: [], creativeTypes: [], campaignTypes: [], platforms: [], postTypes: [], funnels: [], cars: [], connections: [], permissions: { effective: [] } };
const steps = ["بيانات الحملة", "الكرييتيف", "الميزانية", "جدول النشر", "المراجعة والإنشاء"];
type Budget = { id: string; funnelId: string; creativeTempIds: string[]; adsCount: number; contentGoal: string; expectedGoal: string; platformAmounts: Array<{ platformId: string; amount: number }> };
type Schedule = { id: string; date: string; creativeTempIds: string[]; platforms: Array<{ platformId: string; postTypeIds: string[] }> };
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function validateCreativeTaskFlow(creative: CreativeDraft, meta: MarketingMeta) {
  const creativeType = meta.creativeTypes.find((item) => item.id === creative.creativeTypeId);
  const creativeName = creativeType?.name || "الكرييتيف";
  if (!creative.creativeTypeId) return "اختر نوع الكرييتيف";
  if (!creative.contentAssignments.length) return `اختر يوزر قسم المحتوى داخل ${creativeName}`;
  if (creativeType?.primary_department_id && !creative.primaryAssignments.length) {
    return `اختر يوزر القسم الأساسي ${creativeType.primary_department_name || ""} داخل ${creativeName}`;
  }
  const executionAssignments = [
    ...creative.primaryAssignments,
    ...creative.optionalAssignments.flatMap((group) => group.assignments),
  ];
  if (!executionAssignments.length) return `اختر يوزرًا تنفيذيًا واحدًا على الأقل داخل ${creativeName}`;
  const selectedContentUsers = new Set(creative.contentAssignments.map((assignment) => assignment.userId));
  const normalizedLinks = (assignment: (typeof executionAssignments)[number]) => {
    const validLinks = assignment.contentUserIds.filter((id) => selectedContentUsers.has(id));
    return validLinks.length ? validLinks : selectedContentUsers.size === 1 ? Array.from(selectedContentUsers) : [];
  };
  if (executionAssignments.some((assignment) => !normalizedLinks(assignment).length)) {
    return `اربط كل يوزر تنفيذي بكاتب المحتوى داخل ${creativeName}`;
  }
  const linkedContentUsers = new Set(executionAssignments.flatMap(normalizedLinks));
  const unpairedTemplate = creative.contentAssignments.find((assignment) => !linkedContentUsers.has(assignment.userId));
  if (unpairedTemplate) {
    const contentUser = meta.users.find((item) => item.id === unpairedTemplate.userId);
    const contentUserName = contentUser?.full_name || contentUser?.fullName || "كاتب المحتوى";
    return `اربط Task Template الخاص بـ ${contentUserName} بتاسك تنفيذي داخل ${creativeName}`;
  }
  return "";
}

export function CreateCampaignPage() {
  const [meta, setMeta] = useState<MarketingMeta>(emptyMeta);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ campaignDate: marketingLocalDateKey(), publishStart: "", publishEnd: "", campaignTypeId: "", campaignCode: "", name: "", objective: "", requiredFromContent: "" });
  const [creatives, setCreatives] = useState<CreativeDraft[]>([newCreativeDraft()]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [schedule, setSchedule] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [executionFolders, setExecutionFolders] = useState<ExecutionFolderCreation | null>(null);

  useEffect(() => { marketingFetch<MarketingMeta>(`/api/marketing${marketingQuery({ resource: "meta" })}`).then(setMeta).catch((failure) => setError(failure instanceof Error ? failure.message : "تعذر تحميل الإعدادات")); }, []);
  async function campaignTypeChanged(id: string) {
    setForm((current) => ({ ...current, campaignTypeId: id, campaignCode: "" }));
    if (!id) return;
    try { const payload = await marketingFetch<{ code: string }>(`/api/marketing${marketingQuery({ resource: "campaign_code", campaignTypeId: id })}`); setForm((current) => current.campaignTypeId === id ? { ...current, campaignCode: payload.code } : current); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر توليد كود الحملة"); }
  }
  function updateCreative(index: number, value: CreativeDraft) { setCreatives((current) => current.map((item, itemIndex) => itemIndex === index ? value : item)); }
  function deleteCreative(index: number) {
    const removedId = creatives[index]?.tempId;
    setCreatives((current) => current.filter((_, itemIndex) => itemIndex !== index));
    if (!removedId) return;
    setBudgets((current) => current.map((item) => ({ ...item, creativeTempIds: item.creativeTempIds.filter((id) => id !== removedId) })));
    setSchedule((current) => current.map((item) => ({ ...item, creativeTempIds: item.creativeTempIds.filter((id) => id !== removedId) })));
  }
  function creativeName(tempId: string) { const creative = creatives.find((item) => item.tempId === tempId); return meta.creativeTypes.find((item) => item.id === creative?.creativeTypeId)?.name || "—"; }
  const creativePickerItems = useMemo(() => creatives.map((creative, index) => ({ id: creative.tempId, name: creativeName(creative.tempId), code: `كرييتيف ${index + 1}` })), [creatives, meta.creativeTypes]);
  function creativeNames(tempIds: string[]) { return tempIds.map(creativeName).filter((name) => name !== "—").join("، ") || "—"; }
  function platformName(id: string) { return meta.platforms.find((item) => item.id === id)?.name || "—"; }
  function budgetTotal(item: Budget) {
    const platformTotal = item.platformAmounts.reduce((sum, platform) => sum + Number(platform.amount || 0), 0);
    const creativeCount = Math.max(1, new Set(item.creativeTempIds.filter(Boolean)).size);
    return platformTotal * creativeCount;
  }
  const totalBudget = useMemo(() => budgets.reduce((sum, item) => sum + budgetTotal(item), 0), [budgets]);
  function schedulePostCount(item: Schedule) { return item.platforms.reduce((sum, platform) => sum + platform.postTypeIds.length, 0); }
  function scheduleDateLabel(date: string) {
    if (!date) return "لم يتم تحديد اليوم";
    const value = new Date(`${date}T00:00:00`);
    return Number.isNaN(value.getTime()) ? date : new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }).format(value);
  }
  const relations = useMemo(() => creatives.flatMap((creative) => {
    const creativeLabel = meta.creativeTypes.find((item) => item.id === creative.creativeTypeId)?.name || "";
    const user = (id: string) => meta.users.find((item) => item.id === id)?.full_name || meta.users.find((item) => item.id === id)?.fullName || id;
    const rows: Record<string, unknown>[] = [];
    creative.primaryAssignments.forEach((assignment) => assignment.contentUserIds.forEach((contentId) => rows.push({ day: "", creative: creativeLabel, department: meta.creativeTypes.find((item) => item.id === creative.creativeTypeId)?.primary_department_name, user: user(assignment.userId), contentUser: user(contentId), dueOn: assignment.dueOn, note: assignment.note })));
    creative.optionalAssignments.forEach((group) => group.assignments.forEach((assignment) => assignment.contentUserIds.forEach((contentId) => rows.push({ day: "", creative: creativeLabel, department: meta.departments.find((item) => item.id === group.departmentId)?.name, user: user(assignment.userId), contentUser: user(contentId), dueOn: assignment.dueOn, note: assignment.note }))));
    return rows;
  }), [creatives, meta]);
  const rawFolderPayload = useMemo<RawFolderRequest>(() => ({
    monthKey: form.publishStart.slice(0, 7),
    campaignCode: form.campaignCode,
    campaignFolderName: `${form.campaignCode}-${form.name}`,
    campaignDisplayName: form.name,
    driveLetter: "Z:",
    remoteRoot: "/var/www/mzj-raw",
    creatives: creatives.map((creative, index) => {
      const executionAssignments = [
        ...creative.primaryAssignments,
        ...creative.optionalAssignments.flatMap((group) => group.assignments),
      ];
      const users = [...new Map(executionAssignments.map((assignment) => {
        const name = meta.users.find((item) => item.id === assignment.userId)?.full_name
          || meta.users.find((item) => item.id === assignment.userId)?.fullName
          || assignment.userId;
        return [assignment.userId, { uid: assignment.userId, name }] as const;
      })).values()];
      return {
        name: creativeName(creative.tempId),
        folderName: `${String(index + 1).padStart(2, "0")}-${creativeName(creative.tempId)}`,
        creativeInstanceId: creative.tempId,
        creativeIndex: index + 1,
        cars: creative.cars.map((car) => ({ id: car.id, name: `${car.car_name || "سيارة"}-${car.exterior_color || ""}-${car.interior_color || ""}` })),
        users,
      };
    }),
  }), [form.publishStart, form.campaignCode, form.name, creatives, meta.users, meta.creativeTypes]);
  const rawFolderPlanKey = useMemo(() => JSON.stringify(rawFolderPayload), [rawFolderPayload]);
  useEffect(() => { setExecutionFolders(null); }, [rawFolderPlanKey]);

  function validateCurrent() {
    if (step === 0 && (!form.campaignTypeId || !form.campaignCode || !form.name || !form.publishStart || !form.publishEnd)) return "أكمل بيانات الحملة الأساسية";
    if (step === 1) {
      if (!creatives.length) return "أضف كرييتيف واحدًا على الأقل";
      for (const creative of creatives) {
        const issue = validateCreativeTaskFlow(creative, meta);
        if (issue) return issue;
      }
    }
    if (step === 2 && budgets.some((item) => !item.creativeTempIds.length)) return "اختر كرييتيفًا واحدًا على الأقل لكل بند ميزانية";
    if (step === 3 && schedule.some((item) => !item.creativeTempIds.length)) return "اختر كرييتيفًا واحدًا على الأقل لكل يوم نشر";
    return "";
  }
  function next() { const issue = validateCurrent(); if (issue) { setError(issue); return; } setError(""); setStep((current) => Math.min(4, current + 1)); }
  async function create() {
    setLoading(true); setError(""); setMessage("");
    try {
      const result = await marketingFetch<{ message: string; id: string; code: string }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "create_campaign", ...form, creatives, budgets, schedule, executionFolders }) });
      setMessage(`${result.message} — ${result.code}`);
      setStep(0); setForm({ campaignDate: marketingLocalDateKey(), publishStart: "", publishEnd: "", campaignTypeId: "", campaignCode: "", name: "", objective: "", requiredFromContent: "" }); setCreatives([newCreativeDraft()]); setBudgets([]); setSchedule([]); setExecutionFolders(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر إنشاء الحملة"); }
    finally { setLoading(false); }
  }
  async function createRawFolders() {
    setLoading(true); setError(""); setExecutionFolders(null);
    try {
      const result = await marketingFetch<RawFolderResult>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "create_raw_folders", payload: rawFolderPayload }) });
      if (result.ok === false || !result.rawFolders || !Object.keys(result.rawFolders).length) throw new Error(result.message || "لم يرجع السيرفر مسارات فولدرات الخام");
      setExecutionFolders(compactExecutionFolderCreation(rawFolderPayload, result));
      setMessage(result.message || "تم إنشاء فولدرات الخام وربط مساراتها بالتاسكات التنفيذية");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر إنشاء فولدرات الخام"); }
    finally { setLoading(false); }
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
      {step === 1 ? <div className="marketing-creatives-list">{creatives.map((creative, index) => <CreativeEditor key={creative.tempId} value={creative} meta={meta} autoLinkSingleContentUser showTaskFlowSummary onChange={(value) => updateCreative(index, value)} onDelete={() => deleteCreative(index)} />)}<button type="button" className="marketing-add-block" onClick={() => setCreatives((current) => [...current, newCreativeDraft()])}><Plus size={18} />إضافة كرييتيف</button></div> : null}
      {step === 2 ? <div className="marketing-budget-list marketing-campaign-budget-step">
        <div className="marketing-campaign-step-head">
          <div className="marketing-campaign-step-icon"><CurrencyCircleDollar size={25} weight="duotone" /></div>
          <div><h2>الميزانية</h2><p>بنود ميزانية منظمة حسب Funnel والكرييتيف والمنصات والقيم.</p></div>
        </div>
        {budgets.length ? budgets.map((budget, index) => <article key={budget.id} className="marketing-budget-card">
          <header className="marketing-budget-card-head">
            <div><span>بند الميزانية</span><strong>{index + 1}</strong></div>
            <button type="button" className="marketing-card-delete" aria-label={`حذف بند الميزانية ${index + 1}`} onClick={() => setBudgets((current) => current.filter((item) => item.id !== budget.id))}><Trash size={18} /></button>
          </header>
          <div className="marketing-budget-fields">
            <label><span>Funnel</span><select value={budget.funnelId} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, funnelId: event.target.value } : item))}><option value="">اختر Funnel</option>{meta.funnels.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <div className="marketing-multi-field"><CreativeMultiPicker label="المنتج / الكرييتيف" hint="يمكن ربط بند الميزانية بأكثر من كرييتيف" items={creativePickerItems} value={budget.creativeTempIds} onChange={(creativeTempIds) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, creativeTempIds } : item))} /></div>
            <label><span>عدد الإعلانات</span><input type="number" min={1} value={budget.adsCount} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, adsCount: Number(event.target.value) || 1 } : item))} /></label>
            <label><span>هدف المحتوى</span><input value={budget.contentGoal} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, contentGoal: event.target.value } : item))} /></label>
            <label><span>الهدف المتوقع</span><input value={budget.expectedGoal} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, expectedGoal: event.target.value } : item))} /></label>
          </div>
          <div className="marketing-budget-platforms">
            {meta.platforms.map((platform) => {
              const selected = budget.platformAmounts.find((item) => item.platformId === platform.id);
              return <section key={platform.id} className={selected ? "selected" : ""}>
                <label className="marketing-budget-platform-head"><input type="checkbox" checked={Boolean(selected)} onChange={() => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, platformAmounts: selected ? item.platformAmounts.filter((part) => part.platformId !== platform.id) : [...item.platformAmounts, { platformId: platform.id, amount: 0 }] } : item))} /><strong>{platform.name}</strong></label>
                <input type="number" min={0} disabled={!selected} value={selected?.amount ?? ""} placeholder={`قيمة ${platform.name}`} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, platformAmounts: item.platformAmounts.map((part) => part.platformId === platform.id ? { ...part, amount: Number(event.target.value) || 0 } : part) } : item))} />
              </section>;
            })}
          </div>
          <footer className="marketing-budget-card-total"><span>إجمالي بند الميزانية</span><strong>{budgetTotal(budget).toLocaleString("ar-SA-u-nu-latn")} ر.س</strong></footer>
        </article>) : <div className="marketing-campaign-empty-state"><CurrencyCircleDollar size={30} weight="duotone" /><strong>لا توجد بنود ميزانية حتى الآن</strong><span>أضف بندًا لبدء توزيع الميزانية على المنصات.</span></div>}
        <button type="button" className="marketing-add-block marketing-add-budget" onClick={() => setBudgets((current) => [...current, { id: uid(), funnelId: "", creativeTempIds: [], adsCount: 1, contentGoal: "", expectedGoal: "", platformAmounts: [] }])}><Plus size={18} />إضافة بند ميزانية</button>
        <div className="marketing-total-budget"><span>إجمالي الميزانية الكلي</span><strong>{totalBudget.toLocaleString("ar-SA-u-nu-latn")} ر.س</strong></div>
      </div> : null}
      {step === 3 ? <div className="marketing-schedule-list marketing-campaign-schedule-step">
        <div className="marketing-campaign-step-head">
          <div className="marketing-campaign-step-icon"><CalendarBlank size={25} weight="duotone" /></div>
          <div><h2>جدول النشر</h2><p>حدد يوم النشر والكرييتيف ثم اختر المنصات وأنواع النشر.</p></div>
        </div>
        <div className="marketing-schedule-workspace">
          <aside className="marketing-schedule-period">
            <span>فترة النشر</span>
            <div><small>من</small><strong>{form.publishStart || "—"}</strong></div>
            <div><small>إلى</small><strong>{form.publishEnd || "—"}</strong></div>
            <div className="marketing-schedule-period-count"><small>الأيام المضافة</small><strong>{schedule.length}</strong></div>
          </aside>
          <div className="marketing-schedule-days">
            {schedule.length ? schedule.map((item, index) => <article key={item.id} className="marketing-schedule-card">
              <header className="marketing-schedule-card-head">
                <div><span>منشور {index + 1}</span><strong>{scheduleDateLabel(item.date)}</strong><small>{schedulePostCount(item)} نوع نشر محدد</small></div>
                <button type="button" className="marketing-card-delete" aria-label={`حذف المنشور ${index + 1}`} onClick={() => setSchedule((current) => current.filter((part) => part.id !== item.id))}><Trash size={18} /></button>
              </header>
              <div className="marketing-schedule-fields">
                <label><span>اليوم</span><input type="date" min={form.publishStart} max={form.publishEnd} value={item.date} onChange={(event) => setSchedule((current) => current.map((part) => part.id === item.id ? { ...part, date: event.target.value } : part))} /></label>
                <div className="marketing-multi-field"><CreativeMultiPicker label="المنتج / الكرييتيف" hint="يمكن اختيار أكثر من كرييتيف لنفس اليوم" items={creativePickerItems} value={item.creativeTempIds} onChange={(creativeTempIds) => setSchedule((current) => current.map((part) => part.id === item.id ? { ...part, creativeTempIds } : part))} /></div>
              </div>
              <div className="marketing-schedule-platforms">
                {meta.platforms.map((platform) => {
                  const selected = item.platforms.find((part) => part.platformId === platform.id);
                  return <section key={platform.id} className={selected ? "selected" : ""}>
                    <label className="marketing-schedule-platform-head"><input type="checkbox" checked={Boolean(selected)} onChange={() => setSchedule((current) => current.map((part) => part.id === item.id ? { ...part, platforms: selected ? part.platforms.filter((value) => value.platformId !== platform.id) : [...part.platforms, { platformId: platform.id, postTypeIds: [] }] } : part))} /><strong>{platform.name}</strong></label>
                    {selected ? <div className="marketing-chip-picker">{meta.postTypes.filter((post) => post.platform_id === platform.id).map((post) => <button type="button" key={post.id} className={selected.postTypeIds.includes(post.id) ? "selected" : ""} onClick={() => setSchedule((current) => current.map((part) => part.id === item.id ? { ...part, platforms: part.platforms.map((value) => value.platformId === platform.id ? { ...value, postTypeIds: value.postTypeIds.includes(post.id) ? value.postTypeIds.filter((id) => id !== post.id) : [...value.postTypeIds, post.id] } : value) } : part))}>{post.name}</button>)}</div> : <div className="marketing-schedule-platform-placeholder">اختر المنصة لعرض أنواع النشر</div>}
                  </section>;
                })}
              </div>
            </article>) : <div className="marketing-campaign-empty-state"><CalendarBlank size={30} weight="duotone" /><strong>لا توجد أيام نشر مضافة</strong><span>أضف يومًا ثم اختر الكرييتيف والمنصات وأنواع النشر.</span></div>}
            <button type="button" className="marketing-add-block marketing-add-schedule" onClick={() => setSchedule((current) => [...current, { id: uid(), date: form.publishStart, creativeTempIds: [], platforms: [] }])}><Plus size={18} />إضافة لليوم</button>
          </div>
        </div>
      </div> : null}
      {step === 4 ? <div className="marketing-review"><div className="marketing-review-grid"><article><small>اسم الحملة</small><strong>{form.name}</strong></article><article><small>كود الحملة</small><strong>{form.campaignCode}</strong></article><article><small>الفترة</small><strong>{form.publishStart} — {form.publishEnd}</strong></article><article><small>الكرييتيفات</small><strong>{creatives.length}</strong></article><article><small>Task Templates</small><strong>{creatives.reduce((sum, item) => sum + item.contentAssignments.length, 0)}</strong></article><article><small>العلاقات</small><strong>{relations.length}</strong></article><article><small>بنود الميزانية</small><strong>{budgets.length}</strong></article><article><small>إجمالي الميزانية</small><strong>{totalBudget.toLocaleString("ar-SA-u-nu-latn")} ر.س</strong></article><article><small>جدول النشر</small><strong>{schedule.length}</strong></article></div><div className="marketing-review-table"><table><thead><tr><th>اليوم</th><th>الكرييتيف</th><th>المنصات</th></tr></thead><tbody>{schedule.map((item) => <tr key={item.id}><td>{item.date}</td><td>{creativeNames(item.creativeTempIds)}</td><td>{item.platforms.map((platform) => platformName(platform.platformId)).join("، ")}</td></tr>)}</tbody></table></div><div className="marketing-inline-actions"><button type="button" className="secondary" onClick={() => void createRawFolders()} disabled={loading}><FolderOpen size={17} />إنشاء فولدرات الخام</button><button type="button" className="secondary" onClick={() => void downloadRelationsZip()}>تحميل شيتات العلاقات ZIP</button><button type="button" className="primary" onClick={() => void create()} disabled={loading}><CheckCircle size={17} />{loading ? "جاري إنشاء الحملة..." : "إنشاء الحملة"}</button></div></div> : null}
      <footer className="marketing-wizard-footer">{step > 0 ? <button type="button" className="secondary" onClick={() => setStep((current) => current - 1)}>السابق</button> : <span />}{step < 4 ? <button type="button" className="primary" onClick={next}>التالي</button> : null}</footer>
    </section>
  </MarketingPage>;
}
