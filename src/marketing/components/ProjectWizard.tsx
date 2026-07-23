import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDots, CheckCircle, Plus, Trash } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import type { MarketingMeta, WizardAssignment, WizardBudgetItem, WizardInstance, WizardScheduleItem } from "../types";
import { marketingFetch } from "../api";
import { Field, MarketingPageHeader } from "./Common";

type StockRow = { id: string; vin: string; car_name?: string | null; statement?: string | null; exterior_color?: string | null; interior_color?: string | null; location_name?: string | null };

const today = new Date().toISOString().slice(0, 10);
const uid = () => crypto.randomUUID();

type WizardDraft = {
  step?: number;
  project?: { name: string; campaignTypeId: string; objective: string; contentBrief: string; campaignDate: string; startsOn: string; endsOn: string };
  instances?: WizardInstance[];
  budget?: WizardBudgetItem[];
  schedule?: WizardScheduleItem[];
  idempotencyKey?: string;
  createRawFolders?: boolean;
};

function readDraft(key: string): WizardDraft | null {
  try { return JSON.parse(window.localStorage.getItem(key) || "null") as WizardDraft | null; } catch { return null; }
}

function blankAssignment(departmentId = "", userId = "", writerIds: string[] = [], role: "primary" | "optional" = "optional"): WizardAssignment {
  return { id: uid(), departmentId, userId, contentWriterIds: [...writerIds], role, dueAt: "", notes: "" };
}
function blankInstance(index: number, creativeTypeId = "", writerId = ""): WizardInstance {
  return { clientId: uid(), instanceNo: `N${String(index).padStart(2, "0")}`, agendaDay: "", creativeTypeId, contentWriterIds: writerId ? [writerId] : [], contentDueAt: "", contentNotes: "", adminNotes: "", assignments: [], vehicleIds: [], metadata: {} };
}

export function ProjectWizard({ kind, meta }: { kind: "campaign" | "agenda"; meta: MarketingMeta }) {
  const navigate = useNavigate();
  const maxStep = kind === "campaign" ? 5 : 3;
  const draftKey = `mzj-marketing-${kind}-draft-v1`;
  const draft = useMemo(() => readDraft(draftKey), [draftKey]);
  const [step, setStep] = useState(() => Math.min(maxStep, Math.max(1, Number(draft?.step || 1))));
  const [project, setProject] = useState(() => draft?.project || { name: "", campaignTypeId: "", objective: "", contentBrief: "", campaignDate: today, startsOn: today, endsOn: today });
  const [instances, setInstances] = useState<WizardInstance[]>(() => draft?.instances || []);
  const [budget, setBudget] = useState<WizardBudgetItem[]>(() => (draft?.budget || []).map((row) => ({ ...row, adCount: row.adCount || 1, contentGoal: row.contentGoal || "", expectedGoal: row.expectedGoal || "" })));
  const [schedule, setSchedule] = useState<WizardScheduleItem[]>(() => draft?.schedule || []);
  const [idempotencyKey] = useState(() => draft?.idempotencyKey || uid());
  const [createRawFolders, setCreateRawFolders] = useState(() => Boolean(draft?.createRawFolders));
  const [stock, setStock] = useState<StockRow[]>([]);
  const [stockSearch, setStockSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const activeCreatives = meta.creativeTypes.filter((row) => row.is_active);
  const activeDepartments = meta.departments.filter((row) => row.is_active && !row.is_content_department);
  const contentDepartment = meta.departments.find((row) => row.is_content_department && row.is_active);
  const contentUsers = meta.departmentUsers.filter((row) => row.department_id === contentDepartment?.id && row.is_active);
  const defaultWriter = contentUsers[0]?.user_id || "";
  function makePrimaryAssignment(creativeTypeId: string, writerIds: string[]) {
    const type = meta.creativeTypes.find((row) => row.id === creativeTypeId);
    const departmentId = type?.primary_department_id || "";
    if (!departmentId) return null;
    const userId = meta.departmentUsers.find((row) => row.department_id === departmentId && row.is_active)?.user_id || "";
    return blankAssignment(departmentId, userId, writerIds, "primary");
  }
  function makeInstance(index: number, creativeTypeId = activeCreatives[0]?.id || "") {
    const writerIds = defaultWriter ? [defaultWriter] : [];
    const instance = blankInstance(index, creativeTypeId, defaultWriter);
    const primary = makePrimaryAssignment(creativeTypeId, writerIds);
    return { ...instance, agendaDay: kind === "agenda" ? (agendaDays[0] || project.startsOn) : "", assignments: primary ? [primary] : [] };
  }
  const agendaDays = useMemo(() => {
    const result: string[] = [];
    if (!project.startsOn || !project.endsOn || project.endsOn < project.startsOn) return result;
    const cursor = new Date(`${project.startsOn}T12:00:00`);
    const end = new Date(`${project.endsOn}T12:00:00`);
    while (cursor <= end && result.length < 370) {
      result.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }, [project.startsOn, project.endsOn]);

  useEffect(() => {
    if (!instances.length && activeCreatives.length) {
      setInstances([makeInstance(1, activeCreatives[0].id)]);
    }
  }, [activeCreatives.length, defaultWriter, kind, project.startsOn]);
  useEffect(() => { void marketingFetch<{ ok: true; rows: StockRow[] }>(`/api/marketing?resource=stock&search=${encodeURIComponent(stockSearch)}`).then((result) => setStock(result.rows)).catch(() => setStock([])); }, [stockSearch]);
  useEffect(() => {
    window.localStorage.setItem(draftKey, JSON.stringify({ step, project, instances, budget, schedule, idempotencyKey, createRawFolders } satisfies WizardDraft));
  }, [draftKey, step, project, instances, budget, schedule, idempotencyKey, createRawFolders]);

  const stepLabels = kind === "campaign" ? ["بيانات الحملة", "الكرييتيف والتكليف", "الميزانية", "جدول النشر", "التأكيد"] : ["بيانات الأجندة", "الكرييتيف والتكليف", "التأكيد"];
  const instanceMap = useMemo(() => new Map(instances.map((row) => [row.clientId, row])), [instances]);

  function updateInstance(id: string, patch: Partial<WizardInstance>) { setInstances((rows) => rows.map((row) => row.clientId === id ? { ...row, ...patch } : row)); }
  function addInstance() { setInstances((rows) => [...rows, makeInstance(rows.length + 1)]); }
  function removeInstance(id: string) {
    setInstances((rows) => rows.filter((row) => row.clientId !== id).map((row, index) => ({ ...row, instanceNo: `N${String(index + 1).padStart(2, "0")}` })));
    setBudget((rows) => rows.filter((row) => row.instanceClientId !== id)); setSchedule((rows) => rows.filter((row) => row.instanceClientId !== id));
  }
  function addAssignment(instance: WizardInstance) {
    const primaryDepartmentId = meta.creativeTypes.find((row) => row.id === instance.creativeTypeId)?.primary_department_id || "";
    const departmentId = activeDepartments.find((row) => row.id !== primaryDepartmentId)?.id || activeDepartments[0]?.id || "";
    const users = meta.departmentUsers.filter((row) => row.department_id === departmentId && row.is_active);
    updateInstance(instance.clientId, { assignments: [...instance.assignments, blankAssignment(departmentId, users[0]?.user_id || "", instance.contentWriterIds.slice(0, 1), "optional")] });
  }
  function addPrimaryAssignee(instance: WizardInstance) {
    const primary = makePrimaryAssignment(instance.creativeTypeId, instance.contentWriterIds.slice(0, 1));
    if (primary) updateInstance(instance.clientId, { assignments: [...instance.assignments, primary] });
  }
  function changeCreative(instance: WizardInstance, creativeTypeId: string) {
    const primary = makePrimaryAssignment(creativeTypeId, instance.contentWriterIds.slice(0, 1));
    updateInstance(instance.clientId, { creativeTypeId, assignments: primary ? [primary] : [] });
  }
  function updateAssignment(instance: WizardInstance, assignmentId: string, patch: Partial<WizardAssignment>) { updateInstance(instance.clientId, { assignments: instance.assignments.map((row) => row.id === assignmentId ? { ...row, ...patch } : row) }); }
  function addBudget() { setBudget((rows) => [...rows, { id: uid(), instanceClientId: instances[0]?.clientId || "", funnel: "وعي", platformId: meta.platforms[0]?.id || "", adCount: 1, contentGoal: "", expectedGoal: "", amount: 0, notes: "" }]); }
  function addSchedule() { const platformId = meta.platforms[0]?.id || ""; setSchedule((rows) => [...rows, { id: uid(), instanceClientId: instances[0]?.clientId || "", publishDate: kind === "agenda" ? (instances[0]?.agendaDay || project.startsOn) : project.startsOn, publishTime: "12:00", platformId, postTypeId: meta.postTypes.find((row) => row.platform_id === platformId)?.id || "", notes: "" }]); }

  function validateCurrent() {
    if (step === 1 && (!project.name.trim() || !project.startsOn || !project.endsOn)) return "أكمل الاسم وتاريخ البداية والنهاية";
    if (step === 2) {
      if (!instances.length) return "أضف كرييتيف واحدًا على الأقل";
      for (const instance of instances) {
        if (kind === "agenda" && (!instance.agendaDay || !agendaDays.includes(instance.agendaDay))) return `اختر يومًا داخل فترة الأجندة في ${instance.instanceNo}`;
        if (!instance.creativeTypeId || !instance.contentWriterIds.length) return `أكمل نوع الكرييتيف وكاتب المحتوى في ${instance.instanceNo}`;
        if (!instance.assignments.length) return `أضف تكليفًا تنفيذيًا واحدًا على الأقل في ${instance.instanceNo}`;
        const primaryDepartmentId = meta.creativeTypes.find((row) => row.id === instance.creativeTypeId)?.primary_department_id;
        if (primaryDepartmentId && !instance.assignments.some((row) => row.role === "primary" && row.departmentId === primaryDepartmentId)) return `أكمل القسم الأساسي في ${instance.instanceNo}`;
        if (instance.assignments.some((row) => !row.departmentId || !row.userId || !row.contentWriterIds.length)) return `أكمل ربط القسم واليوزر والكاتب في ${instance.instanceNo}`;
      }
    }
    return "";
  }

  function next() { const issue = validateCurrent(); if (issue) return setMessage(issue); setMessage(""); setStep((value) => Math.min(maxStep, value + 1)); }
  async function submit() {
    const issue = step === 1 || step === 2 ? validateCurrent() : ""; if (issue) return setMessage(issue);
    setBusy(true); setMessage("");
    try {
      const result = await marketingFetch<{ ok: true; project: { id: string; campaign_code: string }; message: string }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "create_project", idempotencyKey, project: { ...project, kind }, instances, budget: kind === "campaign" ? budget : [], schedule }) });
      let finalMessage = `${result.message} — ${result.project.campaign_code}`;
      if (createRawFolders) {
        try {
          const raw = await marketingFetch<{ ok: true; message: string }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "create_raw_folders", campaignId: result.project.id }) });
          finalMessage += ` — ${raw.message}`;
        } catch (rawFailure) {
          finalMessage += ` — تم حفظ المشروع، وتعذر إنشاء فولدرات الخام: ${rawFailure instanceof Error ? rawFailure.message : "الإعداد الخارجي غير مكتمل"}`;
        }
      }
      window.localStorage.removeItem(draftKey);
      setMessage(finalMessage);
      window.setTimeout(() => navigate(`/marketing/campaigns?project=${result.project.id}`), 500);
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "تعذر إنشاء المشروع"); }
    finally { setBusy(false); }
  }

  function resetDraft() {
    window.localStorage.removeItem(draftKey);
    window.location.reload();
  }

  return <div className="module-page marketing-page">
    <MarketingPageHeader title={kind === "agenda" ? "إنشاء أجندة" : "إنشاء حملة"} description={kind === "agenda" ? "أجندة Native بثلاث خطوات مع Task Template منفصلة لكل كاتب محتوى." : "مسار كامل من خمس خطوات يربط كل Instance بالكاتب واليوزر التنفيذي بدون تكرار."} />
    <div className="marketing-wizard-steps">{stepLabels.map((label, index) => <button type="button" key={label} className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""} onClick={() => index + 1 < step && setStep(index + 1)}><i>{step > index + 1 ? <CheckCircle size={18} weight="fill" /> : index + 1}</i><span>{label}</span></button>)}</div>

    <section className="panel marketing-wizard-panel">
      {step === 1 ? <div className="marketing-form-grid">
        <Field label={kind === "agenda" ? "اسم الأجندة" : "اسم الحملة"} wide><input value={project.name} onChange={(event) => setProject({ ...project, name: event.target.value })} /></Field>
        {kind === "campaign" ? <><Field label="نوع الحملة"><select value={project.campaignTypeId} onChange={(event) => setProject({ ...project, campaignTypeId: event.target.value })}><option value="">بدون نوع محدد</option>{meta.campaignTypes.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.id}>{row.name} — {row.short_code}</option>)}</select></Field><Field label="كود الحملة"><input disabled value="يتم توليده من السيرفر عند الحفظ" /></Field><Field label="تاريخ الحملة"><input type="date" value={project.campaignDate} onChange={(event) => setProject({ ...project, campaignDate: event.target.value })} /></Field></> : <Field label="شهر الأجندة"><input type="month" value={project.startsOn.slice(0, 7)} onChange={(event) => { const month = event.target.value; if (!month) return; const [year, monthNo] = month.split("-").map(Number); const lastDay = new Date(year, monthNo, 0).getDate(); setProject({ ...project, startsOn: `${month}-01`, endsOn: `${month}-${String(lastDay).padStart(2, "0")}`, campaignDate: `${month}-01` }); }} /></Field>}
        <Field label="بداية النشر"><input type="date" value={project.startsOn} onChange={(event) => setProject({ ...project, startsOn: event.target.value })} /></Field>
        <Field label="نهاية النشر"><input type="date" min={project.startsOn} value={project.endsOn} onChange={(event) => setProject({ ...project, endsOn: event.target.value })} /></Field>
        <Field label="الهدف" wide><textarea value={project.objective} onChange={(event) => setProject({ ...project, objective: event.target.value })} /></Field>
        <Field label="ملخص المحتوى" wide><textarea value={project.contentBrief} onChange={(event) => setProject({ ...project, contentBrief: event.target.value })} /></Field>
      </div> : null}

      {step === 2 ? <div className="marketing-instances-editor">
        {kind === "agenda" ? <div className="marketing-agenda-days">{agendaDays.map((day) => { const dayInstances = instances.filter((row) => row.agendaDay === day); const complete = dayInstances.length > 0 && dayInstances.every((row) => row.creativeTypeId && row.contentWriterIds.length && row.assignments.length); return <button type="button" key={day} className={complete ? "complete" : dayInstances.length ? "partial" : ""} onClick={() => { const firstEmpty = instances.find((row) => !row.agendaDay); if (firstEmpty) updateInstance(firstEmpty.clientId, { agendaDay: day }); }}><strong>{new Intl.DateTimeFormat("ar-SA", { weekday: "short" }).format(new Date(`${day}T12:00:00`))}</strong><span>{day}</span><small>{dayInstances.length} كرييتيف</small></button>; })}</div> : null}
        <div className="marketing-section-title"><div><h2>الـInstances والكرييتيف</h2><p>كل ربط (يوزر تنفيذي × كاتب محتوى × Instance) ينشئ تاسكًا مستقلًا.</p></div><button type="button" onClick={addInstance}><Plus size={17} />إضافة كرييتيف</button></div>
        {instances.map((instance) => {
          const creative = meta.creativeTypes.find((row) => row.id === instance.creativeTypeId);
          return <article key={instance.clientId} className="marketing-instance-card">
            <header><div><strong>{instance.instanceNo}</strong><span>{creative?.short_code || "—"}</span></div><button type="button" disabled={instances.length === 1} onClick={() => removeInstance(instance.clientId)}><Trash size={17} /></button></header>
            <div className="marketing-form-grid">
              <Field label="نوع الكرييتيف"><select value={instance.creativeTypeId} onChange={(event) => changeCreative(instance, event.target.value)}>{activeCreatives.map((row) => <option key={row.id} value={row.id}>{row.name} — {row.short_code}</option>)}</select></Field>
              {kind === "agenda" ? <Field label="يوم الأجندة"><select value={instance.agendaDay} onChange={(event) => updateInstance(instance.clientId, { agendaDay: event.target.value })}><option value="">اختر اليوم</option>{agendaDays.map((day) => <option key={day} value={day}>{day}</option>)}</select></Field> : null}
              <Field label="تسليم كتابة المحتوى"><input type="datetime-local" value={instance.contentDueAt} onChange={(event) => updateInstance(instance.clientId, { contentDueAt: event.target.value })} /></Field>
              <Field label="كاتب/كتاب المحتوى" wide><div className="marketing-check-grid">{contentUsers.map((row) => <label key={row.user_id}><input type="checkbox" checked={instance.contentWriterIds.includes(row.user_id)} onChange={(event) => updateInstance(instance.clientId, { contentWriterIds: event.target.checked ? [...instance.contentWriterIds, row.user_id] : instance.contentWriterIds.filter((id) => id !== row.user_id), assignments: instance.assignments.map((assignment) => ({ ...assignment, contentWriterIds: assignment.contentWriterIds.filter((id) => id !== row.user_id) })) })} /><span>{row.full_name}</span></label>)}</div></Field>
              <Field label="ملاحظات المحتوى" wide><textarea value={instance.contentNotes} onChange={(event) => updateInstance(instance.clientId, { contentNotes: event.target.value })} /></Field>
              <Field label="ملاحظات الإدارة" wide><textarea value={instance.adminNotes} onChange={(event) => updateInstance(instance.clientId, { adminNotes: event.target.value })} /></Field>
              <Field label="السيارات" wide><details className="marketing-instance-accordion"><summary>السيارات المختارة ({instance.vehicleIds.length})</summary><div><input type="search" value={stockSearch} onChange={(event) => setStockSearch(event.target.value)} placeholder="ابحث بالسيارة أو VIN" /><div className="marketing-vehicle-picker">{stock.slice(0, 40).map((row) => <label key={row.id}><input type="checkbox" checked={instance.vehicleIds.includes(row.id)} onChange={(event) => updateInstance(instance.clientId, { vehicleIds: event.target.checked ? [...instance.vehicleIds, row.id] : instance.vehicleIds.filter((id) => id !== row.id) })} /><span><strong>{row.car_name || row.statement || "سيارة"}</strong><small>{row.vin} — {row.exterior_color || "—"} / {row.interior_color || "—"} — {row.location_name || "—"}</small></span></label>)}</div></div></details></Field>
            </div>
            <div className="marketing-assignment-editor"><div className="marketing-section-title compact"><div><h3>أقسام التنفيذ</h3><p>القسم الأساسي يضاف تلقائيًا، ويمكن إضافة يوزرات أساسيين وأقسام اختيارية.</p></div><div className="marketing-inline-actions"><button type="button" onClick={() => addPrimaryAssignee(instance)}><Plus size={16} />يوزر أساسي</button><button type="button" onClick={() => addAssignment(instance)}><Plus size={16} />قسم اختياري</button></div></div>
              {instance.assignments.map((assignment) => {
                const departmentUsers = meta.departmentUsers.filter((row) => row.department_id === assignment.departmentId && row.is_active);
                const isPrimary = assignment.role === "primary";
                return <div className="marketing-assignment-row" key={assignment.id}>
                  <select disabled={isPrimary} value={assignment.departmentId} onChange={(event) => { const user = meta.departmentUsers.find((row) => row.department_id === event.target.value && row.is_active); updateAssignment(instance, assignment.id, { departmentId: event.target.value, userId: user?.user_id || "" }); }}><option value="">القسم</option>{activeDepartments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
                  <select value={assignment.userId} onChange={(event) => updateAssignment(instance, assignment.id, { userId: event.target.value })}><option value="">اليوزر التنفيذي</option>{departmentUsers.map((row) => <option key={row.user_id} value={row.user_id}>{row.full_name}</option>)}</select>
                  <select disabled={isPrimary} value={assignment.role} onChange={(event) => updateAssignment(instance, assignment.id, { role: event.target.value as "primary" | "optional" })}><option value="primary">أساسي</option><option value="optional">اختياري</option></select>
                  <input type="datetime-local" value={assignment.dueAt} onChange={(event) => updateAssignment(instance, assignment.id, { dueAt: event.target.value })} />
                  <div className="marketing-writer-links">{instance.contentWriterIds.map((writerId) => <label key={writerId}><input type="checkbox" checked={assignment.contentWriterIds.includes(writerId)} onChange={(event) => updateAssignment(instance, assignment.id, { contentWriterIds: event.target.checked ? [...assignment.contentWriterIds, writerId] : assignment.contentWriterIds.filter((id) => id !== writerId) })} /><span>{meta.users.find((row) => row.id === writerId)?.full_name || "كاتب"}</span></label>)}</div>
                  <button type="button" onClick={() => updateInstance(instance.clientId, { assignments: instance.assignments.filter((row) => row.id !== assignment.id) })}><Trash size={16} /></button>
                </div>;
              })}
            </div>
          </article>;
        })}
        {kind === "agenda" ? <section className="marketing-agenda-publish"><div className="marketing-section-title"><div><h2>جدول نشر الأجندة</h2><p>كل موعد مرتبط بالـInstance واليوم والمنصة ونوع النشر.</p></div><button type="button" onClick={addSchedule}><Plus size={17} />إضافة موعد</button></div><div className="marketing-table-wrap"><table><thead><tr><th>الكرييتيف</th><th>التاريخ</th><th>الوقت</th><th>المنصة</th><th>نوع النشر</th><th>ملاحظة</th><th /></tr></thead><tbody>{schedule.map((row) => { const postTypes = meta.postTypes.filter((item) => item.platform_id === row.platformId); return <tr key={row.id}><td><select value={row.instanceClientId} onChange={(event) => { const instanceClientId = event.target.value; const selected = instanceMap.get(instanceClientId); setSchedule((rows) => rows.map((item) => item.id === row.id ? { ...item, instanceClientId, publishDate: selected?.agendaDay || item.publishDate } : item)); }}>{instances.map((item) => <option key={item.clientId} value={item.clientId}>{item.instanceNo} — {meta.creativeTypes.find((type) => type.id === item.creativeTypeId)?.name}</option>)}</select></td><td><input type="date" min={project.startsOn} max={project.endsOn} value={row.publishDate} onChange={(event) => setSchedule((rows) => rows.map((item) => item.id === row.id ? { ...item, publishDate: event.target.value } : item))} /></td><td><input type="time" value={row.publishTime} onChange={(event) => setSchedule((rows) => rows.map((item) => item.id === row.id ? { ...item, publishTime: event.target.value } : item))} /></td><td><select value={row.platformId} onChange={(event) => { const platformId = event.target.value; setSchedule((rows) => rows.map((item) => item.id === row.id ? { ...item, platformId, postTypeId: meta.postTypes.find((type) => type.platform_id === platformId)?.id || "" } : item)); }}>{meta.platforms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td><td><select value={row.postTypeId} onChange={(event) => setSchedule((rows) => rows.map((item) => item.id === row.id ? { ...item, postTypeId: event.target.value } : item))}>{postTypes.map((item) => <option key={item.id} value={item.id}>{item.name} {item.dimensions ? `— ${item.dimensions}` : ""}</option>)}</select></td><td><input value={row.notes} onChange={(event) => setSchedule((rows) => rows.map((item) => item.id === row.id ? { ...item, notes: event.target.value } : item))} /></td><td><button type="button" onClick={() => setSchedule((rows) => rows.filter((item) => item.id !== row.id))}><Trash size={16} /></button></td></tr>; })}</tbody></table></div></section> : null}
      </div> : null}

      {kind === "campaign" && step === 3 ? <div><div className="marketing-section-title"><div><h2>ميزانية الحملة</h2><p>المنتج هو الكرييتيف، ويمكن تكرار الصف لنفس المنتج عند توزيع الميزانية على أكثر من منصة.</p></div><button type="button" onClick={addBudget}><Plus size={17} />إضافة بند</button></div><div className="marketing-table-wrap"><table><thead><tr><th>الكرييتيف</th><th>الفانل</th><th>عدد الإعلانات</th><th>هدف المحتوى</th><th>الهدف المتوقع</th><th>المنصة</th><th>المبلغ</th><th>ملاحظة</th><th /></tr></thead><tbody>{budget.map((row) => <tr key={row.id}><td><select value={row.instanceClientId} onChange={(event) => setBudget((rows) => rows.map((item) => item.id === row.id ? { ...item, instanceClientId: event.target.value } : item))}>{instances.map((item) => <option key={item.clientId} value={item.clientId}>{item.instanceNo} — {meta.creativeTypes.find((type) => type.id === item.creativeTypeId)?.name}</option>)}</select></td><td><select value={row.funnel} onChange={(event) => setBudget((rows) => rows.map((item) => item.id === row.id ? { ...item, funnel: event.target.value } : item))}><option>وعي</option><option>اهتمام</option><option>تحويل</option><option>إعادة استهداف</option></select></td><td><input type="number" min="1" value={row.adCount} onChange={(event) => setBudget((rows) => rows.map((item) => item.id === row.id ? { ...item, adCount: Math.max(1, Number(event.target.value)) } : item))} /></td><td><input value={row.contentGoal} onChange={(event) => setBudget((rows) => rows.map((item) => item.id === row.id ? { ...item, contentGoal: event.target.value } : item))} /></td><td><input value={row.expectedGoal} onChange={(event) => setBudget((rows) => rows.map((item) => item.id === row.id ? { ...item, expectedGoal: event.target.value } : item))} /></td><td><select value={row.platformId} onChange={(event) => setBudget((rows) => rows.map((item) => item.id === row.id ? { ...item, platformId: event.target.value } : item))}>{meta.platforms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td><td><input type="number" min="0" value={row.amount} onChange={(event) => setBudget((rows) => rows.map((item) => item.id === row.id ? { ...item, amount: Number(event.target.value) } : item))} /></td><td><input value={row.notes} onChange={(event) => setBudget((rows) => rows.map((item) => item.id === row.id ? { ...item, notes: event.target.value } : item))} /></td><td><button type="button" onClick={() => setBudget((rows) => rows.filter((item) => item.id !== row.id))}><Trash size={16} /></button></td></tr>)}</tbody><tfoot><tr><td colSpan={6}>إجمالي ميزانية الحملة</td><td><strong>{budget.reduce((sum, row) => sum + Number(row.amount || 0), 0).toLocaleString("ar-SA")}</strong></td><td colSpan={2} /></tr></tfoot></table></div></div> : null}

      {kind === "campaign" && step === 4 ? <div><div className="marketing-section-title"><div><h2>جدول النشر</h2><p>المنصة ونوع النشر والمقاس مرتبطة بإعدادات التسويق.</p></div><button type="button" onClick={addSchedule}><Plus size={17} />إضافة موعد</button></div><div className="marketing-table-wrap"><table><thead><tr><th>الكرييتيف</th><th>التاريخ</th><th>الوقت</th><th>المنصة</th><th>نوع النشر</th><th>ملاحظة</th><th /></tr></thead><tbody>{schedule.map((row) => { const postTypes = meta.postTypes.filter((item) => item.platform_id === row.platformId); return <tr key={row.id}><td><select value={row.instanceClientId} onChange={(event) => setSchedule((rows) => rows.map((item) => item.id === row.id ? { ...item, instanceClientId: event.target.value } : item))}>{instances.map((item) => <option key={item.clientId} value={item.clientId}>{item.instanceNo} — {meta.creativeTypes.find((type) => type.id === item.creativeTypeId)?.name}</option>)}</select></td><td><input type="date" min={project.startsOn} max={project.endsOn} value={row.publishDate} onChange={(event) => setSchedule((rows) => rows.map((item) => item.id === row.id ? { ...item, publishDate: event.target.value } : item))} /></td><td><input type="time" value={row.publishTime} onChange={(event) => setSchedule((rows) => rows.map((item) => item.id === row.id ? { ...item, publishTime: event.target.value } : item))} /></td><td><select value={row.platformId} onChange={(event) => { const platformId = event.target.value; setSchedule((rows) => rows.map((item) => item.id === row.id ? { ...item, platformId, postTypeId: meta.postTypes.find((type) => type.platform_id === platformId)?.id || "" } : item)); }}>{meta.platforms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td><td><select value={row.postTypeId} onChange={(event) => setSchedule((rows) => rows.map((item) => item.id === row.id ? { ...item, postTypeId: event.target.value } : item))}>{postTypes.map((item) => <option key={item.id} value={item.id}>{item.name} {item.dimensions ? `— ${item.dimensions}` : ""}</option>)}</select></td><td><input value={row.notes} onChange={(event) => setSchedule((rows) => rows.map((item) => item.id === row.id ? { ...item, notes: event.target.value } : item))} /></td><td><button type="button" onClick={() => setSchedule((rows) => rows.filter((item) => item.id !== row.id))}><Trash size={16} /></button></td></tr>; })}</tbody></table></div></div> : null}

      {step === maxStep ? <div className="marketing-confirmation"><CalendarDots size={48} weight="duotone" /><h2>مراجعة وحفظ {kind === "agenda" ? "الأجندة" : "الحملة"}</h2><div className="marketing-confirm-grid"><div><span>الاسم</span><strong>{project.name || "—"}</strong></div><div><span>الفترة</span><strong>{project.startsOn} — {project.endsOn}</strong></div><div><span>عدد الكرييتيف</span><strong>{instances.length}</strong></div><div><span>Task Template متوقعة</span><strong>{instances.reduce((sum, row) => sum + row.contentWriterIds.length, 0)}</strong></div><div><span>تاسكات تنفيذ متوقعة</span><strong>{instances.reduce((sum, row) => sum + row.assignments.reduce((count, assignment) => count + assignment.contentWriterIds.length, 0), 0)}</strong></div>{kind === "campaign" ? <div><span>بنود الميزانية</span><strong>{budget.length} — {budget.reduce((sum, row) => sum + Number(row.amount || 0), 0).toLocaleString("ar-SA")}</strong></div> : null}<div><span>مواعيد النشر</span><strong>{schedule.length}</strong></div></div><label className="marketing-toggle marketing-raw-toggle"><input type="checkbox" checked={createRawFolders} onChange={(event) => setCreateRawFolders(event.target.checked)} /><span>إنشاء فولدرات الخام والتسليم بعد الحفظ</span></label><p>الحفظ يتم داخل Transaction واحدة مع Idempotency ومنع التكرار، والمسودة محفوظة تلقائيًا على الجهاز.</p></div> : null}

      {message ? <p className="marketing-form-message">{message}</p> : null}
      <footer className="marketing-wizard-footer"><button type="button" disabled={busy} onClick={resetDraft}><Trash size={17} />مسح النموذج</button><button type="button" disabled={step === 1 || busy} onClick={() => setStep((value) => value - 1)}><ArrowRight size={18} />السابق</button>{step < maxStep ? <button className="primary" type="button" onClick={next}>التالي<ArrowLeft size={18} /></button> : <button className="primary" type="button" disabled={busy} onClick={() => void submit()}>{busy ? "جاري الحفظ..." : "حفظ وإنهاء"}<CheckCircle size={18} /></button>}</footer>
    </section>
  </div>;
}
