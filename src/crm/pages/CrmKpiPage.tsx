import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CalendarBlank,
  FilePdf,
  MagnifyingGlass,
  Minus,
  PencilSimple,
  Plus,
  X,
} from "@phosphor-icons/react";
import { useEscapeToClose } from "../../components/useEscapeToClose";
import { crmFetch, queryString } from "../api";
import type { CrmMeta } from "../types";

type ModalTab = "speed" | "efficiency" | "discipline" | "value" | "result";

type KpiDetails = {
  workDays: number;
  speed: { maxAllowedMinutes: number; dailyDelaySales: Record<string, Array<string | number>> };
  efficiency: {
    personality: { customerFitHonesty: number; carNotesHonesty: number };
    technical: { currentPrices: number; oldPrices: number; carSpecs: number; competitorsComparison: number; salesChannels: number };
  };
  dailyPerformance: Record<string, { attendance: number; appearance: number; behavior: number; customerRating: number; salesCount: number }>;
  finalKpi?: Record<string, unknown>;
};

type FormState = {
  userId: string;
  periodStart: string;
  periodEnd: string;
  notes: string;
  details: KpiDetails;
};

function emptyDetails(): KpiDetails {
  return {
    workDays: 1,
    speed: { maxAllowedMinutes: 3, dailyDelaySales: {} },
    efficiency: {
      personality: { customerFitHonesty: 0, carNotesHonesty: 0 },
      technical: { currentPrices: 0, oldPrices: 0, carSpecs: 0, competitorsComparison: 0, salesChannels: 0 },
    },
    dailyPerformance: {},
  };
}

const emptyForm: FormState = { userId: "", periodStart: "", periodEnd: "", notes: "", details: emptyDetails() };

function number(value: unknown, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function clamp(value: unknown, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, number(value)));
}

function dateKeys(from: string, to: string) {
  if (!from || !to) return [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const result: string[] = [];
  for (const current = new Date(start); current <= end && result.length < 370; current.setDate(current.getDate() + 1)) {
    result.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`);
  }
  return result;
}

function arabicDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-SA", { weekday: "long", year: "numeric", month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function calculate(details: KpiDetails) {
  const workDays = Math.max(1, Math.floor(number(details.workDays, 1)));
  const maximumAllowed = Math.max(0.01, number(details.speed.maxAllowedMinutes, 3));
  const delayValues = Object.values(details.speed.dailyDelaySales || {}).flatMap((entry) => entry || [])
    .filter((entry) => String(entry ?? "").trim() !== "")
    .map((entry) => Math.max(0, number(entry)));
  const totalDelay = delayValues.reduce((sum, value) => sum + value, 0);
  const averageDelay = delayValues.length ? totalDelay / delayValues.length : 0;
  const speedRate = delayValues.length ? clamp(100 - (averageDelay / maximumAllowed) * 100) : 100;
  const personality = details.efficiency.personality;
  const technical = details.efficiency.technical;
  const personalityRate = (clamp(personality.customerFitHonesty) + clamp(personality.carNotesHonesty) + speedRate) / 3;
  const technicalRate = (clamp(technical.currentPrices) + clamp(technical.oldPrices) + clamp(technical.carSpecs) + clamp(technical.competitorsComparison) + clamp(technical.salesChannels)) / 5;
  const efficiencyRate = (personalityRate + technicalRate) / 2;
  const efficiencyPoints = (efficiencyRate >= 90 ? 3 : efficiencyRate >= 75 ? 2 : efficiencyRate >= 60 ? 1 : 0) * workDays;
  const performance = Object.values(details.dailyPerformance || {});
  const attendancePoints = performance.reduce((sum, row) => sum + clamp(row.attendance, 0, 3), 0);
  const appearancePoints = performance.reduce((sum, row) => sum + clamp(row.appearance, 0, 3), 0);
  const behaviorPoints = performance.reduce((sum, row) => sum + clamp(row.behavior, 0, 3), 0);
  const customerPoints = performance.reduce((sum, row) => sum + clamp(row.customerRating, 0, 3), 0);
  const salesCount = performance.reduce((sum, row) => sum + Math.max(0, number(row.salesCount)), 0);
  const disciplineRate = clamp(((attendancePoints + appearancePoints + behaviorPoints) / Math.max(1, workDays * 9)) * 100);
  const valueRate = clamp(((customerPoints + salesCount) / 80) * 100);
  const finalRate = ((efficiencyRate + disciplineRate) / 2 + valueRate) / 2;
  const totalPoints = attendancePoints + appearancePoints + behaviorPoints + efficiencyPoints + customerPoints + salesCount;
  const rating = finalRate >= 100 ? "ممتاز" : finalRate >= 90 ? "جيد جدًا" : finalRate >= 80 ? "جيد" : finalRate >= 60 ? "مقبول" : finalRate >= 50 ? "ضعيف" : "غير مناسب";
  return { workDays, totalDelay, averageDelay, speedRate, personalityRate, technicalRate, efficiencyRate, efficiencyPoints, attendancePoints, appearancePoints, behaviorPoints, customerPoints, salesCount, disciplineRate, valueRate, finalRate, totalPoints, rating };
}

function percent(value: unknown) {
  return `${Math.round(number(value) * 100) / 100}%`;
}

export function CrmKpiPage() {
  const [tab, setTab] = useState<"add" | "reports">("add");
  const [modalTab, setModalTab] = useState<ModalTab>("speed");
  const [filters, setFilters] = useState({ month: "", from: "", to: "", branch: "", agent: "", q: "" });
  const [rows, setRows] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [meta, setMeta] = useState<CrmMeta | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [modal, setModal] = useState(false);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const period = useMemo(() => {
    if (!filters.month) return { from: filters.from, to: filters.to };
    const [year, month] = filters.month.split("-").map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return { from: `${filters.month}-01`, to: `${filters.month}-${String(lastDay).padStart(2, "0")}` };
  }, [filters.month, filters.from, filters.to]);

  useEscapeToClose(modal, () => setModal(false));

  useEffect(() => {
    void crmFetch<CrmMeta>("/api/crm/meta").then(setMeta).catch(() => undefined);
  }, []);

  useEffect(() => { void load(); }, [period.from, period.to, filters.branch, filters.agent]);

  async function load() {
    try {
      const result = await crmFetch<{ ok: boolean; rows: any[]; agents: any[] }>(`/api/crm/kpi${queryString({ from: period.from, to: period.to, branch: filters.branch, agent: filters.agent })}`);
      setRows(result.rows || []);
      setAgents(result.agents || []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل تقييمات KPI");
    }
  }

  const visibleAgents = useMemo(() => agents.filter((agent) => {
    if (filters.branch && !(agent.branch_codes || []).includes(filters.branch)) return false;
    return !filters.q || [agent.full_name, agent.employee_no, ...(agent.departments || []), ...(agent.branches || [])].join(" ").toLowerCase().includes(filters.q.toLowerCase());
  }), [agents, filters.branch, filters.q]);

  const visibleRows = useMemo(() => rows.filter((row) => !filters.q || [row.full_name, row.rating, ...(row.departments || []), ...(row.branches || [])].join(" ").toLowerCase().includes(filters.q.toLowerCase())), [rows, filters.q]);
  const modalDays = useMemo(() => dateKeys(form.periodStart, form.periodEnd), [form.periodStart, form.periodEnd]);
  const calculated = useMemo(() => calculate(form.details), [form.details]);

  const reportSummary = useMemo(() => {
    const count = visibleRows.length || 1;
    const average = (key: string) => visibleRows.length ? visibleRows.reduce((sum, row) => sum + number(row[key]), 0) / count : 0;
    return {
      count: visibleRows.length,
      speed: average("speed_score"),
      efficiency: average("efficiency_score"),
      discipline: average("discipline_score"),
      value: average("value_score"),
      total: average("total_score"),
    };
  }, [visibleRows]);

  function updateForm(key: keyof Omit<FormState, "details">, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateDetails(mutator: (draft: KpiDetails) => void) {
    setForm((current) => {
      const draft = structuredClone(current.details);
      mutator(draft);
      return { ...current, details: draft };
    });
  }

  function performanceFor(date: string) {
    return form.details.dailyPerformance[date] || { attendance: 0, appearance: 0, behavior: 0, customerRating: 0, salesCount: 0 };
  }

  function setPerformance(date: string, key: "attendance" | "appearance" | "behavior" | "customerRating" | "salesCount", value: string) {
    updateDetails((draft) => {
      draft.dailyPerformance[date] = { ...performanceFor(date), [key]: number(value) };
    });
  }

  function open(agent?: any, row?: any) {
    const details = row?.details && typeof row.details === "object" ? row.details : emptyDetails();
    const safeDetails: KpiDetails = {
      ...emptyDetails(),
      ...details,
      speed: { ...emptyDetails().speed, ...(details.speed || {}) },
      efficiency: {
        personality: { ...emptyDetails().efficiency.personality, ...(details.efficiency?.personality || {}) },
        technical: { ...emptyDetails().efficiency.technical, ...(details.efficiency?.technical || {}) },
      },
      dailyPerformance: details.dailyPerformance || {},
    };
    setForm(row ? {
      userId: row.user_id,
      periodStart: String(row.period_start).slice(0, 10),
      periodEnd: String(row.period_end).slice(0, 10),
      notes: row.notes || "",
      details: safeDetails,
    } : { ...emptyForm, userId: agent?.id || "", periodStart: period.from, periodEnd: period.to, details: emptyDetails() });
    setModalTab("speed");
    setModal(true);
  }

  async function save() {
    setSaving(true);
    try {
      await crmFetch("/api/crm/kpi", { method: "POST", body: JSON.stringify(form) });
      setNotice("تم حفظ تقييم المندوب بنفس معادلات KPI المعتمدة في النظام القديم");
      setModal(false);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حفظ التقييم");
    } finally {
      setSaving(false);
    }
  }

  function print(rowOrForm: any, target: ModalTab | "all" = "all") {
    const isForm = rowOrForm?.details && rowOrForm?.userId;
    const details: KpiDetails = isForm ? rowOrForm.details : rowOrForm.details || emptyDetails();
    const result = calculate(details);
    const agentName = isForm ? agents.find((agent) => agent.id === rowOrForm.userId)?.full_name || "المندوب" : rowOrForm.full_name;
    const from = isForm ? rowOrForm.periodStart : String(rowOrForm.period_start).slice(0, 10);
    const to = isForm ? rowOrForm.periodEnd : String(rowOrForm.period_end).slice(0, 10);
    const headings: Record<string, string> = { speed: "السرعة", efficiency: "الكفاءة", discipline: "الانضباط", value: "القيمة", result: "النتيجة", all: "التقييم الكامل" };
    const cards = [
      ["السرعة", percent(result.speedRate)], ["الكفاءة", percent(result.efficiencyRate)], ["الانضباط", percent(result.disciplineRate)], ["القيمة", percent(result.valueRate)], ["KPI", percent(result.finalRate)], ["إجمالي النقاط", Math.round(result.totalPoints)], ["التقييم", result.rating],
    ];
    const win = window.open("", "_blank", "width=1150,height=850");
    if (!win) return;
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقييم KPI</title><style>body{font-family:Tajawal,Arial;padding:24px;color:#35221c}.cover,.card{border:1px solid #e5cdbf;border-radius:18px;padding:18px;margin-bottom:14px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card b{display:block;font-size:25px;margin-top:8px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #e5cdbf;padding:8px}th{background:#f7ebe4}</style></head><body><div class="cover"><h1>تقييم KPI - ${headings[target]}</h1><h2>${agentName}</h2><p>الفترة: ${from || "—"} إلى ${to || "—"}</p></div><div class="grid">${cards.map(([label, value]) => `<div class="card">${label}<b>${value}</b></div>`).join("")}</div><div class="card"><h2>تفاصيل المعادلة المعتمدة</h2><table><tbody><tr><th>إجمالي دقائق التأخير</th><td>${Math.round(result.totalDelay * 100) / 100}</td><th>متوسط التأخير</th><td>${Math.round(result.averageDelay * 100) / 100}</td></tr><tr><th>نقاط الحضور</th><td>${result.attendancePoints}</td><th>نقاط الهيئة</th><td>${result.appearancePoints}</td></tr><tr><th>نقاط السلوك</th><td>${result.behaviorPoints}</td><th>نقاط العملاء</th><td>${result.customerPoints}</td></tr><tr><th>عدد المبيعات</th><td>${result.salesCount}</td><th>أيام العمل</th><td>${result.workDays}</td></tr></tbody></table></div><script>window.onload=()=>window.print()</script></body></html>`);
    win.document.close();
  }

  return (
    <div className="crm-page kpi-page">
      <header className="crm-page-head">
        <div><h1>تقييم المناديب KPI</h1><p>السرعة والكفاءة والانضباط والقيمة والنتيجة بنفس معادلات شاشة KPI في النظام القديم.</p></div>
        <button className="crm-secondary-button" onClick={() => void load()}><ArrowClockwise size={18} />تحديث</button>
      </header>

      <div className="crm-department-tabs"><button className={tab === "add" ? "active" : ""} onClick={() => setTab("add")}>إضافة التقييم</button><button className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")}>التقارير</button></div>

      <div className="crm-filter-panel reports kpi-filters">
        <label><span>الشهر</span><input type="month" value={filters.month} onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))} /></label>
        <label><span>من تاريخ</span><input type="date" disabled={Boolean(filters.month)} value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></label>
        <label><span>إلى تاريخ</span><input type="date" disabled={Boolean(filters.month)} value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></label>
        <label><span>الفرع</span><select value={filters.branch} onChange={(event) => setFilters((current) => ({ ...current, branch: event.target.value }))}><option value="">كل الفروع</option>{(meta?.branches || []).map((branch) => <option key={branch.code} value={branch.code}>{branch.name}</option>)}</select></label>
        <label><span>المندوب</span><select value={filters.agent} onChange={(event) => setFilters((current) => ({ ...current, agent: event.target.value }))}><option value="">كل المناديب</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}</select></label>
        <label className="crm-search-box wide"><MagnifyingGlass size={18} /><input value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="بحث باسم المندوب" /></label>
        <button className="crm-secondary-button" onClick={() => setFilters({ month: "", from: "", to: "", branch: "", agent: "", q: "" })}>مسح الفلاتر</button>
      </div>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}

      {tab === "add" ? (
        <div className="crm-table-shell"><table className="crm-table"><thead><tr><th>الفرع</th><th>المندوب</th><th>القسم</th><th>المبيعات</th><th>السرعة</th><th>الكفاءة</th><th>الانضباط</th><th>القيمة</th><th>KPI %</th><th>التقييم</th><th>الإجراء</th></tr></thead><tbody>
          {visibleAgents.map((agent) => { const last = rows.find((row) => row.user_id === agent.id); return <tr key={agent.id}><td>{(agent.branches || []).join("، ") || "—"}</td><td><div className="kpi-agent-cell"><strong>{agent.full_name}</strong><small>{agent.employee_no || ""}</small></div></td><td>{(agent.departments || []).join("، ") || "—"}</td><td>{last?.total_sales ?? last?.calculated_sales ?? 0}</td><td>{last ? percent(last.speed_score) : "—"}</td><td>{last ? percent(last.efficiency_score) : "—"}</td><td>{last ? percent(last.discipline_score) : "—"}</td><td>{last ? percent(last.value_score) : "—"}</td><td>{last ? <strong>{percent(last.total_score)}</strong> : "—"}</td><td>{last?.rating || "—"}</td><td><button className="crm-primary-button small" onClick={() => open(agent, last)}>تقييم</button></td></tr>; })}
          {!visibleAgents.length ? <tr><td colSpan={11}><div className="crm-empty-state">لا يوجد مستخدمون مطابقون للفلاتر</div></td></tr> : null}
        </tbody></table></div>
      ) : null}

      {tab === "reports" ? (
        <>
          <section className="crm-report-summary kpi-report-summary"><article><span>عدد المناديب</span><strong>{reportSummary.count}</strong></article><article><span>متوسط السرعة</span><strong>{percent(reportSummary.speed)}</strong></article><article><span>متوسط الكفاءة</span><strong>{percent(reportSummary.efficiency)}</strong></article><article><span>متوسط الانضباط</span><strong>{percent(reportSummary.discipline)}</strong></article><article><span>متوسط القيمة</span><strong>{percent(reportSummary.value)}</strong></article><article><span>متوسط KPI</span><strong>{percent(reportSummary.total)}</strong></article></section>
          <div className="kpi-report-cards">{visibleRows.map((row) => <article key={row.id} className="crm-panel kpi-report-card"><header><div><span>{(row.branches || []).join("، ") || "بدون فرع"}</span><h2>{row.full_name}</h2><p>{String(row.period_start).slice(0,10)} إلى {String(row.period_end).slice(0,10)}</p></div><strong>{percent(row.total_score)}</strong></header><div className="kpi-card-score-grid"><span>السرعة<b>{percent(row.speed_score)}</b></span><span>الكفاءة<b>{percent(row.efficiency_score)}</b></span><span>الانضباط<b>{percent(row.discipline_score)}</b></span><span>القيمة<b>{percent(row.value_score)}</b></span><span>النقاط<b>{Math.round(number(row.details?.finalKpi?.repTotalScore))}</b></span><span>التقييم<b>{row.rating || "—"}</b></span></div><footer><button className="crm-row-actions-button" onClick={() => open(null, row)}><PencilSimple size={16} />تعديل</button><button className="crm-row-actions-button" onClick={() => print(row, "all")}><FilePdf size={16} />PDF كامل</button></footer></article>)}</div>
          {!visibleRows.length ? <div className="crm-empty-state panel">لا توجد تقييمات ضمن الفترة والفلاتر المحددة</div> : null}
        </>
      ) : null}

      {modal ? (
        <div className="crm-modal-backdrop" onMouseDown={() => setModal(false)}>
          <div className="crm-modal-card kpi-modal-card pro" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><h2>إضافة تقييم المناديب</h2><p>جميع النتائج تحسب تلقائيًا من المدخلات اليومية بنفس منطق النظام القديم.</p></div><button className="crm-icon-button" onClick={() => setModal(false)}><X size={18} /></button></header>

            <section className="kpi-period-card">
              <label><span>المندوب</span><select value={form.userId} onChange={(event) => updateForm("userId", event.target.value)}><option value="">اختر المندوب</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}</select></label>
              <label><span>من تاريخ</span><input type="date" value={form.periodStart} onChange={(event) => updateForm("periodStart", event.target.value)} /></label>
              <label><span>إلى تاريخ</span><input type="date" value={form.periodEnd} onChange={(event) => updateForm("periodEnd", event.target.value)} /></label>
              <label><span>أيام العمل</span><input type="number" min="1" value={form.details.workDays} onChange={(event) => updateDetails((draft) => { draft.workDays = Math.max(1, number(event.target.value)); })} /></label>
            </section>

            <div className="kpi-pdf-actions"><button onClick={() => print(form, "speed")}><FilePdf size={15} />PDF السرعة</button><button onClick={() => print(form, "efficiency")}><FilePdf size={15} />PDF الكفاءة</button><button onClick={() => print(form, "discipline")}><FilePdf size={15} />PDF الانضباط</button><button onClick={() => print(form, "value")}><FilePdf size={15} />PDF القيمة</button><button onClick={() => print(form, "all")}><FilePdf size={15} />PDF كامل</button></div>

            <nav className="kpi-modal-tabs">{(["speed","efficiency","discipline","value","result"] as ModalTab[]).map((item) => <button key={item} className={modalTab === item ? "active" : ""} onClick={() => setModalTab(item)}>{item === "speed" ? "السرعة" : item === "efficiency" ? "الكفاءة" : item === "discipline" ? "الانضباط" : item === "value" ? "القيمة" : "النتيجة"}</button>)}</nav>

            <div className="kpi-modal-scroll">
              {modalTab === "speed" ? <section className="kpi-panel"><header><div><h3>تقييم السرعة - دقائق التأخير اليومية</h3><p>كل خانة تمثل تأخير عملية بيع؛ يمكن إضافة أكثر من تأخير في نفس اليوم.</p></div><label><span>الحد المسموح بالدقائق</span><input type="number" min="0.01" step="0.1" value={form.details.speed.maxAllowedMinutes} onChange={(event) => updateDetails((draft) => { draft.speed.maxAllowedMinutes = Math.max(.01, number(event.target.value, 3)); })} /></label></header><div className="kpi-daily-list">{modalDays.map((date) => { const values = form.details.speed.dailyDelaySales[date] || [""]; return <article className="kpi-day-card" key={date}><header><CalendarBlank size={18} /><strong>{arabicDate(date)}</strong><button onClick={() => updateDetails((draft) => { draft.speed.dailyDelaySales[date] = [...(draft.speed.dailyDelaySales[date] || [""]), ""]; })}><Plus size={15} />إضافة تأخير</button></header><div className="kpi-delay-list">{values.map((value, index) => <div key={`${date}-${index}`}><input type="number" min="0" step="0.1" value={value} placeholder="دقائق التأخير" onChange={(event) => updateDetails((draft) => { const list = [...(draft.speed.dailyDelaySales[date] || [""])]; list[index] = event.target.value; draft.speed.dailyDelaySales[date] = list; })} /><button title="حذف" onClick={() => updateDetails((draft) => { const list = [...(draft.speed.dailyDelaySales[date] || [""])]; list.splice(index, 1); draft.speed.dailyDelaySales[date] = list.length ? list : [""]; })}><Minus size={15} /></button></div>)}</div></article>; })}</div><div className="kpi-modal-stats"><span>إجمالي التأخير<b>{Math.round(calculated.totalDelay * 100) / 100} دقيقة</b></span><span>متوسط التأخير<b>{Math.round(calculated.averageDelay * 100) / 100} دقيقة</b></span><span>نسبة السرعة<b>{percent(calculated.speedRate)}</b></span></div></section> : null}

              {modalTab === "efficiency" ? <section className="kpi-panel"><h3>الكفاءة</h3><div className="kpi-two-cols"><article className="kpi-sub-card"><h4>الشخصية</h4><label><span>المصداقية في إعطاء العميل السيارة التي تناسبه</span><input type="number" min="0" max="100" value={form.details.efficiency.personality.customerFitHonesty} onChange={(event) => updateDetails((draft) => { draft.efficiency.personality.customerFitHonesty = clamp(event.target.value); })} /></label><label><span>المصداقية فيما يتواجد من ملاحظات في السيارة</span><input type="number" min="0" max="100" value={form.details.efficiency.personality.carNotesHonesty} onChange={(event) => updateDetails((draft) => { draft.efficiency.personality.carNotesHonesty = clamp(event.target.value); })} /></label><div className="kpi-readonly-box"><small>نتيجة السرعة من تبويب السرعة</small><strong>{percent(calculated.speedRate)}</strong></div></article><article className="kpi-sub-card"><h4>الفنية</h4>{([ ["currentPrices","حفظ الأسعار الحالية"], ["oldPrices","حفظ الأسعار السابقة"], ["carSpecs","معرفة مواصفات السيارات"], ["competitorsComparison","مقارنة المنافسين"], ["salesChannels","معرفة قنوات البيع"] ] as const).map(([key,label]) => <label key={key}><span>{label}</span><input type="number" min="0" max="100" value={form.details.efficiency.technical[key]} onChange={(event) => updateDetails((draft) => { draft.efficiency.technical[key] = clamp(event.target.value); })} /></label>)}</article></div><div className="kpi-modal-stats"><span>متوسط الشخصية<b>{percent(calculated.personalityRate)}</b></span><span>متوسط الفنية<b>{percent(calculated.technicalRate)}</b></span><span>نسبة الكفاءة<b>{percent(calculated.efficiencyRate)}</b></span><span>نقاط الكفاءة<b>{calculated.efficiencyPoints}</b></span></div></section> : null}

              {modalTab === "discipline" ? <section className="kpi-panel"><h3>الانضباط اليومي</h3><div className="kpi-daily-list">{modalDays.map((date) => { const row = performanceFor(date); return <article className="kpi-day-card" key={date}><header><CalendarBlank size={18} /><strong>{arabicDate(date)}</strong></header><div className="kpi-week-grid"><label><span>الحضور من 3</span><input type="number" min="0" max="3" value={row.attendance} onChange={(event) => setPerformance(date,"attendance",event.target.value)} /></label><label><span>الهيئة من 3</span><input type="number" min="0" max="3" value={row.appearance} onChange={(event) => setPerformance(date,"appearance",event.target.value)} /></label><label><span>السلوك من 3</span><input type="number" min="0" max="3" value={row.behavior} onChange={(event) => setPerformance(date,"behavior",event.target.value)} /></label></div></article>; })}</div><div className="kpi-modal-stats"><span>إجمالي نقاط الحضور<b>{calculated.attendancePoints}</b></span><span>إجمالي نقاط الهيئة<b>{calculated.appearancePoints}</b></span><span>إجمالي نقاط السلوك<b>{calculated.behaviorPoints}</b></span><span>نسبة الانضباط<b>{percent(calculated.disciplineRate)}</b></span></div></section> : null}

              {modalTab === "value" ? <section className="kpi-panel"><h3>القيمة اليومية</h3><div className="kpi-daily-list">{modalDays.map((date) => { const row = performanceFor(date); return <article className="kpi-day-card" key={date}><header><CalendarBlank size={18} /><strong>{arabicDate(date)}</strong></header><div className="kpi-week-grid two"><label><span>تقييم العملاء من 3</span><input type="number" min="0" max="3" value={row.customerRating} onChange={(event) => setPerformance(date,"customerRating",event.target.value)} /></label><label><span>عدد المبيعات</span><input type="number" min="0" value={row.salesCount} onChange={(event) => setPerformance(date,"salesCount",event.target.value)} /></label></div></article>; })}</div><div className="kpi-modal-stats"><span>إجمالي نقاط تقييم العملاء<b>{calculated.customerPoints}</b></span><span>إجمالي عدد المبيعات<b>{calculated.salesCount}</b></span><span>نسبة القيمة<b>{percent(calculated.valueRate)}</b></span></div></section> : null}

              {modalTab === "result" ? <section className="kpi-panel"><h3>النتيجة النهائية</h3><div className="kpi-result-hero"><div><span>نسبة KPI</span><strong>{percent(calculated.finalRate)}</strong><b>{calculated.rating}</b></div><div><span>إجمالي النقاط</span><strong>{Math.round(calculated.totalPoints)}</strong></div></div><div className="kpi-result-table"><span>السرعة<b>{percent(calculated.speedRate)}</b></span><span>الكفاءة<b>{percent(calculated.efficiencyRate)}</b></span><span>الانضباط<b>{percent(calculated.disciplineRate)}</b></span><span>القيمة<b>{percent(calculated.valueRate)}</b></span><span>المبيعات<b>{calculated.salesCount}</b></span><span>أيام العمل<b>{calculated.workDays}</b></span></div><label className="kpi-notes"><span>ملاحظات التقييم</span><textarea rows={5} value={form.notes} onChange={(event) => updateForm("notes", event.target.value)} /></label></section> : null}

              {!modalDays.length && modalTab !== "result" && modalTab !== "efficiency" ? <div className="crm-empty-state panel">حدد فترة التقييم أولًا لعرض الأيام.</div> : null}
            </div>

            <div className="crm-modal-actions"><button className="crm-secondary-button" onClick={() => setModal(false)}>إلغاء</button><button className="crm-primary-button" disabled={saving || !form.userId || !form.periodStart || !form.periodEnd} onClick={() => void save()}>{saving ? "جاري الحفظ..." : "حفظ التقييم"}</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
