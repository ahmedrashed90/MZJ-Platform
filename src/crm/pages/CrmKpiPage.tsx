import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CalendarBlank,
  ChartBar,
  FilePdf,
  FloppyDisk,
  MagnifyingGlass,
  Minus,
  PencilSimple,
  Plus,
  Trophy,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { useEscapeToClose } from "../../components/useEscapeToClose";
import { crmFetch, queryString } from "../api";
import type { CrmMeta } from "../types";

type ModalTab = "speed" | "efficiency" | "discipline" | "value" | "result";
type DailyRow = { attendance: number; appearance: number; behavior: number; customerRating: number; salesCount: number };

type KpiDetails = {
  workDays: number;
  branchCode?: string;
  branchName?: string;
  departmentCode?: string;
  departmentName?: string;
  speed: { maxAllowedMinutes: number; dailyDelaySales: Record<string, Array<string | number>> };
  efficiency: {
    personality: { customerFitHonesty: number; carNotesHonesty: number };
    technical: { currentPrices: number; oldPrices: number; carSpecs: number; competitorsComparison: number; salesChannels: number };
  };
  dailyPerformance: Record<string, DailyRow>;
  finalKpi?: Record<string, unknown>;
};

type FormState = {
  userId: string;
  periodStart: string;
  periodEnd: string;
  branchCode: string;
  branchName: string;
  departmentCode: string;
  departmentName: string;
  notes: string;
  details: KpiDetails;
};

function number(value: unknown, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function clamp(value: unknown, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, number(value)));
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthPeriod(month: string) {
  if (!month) return { from: "", to: "" };
  const [year, monthNo] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNo, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

function businessDates(from: string, to: string) {
  if (!from || !to) return [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const result: string[] = [];
  for (const current = new Date(start); current <= end && result.length < 370; current.setUTCDate(current.getUTCDate() + 1)) {
    if (current.getUTCDay() === 5) continue;
    result.push(`${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}-${String(current.getUTCDate()).padStart(2, "0")}`);
  }
  return result;
}

function weekGroups(dates: string[]) {
  const groups: string[][] = [];
  let group: string[] = [];
  dates.forEach((date) => {
    group.push(date);
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 4) {
      groups.push(group);
      group = [];
    }
  });
  if (group.length) groups.push(group);
  return groups;
}

function arabicDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-SA", { weekday: "long", year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function rating(total: number) {
  if (total >= 100) return "ممتاز";
  if (total >= 90) return "جيد جداً";
  if (total >= 80) return "جيد";
  if (total >= 60) return "مقبول";
  if (total >= 50) return "ضعيف";
  return "غير مناسب";
}

function emptyDetails(workDays = 1): KpiDetails {
  return {
    workDays: Math.max(1, workDays),
    speed: { maxAllowedMinutes: 3, dailyDelaySales: {} },
    efficiency: {
      personality: { customerFitHonesty: 0, carNotesHonesty: 0 },
      technical: { currentPrices: 0, oldPrices: 0, carSpecs: 0, competitorsComparison: 0, salesChannels: 0 },
    },
    dailyPerformance: {},
  };
}

function normalizeDetails(input: any, workDays: number): KpiDetails {
  const base = emptyDetails(workDays);
  return {
    ...base,
    ...(input || {}),
    workDays: Math.max(1, workDays),
    speed: { ...base.speed, ...(input?.speed || {}), dailyDelaySales: input?.speed?.dailyDelaySales || {} },
    efficiency: {
      personality: { ...base.efficiency.personality, ...(input?.efficiency?.personality || {}) },
      technical: { ...base.efficiency.technical, ...(input?.efficiency?.technical || {}) },
    },
    dailyPerformance: input?.dailyPerformance || {},
  };
}

function calculate(detailsInput: KpiDetails) {
  const details = detailsInput || emptyDetails();
  const workDays = Math.max(1, Math.floor(number(details.workDays, 1)));
  const maximumAllowed = Math.max(0.01, number(details.speed?.maxAllowedMinutes, 3));
  const delayValues = Object.values(details.speed?.dailyDelaySales || {}).flatMap((entry) => Array.isArray(entry) ? entry : [entry])
    .filter((entry) => String(entry ?? "").trim() !== "")
    .map((entry) => Math.max(0, number(entry)));
  const totalDelay = delayValues.reduce((sum, value) => sum + value, 0);
  const averageDelay = delayValues.length ? totalDelay / delayValues.length : 0;
  const speedRate = delayValues.length ? clamp(100 - (averageDelay / maximumAllowed) * 100) : 100;
  const personality = details.efficiency?.personality || basePersonality;
  const technical = details.efficiency?.technical || baseTechnical;
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
  return { workDays, totalDelay, averageDelay, speedRate, personalityRate, technicalRate, efficiencyRate, efficiencyPoints, attendancePoints, appearancePoints, behaviorPoints, customerPoints, salesCount, disciplineRate, valueRate, finalRate, totalPoints, rating: rating(finalRate) };
}

const basePersonality = { customerFitHonesty: 0, carNotesHonesty: 0 };
const baseTechnical = { currentPrices: 0, oldPrices: 0, carSpecs: 0, competitorsComparison: 0, salesChannels: 0 };

function percent(value: unknown) { return `${Math.round(number(value) * 100) / 100}%`; }
function rateClass(value: unknown) { const n = number(value); return n >= 80 ? "good" : n >= 50 ? "mid" : "bad"; }

export function CrmKpiPage() {
  const defaultMonth = currentMonth();
  const defaultPeriod = monthPeriod(defaultMonth);
  const [tab, setTab] = useState<"add" | "reports">("add");
  const [modalTab, setModalTab] = useState<ModalTab>("speed");
  const [filters, setFilters] = useState({ month: defaultMonth, from: defaultPeriod.from, to: defaultPeriod.to, branch: "", agent: "", q: "" });
  const [rows, setRows] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [meta, setMeta] = useState<CrmMeta | null>(null);
  const [form, setForm] = useState<FormState>({ userId: "", periodStart: defaultPeriod.from, periodEnd: defaultPeriod.to, branchCode: "", branchName: "", departmentCode: "", departmentName: "", notes: "", details: emptyDetails(businessDates(defaultPeriod.from, defaultPeriod.to).length) });
  const [modal, setModal] = useState(false);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEscapeToClose(modal, () => setModal(false));

  const period = useMemo(() => filters.month ? monthPeriod(filters.month) : { from: filters.from, to: filters.to }, [filters.month, filters.from, filters.to]);
  const modalDays = useMemo(() => businessDates(form.periodStart, form.periodEnd), [form.periodStart, form.periodEnd]);
  const weeks = useMemo(() => weekGroups(modalDays), [modalDays]);
  const calculated = useMemo(() => calculate({ ...form.details, workDays: Math.max(1, modalDays.length) }), [form.details, modalDays.length]);

  useEffect(() => { void crmFetch<CrmMeta>("/api/crm/meta").then(setMeta).catch(() => undefined); }, []);
  useEffect(() => { void load(); }, [period.from, period.to, filters.branch, filters.agent]);

  async function load() {
    setLoading(true);
    setNotice("");
    try {
      const result = await crmFetch<{ ok: boolean; rows: any[]; agents: any[] }>(`/api/crm/kpi${queryString({ from: period.from, to: period.to, branch: filters.branch, agent: filters.agent })}`);
      setRows(result.rows || []);
      setAgents(result.agents || []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل تقييمات KPI");
    } finally {
      setLoading(false);
    }
  }

  const visibleAgents = useMemo(() => agents.filter((agent) => {
    if (filters.branch && !(agent.branch_codes || []).includes(filters.branch)) return false;
    if (filters.agent && agent.id !== filters.agent) return false;
    const search = [agent.full_name, agent.employee_no, agent.department_name, agent.branch_name, ...(agent.departments || []), ...(agent.branches || [])].join(" ").toLowerCase();
    return !filters.q || search.includes(filters.q.toLowerCase());
  }), [agents, filters.branch, filters.agent, filters.q]);

  const visibleRows = useMemo(() => rows.filter((row) => {
    const search = [row.full_name, row.rating, row.department_name, row.branch_name].join(" ").toLowerCase();
    return !filters.q || search.includes(filters.q.toLowerCase());
  }), [rows, filters.q]);

  function rowForAgent(agent: any) {
    return rows.find((row) => row.user_id === agent.id && (!agent.branch_code || !row.branch_code || row.branch_code === agent.branch_code)) || rows.find((row) => row.user_id === agent.id);
  }

  function updateDetails(mutator: (draft: KpiDetails) => void) {
    setForm((current) => {
      const draft = structuredClone(current.details);
      mutator(draft);
      return { ...current, details: draft };
    });
  }

  function performanceFor(date: string): DailyRow {
    return form.details.dailyPerformance[date] || { attendance: 0, appearance: 0, behavior: 0, customerRating: 0, salesCount: 0 };
  }

  function setPerformance(date: string, key: keyof DailyRow, value: string) {
    updateDetails((draft) => { draft.dailyPerformance[date] = { ...performanceFor(date), [key]: number(value) }; });
  }

  function open(agent?: any, row?: any) {
    const start = row ? String(row.period_start).slice(0, 10) : period.from;
    const end = row ? String(row.period_end).slice(0, 10) : period.to;
    const selectedAgent = agent || agents.find((item) => item.id === row?.user_id);
    const days = businessDates(start, end);
    const details = normalizeDetails(row?.details, days.length);
    setForm({
      userId: row?.user_id || selectedAgent?.id || "",
      periodStart: start,
      periodEnd: end,
      branchCode: row?.branch_code || selectedAgent?.branch_code || details.branchCode || "",
      branchName: row?.branch_name || selectedAgent?.branch_name || details.branchName || "",
      departmentCode: row?.department_code || selectedAgent?.department_code || details.departmentCode || "",
      departmentName: row?.department_name || selectedAgent?.department_name || details.departmentName || "",
      notes: row?.notes || "",
      details,
    });
    setModalTab("speed");
    setModal(true);
  }

  async function save() {
    setSaving(true);
    setNotice("");
    try {
      await crmFetch("/api/crm/kpi", {
        method: "POST",
        body: JSON.stringify({ ...form, details: { ...form.details, workDays: Math.max(1, modalDays.length), branchCode: form.branchCode, branchName: form.branchName, departmentCode: form.departmentCode, departmentName: form.departmentName } }),
      });
      setNotice("تم حفظ تقييم المندوب بنفس معادلات KPI المعتمدة");
      setModal(false);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر حفظ التقييم");
    } finally {
      setSaving(false);
    }
  }

  function printReport(rowOrForm: any, target: ModalTab | "all" = "all") {
    const isForm = Boolean(rowOrForm?.userId);
    const details = normalizeDetails(rowOrForm?.details, number(rowOrForm?.details?.workDays, 1));
    const result = calculate(details);
    const agentName = isForm ? agents.find((agent) => agent.id === rowOrForm.userId)?.full_name || "المندوب" : rowOrForm.full_name || "المندوب";
    const from = isForm ? rowOrForm.periodStart : String(rowOrForm.period_start).slice(0, 10);
    const to = isForm ? rowOrForm.periodEnd : String(rowOrForm.period_end).slice(0, 10);
    const branch = isForm ? rowOrForm.branchName : rowOrForm.branch_name;
    const department = isForm ? rowOrForm.departmentName : rowOrForm.department_name;
    const notes = String(rowOrForm?.notes || "").trim();
    const labels: Record<ModalTab | "all", string> = { speed: "السرعة", efficiency: "الكفاءة", discipline: "الانضباط", value: "القيمة", result: "النتيجة", all: "التقييم الكامل" };
    const safe = (input: unknown) => String(input ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
    const metric = (label: string, value: unknown, tone = "") => `<div class="metric ${tone}"><span>${safe(label)}</span><b>${safe(value)}</b></div>`;
    const dailyDates = [...new Set([...businessDates(from, to), ...Object.keys(details.dailyPerformance || {}), ...Object.keys(details.speed?.dailyDelaySales || {})])].sort();

    const speedRows = dailyDates.map((date) => {
      const delays = (details.speed?.dailyDelaySales?.[date] || []).filter((entry) => String(entry ?? "").trim() !== "");
      return `<tr><td>${safe(arabicDate(date))}</td><td>${safe(delays.length ? delays.join("، ") : "—")}</td><td>${delays.length}</td></tr>`;
    }).join("");
    const speedHtml = `<section class="box"><h2>تفاصيل السرعة</h2><div class="metrics">${metric("الحد المسموح", `${details.speed.maxAllowedMinutes} دقيقة`)}${metric("إجمالي التأخير", `${result.totalDelay.toFixed(2)} دقيقة`)}${metric("متوسط التأخير", `${result.averageDelay.toFixed(2)} دقيقة`)}${metric("نسبة السرعة", percent(result.speedRate), rateClass(result.speedRate))}</div><table><thead><tr><th>اليوم</th><th>دقائق التأخير المسجلة</th><th>عدد العمليات</th></tr></thead><tbody>${speedRows || '<tr><td colspan="3">لا توجد تأخيرات مسجلة</td></tr>'}</tbody></table></section>`;

    const personality = details.efficiency.personality;
    const technical = details.efficiency.technical;
    const efficiencyHtml = `<section class="box"><h2>تفاصيل الكفاءة</h2><div class="metrics">${metric("الشخصية", percent(result.personalityRate), rateClass(result.personalityRate))}${metric("الفنية", percent(result.technicalRate), rateClass(result.technicalRate))}${metric("الكفاءة", percent(result.efficiencyRate), rateClass(result.efficiencyRate))}${metric("نقاط التميز", result.efficiencyPoints)}</div><div class="two"><table><thead><tr><th colspan="2">الشخصية</th></tr></thead><tbody><tr><th>اختيار السيارة المناسبة للعميل</th><td>${safe(personality.customerFitHonesty)}%</td></tr><tr><th>توضيح ملاحظات السيارة</th><td>${safe(personality.carNotesHonesty)}%</td></tr><tr><th>نتيجة السرعة</th><td>${safe(percent(result.speedRate))}</td></tr></tbody></table><table><thead><tr><th colspan="2">الفنية</th></tr></thead><tbody><tr><th>حفظ الأسعار الحالية</th><td>${safe(technical.currentPrices)}%</td></tr><tr><th>حفظ الأسعار السابقة</th><td>${safe(technical.oldPrices)}%</td></tr><tr><th>معرفة مواصفات السيارات</th><td>${safe(technical.carSpecs)}%</td></tr><tr><th>مقارنة المنافسين</th><td>${safe(technical.competitorsComparison)}%</td></tr><tr><th>معرفة قنوات البيع</th><td>${safe(technical.salesChannels)}%</td></tr></tbody></table></div></section>`;

    const disciplineRows = dailyDates.map((date) => {
      const row = details.dailyPerformance?.[date] || { attendance: 0, appearance: 0, behavior: 0, customerRating: 0, salesCount: 0 };
      return `<tr><td>${safe(arabicDate(date))}</td><td>${safe(row.attendance)}</td><td>${safe(row.appearance)}</td><td>${safe(row.behavior)}</td></tr>`;
    }).join("");
    const disciplineHtml = `<section class="box"><h2>تفاصيل الانضباط</h2><div class="metrics">${metric("الحضور", result.attendancePoints)}${metric("الهيئة", result.appearancePoints)}${metric("السلوك", result.behaviorPoints)}${metric("نسبة الانضباط", percent(result.disciplineRate), rateClass(result.disciplineRate))}</div><table><thead><tr><th>اليوم</th><th>الحضور / 3</th><th>الهيئة / 3</th><th>السلوك / 3</th></tr></thead><tbody>${disciplineRows || '<tr><td colspan="4">لا توجد بيانات يومية</td></tr>'}</tbody></table></section>`;

    const valueRows = dailyDates.map((date) => {
      const row = details.dailyPerformance?.[date] || { attendance: 0, appearance: 0, behavior: 0, customerRating: 0, salesCount: 0 };
      return `<tr><td>${safe(arabicDate(date))}</td><td>${safe(row.customerRating)}</td><td>${safe(row.salesCount)}</td></tr>`;
    }).join("");
    const valueHtml = `<section class="box"><h2>تفاصيل القيمة</h2><div class="metrics">${metric("تقييم العملاء", result.customerPoints)}${metric("إجمالي المبيعات", result.salesCount)}${metric("نسبة القيمة", percent(result.valueRate), rateClass(result.valueRate))}</div><table><thead><tr><th>اليوم</th><th>تقييم العملاء / 3</th><th>عدد المبيعات</th></tr></thead><tbody>${valueRows || '<tr><td colspan="3">لا توجد بيانات يومية</td></tr>'}</tbody></table></section>`;

    const resultHtml = `<section class="box result-box"><h2>النتيجة النهائية</h2><div class="metrics result-metrics">${metric("السرعة", percent(result.speedRate), rateClass(result.speedRate))}${metric("الكفاءة", percent(result.efficiencyRate), rateClass(result.efficiencyRate))}${metric("الانضباط", percent(result.disciplineRate), rateClass(result.disciplineRate))}${metric("القيمة", percent(result.valueRate), rateClass(result.valueRate))}${metric("نسبة KPI", percent(result.finalRate), rateClass(result.finalRate))}${metric("إجمالي النقاط", Math.round(result.totalPoints))}${metric("التقييم", result.rating)}${metric("أيام العمل", result.workDays)}</div>${notes ? `<div class="notes"><strong>ملاحظات التقييم</strong><p>${safe(notes)}</p></div>` : ""}</section>`;
    const sections: Record<ModalTab, string> = { speed: speedHtml, efficiency: efficiencyHtml, discipline: disciplineHtml, value: valueHtml, result: resultHtml };
    const body = target === "all" ? `${speedHtml}${efficiencyHtml}${disciplineHtml}${valueHtml}${resultHtml}` : sections[target];

    const win = window.open("", "_blank", "width=1200,height=900");
    if (!win) return;
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>KPI - ${safe(agentName)} - ${safe(labels[target])}</title><style>@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Tajawal,Arial;padding:18px;color:#35221c;background:#fff;font-size:12px;font-weight:700}.cover,.box{background:#fff;border:1px solid #e5cdbf;border-radius:16px;padding:17px;margin-bottom:13px}.cover{background:linear-gradient(135deg,#4f2419,#8a4938);color:#fff}.cover h1{margin:0 0 8px}.cover h2{margin:0 0 12px;font-size:24px}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.meta span{padding:9px;border:1px solid rgba(255,255,255,.25);border-radius:9px}.box h2{margin:0 0 12px;font-size:19px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-bottom:13px}.metric{border:1px solid #ead5ca;border-radius:11px;padding:10px;background:#fffaf7}.metric span{display:block;color:#765e55}.metric b{display:block;font-size:20px;margin-top:5px}.metric.good{background:#edf8ef;border-color:#b8dfc1}.metric.mid{background:#fff8df;border-color:#ead88d}.metric.bad{background:#fff0f0;border-color:#efb7b7}.result-metrics{grid-template-columns:repeat(4,minmax(0,1fr))}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}table{width:100%;border-collapse:collapse;margin-top:4px}th,td{border:1px solid #ead5ca;padding:8px;text-align:right}th{background:#f8ece5;font-weight:800}.notes{margin-top:12px;padding:12px;border:1px solid #ead5ca;border-radius:10px;background:#fffaf7}.notes p{white-space:pre-wrap;margin:6px 0 0}@media print{body{padding:0}.box,.cover{break-inside:avoid}.cover{print-color-adjust:exact;-webkit-print-color-adjust:exact}}@media(max-width:800px){.meta,.metrics,.result-metrics,.two{grid-template-columns:1fr 1fr}}</style></head><body><section class="cover"><h1>تقييم KPI — ${safe(labels[target])}</h1><h2>${safe(agentName)}</h2><div class="meta"><span>الفرع: ${safe(branch || "—")}</span><span>القسم: ${safe(department || "—")}</span><span>الفترة: ${safe(from)} إلى ${safe(to)}</span><span>أيام العمل: ${safe(result.workDays)}</span></div></section>${body}<script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);
    win.document.close();
  }

  const reportSummary = useMemo(() => {
    const average = (key: string) => visibleRows.length ? visibleRows.reduce((sum, row) => sum + number(row[key]), 0) / visibleRows.length : 0;
    return { count: visibleRows.length, speed: average("speed_score"), efficiency: average("efficiency_score"), discipline: average("discipline_score"), value: average("value_score"), total: average("total_score") };
  }, [visibleRows]);

  const branchReports = useMemo(() => {
    const grouped = new Map<string, any[]>();
    visibleRows.forEach((row) => {
      const key = row.branch_name || row.branch_code || "بدون فرع";
      grouped.set(key, [...(grouped.get(key) || []), row]);
    });
    return [...grouped.entries()].map(([branchName, branchRows]) => {
      const details = branchRows.map((row) => ({ row, calc: calculate(normalizeDetails(row.details, number(row.details?.workDays, 1))) }));
      const total = details.reduce((acc, item) => ({
        attendance: acc.attendance + item.calc.attendancePoints,
        appearance: acc.appearance + item.calc.appearancePoints,
        behavior: acc.behavior + item.calc.behaviorPoints,
        efficiency: acc.efficiency + item.calc.efficiencyPoints,
        customer: acc.customer + item.calc.customerPoints,
        sales: acc.sales + item.calc.salesCount,
        points: acc.points + item.calc.totalPoints,
      }), { attendance: 0, appearance: 0, behavior: 0, efficiency: 0, customer: 0, sales: 0, points: 0 });
      const workDays = Math.max(1, businessDates(period.from, period.to).length);
      const count = Math.max(1, branchRows.length);
      const discipline = clamp(((total.attendance + total.appearance + total.behavior) / (count * workDays * 9)) * 100);
      const excellence = clamp((total.efficiency / (count * workDays * 3)) * 100);
      const value = clamp(((total.customer + total.sales) / (count * 80)) * 100);
      const managerRate = (discipline + excellence + value) / 3;
      const best = details.slice().sort((a, b) => b.calc.totalPoints - a.calc.totalPoints)[0];
      return { branchName, rows: details, total, managerRate, managerRating: rating(managerRate), best };
    });
  }, [visibleRows, period.from, period.to]);

  return (
    <div className="crm-page kpi-page kpi-page-v3">
      <header className="crm-page-head kpi-page-head-clean">
        <div>
          <span className="crm-eyebrow">إدارة أداء المبيعات</span>
          <h1>تقييم المناديب KPI</h1>
          <p>نفس معادلات النظام القديم مع عرض واضح للنسب والنتيجة، واستبعاد يوم الجمعة تلقائيًا.</p>
        </div>
        <button type="button" className="crm-secondary-button" disabled={loading} onClick={() => void load()}><ArrowClockwise size={18} />{loading ? "جاري التحديث..." : "تحديث"}</button>
      </header>

      <div className="crm-department-tabs kpi-main-tabs centered">
        <button type="button" className={tab === "add" ? "active" : ""} onClick={() => setTab("add")}><UsersThree size={18} />إضافة التقييم</button>
        <button type="button" className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")}><ChartBar size={18} />التقارير</button>
      </div>

      <section className="kpi-filter-shell">
        <div className="kpi-filter-group kpi-filter-dates">
          <label><span>الشهر</span><input type="month" value={filters.month} onChange={(event) => { const value = event.target.value; const selected = monthPeriod(value); setFilters((current) => ({ ...current, month: value, from: selected.from, to: selected.to })); }} /></label>
          <label><span>من تاريخ</span><input type="date" value={period.from} onChange={(event) => setFilters((current) => ({ ...current, month: "", from: event.target.value }))} /></label>
          <label><span>إلى تاريخ</span><input type="date" value={period.to} onChange={(event) => setFilters((current) => ({ ...current, month: "", to: event.target.value }))} /></label>
        </div>
        <div className="kpi-filter-group kpi-filter-people">
          <label><span>الفرع</span><select value={filters.branch} onChange={(event) => setFilters((current) => ({ ...current, branch: event.target.value }))}><option value="">كل الفروع</option>{(meta?.branches || []).map((branch) => <option key={branch.code} value={branch.code}>{branch.name}</option>)}</select></label>
          <label><span>المندوب</span><select value={filters.agent} onChange={(event) => setFilters((current) => ({ ...current, agent: event.target.value }))}><option value="">كل المناديب</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name} - {agent.branch_name || "بدون فرع"}</option>)}</select></label>
          <label className="crm-search-box wide"><MagnifyingGlass size={18} /><input value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="بحث باسم المندوب أو الفرع أو القسم" /></label>
          <button type="button" className="crm-secondary-button" onClick={() => setFilters({ month: defaultMonth, from: defaultPeriod.from, to: defaultPeriod.to, branch: "", agent: "", q: "" })}>مسح الفلاتر</button>
        </div>
      </section>

      {notice ? <div className="crm-inline-notice">{notice}</div> : null}

      {tab === "add" ? <section className="kpi-agents-section">
        <header className="kpi-section-head-clean">
          <div><h2>إضافة تقييم المناديب</h2><p>كل مندوب يظهر حسب فرعه وقسمه، وتُعرض آخر نتيجة محفوظة داخل الفترة المحددة.</p></div>
          <div className="kpi-count-badges"><span>{visibleAgents.length} مندوب</span><span>{businessDates(period.from, period.to).length} يوم عمل</span></div>
        </header>
        <div className="crm-table-shell kpi-agents-table"><table className="crm-table kpi-score-table"><thead><tr><th>الفرع</th><th>المندوب</th><th>القسم</th><th>عدد المبيعات</th><th>درجة المندوب</th><th>السرعة</th><th>الكفاءة</th><th>الانضباط</th><th>القيمة</th><th>نسبة KPI</th><th>التقييم</th><th>إجراءات</th></tr></thead><tbody>
          {visibleAgents.map((agent) => { const last = rowForAgent(agent); const result = last ? calculate(normalizeDetails(last.details, number(last.details?.workDays, 1))) : null; return <tr key={agent.id}>
            <td>{agent.branch_name || (agent.branches || []).join("، ") || "—"}</td>
            <td><div className="kpi-agent-cell"><strong>{agent.full_name}</strong><small>{agent.employee_no || ""}</small></div></td>
            <td>{agent.department_name || (agent.departments || []).join("، ") || "—"}</td>
            <td><strong className="kpi-number-emphasis">{last?.total_sales ?? last?.calculated_sales ?? 0}</strong></td>
            <td><strong className="kpi-number-emphasis">{result ? Math.round(result.totalPoints) : 0}</strong></td>
            {[last?.speed_score,last?.efficiency_score,last?.discipline_score,last?.value_score,last?.total_score].map((score,index) => <td key={index}>{last ? <span className={`kpi-rate-pill ${rateClass(score)}`}>{percent(score)}</span> : "—"}</td>)}
            <td>{last ? <span className={`kpi-rating-pill ${rateClass(last.total_score)}`}>{last.rating || "—"}</span> : "—"}</td>
            <td><button type="button" className="crm-primary-button small kpi-evaluate-button" onClick={() => open(agent, last)}>{last ? "تعديل التقييم" : "تقييم"}</button></td>
          </tr>; })}
          {!visibleAgents.length ? <tr><td colSpan={12}><div className="crm-empty-state">لا يوجد مناديب مبيعات مطابقون للفلاتر</div></td></tr> : null}
        </tbody></table></div>
      </section> : null}

      {tab === "reports" ? <div className="kpi-reports-stack">
        <section className="crm-report-summary kpi-report-summary">
          <article><UsersThree size={22} /><span>عدد المناديب</span><strong>{reportSummary.count}</strong></article>
          <article className={rateClass(reportSummary.speed)}><span>متوسط السرعة</span><strong>{percent(reportSummary.speed)}</strong></article>
          <article className={rateClass(reportSummary.efficiency)}><span>متوسط الكفاءة</span><strong>{percent(reportSummary.efficiency)}</strong></article>
          <article className={rateClass(reportSummary.discipline)}><span>متوسط الانضباط</span><strong>{percent(reportSummary.discipline)}</strong></article>
          <article className={rateClass(reportSummary.value)}><span>متوسط القيمة</span><strong>{percent(reportSummary.value)}</strong></article>
          <article className={rateClass(reportSummary.total)}><Trophy size={22} /><span>متوسط KPI</span><strong>{percent(reportSummary.total)}</strong></article>
        </section>
        {branchReports.map((report) => <section className="crm-panel kpi-branch-report" key={report.branchName}>
          <header><div><span className="crm-eyebrow">تقرير مدير الفرع</span><h2>{report.branchName}</h2><p>{period.from} إلى {period.to}</p></div><span className={`kpi-manager-score ${rateClass(report.managerRate)}`}>{percent(report.managerRate)}<small>{report.managerRating}</small></span></header>
          <div className="crm-table-shell"><table className="crm-table kpi-branch-matrix"><thead><tr><th>البند</th>{report.rows.map(({ row }) => <th key={row.id}><strong className="kpi-report-agent-name">{row.full_name}</strong></th>)}<th>الإجمالي</th></tr></thead><tbody>{[
            ["الحضور","attendancePoints"],["الهيئة","appearancePoints"],["السلوك","behaviorPoints"],["الكفاءة (التميز)","efficiencyPoints"],["تقييم العملاء","customerPoints"],["عدد المبيعات","salesCount"],["إجمالي نقاط المندوب","totalPoints"],
          ].map(([label,key]) => <tr key={key}><td><strong>{label}</strong></td>{report.rows.map(({ row, calc }) => <td key={row.id}>{Math.round(number((calc as any)[key]))}</td>)}<td><strong>{key === "attendancePoints" ? report.total.attendance : key === "appearancePoints" ? report.total.appearance : key === "behaviorPoints" ? report.total.behavior : key === "efficiencyPoints" ? Math.round(report.total.efficiency) : key === "customerPoints" ? report.total.customer : key === "salesCount" ? report.total.sales : Math.round(report.total.points)}</strong></td></tr>)}</tbody></table></div>
          <footer><div><Trophy size={25} weight="duotone" /><span>أفضل مندوب<strong>{report.best?.row?.full_name || "—"}</strong></span><span>إجمالي النقاط<strong>{report.best ? Math.round(report.best.calc.totalPoints) : 0}</strong></span><span>KPI<strong>{report.best ? percent(report.best.calc.finalRate) : "—"}</strong></span></div></footer>
        </section>)}
        {!visibleRows.length ? <div className="crm-empty-state panel">لا توجد تقييمات ضمن الفترة والفلاتر المحددة</div> : null}
      </div> : null}

      {modal ? <div className="crm-modal-backdrop kpi-fullscreen-backdrop" onMouseDown={() => setModal(false)}>
        <div className="kpi-fullscreen-dialog" onMouseDown={(event) => event.stopPropagation()}>
          <header className="kpi-fullscreen-head">
            <div><span className="crm-eyebrow">نموذج التقييم</span><h2>{agents.find((agent) => agent.id === form.userId)?.full_name || "إضافة تقييم مندوب"}</h2><p>{form.departmentName || "مبيعات"} • {form.branchName || "بدون فرع"}</p></div>
            <button type="button" className="crm-icon-button" onClick={() => setModal(false)}><X size={21} /></button>
          </header>

          <div className="kpi-fullscreen-toolbar">
            <section className="kpi-period-card">
              <label><span>المندوب</span><select value={form.userId} onChange={(event) => { const selected = agents.find((agent) => agent.id === event.target.value); setForm((current) => ({ ...current, userId: event.target.value, branchCode: selected?.branch_code || "", branchName: selected?.branch_name || "", departmentCode: selected?.department_code || "", departmentName: selected?.department_name || "" })); }}><option value="">اختر المندوب</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}</select></label>
              <label><span>من تاريخ</span><input type="date" value={form.periodStart} onChange={(event) => setForm((current) => ({ ...current, periodStart: event.target.value }))} /></label>
              <label><span>إلى تاريخ</span><input type="date" value={form.periodEnd} onChange={(event) => setForm((current) => ({ ...current, periodEnd: event.target.value }))} /></label>
              <label><span>أيام العمل</span><input readOnly value={modalDays.length} /></label>
            </section>
            <div className="kpi-pdf-actions">{(["speed","efficiency","discipline","value","result","all"] as const).map((target) => <button type="button" key={target} onClick={() => printReport(form,target)}><FilePdf size={15} />{target === "all" ? "PDF كامل" : `PDF ${target === "speed" ? "السرعة" : target === "efficiency" ? "الكفاءة" : target === "discipline" ? "الانضباط" : target === "value" ? "القيمة" : "النتيجة"}`}</button>)}</div>
            <nav className="kpi-modal-tabs">{(["speed","efficiency","discipline","value","result"] as ModalTab[]).map((item) => <button type="button" key={item} className={modalTab === item ? "active" : ""} onClick={() => setModalTab(item)}>{item === "speed" ? "السرعة" : item === "efficiency" ? "الكفاءة" : item === "discipline" ? "الانضباط" : item === "value" ? "القيمة" : "النتيجة"}</button>)}</nav>
          </div>

          <div className="kpi-fullscreen-content">
            {modalTab === "speed" ? <section className="kpi-panel"><header><div><h3>تقييم السرعة</h3><p>أدخل دقائق تأخير كل عملية بيع يوميًا. الجمعة مستبعدة من الفترة.</p></div><label><span>الحد المسموح</span><input type="number" min="0.01" step="0.1" value={form.details.speed.maxAllowedMinutes} onChange={(event) => updateDetails((draft) => { draft.speed.maxAllowedMinutes = Math.max(.01,number(event.target.value,3)); })} /></label></header>{weeks.map((week,index) => <div className="kpi-week-card" key={index}><h4>الأسبوع {index + 1}<span>من السبت إلى الخميس</span></h4><div className="kpi-daily-list">{week.map((date) => { const values = form.details.speed.dailyDelaySales[date] || [""]; return <article className="kpi-day-card" key={date}><header><CalendarBlank size={17} /><strong>{arabicDate(date)}</strong><button type="button" onClick={() => updateDetails((draft) => { draft.speed.dailyDelaySales[date] = [...(draft.speed.dailyDelaySales[date] || [""]),""]; })}><Plus size={14} />إضافة</button></header><div className="kpi-delay-list">{values.map((value,index) => <div key={`${date}-${index}`}><input type="number" min="0" step="0.1" value={value} placeholder="دقائق التأخير" onChange={(event) => updateDetails((draft) => { const list=[...(draft.speed.dailyDelaySales[date] || [""])]; list[index]=event.target.value; draft.speed.dailyDelaySales[date]=list; })} /><button type="button" title="حذف" onClick={() => updateDetails((draft) => { const list=[...(draft.speed.dailyDelaySales[date] || [""])]; list.splice(index,1); draft.speed.dailyDelaySales[date]=list.length?list:[""]; })}><Minus size={14} /></button></div>)}</div></article>; })}</div></div>)}<div className="kpi-modal-stats"><span><small>إجمالي التأخير</small><b>{calculated.totalDelay.toFixed(2)} دقيقة</b></span><span><small>متوسط التأخير</small><b>{calculated.averageDelay.toFixed(2)} دقيقة</b></span><span className={rateClass(calculated.speedRate)}><small>نسبة السرعة</small><b>{percent(calculated.speedRate)}</b></span></div></section> : null}
            {modalTab === "efficiency" ? <section className="kpi-panel"><h3>الكفاءة</h3><div className="kpi-two-cols"><article className="kpi-sub-card"><h4>الشخصية</h4><label><span>المصداقية في إعطاء العميل السيارة المناسبة</span><input type="number" min="0" max="100" value={form.details.efficiency.personality.customerFitHonesty} onChange={(event) => updateDetails((draft) => { draft.efficiency.personality.customerFitHonesty=clamp(event.target.value); })} /></label><label><span>المصداقية في توضيح ملاحظات السيارة</span><input type="number" min="0" max="100" value={form.details.efficiency.personality.carNotesHonesty} onChange={(event) => updateDetails((draft) => { draft.efficiency.personality.carNotesHonesty=clamp(event.target.value); })} /></label><div className={`kpi-readonly-box ${rateClass(calculated.speedRate)}`}><small>نتيجة السرعة</small><strong>{percent(calculated.speedRate)}</strong></div></article><article className="kpi-sub-card"><h4>الفنية</h4>{([ ["currentPrices","حفظ الأسعار الحالية"],["oldPrices","حفظ الأسعار السابقة"],["carSpecs","معرفة مواصفات السيارات"],["competitorsComparison","مقارنة المنافسين"],["salesChannels","معرفة قنوات البيع"] ] as const).map(([key,label]) => <label key={key}><span>{label}</span><input type="number" min="0" max="100" value={form.details.efficiency.technical[key]} onChange={(event) => updateDetails((draft) => { draft.efficiency.technical[key]=clamp(event.target.value); })} /></label>)}</article></div><div className="kpi-modal-stats"><span className={rateClass(calculated.personalityRate)}><small>الشخصية</small><b>{percent(calculated.personalityRate)}</b></span><span className={rateClass(calculated.technicalRate)}><small>الفنية</small><b>{percent(calculated.technicalRate)}</b></span><span className={rateClass(calculated.efficiencyRate)}><small>الكفاءة</small><b>{percent(calculated.efficiencyRate)}</b></span><span><small>نقاط التميز</small><b>{calculated.efficiencyPoints}</b></span></div></section> : null}
            {modalTab === "discipline" ? <section className="kpi-panel"><h3>الانضباط اليومي</h3>{weeks.map((week,index) => <div className="kpi-week-card" key={index}><h4>الأسبوع {index + 1}</h4><div className="kpi-daily-list">{week.map((date) => { const row=performanceFor(date); return <article className="kpi-day-card" key={date}><header><CalendarBlank size={17}/><strong>{arabicDate(date)}</strong></header><div className="kpi-week-grid"><label><span>الحضور / 3</span><input type="number" min="0" max="3" value={row.attendance} onChange={(event)=>setPerformance(date,"attendance",event.target.value)}/></label><label><span>الهيئة / 3</span><input type="number" min="0" max="3" value={row.appearance} onChange={(event)=>setPerformance(date,"appearance",event.target.value)}/></label><label><span>السلوك / 3</span><input type="number" min="0" max="3" value={row.behavior} onChange={(event)=>setPerformance(date,"behavior",event.target.value)}/></label></div></article>; })}</div></div>)}<div className="kpi-modal-stats"><span><small>الحضور</small><b>{calculated.attendancePoints}</b></span><span><small>الهيئة</small><b>{calculated.appearancePoints}</b></span><span><small>السلوك</small><b>{calculated.behaviorPoints}</b></span><span className={rateClass(calculated.disciplineRate)}><small>الانضباط</small><b>{percent(calculated.disciplineRate)}</b></span></div></section> : null}
            {modalTab === "value" ? <section className="kpi-panel"><h3>القيمة اليومية</h3>{weeks.map((week,index) => <div className="kpi-week-card" key={index}><h4>الأسبوع {index + 1}</h4><div className="kpi-daily-list">{week.map((date) => { const row=performanceFor(date); return <article className="kpi-day-card" key={date}><header><CalendarBlank size={17}/><strong>{arabicDate(date)}</strong></header><div className="kpi-week-grid two"><label><span>تقييم العملاء / 3</span><input type="number" min="0" max="3" value={row.customerRating} onChange={(event)=>setPerformance(date,"customerRating",event.target.value)}/></label><label><span>عدد المبيعات</span><input type="number" min="0" value={row.salesCount} onChange={(event)=>setPerformance(date,"salesCount",event.target.value)}/></label></div></article>; })}</div></div>)}<div className="kpi-modal-stats"><span><small>تقييم العملاء</small><b>{calculated.customerPoints}</b></span><span><small>المبيعات</small><b>{calculated.salesCount}</b></span><span className={rateClass(calculated.valueRate)}><small>القيمة</small><b>{percent(calculated.valueRate)}</b></span></div></section> : null}
            {modalTab === "result" ? <section className="kpi-panel"><h3>النتيجة النهائية</h3><div className="kpi-result-hero"><div className={rateClass(calculated.finalRate)}><span>نسبة KPI</span><strong>{percent(calculated.finalRate)}</strong><b>{calculated.rating}</b></div><div><span>إجمالي النقاط</span><strong>{Math.round(calculated.totalPoints)}</strong></div></div><div className="kpi-result-table"><span className={rateClass(calculated.speedRate)}>السرعة<b>{percent(calculated.speedRate)}</b></span><span className={rateClass(calculated.efficiencyRate)}>الكفاءة<b>{percent(calculated.efficiencyRate)}</b></span><span className={rateClass(calculated.disciplineRate)}>الانضباط<b>{percent(calculated.disciplineRate)}</b></span><span className={rateClass(calculated.valueRate)}>القيمة<b>{percent(calculated.valueRate)}</b></span><span>المبيعات<b>{calculated.salesCount}</b></span><span>أيام العمل<b>{calculated.workDays}</b></span></div><label className="kpi-notes"><span>ملاحظات التقييم</span><textarea rows={5} value={form.notes} onChange={(event)=>setForm((current)=>({...current,notes:event.target.value}))}/></label></section> : null}
            {!modalDays.length && modalTab !== "efficiency" && modalTab !== "result" ? <div className="crm-empty-state panel">حدد فترة تقييم صحيحة أولًا.</div> : null}
          </div>

          <div className="kpi-fullscreen-actions"><button type="button" className="crm-secondary-button" onClick={() => setModal(false)}>إلغاء</button><button type="button" className="crm-primary-button" disabled={saving || !form.userId || !form.periodStart || !form.periodEnd} onClick={() => void save()}><FloppyDisk size={18}/>{saving ? "جاري الحفظ..." : "حفظ تقييم الشهر"}</button></div>
        </div>
      </div> : null}
    </div>
  );
}
