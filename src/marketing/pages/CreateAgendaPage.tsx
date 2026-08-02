import { useEffect, useMemo, useState } from "react";
import { getJSZip } from "../zip";
import { CalendarBlank, CalendarPlus, CheckCircle, FolderOpen, PencilSimple, Plus, X } from "@phosphor-icons/react";
import { marketingFetch, marketingQuery } from "../api";
import { CreativeEditor, newCreativeDraft } from "../components/CreativeEditor";
import { MarketingAlert, MarketingPage } from "../components/MarketingPage";
import { relationshipCsv } from "../templateExcel";
import type { CreativeDraft, ExecutionFolderCreation, MarketingMeta, RawFolderRequest, RawFolderResult } from "../types";
import { useEscapeToClose } from "../../components/useEscapeToClose";

const emptyMeta: MarketingMeta = {
  ok: true,
  users: [],
  departments: [],
  contentDepartmentId: "",
  actions: [],
  creativeTypes: [],
  campaignTypes: [],
  platforms: [],
  postTypes: [],
  funnels: [],
  cars: [],
  connections: [],
  permissions: { effective: [] },
};

type AgendaDay = { date: string; creatives: CreativeDraft[] };

function between(start: string, end: string) {
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

function dayLabel(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("ar-SA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function CreateAgendaPage() {
  const [meta, setMeta] = useState<MarketingMeta>(emptyMeta);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    monthKey: new Date().toISOString().slice(0, 7),
    name: "",
    publishStart: "",
    publishEnd: "",
  });
  const [days, setDays] = useState<AgendaDay[]>([]);
  const [editingDay, setEditingDay] = useState<string | null>(null);
  const [addCreative, setAddCreative] = useState({ creativeTypeId: "", quantity: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [executionFolders, setExecutionFolders] = useState<ExecutionFolderCreation | null>(null);

  useEffect(() => {
    marketingFetch<MarketingMeta>(`/api/marketing${marketingQuery({ resource: "meta" })}`)
      .then(setMeta)
      .catch((failure) => setError(failure instanceof Error ? failure.message : "تعذر تحميل الإعدادات"));
  }, []);

  const selectedDay = days.find((item) => item.date === editingDay);

  useEscapeToClose(Boolean(selectedDay), () => setEditingDay(null));

  useEffect(() => {
    if (!selectedDay) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedDay]);

  function prepareDays() {
    if (!form.name || !form.publishStart || !form.publishEnd) {
      setError("أكمل بيانات الأجندة");
      return;
    }
    setDays((current) => between(form.publishStart, form.publishEnd).map((date) => current.find((item) => item.date === date) || { date, creatives: [] }));
    setStep(1);
    setError("");
  }

  function updateDay(date: string, creatives: CreativeDraft[]) {
    setDays((current) => current.map((item) => item.date === date ? { ...item, creatives } : item));
  }

  function creativeName(id: string) {
    return meta.creativeTypes.find((item) => item.id === id)?.name || "—";
  }

  const executionFolderPlanKey = useMemo(() => JSON.stringify({
    monthKey: form.monthKey,
    campaignFolderName: form.name,
    days: days.map((day) => ({
      date: day.date,
      creatives: day.creatives.map((creative) => ({
        tempId: creative.tempId,
        creativeTypeId: creative.creativeTypeId,
        quantity: creative.quantity,
        cars: creative.cars.map((car) => car.id),
        users: [...creative.primaryAssignments, ...creative.optionalAssignments.flatMap((group) => group.assignments)].map((assignment) => assignment.userId),
      })),
    })),
  }), [form.monthKey, form.name, days]);
  useEffect(() => { setExecutionFolders(null); }, [executionFolderPlanKey]);

  const relations = useMemo(() => days.flatMap((day) => day.creatives.flatMap((creative) => {
    const label = creativeName(creative.creativeTypeId);
    const user = (id: string) => meta.users.find((item) => item.id === id)?.full_name || meta.users.find((item) => item.id === id)?.fullName || id;
    const rows: Record<string, unknown>[] = [];
    creative.primaryAssignments.forEach((assignment) => assignment.contentUserIds.forEach((contentId) => rows.push({
      day: day.date,
      creative: label,
      department: meta.creativeTypes.find((item) => item.id === creative.creativeTypeId)?.primary_department_name,
      user: user(assignment.userId),
      contentUser: user(contentId),
      dueOn: assignment.dueOn,
      note: assignment.note,
    })));
    creative.optionalAssignments.forEach((group) => group.assignments.forEach((assignment) => assignment.contentUserIds.forEach((contentId) => rows.push({
      day: day.date,
      creative: label,
      department: meta.departments.find((item) => item.id === group.departmentId)?.name,
      user: user(assignment.userId),
      contentUser: user(contentId),
      dueOn: assignment.dueOn,
      note: assignment.note,
    }))));
    return rows;
  })), [days, meta]);

  const totalCreatives = days.reduce((sum, day) => sum + day.creatives.reduce((part, item) => part + item.quantity, 0), 0);
  const totalTemplates = days.reduce((sum, day) => sum + day.creatives.reduce((part, item) => part + item.contentAssignments.length * item.quantity, 0), 0);


  function validateAgendaAssignments() {
    for (const day of days) {
      for (const creative of day.creatives) {
        const creativeType = meta.creativeTypes.find((item) => item.id === creative.creativeTypeId);
        if (!creative.creativeTypeId) return `اختر نوع الكرييتيف في يوم ${dayLabel(day.date)}`;
        if (!creative.contentAssignments.length) return `اختر يوزر قسم المحتوى في ${creativeType?.name || "الكرييتيف"} يوم ${dayLabel(day.date)}`;
        if (creativeType?.primary_department_id && !creative.primaryAssignments.length) {
          return `اختر يوزر القسم الأساسي ${creativeType.primary_department_name || ""} في ${creativeType.name}`;
        }
        const executionAssignments = [
          ...creative.primaryAssignments,
          ...creative.optionalAssignments.flatMap((group) => group.assignments),
        ];
        if (!executionAssignments.length) {
          return `اختر يوزرًا تنفيذيًا واحدًا على الأقل داخل ${creativeType?.name || "الكرييتيف"}`;
        }
        if (executionAssignments.some((assignment) => !assignment.contentUserIds.length)) {
          return `اربط كل يوزر تنفيذي بكاتب المحتوى داخل ${creativeType?.name || "الكرييتيف"}`;
        }
        const linkedContentUsers = new Set(executionAssignments.flatMap((assignment) => assignment.contentUserIds));
        const unpairedTemplate = creative.contentAssignments.find((assignment) => !linkedContentUsers.has(assignment.userId));
        if (unpairedTemplate) {
          const contentUser = meta.users.find((item) => item.id === unpairedTemplate.userId);
          const contentUserName = contentUser?.full_name || contentUser?.fullName || "كاتب المحتوى";
          return `اربط Task Template الخاص بـ ${contentUserName} بتاسك تنفيذي داخل ${creativeType?.name || "الكرييتيف"}`;
        }
      }
    }
    return "";
  }

  function goToReview() {
    const issue = validateAgendaAssignments();
    if (issue) {
      setError(issue);
      return;
    }
    setError("");
    setStep(2);
  }

  async function create() {
    setLoading(true);
    setError("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "create_agenda", ...form, days, executionFolders }),
      });
      setMessage(result.message);
      setStep(0);
      setForm({ monthKey: new Date().toISOString().slice(0, 7), name: "", publishStart: "", publishEnd: "" });
      setDays([]);
      setExecutionFolders(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر إنشاء الأجندة");
    } finally {
      setLoading(false);
    }
  }

  async function rawFolders() {
    setLoading(true);
    setError("");
    setExecutionFolders(null);
    try {
      let creativeSequence = 0;
      const creatives = days.flatMap((day) => day.creatives.flatMap((creative, index) => Array.from({ length: creative.quantity }, (_, instance) => {
        creativeSequence += 1;
        return {
          name: creativeName(creative.creativeTypeId),
          folderName: `${day.date}-${creativeName(creative.creativeTypeId)}-${index + 1}-${instance + 1}`,
          creativeInstanceId: `${creative.tempId}:${day.date}:${instance + 1}`,
          creativeIndex: creativeSequence,
          cars: creative.cars.map((car) => ({ id: car.id, name: `${car.car_name || "سيارة"}-${car.exterior_color || ""}-${car.interior_color || ""}` })),
          users: [...creative.primaryAssignments, ...creative.optionalAssignments.flatMap((group) => group.assignments)]
            .filter((assignment, assignmentIndex, all) => all.findIndex((item) => item.userId === assignment.userId) === assignmentIndex)
            .map((assignment) => ({ uid: assignment.userId, name: meta.users.find((item) => item.id === assignment.userId)?.full_name || assignment.userId })),
        };
      })));
      const payload: RawFolderRequest = {
        monthKey: form.monthKey,
        campaignCode: form.monthKey,
        campaignFolderName: form.name,
        campaignDisplayName: form.name,
        driveLetter: "Z:",
        creatives,
      };
      const result = await marketingFetch<RawFolderResult>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({ action: "create_raw_folders", payload }),
      });
      setExecutionFolders({ request: payload, result });
      setMessage(result.message || "تم إنشاء فولدرات الخام");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر إنشاء فولدرات الخام");
    } finally {
      setLoading(false);
    }
  }

  async function downloadZip() {
    const JSZip = await getJSZip();
    const zip = new JSZip();
    zip.file("agenda-relationships.csv", relationshipCsv(relations));
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${form.monthKey || "agenda"}-relationships.zip`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function addCreativeToDay() {
    if (!selectedDay || !addCreative.creativeTypeId) {
      setError("اختر نوع الكرييتيف أولًا");
      return;
    }
    const draft = {
      ...newCreativeDraft(),
      creativeTypeId: addCreative.creativeTypeId,
      quantity: Math.max(1, addCreative.quantity),
    };
    updateDay(selectedDay.date, [...selectedDay.creatives, draft]);
    setAddCreative({ creativeTypeId: "", quantity: 1 });
    setError("");
  }

  return (
    <MarketingPage title="إنشاء أجندة" description="إنشاء الأجندة وربط كرييتيفات كل يوم بالأقسام واليوزرات والمنصات.">
      <div className="marketing-wizard-steps three">
        {["بيانات الأجندة", "جدول الأيام والربط", "مراجعة وإنشاء الأجندة"].map((label, index) => (
          <button key={label} type="button" className={step === index ? "active" : index < step ? "done" : ""} onClick={() => index <= step && setStep(index)}>
            <span>{index < step ? "✓" : index + 1}</span>
            <b>{label}</b>
          </button>
        ))}
      </div>

      {error ? <MarketingAlert>{error}</MarketingAlert> : null}
      {message ? <MarketingAlert type="success">{message}</MarketingAlert> : null}

      <section className="panel marketing-wizard-panel marketing-agenda-wizard">
        {step === 0 ? (
          <div className="marketing-agenda-intro">
            <header><span><CalendarPlus size={25} /></span><div><h2>بيانات الأجندة</h2><p>حدد الشهر وفترة النشر واسم الأجندة.</p></div></header>
            <div className="marketing-form-grid">
              <label><span>الشهر</span><input type="month" value={form.monthKey} onChange={(event) => setForm({ ...form, monthKey: event.target.value })} /></label>
              <label><span>اسم الأجندة</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label><span>بداية النشر</span><input type="date" value={form.publishStart} onChange={(event) => setForm({ ...form, publishStart: event.target.value })} /></label>
              <label><span>نهاية النشر</span><input type="date" min={form.publishStart} value={form.publishEnd} onChange={(event) => setForm({ ...form, publishEnd: event.target.value })} /></label>
            </div>
            <footer><button type="button" className="primary" onClick={prepareDays}><CalendarPlus size={18} />إنشاء جدول الأيام</button></footer>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="marketing-agenda-days-v2">
            <header><div><span><CalendarBlank size={24} /></span><div><h2>جدول الأيام والربط</h2><p>افتح كل يوم لإضافة الكرييتيفات وربط الأقسام والسيارات والمنصات.</p></div></div><strong>{days.length.toLocaleString("ar-SA")} يوم</strong></header>
            <div className="marketing-agenda-day-list">
              {days.map((day) => {
                const count = day.creatives.reduce((sum, item) => sum + item.quantity, 0);
                return (
                  <article key={day.date} className={day.creatives.length ? "configured" : ""}>
                    <div className="marketing-agenda-day-date"><strong>{dayLabel(day.date)}</strong><span>{day.date}</span></div>
                    <div className="marketing-agenda-day-creatives">
                      {day.creatives.length
                        ? day.creatives.map((creative) => <span key={creative.tempId}>{creativeName(creative.creativeTypeId)} <b>× {creative.quantity}</b></span>)
                        : <small>لا توجد كرييتيفات مضافة لهذا اليوم</small>}
                    </div>
                    <div className="marketing-agenda-day-count"><strong>{count.toLocaleString("ar-SA")}</strong><small>كرييتيف</small></div>
                    <button type="button" className="secondary" onClick={() => setEditingDay(day.date)}><PencilSimple size={17} />إضافة / تعديل الربط</button>
                  </article>
                );
              })}
            </div>
            <footer className="marketing-wizard-footer"><button type="button" className="secondary" onClick={() => setStep(0)}>السابق</button><button type="button" className="primary" onClick={goToReview}>التالي: المراجعة والإنشاء</button></footer>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="marketing-review marketing-agenda-review">
            <div className="marketing-review-grid">
              <article><small>الشهر</small><strong>{form.monthKey}</strong></article>
              <article><small>اسم الأجندة</small><strong>{form.name}</strong></article>
              <article><small>الأيام</small><strong>{days.length}</strong></article>
              <article><small>الأيام المستخدمة</small><strong>{days.filter((day) => day.creatives.length).length}</strong></article>
              <article><small>الكرييتيفات</small><strong>{totalCreatives}</strong></article>
              <article><small>العلاقات</small><strong>{relations.length}</strong></article>
              <article><small>Task Templates</small><strong>{totalTemplates}</strong></article>
              <article><small>إجمالي التاسكات</small><strong>{totalTemplates + relations.length}</strong></article>
            </div>
            <div className="marketing-review-table">
              <table><thead><tr><th>اليوم</th><th>الكرييتيف</th><th>العدد</th><th>المنصات وأنواع النشر</th></tr></thead><tbody>
                {days.flatMap((day) => day.creatives.map((creative) => (
                  <tr key={`${day.date}-${creative.tempId}`}>
                    <td>{day.date}</td><td>{creativeName(creative.creativeTypeId)}</td><td>{creative.quantity}</td>
                    <td>{creative.platforms.map((platform) => {
                      const name = meta.platforms.find((item) => item.id === platform.platformId)?.name;
                      const types = platform.postTypeIds.map((id) => meta.postTypes.find((item) => item.id === id)?.name).filter(Boolean).join("، ");
                      return `${name}: ${types}`;
                    }).join(" | ") || "—"}</td>
                  </tr>
                )))}
              </tbody></table>
            </div>
            <div className="marketing-inline-actions">
              <button type="button" className="secondary" onClick={() => setStep(1)}>السابق</button>
              <button type="button" className="secondary" onClick={() => void rawFolders()} disabled={loading}><FolderOpen size={17} />إنشاء فولدرات الخام</button>
              <button type="button" className="secondary" onClick={() => void downloadZip()}>تحميل شيتات العلاقات ZIP</button>
              <button type="button" className="primary" onClick={() => void create()} disabled={loading}><CheckCircle size={17} />{loading ? "جاري إنشاء الأجندة..." : "إنشاء الأجندة"}</button>
            </div>
          </div>
        ) : null}
      </section>

      {selectedDay ? (
        <div className="marketing-day-editor-overlay" role="presentation">
          <section className="marketing-agenda-editor-v2" role="dialog" aria-modal="true" aria-label={`إضافة أو تعديل ربط ${dayLabel(selectedDay.date)}`}>
            <header>
              <div><span><CalendarBlank size={23} /></span><div><h2>إضافة / تعديل الربط</h2><p>{dayLabel(selectedDay.date)}</p></div></div>
              <button type="button" className="marketing-close-button" onClick={() => setEditingDay(null)} aria-label="إغلاق"><X size={20} /></button>
            </header>

            <div className="marketing-agenda-editor-layout">
              <aside className="marketing-agenda-add-panel">
                <div><h3>إضافة كرييتيف جديد</h3><p>اختر النوع والعدد ثم أضفه إلى اليوم.</p></div>
                <label><span>نوع الكرييتيف</span><select value={addCreative.creativeTypeId} onChange={(event) => setAddCreative({ ...addCreative, creativeTypeId: event.target.value })}><option value="">اختر النوع</option>{meta.creativeTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label><span>العدد</span><input type="number" min={1} value={addCreative.quantity} onChange={(event) => setAddCreative({ ...addCreative, quantity: Math.max(1, Number(event.target.value) || 1) })} /></label>
                <button type="button" className="primary" onClick={addCreativeToDay}><Plus size={18} />إضافة الكرييتيف لليوم</button>
                <div className="marketing-agenda-add-note">القسم الأساسي يتحدد تلقائيًا حسب نوع الكرييتيف، وبعد الإضافة تختار اليوزرات والسيارات والمنصات.</div>
              </aside>

              <main className="marketing-agenda-editor-main">
                <div className="marketing-agenda-editor-summary">
                  <div><small>اليوم</small><strong>{selectedDay.date}</strong></div>
                  <div><small>الكرييتيفات</small><strong>{selectedDay.creatives.length.toLocaleString("ar-SA")}</strong></div>
                  <div><small>إجمالي العدد</small><strong>{selectedDay.creatives.reduce((sum, item) => sum + item.quantity, 0).toLocaleString("ar-SA")}</strong></div>
                </div>
                {selectedDay.creatives.length ? (
                  <div className="marketing-agenda-creative-stack">
                    {selectedDay.creatives.map((creative, index) => (
                      <CreativeEditor
                        key={creative.tempId}
                        value={creative}
                        meta={meta}
                        showPlatforms
                        carsModal
                        autoLinkSingleContentUser
                        showTaskFlowSummary
                        onChange={(value) => updateDay(selectedDay.date, selectedDay.creatives.map((item, itemIndex) => itemIndex === index ? value : item))}
                        onDelete={() => updateDay(selectedDay.date, selectedDay.creatives.filter((_, itemIndex) => itemIndex !== index))}
                      />
                    ))}
                  </div>
                ) : <div className="marketing-empty marketing-agenda-empty"><CalendarPlus size={35} />ابدأ بإضافة كرييتيف لهذا اليوم من لوحة الإضافة.</div>}
              </main>
            </div>

            <footer><button type="button" className="primary" onClick={() => setEditingDay(null)}><CheckCircle size={18} />حفظ وإغلاق</button></footer>
          </section>
        </div>
      ) : null}
    </MarketingPage>
  );
}
