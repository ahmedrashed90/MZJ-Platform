import { useEffect, useMemo, useState } from "react";
import { CalendarDots, Check, Eraser, FolderOpen, Plus, RocketLaunch, Trash } from "@phosphor-icons/react";
import { marketingFetch, marketingPost } from "../api";
import { InstanceEditor } from "../components/InstanceEditor";
import { useMarketing } from "../MarketingContext";
import type { CreativeInstanceDraft, StockResponse, StockVehicle } from "../types";

type AgendaDayDraft = { date: string; instances: CreativeInstanceDraft[] };
type AgendaDraft = {
  idempotencyKey: string;
  name: string;
  agendaMonth: string;
  publishStart: string;
  publishEnd: string;
  days: AgendaDayDraft[];
};

const emptyAgenda = (): AgendaDraft => ({
  idempotencyKey: crypto.randomUUID(),
  name: "",
  agendaMonth: "",
  publishStart: "",
  publishEnd: "",
  days: [],
});

const newInstance = (creativeId: string, agendaDate: string): CreativeInstanceDraft => ({
  clientKey: crypto.randomUUID(),
  creativeId,
  agendaDate,
  contentReceivedDate: "",
  contentNotes: "",
  primaryReceivedDate: "",
  primaryNotes: "",
  contentUsers: [],
  sections: [],
  vehicleIds: [],
  platformSelections: [],
});

function datesBetween(start: string, end: string) {
  if (!start || !end || end < start) return [];
  const rows: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const limit = new Date(`${end}T00:00:00Z`);
  while (cursor <= limit && rows.length < 370) {
    rows.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return rows;
}

export function CreateAgendaPage() {
  const { meta } = useMarketing();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<AgendaDraft>(emptyAgenda);
  const [vehicles, setVehicles] = useState<StockVehicle[]>([]);
  const [editingDate, setEditingDate] = useState("");
  const [creativeId, setCreativeId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void marketingFetch<StockResponse>("/api/marketing?action=stock")
      .then((payload) => setVehicles(payload.rows))
      .catch(() => setVehicles([]));
  }, []);

  const dateRows = useMemo(() => datesBetween(draft.publishStart, draft.publishEnd), [draft.publishStart, draft.publishEnd]);
  const selectedDay = draft.days.find((day) => day.date === editingDate);
  const usedDays = draft.days.filter((day) => day.instances.length > 0);
  const instanceCount = usedDays.reduce((total, day) => total + day.instances.length, 0);
  const relationshipCount = usedDays.reduce(
    (total, day) => total + day.instances.reduce((sum, instance) => sum + instance.sections.reduce((s, section) => s + section.users.reduce((u, user) => u + user.writers.length, 0), 0), 0),
    0,
  );
  const taskCount = usedDays.reduce(
    (total, day) => total + day.instances.reduce((sum, instance) => sum + instance.contentUsers.length + instance.sections.reduce((s, section) => s + section.users.reduce((u, user) => u + user.writers.length, 0), 0), 0),
    0,
  );

  if (!meta) return null;

  const ensureDays = (start: string, end: string) => {
    const valid = datesBetween(start, end);
    setDraft((current) => ({
      ...current,
      publishStart: start,
      publishEnd: end,
      days: valid.map((date) => current.days.find((day) => day.date === date) || { date, instances: [] }),
    }));
    if (editingDate && !valid.includes(editingDate)) setEditingDate("");
  };

  const addCreative = () => {
    if (!editingDate || !creativeId) return;
    setDraft((current) => ({
      ...current,
      days: current.days.map((day) => day.date === editingDate
        ? { ...day, instances: [...day.instances, ...Array.from({ length: Math.max(1, quantity) }, () => newInstance(creativeId, editingDate))] }
        : day),
    }));
  };

  const validateBase = () => {
    if (!draft.name || !draft.agendaMonth || !draft.publishStart || !draft.publishEnd || draft.publishEnd < draft.publishStart) {
      setError("أكمل بيانات الأجندة وتأكد من فترة النشر");
      return false;
    }
    return true;
  };

  const validateInstances = () => {
    if (!validateBase()) return false;
    if (!instanceCount) {
      setError("أضف كرييتيفًا واحدًا على الأقل داخل أحد الأيام");
      return false;
    }
    for (const day of usedDays) {
      for (const [index, instance] of day.instances.entries()) {
        if (!instance.contentUsers.length) {
          setError(`اختر كاتب محتوى للكرييتيف رقم ${index + 1} في يوم ${day.date}`);
          return false;
        }
        if (!instance.sections.some((section) => section.users.some((user) => user.writers.length > 0))) {
          setError(`اربط يوزرًا تنفيذيًا بكاتب محتوى في يوم ${day.date}`);
          return false;
        }
      }
    }
    setError("");
    return true;
  };

  const go = (target: number) => {
    if (target > 1 && !validateBase()) return;
    if (target > 2 && !validateInstances()) return;
    setStep(target);
  };

  const createAgenda = async (withFolders = false) => {
    if (!validateInstances()) return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const result = await marketingPost<{ ok: true; id: string; campaignCode: string; message: string }>({
        action: "create_agenda",
        idempotencyKey: draft.idempotencyKey,
        sourceKind: "agenda",
        name: draft.name,
        agendaMonth: `${draft.agendaMonth}-01`,
        publishStart: draft.publishStart,
        publishEnd: draft.publishEnd,
        days: usedDays.map((day) => ({
          date: day.date,
          instances: day.instances.map((instance) => {
            const creative = meta.creatives.find((row) => row.id === instance.creativeId);
            const hasPrimary = instance.sections.some((section) => section.kind === "primary");
            return {
              ...instance,
              agendaDate: day.date,
              sections: hasPrimary ? instance.sections : [{
                localId: crypto.randomUUID(),
                departmentId: creative?.primary_department_id || "",
                kind: "primary",
                receivedDate: instance.primaryReceivedDate,
                notes: instance.primaryNotes,
                users: [],
              }, ...instance.sections],
            };
          }),
        })),
      });
      if (withFolders) {
        await marketingPost({ action: "create_raw_folders", campaignId: result.id });
        setMessage("تم إنشاء الأجندة وفولدرات الخام والتسليم");
      } else {
        setMessage(result.message);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "تعذر إنشاء الأجندة");
    } finally {
      setWorking(false);
    }
  };

  const reset = () => {
    if (!window.confirm("سيتم مسح نموذج الأجندة بالكامل")) return;
    setDraft(emptyAgenda());
    setEditingDate("");
    setStep(1);
    setError("");
    setMessage("");
  };

  return <div className="marketing-page marketing-wizard-page">
    <header className="marketing-page-title"><div><h2>إنشاء أجندة</h2><p>إنشاء أجندة زمنية وربط كرييتيفات مستقلة بكل يوم داخل الفترة.</p></div></header>
    <div className="marketing-steps three-steps">
      {[{ n: 1, label: "بيانات الأجندة" }, { n: 2, label: "جدول الأيام والربط" }, { n: 3, label: "إنشاء الأجندة" }].map((item) => <button key={item.n} type="button" className={step === item.n ? "active" : step > item.n ? "done" : ""} onClick={() => go(item.n)}><span>{step > item.n ? <Check /> : item.n}</span>{item.label}</button>)}
    </div>
    {error ? <div className="marketing-error">{error}</div> : null}
    {message ? <div className="marketing-success">{message}</div> : null}

    {step === 1 ? <section className="marketing-wizard-panel">
      <header><CalendarDots size={25} /><div><h3>بيانات الأجندة</h3><p>حدد الشهر وفترة النشر قبل بناء جدول الأيام.</p></div></header>
      <div className="marketing-form-grid two">
        <label><span>الشهر</span><input type="month" value={draft.agendaMonth} onChange={(event) => setDraft({ ...draft, agendaMonth: event.target.value })} /></label>
        <label><span>اسم الأجندة</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="مثال: أجندة أغسطس 2026" /></label>
        <label><span>بداية النشر</span><input type="date" value={draft.publishStart} onChange={(event) => ensureDays(event.target.value, draft.publishEnd)} /></label>
        <label><span>نهاية النشر</span><input type="date" value={draft.publishEnd} onChange={(event) => ensureDays(draft.publishStart, event.target.value)} /></label>
      </div>
    </section> : null}

    {step === 2 ? <section className="marketing-wizard-panel agenda-days-panel">
      <header><CalendarDots size={25} /><div><h3>جدول الأيام والربط</h3><p>أضف كرييتيفات لكل يوم ثم استكمل بيانات كل Creative Instance.</p></div></header>
      {!editingDate ? <div className="agenda-days-list">
        {dateRows.map((date) => {
          const day = draft.days.find((row) => row.date === date) || { date, instances: [] };
          return <article key={date}><div><strong>{new Date(`${date}T12:00:00`).toLocaleDateString("ar-SA", { weekday: "long" })}</strong><span>{date}</span><small>{day.instances.length ? `${day.instances.length} كرييتيف` : "لا توجد كرييتيفات"}</small></div><button type="button" onClick={() => setEditingDate(date)}>إضافة / تعديل الربط</button></article>;
        })}
      </div> : <div className="agenda-day-editor">
        <header className="agenda-day-editor-head"><div><h4>إضافة / تعديل الربط</h4><p>{new Date(`${editingDate}T12:00:00`).toLocaleDateString("ar-SA", { weekday: "long", dateStyle: "long" })}</p></div><button type="button" onClick={() => setEditingDate("")}>حفظ والعودة للجدول</button></header>
        <div className="marketing-add-creative">
          <select value={creativeId} onChange={(event) => setCreativeId(event.target.value)}><option value="">اختر نوع الكرييتيف</option>{meta.creatives.filter((row) => row.is_active).map((row) => <option key={row.id} value={row.id}>{row.name} — {row.short_code}</option>)}</select>
          <input type="number" min={1} max={30} value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} />
          <button type="button" onClick={addCreative}><Plus />إضافة الكرييتيف لليوم</button>
        </div>
        <div className="marketing-instances-list">
          {(selectedDay?.instances || []).map((instance, index) => <InstanceEditor key={instance.clientKey} instance={instance} index={index} meta={meta} vehicles={vehicles} showPlatforms onChange={(value) => setDraft((current) => ({ ...current, days: current.days.map((day) => day.date === editingDate ? { ...day, instances: day.instances.map((row, i) => i === index ? value : row) } : day) }))} onRemove={() => setDraft((current) => ({ ...current, days: current.days.map((day) => day.date === editingDate ? { ...day, instances: day.instances.filter((_, i) => i !== index) } : day) }))} />)}
        </div>
        {!selectedDay?.instances.length ? <div className="marketing-empty">لا توجد كرييتيفات لهذا اليوم. استخدم لوحة الإضافة.</div> : null}
      </div>}
    </section> : null}

    {step === 3 ? <section className="marketing-wizard-panel review">
      <header><RocketLaunch size={25} /><div><h3>مراجعة وإنشاء الأجندة</h3><p>راجع البيانات ثم أنشئ الأجندة والتاسكات المستقلة لكل علاقة.</p></div></header>
      <div className="agenda-review-metrics">
        <article><span>الأيام</span><strong>{dateRows.length}</strong></article><article><span>الأيام المستخدمة</span><strong>{usedDays.length}</strong></article><article><span>الكرييتيفات</span><strong>{instanceCount}</strong></article><article><span>العلاقات</span><strong>{relationshipCount}</strong></article><article><span>إجمالي التاسكات</span><strong>{taskCount}</strong></article>
      </div>
      <div className="marketing-instance-table"><table><thead><tr><th>اليوم</th><th>التاريخ</th><th>الكرييتيف</th><th>الكود</th><th>المنصات</th><th>السيارات</th></tr></thead><tbody>{usedDays.flatMap((day) => day.instances.map((instance, index) => { const creative = meta.creatives.find((row) => row.id === instance.creativeId); return <tr key={instance.clientKey}><td>{new Date(`${day.date}T12:00:00`).toLocaleDateString("ar-SA", { weekday: "long" })}</td><td>{day.date}</td><td>{creative?.name} #{index + 1}</td><td>{creative?.short_code}</td><td>{instance.platformSelections.map((selection) => meta.platforms.find((platform) => platform.id === selection.platformId)?.name).filter(Boolean).join("، ") || "—"}</td><td>{instance.vehicleIds.length}</td></tr>; }))}</tbody></table></div>
      <div className="marketing-review-actions"><button type="button" disabled={working} onClick={() => void createAgenda(true)}><FolderOpen />إنشاء فولدرات الخام</button><button type="button" className="primary" disabled={working} onClick={() => void createAgenda(false)}><RocketLaunch />إنشاء الأجندة</button></div>
    </section> : null}

    <footer className="marketing-wizard-footer"><button type="button" onClick={reset}><Eraser />مسح النموذج</button><div>{step > 1 ? <button type="button" onClick={() => setStep(step - 1)}>السابق</button> : null}{step < 3 ? <button type="button" className="primary" onClick={() => go(step + 1)}>التالي</button> : null}</div></footer>
  </div>;
}
