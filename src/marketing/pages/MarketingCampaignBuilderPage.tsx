import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarBlank,
  Car,
  CheckCircle,
  Copy,
  CurrencyCircleDollar,
  FolderOpen,
  MegaphoneSimple,
  Plus,
  Trash,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";
import { marketingFetch, marketingMutation } from "../api";
import type { CampaignDetailResponse, PlatformSetting } from "../types";
import type { MarketingOutletContext } from "../MarketingLayout";
import { copyText, DEPARTMENT_LABELS, toLocalInput } from "../utils";

type BuilderCar = { uniqueSpecKey: string; name: string; exteriorColor: string; interiorColor: string };
type BuilderDepartment = { code: string; assignedUserId: string; pairedContentUserId: string; dueAt: string; notes: string };
type BuilderPublish = { platformCode: string; postType: string; scheduledAt: string; caption: string; hashtags: string };
type BuilderCreative = {
  id?: string;
  instanceKey: string;
  creativeType: string;
  name: string;
  description: string;
  cars: BuilderCar[];
  departments: BuilderDepartment[];
  budget: number;
  sortOrder: number;
  publishPlan: BuilderPublish[];
};
type CampaignForm = {
  id?: string;
  name: string;
  campaignCode: string;
  campaignType: string;
  objective: string;
  brief: string;
  startsAt: string;
  endsAt: string;
  dueAt: string;
  rawRootPath: string;
  creatives: BuilderCreative[];
};

const initialForm: CampaignForm = { name: "", campaignCode: "", campaignType: "", objective: "", brief: "", startsAt: "", endsAt: "", dueAt: "", rawRootPath: "", creatives: [] };
const steps = [
  { title: "بيانات الحملة", icon: MegaphoneSimple },
  { title: "الكرييتيف والربط", icon: UsersThree },
  { title: "الميزانية", icon: CurrencyCircleDollar },
  { title: "جدول النشر", icon: CalendarBlank },
  { title: "المراجعة والحفظ", icon: CheckCircle },
];

function nextInstanceKey(code: string, creatives: BuilderCreative[]) {
  const used = new Set(creatives.map((creative) => creative.instanceKey));
  let sequence = 1;
  while (used.has(`${code}-${String(sequence).padStart(2, "0")}`)) sequence += 1;
  return `${code}-${String(sequence).padStart(2, "0")}`;
}

function platformByCode(platforms: PlatformSetting[], code: string) {
  return platforms.find((platform) => platform.code === code);
}

export function MarketingCampaignBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { meta } = useOutletContext<MarketingOutletContext>();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<CampaignForm>(initialForm);
  const [addType, setAddType] = useState(meta.creativeTypes[0]?.code || "");
  const [addCount, setAddCount] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    marketingFetch<CampaignDetailResponse>(`/api/marketing?resource=campaign&id=${encodeURIComponent(id)}`)
      .then((payload) => {
        const plansByCreative = payload.publishing.reduce<Record<string, BuilderPublish[]>>((acc, item) => {
          (acc[item.creative_id] ||= []).push({ platformCode: item.platform_code, postType: item.post_type, scheduledAt: toLocalInput(item.scheduled_at), caption: item.caption || "", hashtags: item.hashtags || "" });
          return acc;
        }, {});
        setForm({
          id: payload.campaign.id,
          name: payload.campaign.name,
          campaignCode: payload.campaign.campaign_code || "",
          campaignType: payload.campaign.campaign_type || "",
          objective: payload.campaign.objective || "",
          brief: payload.campaign.brief || "",
          startsAt: toLocalInput(payload.campaign.starts_at),
          endsAt: toLocalInput(payload.campaign.ends_at),
          dueAt: toLocalInput(payload.campaign.due_at),
          rawRootPath: payload.campaign.raw_root_path || "",
          creatives: payload.creatives.map((creative) => ({
            id: creative.id,
            instanceKey: creative.instance_key,
            creativeType: creative.creative_type,
            name: creative.name,
            description: creative.description || "",
            cars: creative.cars || [],
            departments: (creative.departments || []).map((department) => ({ code: department.code, assignedUserId: department.assignedUserId || "", pairedContentUserId: department.pairedContentUserId || "", dueAt: toLocalInput(department.dueAt), notes: department.notes || "" })),
            budget: Number(creative.budget || 0),
            sortOrder: creative.sort_order,
            publishPlan: plansByCreative[creative.id] || [],
          })),
        });
      })
      .catch((failure) => setError(failure instanceof Error ? failure.message : "تعذر تحميل الحملة"))
      .finally(() => setLoading(false));
  }, [id]);

  const budgetTotal = useMemo(() => form.creatives.reduce((sum, creative) => sum + Number(creative.budget || 0), 0), [form.creatives]);
  const generatedRootPath = useMemo(() => {
    if (form.rawRootPath) return form.rawRootPath;
    const base = form.startsAt ? form.startsAt.slice(0, 7) : new Date().toISOString().slice(0, 7);
    const folderName = (form.name || "اسم الحملة").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
    return `Z:\\${base}\\${folderName || "اسم الحملة"}`;
  }, [form.rawRootPath, form.startsAt, form.name]);

  function updateCreative(index: number, patch: Partial<BuilderCreative>) {
    setForm((current) => ({ ...current, creatives: current.creatives.map((creative, creativeIndex) => creativeIndex === index ? { ...creative, ...patch } : creative) }));
  }

  function addCreatives() {
    const setting = meta.creativeTypes.find((type) => type.code === addType);
    if (!setting) return;
    setForm((current) => {
      const next = [...current.creatives];
      const count = Number.isFinite(addCount) ? Math.max(1, Math.min(20, Math.floor(addCount))) : 1;
      for (let index = 0; index < count; index += 1) {
        const instanceKey = nextInstanceKey(setting.code, next);
        next.push({
          instanceKey,
          creativeType: setting.code,
          name: setting.name,
          description: "",
          cars: [],
          departments: setting.department_codes.map((code) => ({ code, assignedUserId: "", pairedContentUserId: "", dueAt: "", notes: "" })),
          budget: 0,
          sortOrder: next.length,
          publishPlan: [],
        });
      }
      return { ...current, creatives: next };
    });
  }

  function removeCreative(index: number) {
    setForm((current) => ({ ...current, creatives: current.creatives.filter((_, creativeIndex) => creativeIndex !== index).map((creative, sortOrder) => ({ ...creative, sortOrder })) }));
  }

  function updateDepartment(creativeIndex: number, departmentIndex: number, patch: Partial<BuilderDepartment>) {
    const creative = form.creatives[creativeIndex];
    const departments = creative.departments.map((department, index) => index === departmentIndex ? { ...department, ...patch } : department);
    const contentUser = departments.find((department) => department.code === "content")?.assignedUserId || "";
    updateCreative(creativeIndex, { departments: departments.map((department) => department.code === "content" ? department : { ...department, pairedContentUserId: contentUser }) });
  }

  function addCar(creativeIndex: number) {
    updateCreative(creativeIndex, { cars: [...form.creatives[creativeIndex].cars, { uniqueSpecKey: "", name: "", exteriorColor: "", interiorColor: "" }] });
  }

  function updateCar(creativeIndex: number, carIndex: number, key: keyof BuilderCar, value: string) {
    updateCreative(creativeIndex, { cars: form.creatives[creativeIndex].cars.map((car, index) => index === carIndex ? { ...car, [key]: value } : car) });
  }

  function addPublishRow(creativeIndex: number) {
    const platform = meta.platforms[0];
    updateCreative(creativeIndex, { publishPlan: [...form.creatives[creativeIndex].publishPlan, { platformCode: platform?.code || "", postType: platform?.post_types[0] || "", scheduledAt: "", caption: "", hashtags: "" }] });
  }

  function updatePublish(creativeIndex: number, rowIndex: number, patch: Partial<BuilderPublish>) {
    updateCreative(creativeIndex, { publishPlan: form.creatives[creativeIndex].publishPlan.map((row, index) => index === rowIndex ? { ...row, ...patch } : row) });
  }

  function validateStep(targetStep: number) {
    if (targetStep >= 1 && (!form.name.trim() || !form.objective.trim())) return "اسم الحملة وهدف الحملة مطلوبان";
    if (targetStep >= 2 && form.creatives.length === 0) return "أضف كرييتيف واحدًا على الأقل";
    if (targetStep >= 2) {
      for (const creative of form.creatives) {
        if (!creative.name.trim()) return `اسم الكرييتيف مطلوب: ${creative.instanceKey}`;
        for (const department of creative.departments) {
          if (!department.assignedUserId) return `اختر مسؤول ${DEPARTMENT_LABELS[department.code] || department.code} في ${creative.name}`;
          if (department.code === "content" && !department.dueAt) return `حدد موعد تسليم المحتوى في ${creative.name}`;
        }
      }
    }
    if (targetStep >= 4) {
      for (const creative of form.creatives) {
        for (const row of creative.publishPlan) if (!row.platformCode || !row.postType) return `حدد المنصة ونوع النشر في ${creative.name}`;
      }
    }
    return "";
  }

  function go(nextStep: number) {
    const validation = validateStep(nextStep);
    if (validation) { setError(validation); return; }
    setError("");
    setStep(Math.max(0, Math.min(4, nextStep)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(createFolders: boolean) {
    const validation = validateStep(5);
    if (validation) { setError(validation); return; }
    setSaving(true); setError("");
    try {
      const payload = { ...form, rawRootPath: generatedRootPath, creatives: form.creatives };
      const result = await marketingMutation<{ ok: true; campaign: { id: string } }>("campaigns", form.id ? "PUT" : "POST", payload);
      const campaignId = result.campaign.id;
      if (createFolders) await marketingMutation("campaign-action", "POST", { campaignId, action: "create_folders" });
      navigate(`/marketing/campaigns/${campaignId}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر حفظ الحملة"); }
    finally { setSaving(false); }
  }

  if (!meta.access.canManageCampaigns) return <div className="connection-banner"><WarningCircle size={20} /><span>لا تملك صلاحية إنشاء أو تعديل الحملات.</span></div>;
  if (loading) return <div className="crm-loading-panel">جاري تحميل Campaign Builder...</div>;

  return <div className="module-page marketing-page marketing-builder-page">
    <header className="module-page-head"><div><span className="marketing-kicker">CAMPAIGN BUILDER</span><h1>{id ? "تعديل الحملة" : "إنشاء حملة جديدة"}</h1><p>صفحة كاملة بخمس مراحل، بدون Popup أو ربط بالاسم بدل instance key.</p></div></header>
    <nav className="marketing-builder-steps">{steps.map(({ title, icon: Icon }, index) => <button key={title} className={step === index ? "active" : step > index ? "done" : ""} onClick={() => { if (index < step) go(index); }}><span>{step > index ? <CheckCircle size={19} weight="fill" /> : <Icon size={19} />}</span><b>{index + 1}</b><em>{title}</em></button>)}</nav>
    {error ? <div className="connection-banner"><WarningCircle size={20} /><span>{error}</span></div> : null}

    {step === 0 ? <section className="panel marketing-builder-panel"><header><h2>بيانات الحملة</h2><p>الهدف يظهر في تفاصيل التاسكات وملخص الحملة.</p></header><div className="marketing-form-grid"><label><span>اسم الحملة</span><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label><span>كود الحملة</span><input value={form.campaignCode} onChange={(e) => setForm({ ...form, campaignCode: e.target.value })} placeholder="يُنشأ تلقائيًا عند تركه فارغًا" /></label><label><span>نوع الحملة</span><input value={form.campaignType} onChange={(e) => setForm({ ...form, campaignType: e.target.value })} placeholder="رقمية، موسمية، إطلاق..." /></label><label><span>هدف الحملة</span><input required value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} /></label><label><span>تاريخ البداية</span><input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></label><label><span>تاريخ النهاية</span><input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></label><label><span>موعد الحملة النهائي</span><input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></label><label className="wide"><span>Brief الحملة</span><textarea rows={6} value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} /></label></div></section> : null}

    {step === 1 ? <section className="marketing-builder-panel-stack"><section className="panel marketing-add-creative"><header><div><h2>إضافة الكرييتيفات</h2><p>العدد يُنشئ نسخًا مستقلة بمفاتيح مختلفة.</p></div></header><div><select value={addType} onChange={(e) => setAddType(e.target.value)}>{meta.creativeTypes.map((type) => <option key={type.code} value={type.code}>{type.name}</option>)}</select><input type="number" min={1} max={20} value={addCount} onChange={(e) => setAddCount(Number(e.target.value))} /><button className="marketing-primary-button" onClick={addCreatives}><Plus size={17} />إضافة</button></div></section>{form.creatives.map((creative, creativeIndex) => <article className="panel marketing-creative-builder-card" key={creative.instanceKey}><header><div><b>{creative.instanceKey}</b><input value={creative.name} onChange={(e) => updateCreative(creativeIndex, { name: e.target.value })} /></div><button className="danger" onClick={() => removeCreative(creativeIndex)}><Trash size={17} /></button></header><label className="marketing-description-field"><span>وصف أو ملاحظة الكرييتيف</span><textarea value={creative.description} onChange={(e) => updateCreative(creativeIndex, { description: e.target.value })} /></label><section className="marketing-department-assignment"><h3>ربط الأقسام والمستخدمين</h3><div>{creative.departments.map((department, departmentIndex) => <article key={department.code}><header><b>{DEPARTMENT_LABELS[department.code] || department.code}</b>{department.code !== "content" ? <small>مرتبط بكاتب المحتوى لنفس الكرييتيف</small> : null}</header><label><span>المسؤول</span><select value={department.assignedUserId} onChange={(e) => updateDepartment(creativeIndex, departmentIndex, { assignedUserId: e.target.value })}><option value="">اختر المستخدم</option>{meta.users.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}</select></label><label><span>موعد التسليم</span><input type="datetime-local" disabled={department.code !== "content"} value={department.dueAt} onChange={(e) => updateDepartment(creativeIndex, departmentIndex, { dueAt: e.target.value })} />{department.code !== "content" ? <small>يُفتح بعد اعتماد Task Template</small> : null}</label><label><span>ملاحظات القسم</span><textarea value={department.notes} onChange={(e) => updateDepartment(creativeIndex, departmentIndex, { notes: e.target.value })} /></label></article>)}</div></section><section className="marketing-cars-builder"><header><div><Car size={19} /><h3>السيارات المرتبطة</h3></div><button onClick={() => addCar(creativeIndex)}><Plus size={15} />إضافة سيارة</button></header>{creative.cars.map((car, carIndex) => <div key={carIndex}><input value={car.uniqueSpecKey} onChange={(e) => updateCar(creativeIndex, carIndex, "uniqueSpecKey", e.target.value)} placeholder="Unique Spec Key" /><input value={car.name} onChange={(e) => updateCar(creativeIndex, carIndex, "name", e.target.value)} placeholder="السيارة أو المنتج" /><input value={car.exteriorColor} onChange={(e) => updateCar(creativeIndex, carIndex, "exteriorColor", e.target.value)} placeholder="اللون الخارجي" /><input value={car.interiorColor} onChange={(e) => updateCar(creativeIndex, carIndex, "interiorColor", e.target.value)} placeholder="اللون الداخلي" /><button className="danger" onClick={() => updateCreative(creativeIndex, { cars: creative.cars.filter((_, index) => index !== carIndex) })}><Trash size={15} /></button></div>)}{creative.cars.length === 0 ? <p>يمكن ترك السيارات فارغة أو إضافة أكثر من سيارة بنفس الكرييتيف.</p> : null}</section></article>)}</section> : null}

    {step === 2 ? <section className="panel marketing-builder-panel"><header><h2>ميزانية الحملة</h2><p>المنتج هنا هو نسخة الكرييتيف المختارة في الخطوة السابقة.</p></header><div className="marketing-budget-list">{form.creatives.map((creative, index) => <article key={creative.instanceKey}><div><b>{creative.name}</b><span>{creative.instanceKey}</span></div><label><span>ميزانية الكرييتيف</span><input type="number" min={0} step="0.01" value={creative.budget} onChange={(e) => updateCreative(index, { budget: Number(e.target.value) })} /></label></article>)}</div><footer className="marketing-budget-total"><span>إجمالي الميزانية</span><b>{budgetTotal.toLocaleString("ar-SA", { maximumFractionDigits: 2 })}</b></footer></section> : null}

    {step === 3 ? <section className="marketing-builder-panel-stack">{form.creatives.map((creative, creativeIndex) => <article className="panel marketing-publish-builder" key={creative.instanceKey}><header><div><b>{creative.instanceKey}</b><h2>{creative.name}</h2></div><button onClick={() => addPublishRow(creativeIndex)}><Plus size={16} />إضافة منصة</button></header>{creative.publishPlan.map((row, rowIndex) => { const platform = platformByCode(meta.platforms, row.platformCode); return <section key={rowIndex}><div className="marketing-publish-row-head"><select value={row.platformCode} onChange={(e) => { const nextPlatform = platformByCode(meta.platforms, e.target.value); updatePublish(creativeIndex, rowIndex, { platformCode: e.target.value, postType: nextPlatform?.post_types[0] || "" }); }}>{meta.platforms.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select><select value={row.postType} onChange={(e) => updatePublish(creativeIndex, rowIndex, { postType: e.target.value })}>{(platform?.post_types || []).map((type) => <option key={type}>{type}</option>)}</select><input type="datetime-local" value={row.scheduledAt} onChange={(e) => updatePublish(creativeIndex, rowIndex, { scheduledAt: e.target.value })} /><button className="danger" onClick={() => updateCreative(creativeIndex, { publishPlan: creative.publishPlan.filter((_, index) => index !== rowIndex) })}><Trash size={16} /></button></div><div className="marketing-publish-copy-fields"><label><span>الكابشن</span><textarea value={row.caption} onChange={(e) => updatePublish(creativeIndex, rowIndex, { caption: e.target.value })} /></label><label><span>الهاشتاقات</span><textarea value={row.hashtags} onChange={(e) => updatePublish(creativeIndex, rowIndex, { hashtags: e.target.value })} /></label></div>{platform ? <small className="marketing-platform-note">حالة الربط: {platform.connection_status}</small> : null}</section>; })}{creative.publishPlan.length === 0 ? <div className="marketing-empty">أضف منصة ونوع نشر للكرييتيف.</div> : null}</article>)}</section> : null}

    {step === 4 ? <section className="marketing-builder-panel-stack"><section className="panel marketing-review-hero"><div><CheckCircle size={38} weight="duotone" /><h2>مراجعة الحملة قبل الحفظ</h2><p>سيتم إنشاء كل كرييتيف كمستند مستقل وربطه بالأقسام المحددة.</p></div><em>{form.creatives.length} كرييتيف · {budgetTotal.toLocaleString("ar-SA")} إجمالي الميزانية</em></section><section className="panel marketing-review-grid"><article><span>الحملة</span><b>{form.name}</b><p>{form.objective}</p></article><article><span>الفترة</span><b>{form.startsAt ? new Date(form.startsAt).toLocaleDateString("ar-SA") : "—"} — {form.endsAt ? new Date(form.endsAt).toLocaleDateString("ar-SA") : "—"}</b></article><article className="wide"><span>مسار الحملة</span><div className="marketing-path-row"><code>{generatedRootPath}</code><button onClick={() => void copyText(generatedRootPath)}><Copy size={16} /></button></div><label><span>تعديل المسار يدويًا</span><input value={form.rawRootPath} onChange={(e) => setForm({ ...form, rawRootPath: e.target.value })} placeholder={generatedRootPath} /></label></article></section><section className="panel marketing-review-creatives"><header><h2>ملخص الكرييتيفات</h2></header>{form.creatives.map((creative) => <article key={creative.instanceKey}><div><b>{creative.instanceKey}</b><strong>{creative.name}</strong></div><span>{creative.departments.map((department) => DEPARTMENT_LABELS[department.code] || department.code).join(" + ")}</span><span>{creative.cars.map((car) => car.name).filter(Boolean).join("، ") || "بدون سيارة محددة"}</span><span>{creative.publishPlan.map((row) => `${platformByCode(meta.platforms, row.platformCode)?.name || row.platformCode}/${row.postType}`).join("، ") || "بدون نشر"}</span><em>{creative.budget.toLocaleString("ar-SA")}</em></article>)}</section></section> : null}

    <footer className="marketing-builder-actions"><button disabled={step === 0 || saving} onClick={() => go(step - 1)}><ArrowRight size={17} />السابق</button>{step < 4 ? <button className="marketing-primary-button" onClick={() => go(step + 1)}>التالي<ArrowLeft size={17} /></button> : <div><button disabled={saving} onClick={() => void save(false)}><CheckCircle size={17} />حفظ وإنهاء</button><button disabled={saving} className="marketing-primary-button" onClick={() => void save(true)}><FolderOpen size={17} />حفظ وتجهيز مسارات الخام</button></div>}</footer>
  </div>;
}
