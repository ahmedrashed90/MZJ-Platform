import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarBlank, CaretLeft, CaretRight, Car, Check, Copy, Plus, Trash, UsersThree } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { marketingFetch, marketingPost, queryString } from "../api";
import type { VehicleRow } from "../types";
import { useMarketingMeta } from "../MarketingLayout";
import { MarketingAlert, MarketingEmpty, MarketingPageHeader, formatMoney } from "./Ui";

type AssignmentDraft = {
  id: string;
  departmentCode: string;
  executionUserId: string;
  contentUserId: string;
  dueDate: string;
  writerDueDate: string;
  departmentNote: string;
  contentNote: string;
};

type CreativeDraft = {
  clientId: string;
  catalogId: string;
  name: string;
  primaryDepartmentCode: string;
  notes: string;
  assignments: AssignmentDraft[];
  vehicleIds: string[];
  vehicles: VehicleRow[];
  agendaDate: string;
};

type BudgetPlatformDraft = { platformId: string; amount: string };
type BudgetDraft = { id: string; funnelId: string; creativeClientId: string; adsCount: string; contentGoal: string; expectedTarget: string; platforms: BudgetPlatformDraft[] };
type ScheduleTargetDraft = { id: string; platformId: string; publishTime: string; postTypeIds: string[] };
type ScheduleDraft = { id: string; publishDate: string; creativeClientId: string; caption: string; hashtags: string; targets: ScheduleTargetDraft[] };

type CampaignForm = {
  campaignDate: string;
  publishStartDate: string;
  publishEndDate: string;
  campaignTypeId: string;
  name: string;
  objective: string;
  contentBrief: string;
  structureDeadline: string;
};

type AgendaForm = { name: string; monthKey: string; publishStartDate: string; publishEndDate: string; objective: string; contentBrief: string };

function uid(prefix: string) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
function today() { return new Date().toISOString().slice(0, 10); }
function inputDate(value: string) { return value ? String(value).slice(0, 10) : ""; }

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={`marketing-field ${wide ? "wide" : ""}`}><span>{label}</span>{children}</label>;
}

function emptyAssignment(departmentCode = ""): AssignmentDraft {
  return { id: uid("pair"), departmentCode, executionUserId: "", contentUserId: "", dueDate: "", writerDueDate: "", departmentNote: "", contentNote: "" };
}

function emptyCreative(): CreativeDraft {
  return { clientId: uid("creative"), catalogId: "", name: "", primaryDepartmentCode: "", notes: "", assignments: [], vehicleIds: [], vehicles: [], agendaDate: "" };
}

function emptyBudget(): BudgetDraft {
  return { id: uid("budget"), funnelId: "", creativeClientId: "", adsCount: "1", contentGoal: "", expectedTarget: "", platforms: [{ platformId: "", amount: "0" }] };
}

function emptySchedule(date = ""): ScheduleDraft {
  return { id: uid("schedule"), publishDate: date, creativeClientId: "", caption: "", hashtags: "", targets: [{ id: uid("target"), platformId: "", publishTime: "", postTypeIds: [] }] };
}

export function CampaignBuilder({ mode }: { mode: "campaign" | "agenda" }) {
  const { meta } = useMarketingMeta();
  const navigate = useNavigate();
  const campaignMode = mode === "campaign";
  const [step, setStep] = useState(1);
  const [campaign, setCampaign] = useState<CampaignForm>({ campaignDate: today(), publishStartDate: "", publishEndDate: "", campaignTypeId: "", name: "", objective: "", contentBrief: "", structureDeadline: "" });
  const [agenda, setAgenda] = useState<AgendaForm>({ name: "", monthKey: today().slice(0, 7), publishStartDate: "", publishEndDate: "", objective: "", contentBrief: "" });
  const [creatives, setCreatives] = useState<CreativeDraft[]>([]);
  const [budgets, setBudgets] = useState<BudgetDraft[]>([]);
  const [schedule, setSchedule] = useState<ScheduleDraft[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [vehicleSearch, setVehicleSearch] = useState<Record<string, string>>({});
  const [vehicleResults, setVehicleResults] = useState<Record<string, VehicleRow[]>>({});
  const [loadingVehicles, setLoadingVehicles] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const maxStep = campaignMode ? 5 : 3;
  const effectiveStart = campaignMode ? campaign.publishStartDate : agenda.publishStartDate;
  const effectiveEnd = campaignMode ? campaign.publishEndDate : agenda.publishEndDate;
  const steps = campaignMode ? ["بيانات الحملة", "الكرييتيف والتوزيع", "الميزانية", "جدول النشر", "المراجعة والحفظ"] : ["بيانات الأجندة", "الأيام والكرييتيف والتوزيع", "المراجعة والإنشاء"];
  const contentMembers = useMemo(() => {
    const memberIds = new Set(meta.departmentMembers.filter((item) => item.department_code === "content").map((item) => item.user_id));
    const exact = meta.users.filter((user) => memberIds.has(user.id) || user.department_codes?.includes("content"));
    return exact.length ? exact : meta.users;
  }, [meta]);

  const filteredCatalog = useMemo(() => {
    const pattern = catalogSearch.trim().toLowerCase();
    return meta.creativeCatalog.filter((item) => !pattern || item.name.toLowerCase().includes(pattern) || item.short_code.toLowerCase().includes(pattern) || (item.content_section_name || "").toLowerCase().includes(pattern));
  }, [catalogSearch, meta.creativeCatalog]);

  function executionMembers(departmentCode: string) {
    const memberIds = new Set(meta.departmentMembers.filter((item) => item.department_code === departmentCode).map((item) => item.user_id));
    const exact = meta.users.filter((user) => memberIds.has(user.id) || user.department_codes?.includes(departmentCode));
    return exact.length ? exact : meta.users;
  }

  function addCreative(catalogId?: string) {
    const catalog = meta.creativeCatalog.find((item) => item.id === catalogId);
    const item = emptyCreative();
    if (catalog) {
      item.catalogId = catalog.id;
      item.name = catalog.name;
      item.primaryDepartmentCode = catalog.primary_department_code;
      item.assignments = [emptyAssignment(catalog.primary_department_code)];
    }
    if (!campaignMode) item.agendaDate = effectiveStart;
    setCreatives((current) => [...current, item]);
  }

  function updateCreative(id: string, patch: Partial<CreativeDraft>) { setCreatives((current) => current.map((item) => item.clientId === id ? { ...item, ...patch } : item)); }
  function removeCreative(id: string) {
    setCreatives((current) => current.filter((item) => item.clientId !== id));
    setBudgets((current) => current.filter((item) => item.creativeClientId !== id));
    setSchedule((current) => current.filter((item) => item.creativeClientId !== id));
  }
  function updateAssignment(creativeId: string, assignmentId: string, patch: Partial<AssignmentDraft>) {
    setCreatives((current) => current.map((creative) => creative.clientId === creativeId ? { ...creative, assignments: creative.assignments.map((item) => item.id === assignmentId ? { ...item, ...patch } : item) } : creative));
  }
  function addAssignment(creativeId: string) {
    setCreatives((current) => current.map((creative) => creative.clientId === creativeId ? { ...creative, assignments: [...creative.assignments, emptyAssignment(creative.primaryDepartmentCode)] } : creative));
  }
  function duplicateAssignment(creativeId: string, assignment: AssignmentDraft) {
    setCreatives((current) => current.map((creative) => creative.clientId === creativeId ? { ...creative, assignments: [...creative.assignments, { ...assignment, id: uid("pair"), contentUserId: "" }] } : creative));
  }
  function removeAssignment(creativeId: string, assignmentId: string) {
    setCreatives((current) => current.map((creative) => creative.clientId === creativeId ? { ...creative, assignments: creative.assignments.filter((item) => item.id !== assignmentId) } : creative));
  }

  useEffect(() => {
    const timers = Object.keys(vehicleSearch).map((creativeId) => {
      const search = vehicleSearch[creativeId] || "";
      return window.setTimeout(async () => {
      if (search.trim().length < 2) { setVehicleResults((current) => ({ ...current, [creativeId]: [] })); return; }
      setLoadingVehicles((current) => ({ ...current, [creativeId]: true }));
      try {
        const payload = await marketingFetch<{ rows: VehicleRow[] }>(`/api/marketing?${queryString({ resource: "stock", search, pageSize: 20 })}`);
        setVehicleResults((current) => ({ ...current, [creativeId]: payload.rows }));
      } catch { setVehicleResults((current) => ({ ...current, [creativeId]: [] })); }
      finally { setLoadingVehicles((current) => ({ ...current, [creativeId]: false })); }
      }, 320);
    });
    return () => timers.forEach(window.clearTimeout);
  }, [vehicleSearch]);

  function toggleVehicle(creativeId: string, vehicle: VehicleRow) {
    setCreatives((current) => current.map((creative) => {
      if (creative.clientId !== creativeId) return creative;
      const exists = creative.vehicleIds.includes(vehicle.id);
      return { ...creative, vehicleIds: exists ? creative.vehicleIds.filter((id) => id !== vehicle.id) : [...creative.vehicleIds, vehicle.id], vehicles: exists ? creative.vehicles.filter((item) => item.id !== vehicle.id) : [...creative.vehicles, vehicle] };
    }));
  }

  function validate(targetStep = step) {
    setError("");
    if (targetStep >= 1) {
      if (campaignMode) {
        if (!campaign.campaignTypeId || !campaign.name.trim() || !campaign.publishStartDate || !campaign.publishEndDate) return "أكمل نوع الحملة والاسم وتاريخ بداية ونهاية النشر";
        if (campaign.publishStartDate > campaign.publishEndDate) return "تاريخ بداية النشر يجب ألا يتجاوز تاريخ النهاية";
      } else {
        if (!agenda.name.trim() || !agenda.monthKey || !agenda.publishStartDate || !agenda.publishEndDate) return "أكمل اسم الأجندة والشهر وتاريخ البداية والنهاية";
        if (agenda.publishStartDate > agenda.publishEndDate) return "تاريخ بداية الأجندة يجب ألا يتجاوز النهاية";
      }
    }
    if (targetStep >= 2) {
      if (!creatives.length) return "أضف كرييتيف واحدًا على الأقل";
      for (const creative of creatives) {
        if (!creative.catalogId && !creative.name.trim()) return "اختر نوع كل كرييتيف";
        if (!creative.primaryDepartmentCode) return `حدد القسم الأساسي للكرييتيف ${creative.name || "غير المسمى"}`;
        if (!creative.assignments.length) return `أضف توزيعًا للكرييتيف ${creative.name}`;
        for (const pair of creative.assignments) if (!pair.departmentCode || !pair.executionUserId || !pair.contentUserId || !pair.dueDate || !pair.writerDueDate) return `أكمل اليوزر التنفيذي وكاتب المحتوى والمواعيد لكل علاقة داخل ${creative.name}`;
        if (!campaignMode && (!creative.agendaDate || creative.agendaDate < effectiveStart || creative.agendaDate > effectiveEnd)) return `حدد يومًا صحيحًا داخل نطاق الأجندة للكرييتيف ${creative.name}`;
      }
    }
    if (campaignMode && targetStep >= 3) {
      for (const budget of budgets) {
        if (!budget.creativeClientId || !budget.funnelId || !budget.platforms.some((item) => item.platformId)) return "أكمل الكرييتيف والفانل والمنصات في كل صف ميزانية";
      }
    }
    if (targetStep >= (campaignMode ? 4 : 2)) {
      const effectiveSchedule = campaignMode ? schedule : agendaSchedule();
      if (!effectiveSchedule.length) return campaignMode ? "أضف عنصرًا واحدًا على الأقل إلى جدول النشر" : "اختر منصة ونوع نشر لكل كرييتيف في الأجندة";
      for (const item of effectiveSchedule) {
        if (!item.publishDate || !item.creativeClientId || !item.targets.length) return "أكمل تاريخ وكرييتيف وهدف النشر";
        for (const target of item.targets) if (!target.platformId || !target.postTypeIds.length) return "كل منصة مختارة يجب أن تحتوي على نوع نشر واحد على الأقل";
      }
    }
    return "";
  }

  function next() { const issue = validate(step); if (issue) { setError(issue); return; } setStep((value) => Math.min(maxStep, value + 1)); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function previous() { setError(""); setStep((value) => Math.max(1, value - 1)); window.scrollTo({ top: 0, behavior: "smooth" }); }

  function agendaSchedule(): ScheduleDraft[] {
    return creatives.flatMap((creative) => {
      const existing = schedule.filter((item) => item.creativeClientId === creative.clientId);
      if (existing.length) return existing.map((item) => ({ ...item, publishDate: creative.agendaDate || item.publishDate }));
      return [];
    });
  }

  function addAgendaTarget(creativeId: string) {
    const creative = creatives.find((item) => item.clientId === creativeId);
    setSchedule((current) => [...current, { ...emptySchedule(creative?.agendaDate || effectiveStart), creativeClientId: creativeId }]);
  }

  async function submit() {
    const issue = validate(maxStep);
    if (issue) { setError(issue); return; }
    setSaving(true); setError(""); setMessage("");
    try {
      const cleanCreatives = creatives.map(({ vehicles: _vehicles, ...creative }) => ({
        ...creative,
        assignments: creative.assignments.map(({ id: _id, ...assignment }) => assignment),
      }));
      const cleanBudgets = budgets.map(({ id: _id, ...budget }) => ({ ...budget, platforms: budget.platforms.filter((item) => item.platformId).map((item) => ({ ...item, amount: Number(item.amount || 0) })) }));
      const cleanSchedule = (campaignMode ? schedule : agendaSchedule()).map(({ id: _id, ...item }) => ({ ...item, targets: item.targets.map(({ id: _targetId, ...target }) => target) }));
      const payload = campaignMode ? {
        action: "create_campaign",
        campaign,
        creatives: cleanCreatives,
        budgets: cleanBudgets,
        schedule: cleanSchedule,
      } : {
        action: "create_agenda",
        agenda,
        creatives: cleanCreatives,
        schedule: cleanSchedule,
      };
      const result = await marketingPost<{ campaign: { id: string; campaign_code: string }; message: string }>(payload);
      setMessage(result.message);
      window.setTimeout(() => navigate(`/marketing/campaigns?created=${result.campaign.id}`), 550);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر حفظ البيانات"); }
    finally { setSaving(false); }
  }

  const totalBudget = budgets.reduce((sum, row) => sum + row.platforms.reduce((platformSum, platform) => platformSum + Number(platform.amount || 0), 0), 0);
  const pairsCount = creatives.reduce((sum, item) => sum + item.assignments.length, 0);
  const scheduleCount = (campaignMode ? schedule : agendaSchedule()).reduce((sum, item) => sum + item.targets.reduce((targetSum, target) => targetSum + target.postTypeIds.length, 0), 0);

  return (
    <div className="marketing-page marketing-wizard">
      <MarketingPageHeader title={campaignMode ? "إنشاء حملة" : "إنشاء أجندة"} description={campaignMode ? "فلو الحملة الكامل من خمس خطوات: البيانات، الكرييتيف والتوزيع، الميزانية، جدول النشر، ثم المراجعة." : "إنشاء أجندة من ثلاث خطوات مع أيامها وكرييتيفاتها وعلاقات المحتوى والتنفيذ وجدول النشر."} actions={<button className="marketing-button secondary" type="button" onClick={() => { setCampaign({ campaignDate: today(), publishStartDate: "", publishEndDate: "", campaignTypeId: "", name: "", objective: "", contentBrief: "", structureDeadline: "" }); setAgenda({ name: "", monthKey: today().slice(0, 7), publishStartDate: "", publishEndDate: "", objective: "", contentBrief: "" }); setCreatives([]); setBudgets([]); setSchedule([]); setStep(1); }}>مسح النموذج</button>} />
      <div className={`marketing-stepper ${campaignMode ? "" : "three"}`}>{steps.map((label, index) => <button type="button" key={label} className={`marketing-step ${step === index + 1 ? "active" : step > index + 1 ? "done" : ""}`} onClick={() => { if (index + 1 < step) setStep(index + 1); }}><i>{step > index + 1 ? <Check size={16} weight="bold" /> : index + 1}</i><span>{label}</span></button>)}</div>
      {error ? <MarketingAlert>{error}</MarketingAlert> : null}{message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}

      {step === 1 ? <section className="marketing-panel"><div className="marketing-panel-head"><div><h2>{campaignMode ? "بيانات الحملة" : "بيانات الأجندة"}</h2><p>البيانات الأساسية التي تبنى عليها المواعيد والتاسكات.</p></div><CalendarBlank size={29} weight="duotone" /></div>
        {campaignMode ? <div className="marketing-form-grid cols-3">
          <Field label="تاريخ الحملة"><input type="date" value={campaign.campaignDate} onChange={(event) => setCampaign({ ...campaign, campaignDate: event.target.value })} /></Field>
          <Field label="بداية النشر"><input type="date" value={campaign.publishStartDate} onChange={(event) => setCampaign({ ...campaign, publishStartDate: event.target.value })} /></Field>
          <Field label="نهاية النشر"><input type="date" value={campaign.publishEndDate} onChange={(event) => setCampaign({ ...campaign, publishEndDate: event.target.value })} /></Field>
          <Field label="نوع الحملة"><select value={campaign.campaignTypeId} onChange={(event) => setCampaign({ ...campaign, campaignTypeId: event.target.value })}><option value="">اختر نوع الحملة</option>{meta.campaignTypes.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.prefix}</option>)}</select></Field>
          <Field label="كود الحملة"><input value="يُحجز تلقائيًا عند الحفظ" readOnly /></Field>
          <Field label="اسم الحملة"><input value={campaign.name} onChange={(event) => setCampaign({ ...campaign, name: event.target.value })} placeholder="اكتب اسم الحملة" /></Field>
          <Field label="هدف الحملة" wide><textarea value={campaign.objective} onChange={(event) => setCampaign({ ...campaign, objective: event.target.value })} placeholder="اكتب هدف الحملة" /></Field>
          <Field label="المطلوب من كاتب المحتوى" wide><textarea value={campaign.contentBrief} onChange={(event) => setCampaign({ ...campaign, contentBrief: event.target.value })} placeholder="اكتب الـContent Brief والمطلوب" /></Field>
          <Field label="موعد تسليم Task Template"><input type="date" value={campaign.structureDeadline} onChange={(event) => setCampaign({ ...campaign, structureDeadline: event.target.value })} /></Field>
        </div> : <div className="marketing-form-grid cols-3">
          <Field label="شهر الأجندة"><input type="month" value={agenda.monthKey} onChange={(event) => setAgenda({ ...agenda, monthKey: event.target.value })} /></Field>
          <Field label="اسم الأجندة"><input value={agenda.name} onChange={(event) => setAgenda({ ...agenda, name: event.target.value })} placeholder="أجندة شهر ..." /></Field>
          <Field label="بداية النشر"><input type="date" value={agenda.publishStartDate} onChange={(event) => setAgenda({ ...agenda, publishStartDate: event.target.value })} /></Field>
          <Field label="نهاية النشر"><input type="date" value={agenda.publishEndDate} onChange={(event) => setAgenda({ ...agenda, publishEndDate: event.target.value })} /></Field>
          <Field label="هدف الأجندة" wide><textarea value={agenda.objective} onChange={(event) => setAgenda({ ...agenda, objective: event.target.value })} /></Field>
          <Field label="المطلوب من قسم المحتوى" wide><textarea value={agenda.contentBrief} onChange={(event) => setAgenda({ ...agenda, contentBrief: event.target.value })} /></Field>
        </div>}
      </section> : null}

      {step === 2 ? <section className="marketing-builder-layout">
        <aside className="marketing-panel"><div className="marketing-panel-head"><div><h2>كتالوج الكرييتيف</h2><p>اضغط لإضافة Instance مستقل.</p></div></div><Field label="بحث"><input value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="اسم أو قسم الكرييتيف" /></Field><div className="marketing-catalog-list">{filteredCatalog.map((item) => <button type="button" className="marketing-catalog-item" key={item.id} onClick={() => addCreative(item.id)}><span><b>{item.name}</b><small style={{ display: "block" }}>{item.content_section_name || item.primary_department_code}</small></span><Plus size={18} /></button>)}<button type="button" className="marketing-button secondary full" onClick={() => addCreative()}><Plus />كرييتيف مخصص</button></div></aside>
        <div className="marketing-stack">
          {!creatives.length ? <section className="marketing-panel"><MarketingEmpty title="لم تضف كرييتيفات" description="اختر من الكتالوج، وكل إضافة تنشئ Creative Instance منفصلًا حتى لو تكرر نفس النوع." /></section> : creatives.map((creative, creativeIndex) => <article className="marketing-creative-card" key={creative.clientId}><header><div><span className="code">N{String(creativeIndex + 1).padStart(2, "0")}</span><h3>{creative.name || "كرييتيف جديد"}</h3></div><button type="button" className="marketing-button danger small" onClick={() => removeCreative(creative.clientId)}><Trash />حذف</button></header><div className="body">
            <div className="marketing-form-grid cols-3">
              <Field label="نوع الكرييتيف"><select value={creative.catalogId} onChange={(event) => { const catalog = meta.creativeCatalog.find((item) => item.id === event.target.value); updateCreative(creative.clientId, { catalogId: event.target.value, name: catalog?.name || creative.name, primaryDepartmentCode: catalog?.primary_department_code || creative.primaryDepartmentCode, assignments: creative.assignments.length ? creative.assignments : [emptyAssignment(catalog?.primary_department_code || "")] }); }}><option value="">مخصص</option>{meta.creativeCatalog.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
              <Field label="اسم الـInstance"><input value={creative.name} onChange={(event) => updateCreative(creative.clientId, { name: event.target.value })} /></Field>
              <Field label="القسم الأساسي"><select value={creative.primaryDepartmentCode} onChange={(event) => updateCreative(creative.clientId, { primaryDepartmentCode: event.target.value })}><option value="">اختر القسم</option>{meta.departments.filter((item) => item.department_code !== "content").map((item) => <option key={item.department_code} value={item.department_code}>{item.display_name}</option>)}</select></Field>
              {!campaignMode ? <Field label="يوم الأجندة"><input type="date" min={effectiveStart} max={effectiveEnd} value={creative.agendaDate} onChange={(event) => updateCreative(creative.clientId, { agendaDate: event.target.value })} /></Field> : null}
              <Field label="ملاحظات الكرييتيف" wide><textarea value={creative.notes} onChange={(event) => updateCreative(creative.clientId, { notes: event.target.value })} /></Field>
            </div>
            <div className="marketing-panel-head"><div><h3>علاقات التنفيذ × كاتب المحتوى</h3><p>كل سطر ينشئ زوج مهام مستقلًا واعتمادًا دقيقًا.</p></div><button type="button" className="marketing-button secondary small" onClick={() => addAssignment(creative.clientId)}><Plus />إضافة علاقة</button></div>
            {!creative.assignments.length ? <MarketingAlert type="info">أضف علاقة واحدة على الأقل بين يوزر تنفيذي وكاتب محتوى.</MarketingAlert> : creative.assignments.map((assignment, pairIndex) => <div className="marketing-assignment" key={assignment.id}><div className="marketing-assignment-head"><strong>العلاقة {pairIndex + 1}</strong><div className="marketing-table-actions"><button type="button" className="marketing-button small" title="نفس التنفيذي مع كاتب آخر" onClick={() => duplicateAssignment(creative.clientId, assignment)}><Copy />نسخ</button><button type="button" className="marketing-button danger small" onClick={() => removeAssignment(creative.clientId, assignment.id)}><Trash /></button></div></div><div className="marketing-form-grid cols-3">
              <Field label="قسم التنفيذ"><select value={assignment.departmentCode} onChange={(event) => updateAssignment(creative.clientId, assignment.id, { departmentCode: event.target.value, executionUserId: "" })}><option value="">اختر القسم</option>{meta.departments.filter((item) => item.department_code !== "content").map((item) => <option key={item.department_code} value={item.department_code}>{item.display_name}</option>)}</select></Field>
              <Field label="اليوزر التنفيذي"><select value={assignment.executionUserId} onChange={(event) => updateAssignment(creative.clientId, assignment.id, { executionUserId: event.target.value })}><option value="">اختر اليوزر</option>{executionMembers(assignment.departmentCode).map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}</select></Field>
              <Field label="كاتب المحتوى المرتبط"><select value={assignment.contentUserId} onChange={(event) => updateAssignment(creative.clientId, assignment.id, { contentUserId: event.target.value })}><option value="">اختر الكاتب</option>{contentMembers.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}</select></Field>
              <Field label="تاريخ تسليم المحتوى"><input type="date" value={assignment.writerDueDate} onChange={(event) => updateAssignment(creative.clientId, assignment.id, { writerDueDate: event.target.value })} /></Field>
              <Field label="تاريخ تسليم التنفيذ"><input type="date" value={assignment.dueDate} onChange={(event) => updateAssignment(creative.clientId, assignment.id, { dueDate: event.target.value })} /></Field>
              <Field label="ملاحظة المحتوى"><input value={assignment.contentNote} onChange={(event) => updateAssignment(creative.clientId, assignment.id, { contentNote: event.target.value })} /></Field>
              <Field label="ملاحظة قسم التنفيذ" wide><textarea value={assignment.departmentNote} onChange={(event) => updateAssignment(creative.clientId, assignment.id, { departmentNote: event.target.value })} /></Field>
            </div></div>)}
            <div className="marketing-panel-head"><div><h3>سيارات الكرييتيف</h3><p>قراءة مباشرة من مخزن السيارات في العمليات.</p></div><Car size={24} /></div>
            <Field label="بحث برقم الهيكل أو السيارة أو البيان"><input value={vehicleSearch[creative.clientId] || ""} onChange={(event) => setVehicleSearch((current) => ({ ...current, [creative.clientId]: event.target.value }))} placeholder="اكتب حرفين على الأقل" /></Field>
            {loadingVehicles[creative.clientId] ? <small>جاري البحث...</small> : null}
            {(vehicleResults[creative.clientId] || []).length ? <div className="marketing-table-wrap"><table className="marketing-table"><thead><tr><th>اختيار</th><th>VIN</th><th>السيارة</th><th>البيان</th><th>اللون الخارجي</th><th>اللون الداخلي</th><th>الموديل</th><th>المكان</th></tr></thead><tbody>{vehicleResults[creative.clientId].map((vehicle) => <tr key={vehicle.id}><td><input type="checkbox" checked={creative.vehicleIds.includes(vehicle.id)} onChange={() => toggleVehicle(creative.clientId, vehicle)} /></td><td>{vehicle.vin}</td><td>{vehicle.car_name || "—"}</td><td>{vehicle.statement || "—"}</td><td>{vehicle.exterior_color || "—"}</td><td>{vehicle.interior_color || "—"}</td><td>{vehicle.model_year || "—"}</td><td>{vehicle.location_name || "—"}</td></tr>)}</tbody></table></div> : null}
            {creative.vehicles.length ? <div className="marketing-chip-list">{creative.vehicles.map((vehicle) => <span className="marketing-chip" key={vehicle.id}>{vehicle.vin} — {vehicle.car_name}<button type="button" onClick={() => toggleVehicle(creative.clientId, vehicle)}>×</button></span>)}</div> : null}
            {!campaignMode ? <div><div className="marketing-panel-head"><div><h3>منصات يوم الأجندة</h3><p>يمكن إضافة أكثر من موعد نشر لنفس الكرييتيف.</p></div><button type="button" className="marketing-button secondary small" onClick={() => addAgendaTarget(creative.clientId)}><Plus />عنصر نشر</button></div>{schedule.filter((item) => item.creativeClientId === creative.clientId).map((item) => <ScheduleEditor key={item.id} item={item} meta={meta} onChange={(patch) => setSchedule((current) => current.map((row) => row.id === item.id ? { ...row, ...patch, publishDate: creative.agendaDate } : row))} onRemove={() => setSchedule((current) => current.filter((row) => row.id !== item.id))} hideCreative />)}</div> : null}
          </div></article>)}
        </div>
      </section> : null}

      {campaignMode && step === 3 ? <section className="marketing-panel"><div className="marketing-panel-head"><div><h2>ميزانية الحملة</h2><p>المنتج هو الـCreative Instance المختار في الخطوة السابقة، ولكل منصة قيمة مستقلة.</p></div><button type="button" className="marketing-button primary" onClick={() => setBudgets((current) => [...current, emptyBudget()])}><Plus />إضافة صف ميزانية</button></div>{!budgets.length ? <MarketingEmpty title="لم تضف ميزانية" description="يمكن ترك الميزانية فارغة أو إضافة أكثر من صف." /> : <div className="marketing-stack">{budgets.map((budget, index) => <div className="marketing-budget-row" key={budget.id}><div className="marketing-panel-head"><strong>صف الميزانية {index + 1}</strong><button type="button" className="marketing-button danger small" onClick={() => setBudgets((current) => current.filter((item) => item.id !== budget.id))}><Trash /></button></div><div className="marketing-form-grid cols-4"><Field label="Funnel"><select value={budget.funnelId} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, funnelId: event.target.value } : item))}><option value="">اختر Funnel</option>{meta.funnels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="الكرييتيف"><select value={budget.creativeClientId} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, creativeClientId: event.target.value } : item))}><option value="">اختر الكرييتيف</option>{creatives.map((item, i) => <option key={item.clientId} value={item.clientId}>N{String(i + 1).padStart(2, "0")} — {item.name}</option>)}</select></Field><Field label="عدد الإعلانات"><input type="number" min="1" value={budget.adsCount} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, adsCount: event.target.value } : item))} /></Field><Field label="هدف المحتوى"><input value={budget.contentGoal} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, contentGoal: event.target.value } : item))} /></Field><Field label="النتيجة المستهدفة" wide><input value={budget.expectedTarget} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, expectedTarget: event.target.value } : item))} /></Field></div><div className="marketing-stack">{budget.platforms.map((platform, platformIndex) => <div className="marketing-platform-budget" key={`${budget.id}_${platformIndex}`}><Field label="المنصة"><select value={platform.platformId} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, platforms: item.platforms.map((row, i) => i === platformIndex ? { ...row, platformId: event.target.value } : row) } : item))}><option value="">اختر المنصة</option>{meta.platforms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="القيمة"><input type="number" min="0" step="0.01" value={platform.amount} onChange={(event) => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, platforms: item.platforms.map((row, i) => i === platformIndex ? { ...row, amount: event.target.value } : row) } : item))} /></Field><button type="button" className="marketing-button danger" onClick={() => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, platforms: item.platforms.filter((_row, i) => i !== platformIndex) } : item))}><Trash /></button></div>)}</div><button type="button" className="marketing-button secondary small" onClick={() => setBudgets((current) => current.map((item) => item.id === budget.id ? { ...item, platforms: [...item.platforms, { platformId: "", amount: "0" }] } : item))}><Plus />إضافة منصة</button><div style={{ textAlign: "left", fontWeight: 900 }}>إجمالي الصف: {formatMoney(budget.platforms.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</div></div>)}</div>}<div className="marketing-panel" style={{ marginTop: 14 }}><strong>إجمالي ميزانية الحملة: {formatMoney(totalBudget)}</strong></div></section> : null}

      {campaignMode && step === 4 ? <section className="marketing-panel"><div className="marketing-panel-head"><div><h2>جدول النشر</h2><p>أضف عناصر النشر داخل نطاق الحملة، وكل عنصر يقبل أكثر من منصة وأكثر من نوع نشر.</p></div><button type="button" className="marketing-button primary" onClick={() => setSchedule((current) => [...current, emptySchedule(effectiveStart)])}><Plus />إضافة عنصر نشر</button></div>{!schedule.length ? <MarketingEmpty title="جدول النشر فارغ" description="أضف يومًا وكرييتيفًا ومنصة ونوع نشر." /> : <div className="marketing-stack">{schedule.map((item) => <ScheduleEditor key={item.id} item={item} meta={meta} creatives={creatives} min={effectiveStart} max={effectiveEnd} onChange={(patch) => setSchedule((current) => current.map((row) => row.id === item.id ? { ...row, ...patch } : row))} onRemove={() => setSchedule((current) => current.filter((row) => row.id !== item.id))} />)}</div>}</section> : null}

      {step === maxStep ? <section className="marketing-stack"><section className="marketing-panel"><div className="marketing-panel-head"><div><h2>المراجعة النهائية</h2><p>راجع كل البيانات قبل إنشاء الحملة والتاسكات والعلاقات داخل Transaction واحدة.</p></div><Check size={30} /></div><div className="marketing-review-kv"><div><small>الاسم</small><strong>{campaignMode ? campaign.name : agenda.name}</strong></div><div><small>النوع</small><strong>{campaignMode ? meta.campaignTypes.find((item) => item.id === campaign.campaignTypeId)?.name || "—" : "أجندة شهرية"}</strong></div><div><small>نطاق النشر</small><strong>{effectiveStart} ← {effectiveEnd}</strong></div><div><small>الكرييتيفات</small><strong>{creatives.length}</strong></div><div><small>علاقات التنفيذ والمحتوى</small><strong>{pairsCount} — ينتج {pairsCount * 2} مهمة</strong></div><div><small>عناصر النشر</small><strong>{scheduleCount}</strong></div>{campaignMode ? <div><small>إجمالي الميزانية</small><strong>{formatMoney(totalBudget)}</strong></div> : null}</div></section>
        <section className="marketing-review-section"><h3>الكرييتيف والتوزيع</h3><div className="content marketing-stack">{creatives.map((creative, i) => <article key={creative.clientId}><strong>N{String(i + 1).padStart(2, "0")} — {creative.name}</strong>{!campaignMode ? <span> · {creative.agendaDate}</span> : null}<div className="marketing-chip-list">{creative.assignments.map((assignment) => <span className="marketing-chip" key={assignment.id}>{meta.users.find((user) => user.id === assignment.executionUserId)?.full_name} × {meta.users.find((user) => user.id === assignment.contentUserId)?.full_name} · {meta.departments.find((department) => department.department_code === assignment.departmentCode)?.display_name}</span>)}</div>{creative.vehicles.length ? <small>{creative.vehicles.length} سيارة مختارة</small> : null}</article>)}</div></section>
        <section className="marketing-review-section"><h3>جدول النشر</h3><div className="content marketing-stack">{(campaignMode ? schedule : agendaSchedule()).map((item) => <div key={item.id}><strong>{item.publishDate} — {creatives.find((creative) => creative.clientId === item.creativeClientId)?.name}</strong><div className="marketing-chip-list">{item.targets.map((target) => <span key={target.id} className="marketing-chip">{meta.platforms.find((platform) => platform.id === target.platformId)?.name} · {target.postTypeIds.length} نوع</span>)}</div></div>)}</div></section>
      </section> : null}

      <div className="marketing-wizard-actions"><div className="right">{step > 1 ? <button type="button" className="marketing-button" onClick={previous}><CaretRight />السابق</button> : null}</div><div className="left">{step < maxStep ? <button type="button" className="marketing-button primary" onClick={next}>التالي<CaretLeft /></button> : <button type="button" className="marketing-button primary" disabled={saving} onClick={() => void submit()}>{saving ? "جاري الإنشاء..." : campaignMode ? "إنشاء الحملة" : "إنشاء الأجندة"}</button>}</div></div>
    </div>
  );
}

function ScheduleEditor({ item, meta, creatives = [], min, max, onChange, onRemove, hideCreative = false }: { item: ScheduleDraft; meta: ReturnType<typeof useMarketingMeta>["meta"]; creatives?: CreativeDraft[]; min?: string; max?: string; onChange: (patch: Partial<ScheduleDraft>) => void; onRemove: () => void; hideCreative?: boolean }) {
  function updateTarget(id: string, patch: Partial<ScheduleTargetDraft>) { onChange({ targets: item.targets.map((target) => target.id === id ? { ...target, ...patch } : target) }); }
  return <div className="marketing-schedule-row"><div className="marketing-panel-head"><strong>عنصر نشر</strong><button type="button" className="marketing-button danger small" onClick={onRemove}><Trash /></button></div><div className="marketing-form-grid cols-3">{!hideCreative ? <Field label="التاريخ"><input type="date" min={min} max={max} value={item.publishDate} onChange={(event) => onChange({ publishDate: event.target.value })} /></Field> : null}{!hideCreative ? <Field label="الكرييتيف"><select value={item.creativeClientId} onChange={(event) => onChange({ creativeClientId: event.target.value })}><option value="">اختر الكرييتيف</option>{creatives.map((creative, i) => <option key={creative.clientId} value={creative.clientId}>N{String(i + 1).padStart(2, "0")} — {creative.name}</option>)}</select></Field> : null}<Field label="Caption"><input value={item.caption} onChange={(event) => onChange({ caption: event.target.value })} /></Field><Field label="Hashtags"><input value={item.hashtags} onChange={(event) => onChange({ hashtags: event.target.value })} /></Field></div><div className="marketing-stack">{item.targets.map((target) => { const postTypes = meta.postTypes.filter((type) => type.platform_id === target.platformId); return <div className="marketing-target-row" key={target.id}><Field label="المنصة"><select value={target.platformId} onChange={(event) => updateTarget(target.id, { platformId: event.target.value, postTypeIds: [] })}><option value="">اختر المنصة</option>{meta.platforms.map((platform) => <option key={platform.id} value={platform.id}>{platform.name}</option>)}</select></Field><Field label="وقت النشر"><input type="time" value={target.publishTime} onChange={(event) => updateTarget(target.id, { publishTime: event.target.value })} /></Field><div className="marketing-field"><span>أنواع النشر</span><div className="marketing-check-grid">{postTypes.map((type) => <label className="marketing-check" key={type.id}><input type="checkbox" checked={target.postTypeIds.includes(type.id)} onChange={() => updateTarget(target.id, { postTypeIds: target.postTypeIds.includes(type.id) ? target.postTypeIds.filter((id) => id !== type.id) : [...target.postTypeIds, type.id] })} /><span>{type.name}{type.dimensions ? ` · ${type.dimensions}` : ""}</span></label>)}</div></div><button type="button" className="marketing-button danger" onClick={() => onChange({ targets: item.targets.filter((row) => row.id !== target.id) })}><Trash /></button></div>; })}</div><button type="button" className="marketing-button secondary small" onClick={() => onChange({ targets: [...item.targets, { id: uid("target"), platformId: "", publishTime: "", postTypeIds: [] }] })}><Plus />إضافة منصة</button></div>;
}
