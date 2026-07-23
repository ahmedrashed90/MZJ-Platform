import { useMemo, useRef, useState } from "react";
import { CalendarBlank, CheckCircle, FolderOpen, Plus, Table, Trash } from "@phosphor-icons/react";
import { useOutletContext } from "react-router-dom";
import { marketingFetch, todayIso, uid } from "../api";
import type { DraftInstance } from "../types";
import type { MarketingOutletContext } from "../MarketingLayout";
import { Alert, ConfirmButton, Empty, Modal, PageHead } from "../components/Ui";
import { InstanceEditor } from "../components/InstanceEditor";
import { buildCsv, downloadStoredZip } from "../components/exportFiles";

type AgendaFields = { name: string; month: string; publishStartDate: string; publishEndDate: string };
type DayDraft = { date: string; instances: DraftInstance[] };

function monthValue() { return todayIso().slice(0, 7); }
function initialFields(): AgendaFields { const today = todayIso(); return { name: "", month: monthValue(), publishStartDate: today, publishEndDate: today }; }
function datesBetween(start: string, end: string) {
  if (!start || !end || end < start) return [];
  const rows: string[] = []; const cursor = new Date(`${start}T00:00:00`); const finish = new Date(`${end}T00:00:00`);
  while (cursor <= finish && rows.length < 370) { rows.push(cursor.toISOString().slice(0, 10)); cursor.setDate(cursor.getDate() + 1); }
  return rows;
}
function createInstance(creativeId: string, primaryDepartmentId: string, agendaDate: string): DraftInstance {
  return { key: uid("agenda-creative"), creativeId, agendaDate, contentReceivedDate: "", contentNotes: "", writers: [], departments: [{ departmentId: primaryDepartmentId, isPrimary: true, dueDate: "", notes: "", assignments: [] }], vehicleIds: [], posts: [] };
}
function dayLabel(date: string) { return new Intl.DateTimeFormat("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date(`${date}T00:00:00`)); }

export function CreateAgendaPage() {
  const { meta } = useOutletContext<MarketingOutletContext>();
  const [step, setStep] = useState(1);
  const [fields, setFields] = useState<AgendaFields>(initialFields);
  const [days, setDays] = useState<DayDraft[]>([]);
  const [editingDate, setEditingDate] = useState("");
  const [creativeId, setCreativeId] = useState("");
  const [creativeCount, setCreativeCount] = useState(1);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [createRaw, setCreateRaw] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const range = useMemo(() => datesBetween(fields.publishStartDate, fields.publishEndDate), [fields.publishStartDate, fields.publishEndDate]);
  const currentDay = days.find((day) => day.date === editingDate);
  const usedDays = days.filter((day) => day.instances.length);
  const relationships = days.reduce((sum, day) => sum + day.instances.reduce((inside, instance) => inside + instance.departments.reduce((value, department) => value + department.assignments.length, 0), 0), 0);
  const totalInstances = days.reduce((sum, day) => sum + day.instances.length, 0);
  const resultingTasks = days.reduce((sum, day) => sum + day.instances.reduce((inside, instance) => inside + instance.writers.length + instance.departments.reduce((value, department) => value + department.assignments.length, 0), 0), 0);

  function updateDates(patch: Partial<AgendaFields>) {
    const next = { ...fields, ...patch }; setFields(next);
    if (patch.publishStartDate !== undefined || patch.publishEndDate !== undefined) {
      const valid = new Set(datesBetween(next.publishStartDate, next.publishEndDate));
      setDays((current) => current.filter((day) => valid.has(day.date)));
    }
  }
  function openDay(date: string) { setEditingDate(date); setCreativeId(""); setCreativeCount(1); setError(""); }
  function addInstances() {
    const creative = meta.creatives.find((item) => item.id === creativeId && item.is_active);
    if (!creative || !editingDate) { setError("اختر نوع الكرييتيف."); return; }
    const count = Math.max(1, Math.min(50, Math.floor(creativeCount || 1)));
    setDays((current) => {
      const existing = current.find((day) => day.date === editingDate) || { date: editingDate, instances: [] };
      const additions = Array.from({ length: count }, () => createInstance(creative.id, creative.primary_department_id, editingDate));
      const next = { ...existing, instances: [...existing.instances, ...additions] };
      return current.some((day) => day.date === editingDate) ? current.map((day) => day.date === editingDate ? next : day) : [...current, next];
    });
    setCreativeId(""); setCreativeCount(1); setError("");
  }
  function updateInstance(key: string, next: DraftInstance) { setDays((current) => current.map((day) => day.date === editingDate ? { ...day, instances: day.instances.map((item) => item.key === key ? next : item) } : day)); }
  function removeInstance(key: string) { setDays((current) => current.map((day) => day.date === editingDate ? { ...day, instances: day.instances.filter((item) => item.key !== key) } : day)); }
  function instanceComplete(instance: DraftInstance) { return Boolean(instance.writers.length && instance.departments.length && instance.departments.every((department) => department.assignments.length) && instance.posts.length); }
  function validate(currentStep: number) {
    if (currentStep === 1) {
      if (!fields.name.trim() || !fields.month || !fields.publishStartDate || !fields.publishEndDate) return "أكمل بيانات الأجندة.";
      if (fields.publishEndDate < fields.publishStartDate) return "تاريخ نهاية النشر يجب ألا يسبق البداية.";
    }
    if (currentStep === 2) {
      if (!totalInstances) return "أضف كرييتيف واحدًا على الأقل داخل أيام الأجندة.";
      const incomplete = days.flatMap((day) => day.instances.map((instance) => ({ day: day.date, instance }))).find((row) => !instanceComplete(row.instance));
      if (incomplete) return `أكمل بيانات كل كرييتيف في يوم ${incomplete.day}.`;
    }
    return "";
  }
  function next() { const validation = validate(step); if (validation) { setError(validation); return; } setError(""); setStep((value) => Math.min(3, value + 1)); }
  function previous() { setError(""); setStep((value) => Math.max(1, value - 1)); }
  function reset(clearMessage = true) { setStep(1); setFields(initialFields()); setDays([]); setEditingDate(""); setCreativeId(""); setCreativeCount(1); setError(""); if (clearMessage) setMessage(""); setCreateRaw(false); idempotencyKey.current = crypto.randomUUID(); }
  function downloadRelationshipSheets() {
    const files = usedDays.map((day) => {
      const rows: Array<Array<string | number>> = [[
        "اليوم",
        "التاريخ",
        "رقم الكرييتيف",
        "الكرييتيف",
        "الكود المختصر",
        "القسم",
        "المسؤول التنفيذي",
        "كاتب المحتوى",
        "موعد استلام المحتوى",
        "موعد تسليم القسم",
        "ملاحظات المحتوى",
        "ملاحظات القسم",
        "المنصات وأنواع النشر",
        "معرّفات السيارات",
      ]];
      day.instances.forEach((instance, index) => {
        const creative = meta.creatives.find((item) => item.id === instance.creativeId);
        const posts = instance.posts.map((post) => {
          const platform = meta.platforms.find((item) => item.id === post.platformId);
          const postType = platform?.post_types.find((item) => item.id === post.postTypeId);
          return `${platform?.name || post.platformId}: ${postType?.name || post.postTypeId}`;
        }).join(" | ");
        instance.departments.forEach((department) => {
          const departmentMeta = meta.departments.find((item) => item.id === department.departmentId);
          department.assignments.forEach((assignment) => {
            const executive = meta.users.find((user) => user.id === assignment.executiveUserId);
            const writer = meta.users.find((user) => user.id === assignment.contentWriterId);
            rows.push([
              dayLabel(day.date),
              day.date,
              `N${String(index + 1).padStart(2, "0")}`,
              creative?.name || instance.creativeId,
              creative?.short_code || "",
              departmentMeta?.name || department.departmentId,
              executive?.full_name || assignment.executiveUserId,
              writer?.full_name || assignment.contentWriterId,
              instance.contentReceivedDate,
              assignment.dueDate || department.dueDate,
              instance.contentNotes,
              department.notes,
              posts,
              instance.vehicleIds.join(" | "),
            ]);
          });
        });
      });
      return { name: `${day.date}-relationships.csv`, content: buildCsv(rows) };
    });
    const safeName = (fields.name.trim() || fields.month || "agenda").replace(/[\\/:*?"<>|]+/g, "-");
    downloadStoredZip(`${safeName}-relationship-sheets.zip`, files);
  }

  async function createAgenda() {
    const first = validate(1) || validate(2); if (first) { setError(first); setStep(first.includes("بيانات الأجندة") || first.includes("نهاية") ? 1 : 2); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const instances = [...days].sort((a, b) => a.date.localeCompare(b.date)).flatMap((day) => day.instances).map((instance) => ({ ...instance, key: undefined }));
      const response = await marketingFetch<{ ok: boolean; campaignId: string; campaignCode: string }>("/api/marketing", { method: "POST", body: JSON.stringify({ action: "create_campaign", sourceKind: "agenda", name: fields.name, publishStartDate: fields.publishStartDate, publishEndDate: fields.publishEndDate, month: fields.month, idempotencyKey: idempotencyKey.current, instances }) });
      let rawWarning = "";
      if (createRaw) {
        try { await marketingFetch("/api/marketing", { method: "POST", body: JSON.stringify({ action: "campaign_action", campaignAction: "create_raw_folders", campaignId: response.campaignId }) }); }
        catch (failure) { rawWarning = ` تم إنشاء الأجندة، لكن تعذر إنشاء فولدرات الخام: ${failure instanceof Error ? failure.message : "خطأ غير معروف"}`; }
      }
      reset(false);
      setMessage(`تم إنشاء الأجندة بنجاح: ${response.campaignCode}.${rawWarning}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "تعذر إنشاء الأجندة"); }
    finally { setBusy(false); }
  }

  return <div className="marketing-page">
    <PageHead title="إنشاء أجندة" description="إنشاء الأجندة وربط الأيام والكرييتيفات والأقسام واليوزرات والمنصات والسيارات." />
    <div className="marketing-steps three"><button className={step === 1 ? "active" : step > 1 ? "done" : ""}><b>{step > 1 ? "✓" : "1"}</b><span>بيانات الأجندة</span></button><button className={step === 2 ? "active" : step > 2 ? "done" : ""}><b>{step > 2 ? "✓" : "2"}</b><span>جدول الأيام والربط</span></button><button className={step === 3 ? "active" : ""}><b>3</b><span>إنشاء الأجندة</span></button></div>
    {error ? <Alert type="error">{error}</Alert> : null}{message ? <Alert type="success">{message}</Alert> : null}
    {step === 1 ? <section className="marketing-form-card"><h2><CalendarBlank size={24} /> بيانات الأجندة</h2><div className="marketing-form-grid two"><label><span>الشهر</span><input type="month" value={fields.month} onChange={(event) => updateDates({ month: event.target.value })} /></label><label><span>اسم الأجندة</span><input value={fields.name} onChange={(event) => updateDates({ name: event.target.value })} placeholder="مثال: أجندة أغسطس 2026" /></label><label><span>بداية النشر</span><input type="date" value={fields.publishStartDate} onChange={(event) => updateDates({ publishStartDate: event.target.value })} /></label><label><span>نهاية النشر</span><input type="date" value={fields.publishEndDate} onChange={(event) => updateDates({ publishEndDate: event.target.value })} /></label></div></section> : null}
    {step === 2 ? <section className="marketing-form-card"><h2>جدول الأيام والربط</h2><p>الأيام الظاهرة محصورة بين بداية ونهاية النشر شاملًا التاريخين.</p><div className="marketing-agenda-days">{range.map((date) => { const day = days.find((item) => item.date === date); return <article key={date}><div><strong>{dayLabel(date)}</strong><small>{day?.instances.length || 0} كرييتيف</small></div><button type="button" onClick={() => openDay(date)}>إضافة / تعديل الربط</button></article>; })}</div></section> : null}
    {step === 3 ? <section className="marketing-form-card"><h2><CheckCircle size={24} /> مراجعة وإنشاء الأجندة</h2><div className="marketing-summary-cards"><div><span>الأيام</span><b>{range.length}</b></div><div><span>الأيام المستخدمة</span><b>{usedDays.length}</b></div><div><span>الكرييتيفات</span><b>{totalInstances}</b></div><div><span>العلاقات</span><b>{relationships}</b></div><div><span>إجمالي التاسكات</span><b>{resultingTasks}</b></div></div>{usedDays.map((day) => <article className="marketing-review-day" key={day.date}><h3>{dayLabel(day.date)}</h3>{day.instances.map((instance, index) => { const creative = meta.creatives.find((item) => item.id === instance.creativeId); return <div key={instance.key}><b>N{String(index + 1).padStart(2, "0")} · {creative?.name}</b><span>{creative?.short_code}</span><span>{instance.writers.map((writer) => meta.users.find((user) => user.id === writer.userId)?.full_name).filter(Boolean).join("، ")}</span><span>{instance.posts.length} منصة/نوع نشر · {instance.vehicleIds.length} سيارة</span></div>; })}</article>)}<div className="marketing-agenda-review-actions"><ConfirmButton tone="secondary" onClick={downloadRelationshipSheets}><Table size={18} />تحميل شيتات العلاقات ZIP</ConfirmButton><label className="marketing-checkbox"><input type="checkbox" checked={createRaw} onChange={(event) => setCreateRaw(event.target.checked)} /><FolderOpen size={18} />إنشاء فولدرات الخام عند الإنشاء</label></div></section> : null}
    <div className="marketing-wizard-actions"><ConfirmButton tone="secondary" onClick={reset}>مسح النموذج</ConfirmButton>{step > 1 ? <ConfirmButton tone="secondary" onClick={previous}>السابق</ConfirmButton> : null}{step < 3 ? <ConfirmButton onClick={next}>التالي</ConfirmButton> : <ConfirmButton onClick={() => void createAgenda()} disabled={busy}>{busy ? "جاري الإنشاء..." : "إنشاء الأجندة"}</ConfirmButton>}</div>
    <Modal open={Boolean(editingDate)} title="إضافة / تعديل الربط" subtitle={editingDate ? dayLabel(editingDate) : undefined} onClose={() => setEditingDate("")} wide>
      <div className="marketing-agenda-editor-head"><select value={creativeId} onChange={(event) => setCreativeId(event.target.value)}><option value="">اختر نوع الكرييتيف</option>{meta.creatives.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input type="number" min={1} max={50} value={creativeCount} onChange={(event) => setCreativeCount(Number(event.target.value))} /><ConfirmButton onClick={addInstances}><Plus size={17} />إضافة الكرييتيف لليوم</ConfirmButton></div>
      {!currentDay?.instances.length ? <Empty text="لا توجد كرييتيفات لهذا اليوم." /> : currentDay.instances.map((instance, index) => <section className={`marketing-instance-shell ${instanceComplete(instance) ? "complete" : "incomplete"}`} key={instance.key}><header><strong>N{String(index + 1).padStart(2, "0")} - {meta.creatives.find((item) => item.id === instance.creativeId)?.name}</strong><span>{instanceComplete(instance) ? "مكتمل" : "لم يتم اختيار أي بيانات بعد"}</span><button type="button" onClick={() => removeInstance(instance.key)}><Trash size={17} />حذف الكرييتيف</button></header><InstanceEditor instance={instance} onChange={(next) => updateInstance(instance.key, next)} meta={meta} showPosts /></section>)}
      <div className="marketing-modal-sticky-actions"><ConfirmButton onClick={() => setEditingDate("")}>حفظ والعودة للجدول</ConfirmButton></div>
    </Modal>
  </div>;
}
