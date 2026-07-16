import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, isCrmManager, parseBody, requireCrmUser } from "../_crm-utils.js";
import { getSql } from "../_db.js";

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: unknown, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, number(value)));
}

function rating(total: number) {
  if (total >= 100) return "ممتاز";
  if (total >= 90) return "جيد جدًا";
  if (total >= 80) return "جيد";
  if (total >= 60) return "مقبول";
  if (total >= 50) return "ضعيف";
  return "غير مناسب";
}

type DailyPerformance = Record<string, {
  attendance?: unknown;
  appearance?: unknown;
  behavior?: unknown;
  customerRating?: unknown;
  salesCount?: unknown;
}>;

type KpiDetails = {
  workDays?: unknown;
  speed?: {
    maxAllowedMinutes?: unknown;
    dailyDelaySales?: Record<string, unknown[] | unknown>;
    dailyDelays?: Record<string, unknown>;
    delayEnteredDates?: string[];
  };
  efficiency?: {
    personality?: { customerFitHonesty?: unknown; carNotesHonesty?: unknown };
    technical?: {
      currentPrices?: unknown;
      oldPrices?: unknown;
      carSpecs?: unknown;
      competitorsComparison?: unknown;
      salesChannels?: unknown;
    };
  };
  dailyPerformance?: DailyPerformance;
  finalKpi?: Record<string, unknown>;
};

function calculate(detailsInput: KpiDetails, fallbackWorkDays = 1) {
  const details = detailsInput || {};
  const workDays = Math.max(1, Math.floor(number(details.workDays, fallbackWorkDays)));
  const maximumAllowed = Math.max(0.01, number(details.speed?.maxAllowedMinutes, 3));
  const dailyDelaySales = details.speed?.dailyDelaySales || {};
  const delayValues: number[] = [];
  Object.values(dailyDelaySales).forEach((entry) => {
    const entries = Array.isArray(entry) ? entry : [entry];
    entries.forEach((value) => {
      if (String(value ?? "").trim() !== "") delayValues.push(Math.max(0, number(value)));
    });
  });
  const totalDelay = delayValues.reduce((sum, value) => sum + value, 0);
  const averageDelay = delayValues.length ? totalDelay / delayValues.length : 0;
  const delayRate = delayValues.length ? clamp((averageDelay / maximumAllowed) * 100) : 0;
  const speedRate = delayValues.length ? clamp(100 - delayRate) : 100;

  const personality = details.efficiency?.personality || {};
  const technical = details.efficiency?.technical || {};
  const personalityRate = (
    clamp(personality.customerFitHonesty) +
    clamp(personality.carNotesHonesty) +
    speedRate
  ) / 3;
  const technicalRate = (
    clamp(technical.currentPrices) +
    clamp(technical.oldPrices) +
    clamp(technical.carSpecs) +
    clamp(technical.competitorsComparison) +
    clamp(technical.salesChannels)
  ) / 5;
  const efficiencyRate = (personalityRate + technicalRate) / 2;
  const efficiencyPoints = (efficiencyRate >= 90 ? 3 : efficiencyRate >= 75 ? 2 : efficiencyRate >= 60 ? 1 : 0) * workDays;

  const performance = details.dailyPerformance || {};
  const days = Object.values(performance);
  const attendancePoints = days.reduce((sum, row) => sum + clamp(row?.attendance, 0, 3), 0);
  const appearancePoints = days.reduce((sum, row) => sum + clamp(row?.appearance, 0, 3), 0);
  const behaviorPoints = days.reduce((sum, row) => sum + clamp(row?.behavior, 0, 3), 0);
  const customerPoints = days.reduce((sum, row) => sum + clamp(row?.customerRating, 0, 3), 0);
  const salesCount = days.reduce((sum, row) => sum + Math.max(0, number(row?.salesCount)), 0);
  const disciplineRate = clamp(((attendancePoints + appearancePoints + behaviorPoints) / Math.max(1, workDays * 9)) * 100);
  const valueRate = clamp(((customerPoints + salesCount) / 80) * 100);
  const finalRate = ((efficiencyRate + disciplineRate) / 2 + valueRate) / 2;
  const totalPoints = attendancePoints + appearancePoints + behaviorPoints + efficiencyPoints + customerPoints + salesCount;

  const dailyDelays: Record<string, number> = {};
  Object.entries(dailyDelaySales).forEach(([key, entry]) => {
    const entries = Array.isArray(entry) ? entry : [entry];
    dailyDelays[key] = entries.reduce<number>((sum, value) => sum + Math.max(0, number(value)), 0);
  });
  const delayEnteredDates = Object.keys(dailyDelaySales).filter((key) => {
    const entry = dailyDelaySales[key];
    return (Array.isArray(entry) ? entry : [entry]).some((value) => String(value ?? "").trim() !== "");
  });

  const normalizedDetails: KpiDetails = {
    ...details,
    workDays,
    speed: {
      ...(details.speed || {}),
      maxAllowedMinutes: maximumAllowed,
      dailyDelaySales,
      dailyDelays,
      delayEnteredDates,
    },
    dailyPerformance: performance,
    finalKpi: {
      ...(details.finalKpi || {}),
      rate: Math.round(finalRate),
      levelText: rating(finalRate),
      speedRate: Math.round(speedRate),
      efficiencyRate: Math.round(efficiencyRate),
      disciplineRate: Math.round(disciplineRate),
      valueRate: Math.round(valueRate),
      repTotalScore: Math.round(totalPoints),
      salesCount,
      attendanceScore: attendancePoints,
      appearanceScore: appearancePoints,
      behaviorScore: behaviorPoints,
      customerScore: customerPoints,
      totalDelay,
      averageDelay,
    },
  };

  return {
    details: normalizedDetails,
    workDays,
    totalDelay,
    averageDelay,
    speedRate,
    personalityRate,
    technicalRate,
    efficiencyRate,
    efficiencyPoints,
    attendancePoints,
    appearancePoints,
    behaviorPoints,
    customerPoints,
    salesCount,
    disciplineRate,
    valueRate,
    finalRate,
    totalPoints,
    rating: rating(finalRate),
  };
}

function inclusiveDays(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 1;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const sql = getSql();

  if (request.method === "GET") {
    const from = clean(request.query.from);
    const to = clean(request.query.to);
    const agent = clean(request.query.agent);
    const branch = clean(request.query.branch);
    const rows = await sql<any[]>`
      select e.*,e.id::text,e.user_id::text,u.full_name,u.employee_no,
        coalesce((select array_agg(distinct d.name order by d.name) from core.user_departments ud join core.departments d on d.id=ud.department_id where ud.user_id=u.id),'{}') as departments,
        coalesce((select array_agg(distinct b.name order by b.name) from core.user_branches ub join core.branches b on b.id=ub.branch_id where ub.user_id=u.id),'{}') as branches,
        coalesce((select count(*)::int from crm.leads l where l.assigned_to=u.id and l.status_label in ('تم البيع','تم الإنتهاء - إنشاء طلب البيع','تم الانتهاء - إنشاء طلب البيع') and l.is_deleted=false and l.updated_at::date between e.period_start and e.period_end),0) as calculated_sales
      from crm.kpi_evaluations e join core.users u on u.id=e.user_id
      where (${from || null}::date is null or e.period_end >= ${from || null}::date)
        and (${to || null}::date is null or e.period_start <= ${to || null}::date)
        and (${agent || null}::uuid is null or e.user_id=${agent || null}::uuid)
        and (${branch || null}::text is null or exists (
          select 1 from core.user_branches ub join core.branches b on b.id=ub.branch_id
          where ub.user_id=u.id and b.code=${branch || null}
        ))
      order by e.period_start desc,u.full_name
    `;
    const agents = await sql<any[]>`
      select distinct u.id::text,u.full_name,u.employee_no,
        coalesce(array_agg(distinct d.name) filter (where d.name is not null),'{}') as departments,
        coalesce(array_agg(distinct b.name) filter (where b.name is not null),'{}') as branches,
        coalesce(array_agg(distinct b.code) filter (where b.code is not null),'{}') as branch_codes
      from core.users u
      join core.user_departments ud on ud.user_id=u.id
      join core.departments d on d.id=ud.department_id and d.code in ('cash_sales','finance_sales','customer_service','call_center')
      left join core.user_branches ub on ub.user_id=u.id
      left join core.branches b on b.id=ub.branch_id
      where u.is_active=true
      group by u.id order by u.full_name
    `;
    return response.status(200).json({ ok: true, rows, agents });
  }

  if (request.method === "POST" || request.method === "PUT") {
    if (!isCrmManager(user)) return response.status(403).json({ ok: false, error: "إضافة التقييم متاحة للإدارة فقط" });
    const body = parseBody(request);
    const userId = clean(body.userId);
    const periodStart = clean(body.periodStart);
    const periodEnd = clean(body.periodEnd);
    if (!userId || !periodStart || !periodEnd) return response.status(400).json({ ok: false, error: "اختر المندوب والفترة" });
    if (periodEnd < periodStart) return response.status(400).json({ ok: false, error: "تاريخ النهاية يجب أن يكون بعد تاريخ البداية" });

    const details = body.details && typeof body.details === "object" ? body.details as KpiDetails : {};
    const calculated = calculate(details, inclusiveDays(periodStart, periodEnd));
    const [row] = await sql<any[]>`
      insert into crm.kpi_evaluations(user_id,period_start,period_end,total_sales,speed_score,efficiency_score,discipline_score,value_score,total_score,rating,details,notes,evaluated_by)
      values (
        ${userId}::uuid,${periodStart}::date,${periodEnd}::date,${Math.round(calculated.salesCount)},
        ${calculated.speedRate},${calculated.efficiencyRate},${calculated.disciplineRate},${calculated.valueRate},${calculated.finalRate},${calculated.rating},
        ${sql.json(calculated.details as any)},${clean(body.notes)||null},${user.id}::uuid
      )
      on conflict (user_id,period_start,period_end) do update set
        total_sales=excluded.total_sales,speed_score=excluded.speed_score,efficiency_score=excluded.efficiency_score,
        discipline_score=excluded.discipline_score,value_score=excluded.value_score,total_score=excluded.total_score,rating=excluded.rating,
        details=excluded.details,notes=excluded.notes,evaluated_by=excluded.evaluated_by,updated_at=now()
      returning *,id::text,user_id::text
    `;
    await audit(user, "kpi_evaluation_saved", "kpi_evaluation", row.id, row);
    return response.status(200).json({ ok: true, row, calculated });
  }
  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
