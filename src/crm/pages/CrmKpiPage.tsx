import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CalendarBlank,
  ChartBar,
  FilePdf,
  FileXls,
  FloppyDisk,
  MagnifyingGlass,
  Minus,
  PencilSimple,
  Plus,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { useEscapeToClose } from "../../components/useEscapeToClose";
import { crmFetch, queryString } from "../api";
import type { CrmMeta } from "../types";

type ModalTab = "speed" | "efficiency" | "discipline" | "value" | "result";
type DailyRow = { attendance: number; appearance: number; behavior: number; customerRating: number; salesCount: number };
type KpiPermissions = { canEditSpeed: boolean; canEditEfficiency: boolean; canEditBase: boolean; canSave: boolean; speedConfigured: boolean; efficiencyConfigured: boolean };
const noKpiPermissions: KpiPermissions = { canEditSpeed: false, canEditEfficiency: false, canEditBase: false, canSave: false, speedConfigured: false, efficiencyConfigured: false };

type KpiDetails = {
  workDays: number;
  branchCode?: string;
  branchName?: string;
  departmentCode?: string;
  departmentName?: string;
  speed: { maxAllowedMinutes: number; dailyDelaySales: Record<string, Array<string | number>>; dailyDelayNotes: Record<string, string[]> };
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
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", { weekday: "long", year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function rating(total: number) {
  if (total >= 100) return "ممتاز";
  if (total >= 90) return "جيد جداً";
  if (total >= 80) return "جيد";
  if (total >= 60) return "مقبول";
  if (total >= 50) return "ضعيف";
  return "غير مناسب";
}

function branchManagerRating(total: number) {
  if (total >= 100) return "ممتاز";
  if (total >= 90) return "جيد";
  if (total >= 80) return "مقبول";
  if (total >= 70) return "ضعيف";
  return "غير مناسب";
}

function emptyDetails(workDays = 1): KpiDetails {
  return {
    workDays: Math.max(1, workDays),
    speed: { maxAllowedMinutes: 3, dailyDelaySales: {}, dailyDelayNotes: {} },
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
    speed: { ...base.speed, ...(input?.speed || {}), dailyDelaySales: input?.speed?.dailyDelaySales || {}, dailyDelayNotes: input?.speed?.dailyDelayNotes || {} },
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
  const speedRate = delayValues.length ? clamp(100 - (averageDelay / maximumAllowed) * 100) : 0;
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
  return { workDays, totalDelay, averageDelay, speedRate, personalityRate, technicalRate, efficiencyRate, efficiencyPoints, attendancePoints, appearancePoints, behaviorPoints, customerPoints, salesCount, disciplineRate, valueRate, finalRate, totalPoints, rating: rating(Math.round(finalRate)) };
}

const basePersonality = { customerFitHonesty: 0, carNotesHonesty: 0 };
const baseTechnical = { currentPrices: 0, oldPrices: 0, carSpecs: 0, competitorsComparison: 0, salesChannels: 0 };

function escapeHtml(input: unknown) {
  return String(input ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeXml(input: unknown) {
  return String(input ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
}

function downloadBrowserFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob(["\ufeff", content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function percent(value: unknown) { return `${Math.round(number(value))}%`; }
function rateClass(value: unknown) { const n = number(value); return n >= 80 ? "good" : n >= 50 ? "mid" : "bad"; }
function representativeRatingClass(value: unknown) {
  const label = rating(Math.round(number(value)));
  return label === "غير مناسب" ? "branch-rating-red" : label === "ضعيف" || label === "مقبول" ? "branch-rating-yellow" : "branch-rating-green";
}
function branchManagerRatingClass(value: unknown) {
  const label = branchManagerRating(number(value));
  return label === "غير مناسب" ? "branch-rating-red" : label === "ضعيف" || label === "مقبول" ? "branch-rating-yellow" : "branch-rating-green";
}

function hasKpiResult(calc: ReturnType<typeof calculate>) {
  return [
    calc.salesCount,
    calc.totalPoints,
    calc.speedRate,
    calc.efficiencyRate,
    calc.disciplineRate,
    calc.valueRate,
    calc.finalRate,
  ].some((value) => Math.abs(number(value)) > 0.0001);
}

export function CrmKpiPage() {
  const defaultMonth = currentMonth();
  const defaultPeriod = monthPeriod(defaultMonth);
  const [tab, setTab] = useState<"add" | "reports">("add");
  const [modalTab, setModalTab] = useState<ModalTab>("speed");
  const [filters, setFilters] = useState({ month: defaultMonth, from: defaultPeriod.from, to: defaultPeriod.to, branch: "", agent: "", q: "" });
  const [rows, setRows] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<KpiPermissions>(noKpiPermissions);
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
      const result = await crmFetch<{ ok: boolean; rows: any[]; agents: any[]; permissions?: KpiPermissions }>(`/api/crm/kpi${queryString({ from: period.from, to: period.to, branch: filters.branch, agent: filters.agent })}`);
      setRows(result.rows || []);
      setAgents(result.agents || []);
      setPermissions(result.permissions || noKpiPermissions);
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

  const reportAgents = useMemo(
    () => visibleAgents.filter((agent) => hasKpiResult(resultForAgent(agent).calc)),
    [visibleAgents, rows, period.from, period.to],
  );

  function rowForAgent(agent: any) {
    return rows.find((row) => row.user_id === agent.id && (!agent.branch_code || !row.branch_code || row.branch_code === agent.branch_code))
      || rows.find((row) => row.user_id === agent.id);
  }

  function resultForAgent(agent: any) {
    const row = rowForAgent(agent);
    const details = normalizeDetails(row?.details, businessDates(period.from, period.to).length);
    return { row, calc: calculate(details) };
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
    setModalTab(permissions.canEditSpeed ? "speed" : permissions.canEditEfficiency ? "efficiency" : permissions.canEditBase ? "discipline" : "result");
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

  function reportFormForAgent(agent: any): FormState {
    const row = rowForAgent(agent);
    const details = normalizeDetails(row?.details, businessDates(period.from, period.to).length);
    return {
      userId: agent.id,
      periodStart: period.from,
      periodEnd: period.to,
      branchCode: row?.branch_code || agent.branch_code || details.branchCode || "",
      branchName: row?.branch_name || agent.branch_name || details.branchName || (agent.branches || []).join("، ") || "",
      departmentCode: row?.department_code || agent.department_code || details.departmentCode || "",
      departmentName: row?.department_name || agent.department_name || details.departmentName || (agent.departments || []).join("، ") || "",
      notes: row?.notes || "",
      details,
    };
  }

  function buildPrintReport(rowOrForm: any, target: ModalTab | "all" = "all") {
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
    const metric = (label: string, value: unknown, tone = "") => `<div class="metric ${tone}"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
    const dailyDates = [...new Set([...businessDates(from, to), ...Object.keys(details.dailyPerformance || {}), ...Object.keys(details.speed?.dailyDelaySales || {})])].sort();

    const speedRows = dailyDates.map((date) => {
      const delays = (details.speed?.dailyDelaySales?.[date] || []).filter((entry) => String(entry ?? "").trim() !== "");
      return `<tr><td>${escapeHtml(arabicDate(date))}</td><td>${escapeHtml(delays.length ? delays.join("، ") : "—")}</td><td>${delays.length}</td></tr>`;
    }).join("");
    const speedHtml = `<section class="box"><h2>تفاصيل السرعة</h2><div class="metrics">${metric("الحد المسموح", `${details.speed.maxAllowedMinutes} دقيقة`)}${metric("إجمالي التأخير", `${result.totalDelay.toFixed(2)} دقيقة`)}${metric("متوسط التأخير", `${result.averageDelay.toFixed(2)} دقيقة`)}${metric("نسبة السرعة", percent(result.speedRate), rateClass(result.speedRate))}</div><table><thead><tr><th>اليوم</th><th>دقائق التأخير المسجلة</th><th>عدد العمليات</th></tr></thead><tbody>${speedRows || '<tr><td colspan="3">لا توجد تأخيرات مسجلة</td></tr>'}</tbody></table></section>`;

    const personality = details.efficiency.personality;
    const technical = details.efficiency.technical;
    const efficiencyHtml = `<section class="box"><h2>تفاصيل الكفاءة</h2><div class="metrics">${metric("الشخصية", percent(result.personalityRate), rateClass(result.personalityRate))}${metric("الفنية", percent(result.technicalRate), rateClass(result.technicalRate))}${metric("الكفاءة", percent(result.efficiencyRate), rateClass(result.efficiencyRate))}${metric("نقاط التميز", result.efficiencyPoints)}</div><div class="two"><table><thead><tr><th colspan="2">الشخصية</th></tr></thead><tbody><tr><th>اختيار السيارة المناسبة للعميل</th><td>${escapeHtml(personality.customerFitHonesty)}%</td></tr><tr><th>توضيح ملاحظات السيارة</th><td>${escapeHtml(personality.carNotesHonesty)}%</td></tr><tr><th>نتيجة السرعة</th><td>${escapeHtml(percent(result.speedRate))}</td></tr></tbody></table><table><thead><tr><th colspan="2">الفنية</th></tr></thead><tbody><tr><th>حفظ الأسعار الحالية</th><td>${escapeHtml(technical.currentPrices)}%</td></tr><tr><th>حفظ الأسعار السابقة</th><td>${escapeHtml(technical.oldPrices)}%</td></tr><tr><th>المعرفة التفصيلية بمواصفات السيارة</th><td>${escapeHtml(technical.carSpecs)}%</td></tr><tr><th>معرفة فروق السيارة مع البراندات الأخرى</th><td>${escapeHtml(technical.competitorsComparison)}%</td></tr><tr><th>معرفة طرق وقنوات البيع كاش أو أقساط</th><td>${escapeHtml(technical.salesChannels)}%</td></tr></tbody></table></div></section>`;

    const disciplineRows = dailyDates.map((date) => {
      const row = details.dailyPerformance?.[date] || { attendance: 0, appearance: 0, behavior: 0, customerRating: 0, salesCount: 0 };
      return `<tr><td>${escapeHtml(arabicDate(date))}</td><td>${escapeHtml(row.attendance)}</td><td>${escapeHtml(row.appearance)}</td><td>${escapeHtml(row.behavior)}</td></tr>`;
    }).join("");
    const disciplineHtml = `<section class="box"><h2>تفاصيل الانضباط</h2><div class="metrics">${metric("الحضور", result.attendancePoints)}${metric("الهيئة", result.appearancePoints)}${metric("السلوك", result.behaviorPoints)}${metric("نسبة الانضباط", percent(result.disciplineRate), rateClass(result.disciplineRate))}</div><table><thead><tr><th>اليوم</th><th>الحضور / 3</th><th>الهيئة / 3</th><th>السلوك / 3</th></tr></thead><tbody>${disciplineRows || '<tr><td colspan="4">لا توجد بيانات يومية</td></tr>'}</tbody></table></section>`;

    const valueRows = dailyDates.map((date) => {
      const row = details.dailyPerformance?.[date] || { attendance: 0, appearance: 0, behavior: 0, customerRating: 0, salesCount: 0 };
      return `<tr><td>${escapeHtml(arabicDate(date))}</td><td>${escapeHtml(row.customerRating)}</td><td>${escapeHtml(row.salesCount)}</td></tr>`;
    }).join("");
    const valueHtml = `<section class="box"><h2>تفاصيل القيمة</h2><div class="metrics">${metric("تقييم العملاء", result.customerPoints)}${metric("إجمالي المبيعات", result.salesCount)}${metric("نسبة القيمة", percent(result.valueRate), rateClass(result.valueRate))}</div><table><thead><tr><th>اليوم</th><th>تقييم العملاء / 3</th><th>عدد المبيعات</th></tr></thead><tbody>${valueRows || '<tr><td colspan="3">لا توجد بيانات يومية</td></tr>'}</tbody></table></section>`;

    const resultHtml = `<section class="box result-box"><h2>النتيجة النهائية</h2><div class="metrics result-metrics">${metric("السرعة", percent(result.speedRate), rateClass(result.speedRate))}${metric("الكفاءة", percent(result.efficiencyRate), rateClass(result.efficiencyRate))}${metric("الانضباط", percent(result.disciplineRate), rateClass(result.disciplineRate))}${metric("القيمة", percent(result.valueRate), rateClass(result.valueRate))}${metric("نسبة KPI", percent(result.finalRate), rateClass(result.finalRate))}${metric("إجمالي النقاط", Math.round(result.totalPoints))}${metric("التقييم", result.rating)}${metric("أيام العمل", result.workDays)}</div>${notes ? `<div class="notes"><strong>ملاحظات التقييم</strong><p>${escapeHtml(notes)}</p></div>` : ""}</section>`;
    const sections: Record<ModalTab, string> = { speed: speedHtml, efficiency: efficiencyHtml, discipline: disciplineHtml, value: valueHtml, result: resultHtml };
    const pageTitles: Record<ModalTab, string> = { speed: "تفاصيل السرعة", efficiency: "تفاصيل الكفاءة", discipline: "تفاصيل الانضباط", value: "تفاصيل القيمة", result: "النتيجة النهائية" };
    const reportHeader = (pageTitle: string) => `<header class="report-head"><div class="report-title"><h1>تقييم KPI — ${escapeHtml(pageTitle)}</h1><h2>${escapeHtml(agentName)}</h2></div><div class="meta"><span>الفرع: ${escapeHtml(branch || "—")}</span><span>القسم: ${escapeHtml(department || "—")}</span><span>الفترة: ${escapeHtml(from)} إلى ${escapeHtml(to)}</span><span>أيام العمل: ${escapeHtml(result.workDays)}</span></div></header>`;
    const page = (content: string, pageTitle: string, extraClass = "") => `<section class="pdf-page ${extraClass}">${reportHeader(pageTitle)}<main>${content}</main></section>`;
    const body = target === "all"
      ? [
          page(resultHtml, pageTitles.result, "page-result first-page"),
          page(speedHtml, pageTitles.speed, "page-speed"),
          page(efficiencyHtml, pageTitles.efficiency, "page-efficiency"),
          page(disciplineHtml, pageTitles.discipline, "page-discipline"),
          page(valueHtml, pageTitles.value, "page-value"),
        ].join("")
      : page(sections[target], pageTitles[target], `page-${target} first-page`);
    return { body, title: `KPI - ${agentName} - ${labels[target]}` };
  }

  function openPrintDocument(body: string, title: string) {
    const win = window.open("", "_blank", "width=1200,height=900");
    if (!win) return;
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page{size:A4 landscape;margin:4mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
body{font-family:Tajawal,Arial,sans-serif;color:#35221c;font-size:9px;font-weight:700;line-height:1.28}
.pdf-page{width:100%;page-break-after:always;break-after:page;min-height:1px}
.pdf-page:last-child{page-break-after:auto;break-after:auto}
.pdf-page main{margin:0;padding:0}
.report-head{background:linear-gradient(135deg,#4f2419,#8a4938);color:#fff;border-radius:9px;padding:8px 10px;margin:0 0 6px;break-inside:avoid;page-break-after:avoid}
.report-title{display:flex;align-items:center;justify-content:space-between;gap:10px}
.report-title h1{margin:0;font-size:14px;line-height:1.15}
.report-title h2{margin:0;font-size:17px;line-height:1.15}
.meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin-top:4px}
.meta span{padding:3.5px 6px;border:1px solid rgba(255,255,255,.28);border-radius:5px;font-size:7.5px;line-height:1.15}
.box{background:#fff;border:1px solid #e5cdbf;border-radius:8px;padding:7px;margin:0;break-inside:avoid;page-break-inside:avoid}
.box h2{margin:0 0 6px;font-size:13px;line-height:1.15}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin-bottom:5px}
.metric{border:1px solid #ead5ca;border-radius:6px;padding:5px 6px;background:#fffaf7;break-inside:avoid;min-height:38px}
.metric span{display:block;color:#765e55;font-size:8px;line-height:1.1}
.metric b{display:block;font-size:12px;line-height:1.1;margin-top:1px}
.metric.good{background:#edf8ef;border-color:#b8dfc1}
.metric.mid{background:#fff8df;border-color:#ead88d}
.metric.bad{background:#fff0f0;border-color:#efb7b7}
.result-metrics{grid-template-columns:repeat(4,minmax(0,1fr))}
.two{display:grid;grid-template-columns:1fr 1fr;gap:5px}
table{width:100%;border-collapse:collapse;margin:0;font-size:8.2px;line-height:1.15;table-layout:fixed}
thead{display:table-header-group}
tr{break-inside:avoid;page-break-inside:avoid}
th,td{border:1px solid #ead5ca;padding:3px 5px;text-align:right;vertical-align:middle;overflow-wrap:anywhere}
th{background:#f8ece5;font-weight:900}
.notes{margin-top:5px;padding:6px;border:1px solid #ead5ca;border-radius:6px;background:#fffaf7;break-inside:avoid}
.notes p{white-space:pre-wrap;margin:3px 0 0;line-height:1.25}
.page-result .box{padding:9px}.page-result .metrics{gap:6px}.page-result .metric{min-height:46px;padding:7px}.page-result .metric span{font-size:9px}.page-result .metric b{font-size:14px}
.page-efficiency .box{padding:9px}.page-efficiency table{font-size:9px;line-height:1.2}.page-efficiency th,.page-efficiency td{padding:5px 6px}
@media print{.report-head{-webkit-print-color-adjust:exact;print-color-adjust:exact}.pdf-page,.box,.metric,.notes,.two>table{break-inside:avoid;page-break-inside:avoid}}
</style></head><body>${body}<script>window.onload=()=>setTimeout(()=>window.print(),200)<\/script></body></html>`);
    win.document.close();
  }

  function printReport(rowOrForm: any, target: ModalTab | "all" = "all") {
    const report = buildPrintReport(rowOrForm, target);
    openPrintDocument(report.body, report.title);
  }

  function exportVisiblePdf(target: "result" | "all") {
    if (!reportAgents.length) {
      setNotice("لا يوجد مناديب لديهم نتيجة KPI ضمن الفلاتر الحالية للتصدير");
      return;
    }
    const body = reportAgents.map((agent) => buildPrintReport(reportFormForAgent(agent), target).body).join("");
    openPrintDocument(body, `KPI - ${target === "result" ? "النتيجة" : "التقييم الكامل"} - ${period.from} إلى ${period.to}`);
  }

  function exportVisibleExcel(full: boolean) {
    if (!reportAgents.length) {
      setNotice("لا يوجد مناديب لديهم نتيجة KPI ضمن الفلاتر الحالية للتصدير");
      return;
    }
    const entries = reportAgents.map((agent) => {
      const input = reportFormForAgent(agent);
      return { agent, input, details: input.details, calc: calculate(input.details) };
    });
    const cell = (value: unknown, header = false) => {
      const numeric = typeof value === "number" && Number.isFinite(value);
      return `<Cell${header ? ' ss:StyleID="Header"' : ""}><Data ss:Type="${numeric ? "Number" : "String"}">${escapeXml(numeric ? value : String(value ?? ""))}</Data></Cell>`;
    };
    const row = (values: unknown[], header = false) => `<Row>${values.map((value) => cell(value, header)).join("")}</Row>`;
    const worksheet = (name: string, tableRows: unknown[][]) => `<Worksheet ss:Name="${escapeXml(name)}"><Table>${tableRows.map((values, index) => row(values, index === 0)).join("")}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DisplayRightToLeft/></WorksheetOptions></Worksheet>`;

    const resultRows: unknown[][] = [["الفرع", "المندوب", "القسم", "من تاريخ", "إلى تاريخ", "عدد المبيعات", "إجمالي النقاط", "السرعة %", "الكفاءة %", "الانضباط %", "القيمة %", "KPI %", "التقييم"]];
    entries.forEach(({ agent, input, calc }) => resultRows.push([
      input.branchName || "—", agent.full_name || "—", input.departmentName || "—", input.periodStart, input.periodEnd,
      Math.round(calc.salesCount), Math.round(calc.totalPoints), Math.round(calc.speedRate), Math.round(calc.efficiencyRate), Math.round(calc.disciplineRate), Math.round(calc.valueRate), Math.round(calc.finalRate), calc.rating,
    ]));

    const sheets = [worksheet("النتيجة", resultRows)];
    if (full) {
      const speedRows: unknown[][] = [["الفرع", "المندوب", "التاريخ", "دقائق التأخير", "عدد العمليات", "ملاحظات التأخير", "أقصى دقائق مسموح بها", "نسبة السرعة %"]];
      const efficiencyRows: unknown[][] = [["الفرع", "المندوب", "المصداقية %", "المعرفة بالمخزون %", "نتيجة السرعة %", "الأسعار الحالية %", "الأسعار السابقة %", "مواصفات السيارة %", "مقارنة المنافسين %", "قنوات البيع %", "الشخصية %", "الفنية %", "الكفاءة %", "نقاط التميز"]];
      const disciplineRows: unknown[][] = [["الفرع", "المندوب", "التاريخ", "الحضور / 3", "الهيئة / 3", "السلوك / 3", "نسبة الانضباط %"]];
      const valueRows: unknown[][] = [["الفرع", "المندوب", "التاريخ", "تقييم العملاء / 3", "عدد المبيعات", "نسبة القيمة %"]];

      entries.forEach(({ agent, input, details, calc }) => {
        const dates = [...new Set([...businessDates(input.periodStart, input.periodEnd), ...Object.keys(details.dailyPerformance || {}), ...Object.keys(details.speed?.dailyDelaySales || {})])].sort();
        dates.forEach((date) => {
          const delays = (details.speed?.dailyDelaySales?.[date] || []).filter((entry) => String(entry ?? "").trim() !== "");
          const notes = (details.speed?.dailyDelayNotes?.[date] || []).filter((entry) => String(entry ?? "").trim() !== "");
          const daily = details.dailyPerformance?.[date] || { attendance: 0, appearance: 0, behavior: 0, customerRating: 0, salesCount: 0 };
          speedRows.push([input.branchName || "—", agent.full_name || "—", date, delays.join("، ") || "—", delays.length, notes.join(" | ") || "—", number(details.speed.maxAllowedMinutes, 3), Math.round(calc.speedRate)]);
          disciplineRows.push([input.branchName || "—", agent.full_name || "—", date, daily.attendance, daily.appearance, daily.behavior, Math.round(calc.disciplineRate)]);
          valueRows.push([input.branchName || "—", agent.full_name || "—", date, daily.customerRating, daily.salesCount, Math.round(calc.valueRate)]);
        });
        efficiencyRows.push([
          input.branchName || "—", agent.full_name || "—",
          details.efficiency.personality.customerFitHonesty, details.efficiency.personality.carNotesHonesty, Math.round(calc.speedRate),
          details.efficiency.technical.currentPrices, details.efficiency.technical.oldPrices, details.efficiency.technical.carSpecs,
          details.efficiency.technical.competitorsComparison, details.efficiency.technical.salesChannels,
          Math.round(calc.personalityRate), Math.round(calc.technicalRate), Math.round(calc.efficiencyRate), Math.round(calc.efficiencyPoints),
        ]);
      });
      sheets.push(worksheet("السرعة", speedRows), worksheet("الكفاءة", efficiencyRows), worksheet("الانضباط", disciplineRows), worksheet("القيمة", valueRows));
    }

    const workbook = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/></Style><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#F8ECE5" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style></Styles>${sheets.join("")}</Workbook>`;
    downloadBrowserFile(`KPI-${full ? "FULL" : "RESULT"}-${period.from || "from"}-${period.to || "to"}.xls`, workbook, "application/vnd.ms-excel;charset=utf-8");
  }

  const reportSummary = useMemo(() => {
    const calculatedRows = reportAgents.map((agent) => resultForAgent(agent).calc);
    const average = (key: keyof ReturnType<typeof calculate>) => calculatedRows.length
      ? calculatedRows.reduce((sum, item) => sum + number(item[key]), 0) / calculatedRows.length
      : 0;
    return {
      count: reportAgents.length,
      speed: average("speedRate"),
      efficiency: average("efficiencyRate"),
      discipline: average("disciplineRate"),
      value: average("valueRate"),
      total: average("finalRate"),
    };
  }, [reportAgents, rows, period.from, period.to]);

  const branchReports = useMemo(() => {
    const grouped = new Map<string, any[]>();
    reportAgents.forEach((agent) => {
      const key = agent.branch_name || agent.branch_code || "بدون فرع";
      grouped.set(key, [...(grouped.get(key) || []), agent]);
    });
    return [...grouped.entries()].map(([branchName, branchAgents]) => {
      const details = branchAgents.map((agent) => ({ agent, ...resultForAgent(agent) }));
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
      const count = Math.max(1, branchAgents.length);
      const discipline = clamp(((total.attendance + total.appearance + total.behavior) / (count * workDays * 9)) * 100);
      const excellence = clamp((total.efficiency / (count * workDays * 3)) * 100);
      const value = clamp(((total.customer + total.sales) / (count * 80)) * 100);
      const managerRate = ((discipline + excellence) / 2 + value) / 2;
      const best = details.slice().sort((a, b) =>
        b.calc.totalPoints - a.calc.totalPoints
        || b.calc.finalRate - a.calc.finalRate
        || String(a.agent.full_name || "").localeCompare(String(b.agent.full_name || ""), "ar")
      )[0];
      return { branchName, rows: details, total, discipline, excellence, value, managerRate, managerRating: branchManagerRating(managerRate), best };
    });
  }, [reportAgents, rows, period.from, period.to]);

  const addTotalSales = visibleAgents.reduce((sum, agent) => {
    const { calc } = resultForAgent(agent);
    return sum + number(calc.salesCount);
  }, 0);

  return (
    <div className="crm-page kpi-page kpi-page-v3">
      <div className="page-top-actions">
        <button type="button" className="crm-secondary-button" disabled={loading} onClick={() => void load()}><ArrowClockwise size={18} />{loading ? "جاري التحديث..." : "تحديث"}</button>
        <button type="button" className="crm-secondary-button" disabled={loading || !reportAgents.length} onClick={() => exportVisiblePdf("result")}><FilePdf size={18} />PDF النتيجة</button>
        <button type="button" className="crm-secondary-button" disabled={loading || !reportAgents.length} onClick={() => exportVisiblePdf("all")}><FilePdf size={18} />PDF كامل</button>
        <button type="button" className="crm-secondary-button" disabled={loading || !reportAgents.length} onClick={() => exportVisibleExcel(false)}><FileXls size={18} />Excel النتيجة</button>
        <button type="button" className="crm-secondary-button" disabled={loading || !reportAgents.length} onClick={() => exportVisibleExcel(true)}><FileXls size={18} />Excel كامل</button>
      </div>

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

      {tab === "add" ? <section className="kpi-agents-section kpi-add-evaluation-wrap">
        <header className="crm-panel kpi-section-head-clean kpi-add-title">
          <div><h2>إضافة تقييم المناديب</h2><p>كل مندوب يظهر حسب فرعه، مع نفس آلية الحفظ والحسابات المعتمدة.</p></div>
          <div className="kpi-count-badges kpi-add-title-chips"><span>{visibleAgents.length} مندوب</span><span>إجمالي المبيعات {Math.round(addTotalSales)}</span></div>
        </header>
        <div className="crm-table-shell kpi-agents-table"><table className="crm-table kpi-score-table"><thead><tr><th>الفرع</th><th>المندوب</th><th>عدد المبيعات</th><th>درجة المندوب</th><th>السرعة</th><th>الكفاءة</th><th>الانضباط</th><th>القيمة</th><th>نسبة KPI</th><th>التقييم</th><th>إجراءات</th></tr></thead><tbody>
          {visibleAgents.map((agent) => { const { row: last, calc: result } = resultForAgent(agent); return <tr key={`${agent.id}-${agent.branch_code || "branch"}`}>
            <td>{agent.branch_name || (agent.branches || []).join("، ") || "—"}</td>
            <td><div className="kpi-agent-cell"><strong>{agent.full_name}</strong><small>{agent.employee_no || ""}</small></div></td>
            <td><strong className="kpi-number-emphasis">{Math.round(result.salesCount)}</strong></td>
            <td><strong className="kpi-number-emphasis">{Math.round(result.totalPoints)}</strong></td>
            {[result.speedRate,result.efficiencyRate,result.disciplineRate,result.valueRate,result.finalRate].map((score,index) => <td key={index}><span className={`kpi-rate-pill ${rateClass(score)}`}>{percent(score)}</span></td>)}
            <td><span className={`kpi-rating-pill ${rateClass(result.finalRate)}`}>{result.rating}</span></td>
            <td><button type="button" className="crm-primary-button small kpi-evaluate-button" onClick={() => open(agent, last)}>{permissions.canSave ? (last ? "تعديل التقييم" : "تقييم") : "عرض التقييم"}</button></td>
          </tr>; })}
          {!visibleAgents.length ? <tr><td colSpan={11}><div className="crm-empty-state">لا يوجد مناديب مبيعات مطابقون للفلاتر</div></td></tr> : null}
        </tbody></table></div>
      </section> : null}

      {tab === "reports" ? <div className="kpi-reports-stack">
        <section className="crm-report-summary kpi-report-summary">
          <article><UsersThree size={22} /><span>عدد المناديب</span><strong>{reportSummary.count}</strong><small>حسب الفرع والفلاتر</small></article>
          <article className={rateClass(reportSummary.speed)}><span>متوسط السرعة</span><strong>{percent(reportSummary.speed)}</strong><small>من تأخير الحضور</small></article>
          <article className={rateClass(reportSummary.efficiency)}><span>متوسط الكفاءة</span><strong>{percent(reportSummary.efficiency)}</strong><small>شخصية + فنية + سرعة</small></article>
          <article className={rateClass(reportSummary.discipline)}><span>متوسط الانضباط</span><strong>{percent(reportSummary.discipline)}</strong><small>الحضور + الهيئة + السلوك</small></article>
          <article className={rateClass(reportSummary.value)}><span>متوسط القيمة</span><strong>{percent(reportSummary.value)}</strong><small>تقييم العملاء + المبيعات</small></article>
        </section>
        <section className="crm-panel kpi-report-title-old">
          <div><h2>تقرير نتيجة مدير الفرع / كل الفروع</h2><p>تجميع درجات المناديب مثل شيت تحليل الأداء، والحسبة تستبعد أيام الجمعة.</p></div>
          <span>{period.from || "..."} إلى {period.to || "..."}</span>
        </section>
        {branchReports.map((report) => {
          const representativeTone = representativeRatingClass(report.best?.calc.finalRate || 0);
          const managerTone = branchManagerRatingClass(report.managerRate);
          const matrixRows = [
            { label: "تقييم إنضباط الحضور", key: "attendancePoints", total: report.total.attendance, ratio: report.discipline, classification: "إنضباط الفرع" },
            { label: "تقييم إنضباط الهيئة", key: "appearancePoints", total: report.total.appearance, ratio: report.discipline, classification: "إنضباط الفرع" },
            { label: "تقييم إنضباط السلوك", key: "behaviorPoints", total: report.total.behavior, ratio: report.discipline, classification: "إنضباط الفرع" },
            { label: "تقييم الكفاءة (التميز)", key: "efficiencyPoints", total: report.total.efficiency, ratio: report.excellence, classification: "تميز الفرع" },
            { label: "تقييم العملاء", key: "customerPoints", total: report.total.customer, ratio: report.value, classification: "قيمة الفرع" },
            { label: "عدد المبيعات", key: "salesCount", total: report.total.sales, ratio: report.value, classification: "قيمة الفرع" },
          ];
          return <section className="crm-panel kpi-branch-report kpi-branch-report-old" key={report.branchName}>
            <div className="kpi-report-head">
              <div><h2>تقرير نتيجة مدير الفرع / {report.branchName}</h2><p>هذا التقرير خاص بفرع {report.branchName} فقط.</p></div>
              <span className="kpi-report-count-chip">{report.rows.length} مندوب</span>
            </div>
            <div className="crm-table-shell kpi-old-branch-table"><table className="crm-table kpi-branch-matrix"><thead><tr><th>الإجمالي</th>{report.rows.map(({ agent }) => <th key={`${agent.id}-${agent.branch_code || "branch"}`}><strong className="kpi-report-agent-name">{agent.full_name}</strong></th>)}<th>البند</th><th>النسبة</th><th>التصنيف</th></tr></thead><tbody>
              {matrixRows.map((row) => <tr key={row.key}><td className="kpi-total-cell"><strong>{Math.round(number(row.total))}</strong></td>{report.rows.map(({ agent, calc }) => <td key={`${agent.id}-${agent.branch_code || "branch"}`}>{Math.round(number((calc as any)[row.key]))}</td>)}<td className="kpi-item-cell">{row.label}</td><td>{percent(row.ratio)}</td><td>{row.classification}</td></tr>)}
              <tr className="kpi-branch-total-row"><td className="kpi-total-cell"><strong>{Math.round(report.total.points)}</strong></td>{report.rows.map(({ agent, calc }) => <td key={`${agent.id}-${agent.branch_code || "branch"}`}><strong>{Math.round(calc.totalPoints)}</strong></td>)}<td className="kpi-item-cell">إجمالي درجات المناديب خلال الشهر</td><td></td><td></td></tr>
            </tbody></table></div>
            <div className="kpi-report-summary-old">
              <article className="kpi-representative-summary">
                <h3>مندوب الفرع</h3>
                <p>اسم المندوب</p><strong>{report.best?.agent?.full_name || "—"}</strong>
                <p>إجمالي النقاط</p><strong>{report.best ? Math.round(report.best.calc.totalPoints) : 0}</strong>
                <p>نسبة KPI</p><strong className={`representative-score-value ${representativeTone}`}>{report.best ? percent(report.best.calc.finalRate) : "—"}</strong>
                <p>التقييم</p><strong className={`representative-rating-value ${representativeTone}`}>{report.best?.calc.rating || "—"}</strong>
              </article>
              <article className="kpi-manager-summary">
                <h3>مدير الفرع - {report.branchName}</h3>
                <p>إنضباط الفرع</p><strong>{percent(report.discipline)}</strong>
                <p>تميز الفرع</p><strong>{percent(report.excellence)}</strong>
                <p>قيمة الفرع</p><strong>{percent(report.value)}</strong>
                <p>درجة مدير الفرع</p><strong className={`branch-manager-score-value ${managerTone}`}>{percent(report.managerRate)}</strong>
                <p>تقييمه</p><strong className={`branch-manager-rating-value ${managerTone}`}>{report.managerRating}</strong>
              </article>
            </div>
          </section>;
        })}
        {!reportAgents.length ? <div className="crm-empty-state panel">لا يوجد مناديب لديهم نتيجة KPI ضمن الفترة والفلاتر المحددة</div> : null}
      </div> : null}

      {modal ? <div className="crm-modal-backdrop kpi-fullscreen-backdrop" onMouseDown={() => setModal(false)}>
        <div className="kpi-fullscreen-dialog" onMouseDown={(event) => event.stopPropagation()}>
          <header className="kpi-fullscreen-head">
            <div><span className="crm-eyebrow">نموذج التقييم</span><h2>{agents.find((agent) => agent.id === form.userId)?.full_name || "إضافة تقييم مندوب"}</h2><p>{form.departmentName || "مبيعات"} • {form.branchName || "بدون فرع"}</p></div>
            <button type="button" className="crm-icon-button" onClick={() => setModal(false)}><X size={21} /></button>
          </header>

          <div className="kpi-fullscreen-toolbar">
            <section className="kpi-period-card">
              <label><span>المندوب</span><select disabled={!permissions.canSave} value={form.userId} onChange={(event) => { const selected = agents.find((agent) => agent.id === event.target.value); setForm((current) => ({ ...current, userId: event.target.value, branchCode: selected?.branch_code || "", branchName: selected?.branch_name || "", departmentCode: selected?.department_code || "", departmentName: selected?.department_name || "" })); }}><option value="">اختر المندوب</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}</select></label>
              <label><span>من تاريخ</span><input disabled={!permissions.canSave} type="date" value={form.periodStart} onChange={(event) => setForm((current) => ({ ...current, periodStart: event.target.value }))} /></label>
              <label><span>إلى تاريخ</span><input disabled={!permissions.canSave} type="date" value={form.periodEnd} onChange={(event) => setForm((current) => ({ ...current, periodEnd: event.target.value }))} /></label>
              <label><span>أيام العمل</span><input readOnly value={modalDays.length} /></label>
            </section>
            <div className="kpi-pdf-actions">{(["speed","efficiency","discipline","value","result","all"] as const).map((target) => <button type="button" key={target} onClick={() => printReport(form,target)}><FilePdf size={15} />{target === "all" ? "PDF كامل" : `PDF ${target === "speed" ? "السرعة" : target === "efficiency" ? "الكفاءة" : target === "discipline" ? "الانضباط" : target === "value" ? "القيمة" : "النتيجة"}`}</button>)}</div>
            <nav className="kpi-modal-tabs">{(["speed","efficiency","discipline","value","result"] as ModalTab[]).map((item) => <button type="button" key={item} className={modalTab === item ? "active" : ""} onClick={() => setModalTab(item)}>{item === "speed" ? "السرعة" : item === "efficiency" ? "الكفاءة" : item === "discipline" ? "الانضباط" : item === "value" ? "القيمة" : "النتيجة"}</button>)}</nav>
          </div>

          <div className="kpi-fullscreen-content">
            {modalTab === "speed" ? <section className="kpi-panel">{!permissions.canEditSpeed ? <div className="crm-inline-notice">هذا الجزء للعرض فقط. التعديل متاح لمستخدمي السرعة المحددين في إعدادات CRM.</div> : null}<fieldset className="kpi-permission-fieldset" disabled={!permissions.canEditSpeed}><header><div><h3>تقييم السرعة</h3><p>أدخل دقائق تأخير كل عملية بيع يوميًا. الجمعة مستبعدة من الفترة.</p></div><label><span>الحد المسموح</span><input type="number" min="0.01" step="0.1" value={form.details.speed.maxAllowedMinutes} onChange={(event) => updateDetails((draft) => { draft.speed.maxAllowedMinutes = Math.max(.01,number(event.target.value,3)); })} /></label></header>{weeks.map((week,index) => <div className="kpi-week-card" key={index}><h4>الأسبوع {index + 1}<span>من السبت إلى الخميس</span></h4><div className="kpi-daily-list">{week.map((date) => { const values = form.details.speed.dailyDelaySales[date] || [""]; const notes = form.details.speed.dailyDelayNotes[date] || []; return <article className="kpi-day-card" key={date}><header><CalendarBlank size={17} /><strong>{arabicDate(date)}</strong><button type="button" onClick={() => updateDetails((draft) => { draft.speed.dailyDelaySales[date] = [...(draft.speed.dailyDelaySales[date] || [""]),""]; draft.speed.dailyDelayNotes[date] = [...(draft.speed.dailyDelayNotes[date] || []),""]; })}><Plus size={14} />إضافة</button></header><div className="kpi-delay-list">{values.map((value,index) => <div className={Math.max(0,number(value)) > 0 ? "has-note" : ""} key={`${date}-${index}`}><input type="number" min="0" step="0.1" value={value} placeholder="دقائق التأخير" onChange={(event) => updateDetails((draft) => { const list=[...(draft.speed.dailyDelaySales[date] || [""])]; list[index]=event.target.value; draft.speed.dailyDelaySales[date]=list; })} />{Math.max(0,number(value)) > 0 ? <input type="text" value={notes[index] || ""} placeholder="ملاحظة التأخير" onChange={(event) => updateDetails((draft) => { const list=[...(draft.speed.dailyDelayNotes[date] || [])]; while (list.length <= index) list.push(""); list[index]=event.target.value; draft.speed.dailyDelayNotes[date]=list; })} /> : null}<button type="button" title="حذف" onClick={() => updateDetails((draft) => { const list=[...(draft.speed.dailyDelaySales[date] || [""])]; const noteList=[...(draft.speed.dailyDelayNotes[date] || [])]; list.splice(index,1); noteList.splice(index,1); draft.speed.dailyDelaySales[date]=list.length?list:[""]; draft.speed.dailyDelayNotes[date]=noteList; })}><Minus size={14} /></button></div>)}</div></article>; })}</div></div>)}<div className="kpi-modal-stats six"><span><small>إجمالي دقائق التأخير</small><b>{Math.round(calculated.totalDelay)} دقيقة</b></span><span><small>عدد الطلبات</small><b>{Object.values(form.details.speed.dailyDelaySales || {}).flat().filter((value) => String(value ?? "").trim() !== "").length}</b></span><span><small>متوسط عدد دقائق التأخير</small><b>{Math.round(calculated.averageDelay)} دقيقة</b></span><span><small>أقصى دقائق مسموح بها</small><b>{form.details.speed.maxAllowedMinutes} دقائق</b></span><span className={rateClass(100 - calculated.speedRate)}><small>نسبة التأخير خلال الشهر</small><b>{percent(100 - calculated.speedRate)}</b></span><span className={rateClass(calculated.speedRate)}><small>نسبة سرعة المندوب خلال الشهر</small><b>{percent(calculated.speedRate)}</b></span></div></fieldset></section> : null}
            {modalTab === "efficiency" ? <section className="kpi-panel">{!permissions.canEditEfficiency ? <div className="crm-inline-notice">هذا الجزء للعرض فقط. التعديل متاح لمستخدمي الكفاءة المحددين في إعدادات CRM.</div> : null}<fieldset className="kpi-permission-fieldset" disabled={!permissions.canEditEfficiency}><h3>الكفاءة</h3><div className="kpi-two-cols"><article className="kpi-sub-card"><h4>الشخصية</h4><label><span>المصداقية</span><input type="number" min="0" max="100" value={form.details.efficiency.personality.customerFitHonesty} onChange={(event) => updateDetails((draft) => { draft.efficiency.personality.customerFitHonesty=clamp(event.target.value); })} /></label><label><span>المعرفة التفصيلية بالمخزون</span><input type="number" min="0" max="100" value={form.details.efficiency.personality.carNotesHonesty} onChange={(event) => updateDetails((draft) => { draft.efficiency.personality.carNotesHonesty=clamp(event.target.value); })} /></label><div className={`kpi-readonly-box ${rateClass(calculated.speedRate)}`}><small>نتيجة السرعة</small><strong>{percent(calculated.speedRate)}</strong></div></article><article className="kpi-sub-card"><h4>الفنية</h4>{([ ["currentPrices","حفظ الأسعار الحالية"],["oldPrices","حفظ الأسعار السابقة"],["carSpecs","المعرفة التفصيلية بمواصفات السيارة"],["competitorsComparison","معرفة فروق السيارة مع البراندات الأخرى"],["salesChannels","معرفة طرق وقنوات البيع كاش أو أقساط"] ] as const).map(([key,label]) => <label key={key}><span>{label}</span><input type="number" min="0" max="100" value={form.details.efficiency.technical[key]} onChange={(event) => updateDetails((draft) => { draft.efficiency.technical[key]=clamp(event.target.value); })} /></label>)}</article></div><div className="kpi-modal-stats four"><span className={rateClass(calculated.personalityRate)}><small>متوسط الكفاءة الشخصية</small><b>{percent(calculated.personalityRate)}</b></span><span className={rateClass(calculated.technicalRate)}><small>متوسط الكفاءة الفنية</small><b>{percent(calculated.technicalRate)}</b></span><span className={rateClass(calculated.efficiencyRate)}><small>متوسط الكفاءة</small><b>{percent(calculated.efficiencyRate)}</b></span><span><small>تحويل الكفاءة إلى عدد نقاط</small><b>{Math.round(calculated.efficiencyPoints)}</b></span></div><div className="kpi-level-table"><h4>تقييم مستوى كفاءة المندوب</h4><table><tbody><tr><th>البند</th><th>أقل من 60% ضعيف</th><th>من 60% : 74% متوسط</th><th>من 75% : 89% جيد</th><th>من 90% : 100% ممتاز</th></tr><tr><td>الدرجة</td><td>0</td><td>1</td><td>2</td><td>3</td></tr><tr><td>درجة مستوى كفاءة المندوب خلال الشهر</td><td>{calculated.efficiencyRate < 60 ? Math.round(calculated.efficiencyPoints) : 0}</td><td>{calculated.efficiencyRate >= 60 && calculated.efficiencyRate < 75 ? Math.round(calculated.efficiencyPoints) : 0}</td><td>{calculated.efficiencyRate >= 75 && calculated.efficiencyRate < 90 ? Math.round(calculated.efficiencyPoints) : 0}</td><td>{calculated.efficiencyRate >= 90 ? Math.round(calculated.efficiencyPoints) : 0}</td></tr></tbody></table></div></fieldset></section> : null}
            {modalTab === "discipline" ? <section className="kpi-panel">{!permissions.canEditBase ? <div className="crm-inline-notice">الانضباط للعرض فقط ويحتاج صلاحية إدارة تقييمات KPI.</div> : null}<fieldset className="kpi-permission-fieldset" disabled={!permissions.canEditBase}><h3>الانضباط اليومي</h3>{weeks.map((week,index) => <div className="kpi-week-card" key={index}><h4>الأسبوع {index + 1}</h4><div className="kpi-daily-list">{week.map((date) => { const row=performanceFor(date); return <article className="kpi-day-card" key={date}><header><CalendarBlank size={17}/><strong>{arabicDate(date)}</strong></header><div className="kpi-week-grid"><label><span>الحضور / 3</span><input type="number" min="0" max="3" value={row.attendance} onChange={(event)=>setPerformance(date,"attendance",event.target.value)}/></label><label><span>الهيئة / 3</span><input type="number" min="0" max="3" value={row.appearance} onChange={(event)=>setPerformance(date,"appearance",event.target.value)}/></label><label><span>السلوك / 3</span><input type="number" min="0" max="3" value={row.behavior} onChange={(event)=>setPerformance(date,"behavior",event.target.value)}/></label></div></article>; })}</div></div>)}<div className="kpi-modal-stats four"><span><small>إجمالي نقاط الحضور</small><b>{Math.round(calculated.attendancePoints)}</b></span><span><small>إجمالي نقاط الهيئة</small><b>{Math.round(calculated.appearancePoints)}</b></span><span><small>إجمالي نقاط السلوك</small><b>{Math.round(calculated.behaviorPoints)}</b></span><span className={rateClass(calculated.disciplineRate)}><small>نسبة الانضباط</small><b>{percent(calculated.disciplineRate)}</b></span></div></fieldset></section> : null}
            {modalTab === "value" ? <section className="kpi-panel">{!permissions.canEditBase ? <div className="crm-inline-notice">القيمة للعرض فقط وتحتاج صلاحية إدارة تقييمات KPI.</div> : null}<fieldset className="kpi-permission-fieldset" disabled={!permissions.canEditBase}><h3>القيمة اليومية</h3>{weeks.map((week,index) => <div className="kpi-week-card" key={index}><h4>الأسبوع {index + 1}</h4><div className="kpi-daily-list">{week.map((date) => { const row=performanceFor(date); return <article className="kpi-day-card" key={date}><header><CalendarBlank size={17}/><strong>{arabicDate(date)}</strong></header><div className="kpi-week-grid two"><label><span>تقييم العملاء / 3</span><input type="number" min="0" max="3" value={row.customerRating} onChange={(event)=>setPerformance(date,"customerRating",event.target.value)}/></label><label><span>عدد المبيعات</span><input type="number" min="0" value={row.salesCount} onChange={(event)=>setPerformance(date,"salesCount",event.target.value)}/></label></div></article>; })}</div></div>)}<div className="kpi-modal-stats three"><span><small>إجمالي نقاط تقييم العملاء</small><b>{Math.round(calculated.customerPoints)}</b></span><span><small>إجمالي عدد المبيعات</small><b>{Math.round(calculated.salesCount)}</b></span><span className={rateClass(calculated.valueRate)}><small>نسبة القيمة</small><b>{percent(calculated.valueRate)}</b></span></div></fieldset></section> : null}
            {modalTab === "result" ? <section className="kpi-panel"><h3>النتيجة المحسوبة</h3><div className="kpi-modal-stats four"><span className={rateClass(calculated.speedRate)}><small>نسبة السرعة</small><b>{percent(calculated.speedRate)}</b></span><span className={rateClass(calculated.efficiencyRate)}><small>نسبة الكفاءة</small><b>{percent(calculated.efficiencyRate)}</b></span><span className={rateClass(calculated.disciplineRate)}><small>نسبة الانضباط</small><b>{percent(calculated.disciplineRate)}</b></span><span className={rateClass(calculated.valueRate)}><small>نسبة القيمة</small><b>{percent(calculated.valueRate)}</b></span><span className={rateClass(calculated.finalRate)}><small>نسبة KPI</small><b>{percent(calculated.finalRate)}</b></span><span><small>إجمالي النقاط</small><b>{Math.round(calculated.totalPoints)}</b></span><span className={rateClass(calculated.finalRate)}><small>التقييم</small><b>{calculated.rating}</b></span></div><div className="kpi-result-table old-result-table"><h4>نتيجة المندوب في تحليل الأداء</h4><table><thead><tr><th>البند</th><th>الدرجة</th></tr></thead><tbody>{[["تقييم إنضباط الحضور",calculated.attendancePoints],["تقييم إنضباط الهيئة",calculated.appearancePoints],["تقييم إنضباط السلوك",calculated.behaviorPoints],["تقييم الكفاءة (التميز)",calculated.efficiencyPoints],["تقييم العملاء",calculated.customerPoints],["عدد المبيعات",calculated.salesCount]].map(([label,value]) => <tr key={String(label)}><td>{label}</td><td>{Math.round(number(value))}</td></tr>)}<tr className="dark"><td>إجمالي درجات المناديب خلال الشهر</td><td>{Math.round(calculated.totalPoints)}</td></tr></tbody></table></div><label className="kpi-notes"><span>ملاحظات التقييم</span><textarea disabled={!permissions.canEditBase} rows={5} value={form.notes} onChange={(event)=>setForm((current)=>({...current,notes:event.target.value}))}/></label></section> : null}
            {!modalDays.length && modalTab !== "efficiency" && modalTab !== "result" ? <div className="crm-empty-state panel">حدد فترة تقييم صحيحة أولًا.</div> : null}
          </div>

          <div className="kpi-fullscreen-actions"><button type="button" className="crm-secondary-button" onClick={() => setModal(false)}>إلغاء</button><button type="button" className="crm-primary-button" disabled={saving || !permissions.canSave || !form.userId || !form.periodStart || !form.periodEnd} onClick={() => void save()}><FloppyDisk size={18}/>{saving ? "جاري الحفظ..." : permissions.canEditBase && permissions.canEditSpeed && permissions.canEditEfficiency ? "حفظ تقييم الشهر" : "حفظ الأجزاء المصرح بها"}</button></div>
        </div>
      </div> : null}
    </div>
  );
}
