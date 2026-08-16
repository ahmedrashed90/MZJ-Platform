import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, isCrmManager, parseBody, requireCrmUser, userScope } from "../_crm-utils.js";
import { getSql } from "../_db.js";
import { hasPermission } from "../_access-control.js";

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: unknown, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, number(value)));
}

function rating(total: number) {
  if (total >= 100) return "ممتاز";
  if (total >= 90) return "جيد جداً";
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
  branchCode?: string;
  branchName?: string;
  departmentCode?: string;
  departmentName?: string;
  speed?: {
    maxAllowedMinutes?: unknown;
    dailyDelaySales?: Record<string, unknown[] | unknown>;
    dailyDelayNotes?: Record<string, string[]>;
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

function businessDays(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 1;
  let count = 0;
  for (const current = new Date(start); current <= end && count < 370; current.setUTCDate(current.getUTCDate() + 1)) {
    if (current.getUTCDay() !== 5) count += 1;
  }
  return Math.max(1, count);
}

function calculate(detailsInput: KpiDetails, workDaysInput: number) {
  const details = detailsInput || {};
  const workDays = Math.max(1, Math.floor(workDaysInput));
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
  const speedRate = delayValues.length ? clamp(100 - delayRate) : 0;

  const personality = details.efficiency?.personality || {};
  const technical = details.efficiency?.technical || {};
  const personalityRate = (clamp(personality.customerFitHonesty) + clamp(personality.carNotesHonesty) + speedRate) / 3;
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

async function resolveKpiAccess(sql: ReturnType<typeof getSql>, user: any) {
  const rows = await sql<{ section_code: string; configured_count: number; current_user_allowed: boolean }[]>`
    select section_code,count(*)::int as configured_count,bool_or(user_id=${user.id}::uuid) as current_user_allowed
    from crm.kpi_section_permissions p
    join core.users allowed_user on allowed_user.id=p.user_id and allowed_user.is_active=true
    where p.section_code in ('speed','efficiency')
    group by p.section_code
  `;
  const manager = isCrmManager(user);
  const speed = rows.find((row) => row.section_code === "speed");
  const efficiency = rows.find((row) => row.section_code === "efficiency");
  const canEditSpeed = Number(speed?.configured_count || 0) > 0 ? speed?.current_user_allowed === true : manager;
  const canEditEfficiency = Number(efficiency?.configured_count || 0) > 0 ? efficiency?.current_user_allowed === true : manager;
  const canEditBase = manager;
  return {
    canEditSpeed,
    canEditEfficiency,
    canEditBase,
    canSave: canEditSpeed || canEditEfficiency || canEditBase,
    speedConfigured: Number(speed?.configured_count || 0) > 0,
    efficiencyConfigured: Number(efficiency?.configured_count || 0) > 0,
  };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const sql = getSql();
  const scope = userScope(user);
  const permissions = await resolveKpiAccess(sql, user);
  const kpiScopeAll = scope.all || hasPermission(user, "crm.kpi.rate_all");
  // Sales-department lateral selection is equivalent to requiring primary_department.code in ('cash_sales','finance_sales'), while still finding a valid sales department when another CRM department is marked primary.

  if (request.method === "GET") {
    const from = clean(request.query.from);
    const to = clean(request.query.to);
    const agent = clean(request.query.agent);
    const branch = clean(request.query.branch);

    const rows = await sql<any[]>`
      select
        e.*,
        e.id::text,
        e.user_id::text,
        u.full_name,
        u.employee_no,
        primary_branch.code as branch_code,
        primary_branch.name as branch_name,
        primary_department.code as department_code,
        primary_department.name as department_name
      from crm.kpi_evaluations e
      join core.users u on u.id=e.user_id and u.is_active=true
      join lateral (
        select d.code,d.name
        from core.user_system_departments usd
        join core.departments d on d.id=usd.department_id and d.system_code='crm' and d.is_active=true
        where usd.user_id=u.id and usd.system_code='crm'
          and d.code in ('cash_sales','finance_sales')
        order by usd.is_primary desc,d.created_at,d.code
        limit 1
      ) primary_department on true
      join lateral (
        select b.code,b.name,b.sort_order
        from core.user_system_branches usb
        join core.branches b on b.id=usb.branch_id and b.is_active=true
        where usb.user_id=u.id and usb.system_code='crm'
        order by usb.is_primary desc,b.sort_order,b.name
        limit 1
      ) primary_branch on true
      where (${from || null}::date is null or e.period_end >= ${from || null}::date)
        and (${to || null}::date is null or e.period_start <= ${to || null}::date)
        and (${agent || null}::uuid is null or e.user_id=${agent || null}::uuid)
        and (${branch || null}::text is null or primary_branch.code=${branch || null})
        and (
          u.can_receive_leads=true
          or exists (
            select 1 from core.user_systems us join core.roles r on r.id=us.role_id
            where us.user_id=u.id and us.system_code='crm' and us.is_enabled=true and r.code='sales_user'
          )
          or exists (
            select 1 from core.user_roles ur join core.roles r on r.id=ur.role_id
            where ur.user_id=u.id and r.code='sales_user'
          )
        )
        and (${kpiScopeAll}::boolean or primary_department.code=any(${scope.departmentCodes}::text[]))
        and (${kpiScopeAll}::boolean or ${scope.branchCodes.length === 0}::boolean or primary_branch.code=any(${scope.branchCodes}::text[]))
      order by e.period_start desc,u.full_name
    `;

    const agents = await sql<any[]>`
      select
        u.id::text,
        u.full_name,
        u.employee_no,
        primary_department.code as department_code,
        primary_department.name as department_name,
        primary_branch.code as branch_code,
        primary_branch.name as branch_name,
        array[primary_department.name]::text[] as departments,
        array[primary_branch.name]::text[] as branches,
        array[primary_branch.code]::text[] as branch_codes
      from core.users u
      join lateral (
        select d.code,d.name
        from core.user_system_departments usd
        join core.departments d on d.id=usd.department_id and d.system_code='crm' and d.is_active=true
        where usd.user_id=u.id and usd.system_code='crm'
          and d.code in ('cash_sales','finance_sales')
        order by usd.is_primary desc,d.created_at,d.code
        limit 1
      ) primary_department on true
      join lateral (
        select b.code,b.name,b.sort_order
        from core.user_system_branches usb
        join core.branches b on b.id=usb.branch_id and b.is_active=true
        where usb.user_id=u.id and usb.system_code='crm'
        order by usb.is_primary desc,b.sort_order,b.name
        limit 1
      ) primary_branch on true
      where u.is_active=true
        and (
          u.can_receive_leads=true
          or exists (
            select 1 from core.user_systems us join core.roles r on r.id=us.role_id
            where us.user_id=u.id and us.system_code='crm' and us.is_enabled=true and r.code='sales_user'
          )
          or exists (
            select 1 from core.user_roles ur join core.roles r on r.id=ur.role_id
            where ur.user_id=u.id and r.code='sales_user'
          )
        )
        and (${kpiScopeAll}::boolean or primary_department.code=any(${scope.departmentCodes}::text[]))
        and (${kpiScopeAll}::boolean or ${scope.branchCodes.length === 0}::boolean or primary_branch.code=any(${scope.branchCodes}::text[]))
      order by primary_branch.sort_order,u.full_name
    `;

    return response.status(200).json({ ok: true, rows, agents, permissions });
  }

  if (request.method === "POST" || request.method === "PUT") {
    if (!permissions.canSave) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لتعديل أي جزء من تقييم KPI" });
    const body = parseBody(request);
    const userId = clean(body.userId);
    const periodStart = clean(body.periodStart);
    const periodEnd = clean(body.periodEnd);
    if (!userId || !periodStart || !periodEnd) return response.status(400).json({ ok: false, error: "اختر المندوب والفترة" });
    if (periodEnd < periodStart) return response.status(400).json({ ok: false, error: "تاريخ النهاية يجب أن يكون بعد تاريخ البداية" });

    const [agent] = await sql<any[]>`
      select u.id::text,u.full_name,u.employee_no,
        primary_department.code as department_code,primary_department.name as department_name,
        primary_branch.code as branch_code,primary_branch.name as branch_name
      from core.users u
      join lateral (
        select d.code,d.name
        from core.user_system_departments usd
        join core.departments d on d.id=usd.department_id and d.system_code='crm' and d.is_active=true
        where usd.user_id=u.id and usd.system_code='crm'
          and d.code in ('cash_sales','finance_sales')
        order by usd.is_primary desc,d.created_at,d.code
        limit 1
      ) primary_department on true
      join lateral (
        select b.code,b.name
        from core.user_system_branches usb
        join core.branches b on b.id=usb.branch_id and b.is_active=true
        where usb.user_id=u.id and usb.system_code='crm'
        order by usb.is_primary desc,b.sort_order,b.name
        limit 1
      ) primary_branch on true
      where u.id=${userId}::uuid and u.is_active=true
        and (
          u.can_receive_leads=true
          or exists (
            select 1 from core.user_systems us join core.roles r on r.id=us.role_id
            where us.user_id=u.id and us.system_code='crm' and us.is_enabled=true and r.code='sales_user'
          )
          or exists (
            select 1 from core.user_roles ur join core.roles r on r.id=ur.role_id
            where ur.user_id=u.id and r.code='sales_user'
          )
        )
        and (${kpiScopeAll}::boolean or primary_department.code=any(${scope.departmentCodes}::text[]))
        and (${kpiScopeAll}::boolean or ${scope.branchCodes.length === 0}::boolean or primary_branch.code=any(${scope.branchCodes}::text[]))
    `;
    if (!agent) return response.status(404).json({ ok: false, error: "المندوب غير موجود أو خارج صلاحيتك" });

    const [existing] = await sql<any[]>`
      select *,id::text,user_id::text
      from crm.kpi_evaluations
      where user_id=${userId}::uuid and period_start=${periodStart}::date and period_end=${periodEnd}::date
    `;
    const incomingDetails = body.details && typeof body.details === "object" ? body.details as KpiDetails : {};
    const existingDetails = existing?.details && typeof existing.details === "object" ? existing.details as KpiDetails : {};
    const details: KpiDetails = {
      ...existingDetails,
      workDays: businessDays(periodStart, periodEnd),
      branchCode: clean(body.branchCode || incomingDetails.branchCode || existingDetails.branchCode || agent.branch_code),
      branchName: clean(body.branchName || incomingDetails.branchName || existingDetails.branchName || agent.branch_name),
      departmentCode: clean(body.departmentCode || incomingDetails.departmentCode || existingDetails.departmentCode || agent.department_code),
      departmentName: clean(body.departmentName || incomingDetails.departmentName || existingDetails.departmentName || agent.department_name),
      speed: permissions.canEditSpeed ? (incomingDetails.speed || existingDetails.speed || {}) : (existingDetails.speed || {}),
      efficiency: permissions.canEditEfficiency ? (incomingDetails.efficiency || existingDetails.efficiency || {}) : (existingDetails.efficiency || {}),
      dailyPerformance: permissions.canEditBase ? (incomingDetails.dailyPerformance || {}) : (existingDetails.dailyPerformance || {}),
    };
    const calculated = calculate(details, businessDays(periodStart, periodEnd));
    const notes = permissions.canEditBase ? (clean(body.notes) || null) : (existing?.notes || null);

    const [row] = await sql<any[]>`
      insert into crm.kpi_evaluations(user_id,period_start,period_end,total_sales,speed_score,efficiency_score,discipline_score,value_score,total_score,rating,details,notes,evaluated_by)
      values (
        ${userId}::uuid,${periodStart}::date,${periodEnd}::date,${Math.round(calculated.salesCount)},
        ${calculated.speedRate},${calculated.efficiencyRate},${calculated.disciplineRate},${calculated.valueRate},${calculated.finalRate},${calculated.rating},
        ${sql.json(calculated.details as any)},${notes},${user.id}::uuid
      )
      on conflict (user_id,period_start,period_end) do update set
        total_sales=excluded.total_sales,
        speed_score=excluded.speed_score,
        efficiency_score=excluded.efficiency_score,
        discipline_score=excluded.discipline_score,
        value_score=excluded.value_score,
        total_score=excluded.total_score,
        rating=excluded.rating,
        details=excluded.details,
        notes=excluded.notes,
        evaluated_by=excluded.evaluated_by,
        updated_at=now()
      returning *,id::text,user_id::text
    `;
    await audit(user, "kpi_evaluation_saved", "kpi_evaluation", row.id, row);
    return response.status(200).json({ ok: true, row, calculated });
  }

  return response.status(405).json({ ok: false, error: "Method not allowed" });
}
