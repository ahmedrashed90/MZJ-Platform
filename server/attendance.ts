import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin, requireUser } from "./_auth.js";
import { getSql } from "./_db.js";
import { ensureAttendanceSchema } from "./_attendance-schema.js";
import { AttendanceError, ATTENDANCE_TIME_ZONE, checkInCurrentAttendance, formatMinutes, getSelfAttendanceState, isAttendanceEnforcementEnabled } from "./_attendance.js";
import { adminDeviceSnapshot, approveUserDevice, getUserDeviceAttendanceRole, revokeUserDevice, setPrimaryUserDevice, setUserDevicePolicy } from "./_device-agent.js";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function bodyObject(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, any>;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body || "{}"); } catch { return {}; }
  }
  return {};
}

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizePeriodOverrides(value: unknown): Record<string, { startTime: string; endTime: string }> {
  let source = value;
  if (typeof source === "string") {
    try { source = JSON.parse(source); } catch { return {}; }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const result: Record<string, { startTime: string; endTime: string }> = {};
  for (const [periodId, raw] of Object.entries(source as Record<string, unknown>)) {
    if (!validUuid(periodId) || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const startTime = clean(item.startTime ?? item.start_time).slice(0, 5);
    const endTime = clean(item.endTime ?? item.end_time).slice(0, 5);
    if (validTime(startTime) && validTime(endTime)) result[periodId] = { startTime, endTime };
  }
  return result;
}

function periodOverridesEqual(left: unknown, right: unknown) {
  const normalize = (value: unknown) => Object.fromEntries(
    Object.entries(normalizePeriodOverrides(value)).sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function resolveAssignedPeriodTimes(period: any, override?: { startTime: string; endTime: string } | null) {
  const baseStartTime = clean(period?.start_time ?? period?.startTime).slice(0, 5);
  const baseEndTime = clean(period?.end_time ?? period?.endTime).slice(0, 5);
  if (!validTime(baseStartTime) || !validTime(baseEndTime)) {
    return { startTime: baseStartTime, endTime: baseEndTime };
  }

  const requestedStart = validTime(clean(override?.startTime).slice(0, 5)) ? clean(override?.startTime).slice(0, 5) : baseStartTime;
  const requestedEnd = validTime(clean(override?.endTime).slice(0, 5)) ? clean(override?.endTime).slice(0, 5) : baseEndTime;
  const periodName = clean(period?.name);

  // "فترة واحدة" هي فترة مرنة لكل يوزر؛ الوقت المحفوظ في التعيين هو المصدر الفعلي للدوام.
  if (periodName.includes("فترة واحدة")) {
    return { startTime: requestedStart, endTime: requestedEnd };
  }

  // الصباحية والمسائية الرسمية تظلان على مواعيد جدول العمل الأساسية.
  if (baseEndTime === "12:00" || baseEndTime === "21:00") {
    return { startTime: baseStartTime, endTime: baseEndTime };
  }

  return { startTime: requestedStart, endTime: requestedEnd };
}

function buildSelectedPeriodOverrides(periods: any[], requested: unknown) {
  const input = normalizePeriodOverrides(requested);
  const overrides: Record<string, { startTime: string; endTime: string }> = {};
  for (const period of periods) {
    const periodId = clean(period.id);
    const resolved = resolveAssignedPeriodTimes(period, input[periodId]);
    const startTime = resolved.startTime;
    const endTime = resolved.endTime;
    if (!validTime(startTime) || !validTime(endTime)) throw new AttendanceError("INVALID_PERIOD_TIME", `تأكد من مدة الفترة: ${clean(period.name) || "فترة العمل"}`);
    const startMinutes = timeMinutes(startTime);
    const endMinutes = timeMinutes(endTime);
    if (startMinutes >= endMinutes) {
      throw new AttendanceError("INVALID_ASSIGNMENT_PERIOD_TIME", `مدة ${clean(period.name) || "فترة العمل"} يجب أن تنتهي بعد بدايتها`);
    }
    overrides[periodId] = { startTime, endTime };
  }
  const intervals = Object.entries(overrides).map(([periodId, value]) => ({
    periodId, start: timeMinutes(value.startTime), end: timeMinutes(value.endTime),
  }));
  for (let i = 0; i < intervals.length; i += 1) {
    for (let j = i + 1; j < intervals.length; j += 1) {
      if (Math.max(intervals[i].start, intervals[j].start) < Math.min(intervals[i].end, intervals[j].end)) {
        const left = periods.find((item) => clean(item.id) === intervals[i].periodId);
        const right = periods.find((item) => clean(item.id) === intervals[j].periodId);
        throw new AttendanceError("OVERLAPPING_USER_PERIODS", `لا يمكن تعيين ${clean(left?.name) || "الفترة الأولى"} و ${clean(right?.name) || "الفترة الثانية"} لهذا اليوزر لأن المدد متداخلة`);
      }
    }
  }
  return overrides;
}

function parseWeeklyOffDay(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const day = Number(value);
  return Number.isInteger(day) && day >= 0 && day <= 6 ? day : null;
}

function timeMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function validatePeriods(periods: any[]) {
  if (!periods.length) throw new AttendanceError("SCHEDULE_PERIODS_REQUIRED", "أضف فترة عمل واحدة على الأقل");
  return periods.map((period, index) => {
    const startTime = clean(period.startTime).slice(0, 5);
    const endTime = clean(period.endTime).slice(0, 5);
    if (!validTime(startTime) || !validTime(endTime)) throw new AttendanceError("INVALID_PERIOD_TIME", "تأكد من وقت بداية ونهاية كل فترة");
    if (startTime === endTime) throw new AttendanceError("INVALID_PERIOD_TIME", "وقت بداية الفترة لا يمكن أن يساوي وقت نهايتها");
    const startMinutes = timeMinutes(startTime);
    const endMinutes = timeMinutes(endTime);
    if (endMinutes <= startMinutes) throw new AttendanceError("INVALID_PERIOD_TIME", "فترات الدوام يجب أن تبدأ وتنتهي في نفس يوم العمل");
    const graceMinutes = Math.max(0, Math.min(360, Math.floor(Number(period.graceMinutes) || 0)));
    return {
      id: validUuid(clean(period.id)) ? clean(period.id) : "",
      name: clean(period.name) || `الفترة ${index + 1}`,
      startTime,
      endTime,
      graceMinutes,
      sortOrder: index + 1,
    };
  });
}

function normalizedIdList(value: unknown) {
  return Array.from(new Set(asArray(value).filter(validUuid))).sort();
}

function sameIdList(a: unknown, b: unknown) {
  const left = normalizedIdList(a);
  const right = normalizedIdList(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertSelectedPeriodsDoNotOverlap(periods: any[]) {
  const intervals = periods.map((period) => {
    const startTime = clean(period.start_time).slice(0, 5);
    const endTime = clean(period.end_time).slice(0, 5);
    const start = timeMinutes(startTime);
    let end = timeMinutes(endTime);
    if (end <= start) end += 1440;
    return { start, end, name: clean(period.name) || "فترة العمل" };
  });
  for (let i = 0; i < intervals.length; i += 1) {
    for (let j = i + 1; j < intervals.length; j += 1) {
      for (const offset of [-1440, 0, 1440]) {
        const bStart = intervals[j].start + offset;
        const bEnd = intervals[j].end + offset;
        if (Math.max(intervals[i].start, bStart) < Math.min(intervals[i].end, bEnd)) {
          throw new AttendanceError(
            "OVERLAPPING_USER_PERIODS",
            `لا يمكن تعيين ${intervals[i].name} و ${intervals[j].name} لنفس الموظف لأن مواعيدهما متداخلة`,
          );
        }
      }
    }
  }
}

function dateRange(from: string, to: string) {
  const result: string[] = [];
  let cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end && result.length < 367) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  if (cursor <= end) throw new AttendanceError("REPORT_RANGE_TOO_LARGE", "الحد الأقصى للتقرير 366 يومًا");
  return result;
}

function currentRiyadhDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ATTENDANCE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function currentRiyadhTimeMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ATTENDANCE_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value || 0);
  return part("hour") * 60 + part("minute");
}

function liveWorkMinutes(record: any) {
  if (!record?.check_in) return 0;
  if (record?.check_out) return Math.max(0, Number(record.work_minutes || 0));
  const checkInMs = new Date(record.check_in).getTime();
  const scheduledEndMs = record.scheduled_end_at ? new Date(record.scheduled_end_at).getTime() : Date.now();
  if (!Number.isFinite(checkInMs)) return Math.max(0, Number(record.work_minutes || 0));
  const endMs = Math.min(Date.now(), Number.isFinite(scheduledEndMs) ? scheduledEndMs : Date.now());
  return Math.max(0, Math.floor((endMs - checkInMs) / 60000));
}

function reportClock(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    timeZone: ATTENDANCE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function reportDateFromTimestamp(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ATTENDANCE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  const result = `${part("year")}-${part("month")}-${part("day")}`;
  return validDate(result) ? result : "";
}

function reportTimeMinutesFromTimestamp(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ATTENDANCE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value || 0);
  return part("hour") * 60 + part("minute");
}

function report24HourTime(value: unknown) {
  const minutes = reportTimeMinutesFromTimestamp(value);
  if (minutes === null) return "";
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function reportDelayMinutes(checkIn: unknown, workDate: string, periodStartTime: string, graceMinutes: number, fallback = 0) {
  if (!checkIn || !validDate(workDate) || !validTime(periodStartTime)) return Math.max(0, Math.floor(Number(fallback) || 0));
  const checkInDate = reportDateFromTimestamp(checkIn);
  const checkInMinutes = reportTimeMinutesFromTimestamp(checkIn);
  if (!checkInDate || checkInMinutes === null) return Math.max(0, Math.floor(Number(fallback) || 0));
  const workDay = new Date(`${workDate}T00:00:00Z`).getTime();
  const checkInDay = new Date(`${checkInDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(workDay) || !Number.isFinite(checkInDay)) return Math.max(0, Math.floor(Number(fallback) || 0));
  const dayOffsetMinutes = Math.round((checkInDay - workDay) / 86400000) * 1440;
  const scheduledMinutes = timeMinutes(periodStartTime) + Math.max(0, Math.floor(Number(graceMinutes) || 0));
  return Math.max(0, dayOffsetMinutes + checkInMinutes - scheduledMinutes);
}

async function adminBootstrap() {
  const sql = getSql();
  const [settings] = await sql<{ enforcement_enabled: boolean; official_day_end: string; friday_start_time: string | null; friday_end_time: string | null }[]>`
    select enforcement_enabled,official_day_end::text as official_day_end,
      friday_start_time::text as friday_start_time,friday_end_time::text as friday_end_time
    from core.attendance_settings where id=1 limit 1
  `;
  const [schedules, periods, users, branches, attendanceBranchRows] = await Promise.all([
    sql<any[]>`
      select id::text,name,is_active
      from core.attendance_schedules
      where is_active=true
      order by name
    `,
    sql<any[]>`
      select id::text,schedule_id::text,name,start_time::text,end_time::text,grace_minutes,sort_order,is_active
      from core.attendance_periods
      where is_active=true
      order by schedule_id,sort_order,start_time
    `,
    sql<any[]>`
      select
        u.id::text,u.employee_no,u.full_name,u.email,u.mobile,
        case when a.id is not null then a.branch_id::text else coalesce(crm_branch.id,global_branch.id) end as branch_id,
        a.attendance_branch_name,
        coalesce(nullif(btrim(a.attendance_branch_name),''),ab.name,crm_branch.name,global_branch.name,'—') as branch_name,
        a.id::text as assignment_id,a.schedule_id::text,a.weekly_off_day,a.daily_work_hours,
        coalesce(a.period_overrides,'{}'::jsonb) as period_overrides,
        coalesce(a.period_ids,'{}'::uuid[]) as period_ids,
        s.name as schedule_name
      from core.users u
      left join lateral (
        select ax.*
        from core.attendance_user_schedules ax
        where ax.user_id=u.id
          and ax.effective_from <= (now() at time zone ${ATTENDANCE_TIME_ZONE})::date
          and (ax.effective_to is null or ax.effective_to >= (now() at time zone ${ATTENDANCE_TIME_ZONE})::date)
        order by ax.effective_from desc,ax.created_at desc limit 1
      ) a on true
      left join core.attendance_schedules s on s.id=a.schedule_id
      left join core.branches ab on ab.id=a.branch_id and ab.is_active=true
      left join lateral (
        select b.id::text,b.name
        from core.user_system_branches usb
        join core.branches b on b.id=usb.branch_id and b.is_active=true
        where usb.user_id=u.id and usb.system_code='crm'
        order by usb.is_primary desc,b.sort_order,b.name
        limit 1
      ) crm_branch on true
      left join lateral (
        select b.id::text,b.name
        from core.user_branches ub
        join core.branches b on b.id=ub.branch_id and b.is_active=true
        where ub.user_id=u.id
        order by ub.is_primary desc,b.sort_order,b.name
        limit 1
      ) global_branch on true
      where u.is_active=true and coalesce(u.is_archived,false)=false
      order by u.full_name
    `,
    sql<any[]>`select id::text,code,name from core.branches where is_active=true order by sort_order,name`,
    sql<any[]>`
      select distinct btrim(attendance_branch_name) as name
      from core.attendance_user_schedules
      where nullif(btrim(attendance_branch_name),'') is not null
        and effective_from <= (now() at time zone ${ATTENDANCE_TIME_ZONE})::date
        and (effective_to is null or effective_to >= (now() at time zone ${ATTENDANCE_TIME_ZONE})::date)
      order by name
    `,
  ]);

  const periodMap = new Map<string, any[]>();
  for (const period of periods) {
    const key = String(period.schedule_id);
    if (!periodMap.has(key)) periodMap.set(key, []);
    periodMap.get(key)!.push({
      id: period.id,
      name: period.name,
      startTime: String(period.start_time).slice(0, 5),
      endTime: String(period.end_time).slice(0, 5),
      graceMinutes: Number(period.grace_minutes || 0),
      sortOrder: Number(period.sort_order || 0),
    });
  }

  const deviceSnapshot = await adminDeviceSnapshot();
  return {
    ok: true,
    settings: {
      enforcementEnabled: Boolean(settings?.enforcement_enabled),
      officialDayEnd: String(settings?.official_day_end || "21:00").slice(0, 5),
      fridayStartTime: settings?.friday_start_time ? String(settings.friday_start_time).slice(0, 5) : null,
      fridayEndTime: settings?.friday_end_time ? String(settings.friday_end_time).slice(0, 5) : null,
    },
    schedules: schedules.map((schedule) => ({ ...schedule, periods: periodMap.get(String(schedule.id)) || [] })),
    users: users.map((user) => {
      const rawOverrides = normalizePeriodOverrides(user.period_overrides);
      const selectedIds = normalizedIdList(user.period_ids);
      const assignedPeriods = (periodMap.get(String(user.schedule_id)) || [])
        .filter((period) => !selectedIds.length || selectedIds.includes(clean(period.id)));
      const periodOverrides = Object.fromEntries(assignedPeriods.map((period) => [
        clean(period.id),
        resolveAssignedPeriodTimes(period, rawOverrides[clean(period.id)]),
      ]));
      return {
        ...user,
        period_overrides: periodOverrides,
        device_verification_required: deviceSnapshot.policyMap.get(String(user.id)) === true,
        devices: deviceSnapshot.deviceMap.get(String(user.id)) || [],
      };
    }),
    branches: [
      ...branches,
      ...attendanceBranchRows.map((row) => ({ id: `attendance:${encodeURIComponent(clean(row.name))}`, code: "attendance_custom", name: clean(row.name) })),
    ],
  };
}

async function saveSettings(body: Record<string, any>, adminId: string) {
  const sql = getSql();
  const [current] = await sql<{ enforcement_enabled: boolean; official_day_end: string; friday_start_time: string | null; friday_end_time: string | null }[]>`
    select enforcement_enabled,official_day_end::text as official_day_end,
      friday_start_time::text as friday_start_time,friday_end_time::text as friday_end_time
    from core.attendance_settings where id=1 limit 1
  `;
  const enforcementEnabled = typeof body.enforcementEnabled === "boolean"
    ? body.enforcementEnabled
    : Boolean(current?.enforcement_enabled);
  const requestedOfficialDayEnd = clean(body.officialDayEnd).slice(0, 5);
  const officialDayEnd = validTime(requestedOfficialDayEnd)
    ? requestedOfficialDayEnd
    : String(current?.official_day_end || "21:00").slice(0, 5);

  const hasFridayFields = Object.prototype.hasOwnProperty.call(body, "fridayStartTime")
    || Object.prototype.hasOwnProperty.call(body, "fridayEndTime");
  let fridayStartTime = current?.friday_start_time ? String(current.friday_start_time).slice(0, 5) : null;
  let fridayEndTime = current?.friday_end_time ? String(current.friday_end_time).slice(0, 5) : null;
  if (hasFridayFields) {
    const requestedFridayStart = clean(body.fridayStartTime).slice(0, 5);
    const requestedFridayEnd = clean(body.fridayEndTime).slice(0, 5);
    if (!requestedFridayStart && !requestedFridayEnd) {
      fridayStartTime = null;
      fridayEndTime = null;
    } else {
      if (!validTime(requestedFridayStart) || !validTime(requestedFridayEnd)) {
        throw new AttendanceError("INVALID_FRIDAY_HOURS", "حدد بداية ونهاية دوام الجمعة بشكل صحيح");
      }
      if (requestedFridayStart === requestedFridayEnd) {
        throw new AttendanceError("INVALID_FRIDAY_HOURS", "بداية ونهاية دوام الجمعة لا يمكن أن تكونا نفس الوقت");
      }
      fridayStartTime = requestedFridayStart;
      fridayEndTime = requestedFridayEnd;
    }
  }

  await sql`
    insert into core.attendance_settings(id,enforcement_enabled,official_day_end,friday_start_time,friday_end_time,updated_by,updated_at)
    values(1,${enforcementEnabled},${officialDayEnd}::time,${fridayStartTime}::time,${fridayEndTime}::time,${adminId}::uuid,now())
    on conflict(id) do update
    set enforcement_enabled=excluded.enforcement_enabled,official_day_end=excluded.official_day_end,
        friday_start_time=excluded.friday_start_time,friday_end_time=excluded.friday_end_time,
        updated_by=excluded.updated_by,updated_at=now()
  `;

  let forcedLogoutUsers = 0;
  if (enforcementEnabled && !Boolean(current?.enforcement_enabled)) {
    const expired = await sql<{ user_id: string }[]>`
      delete from core.sessions s
      using core.attendance_user_schedules a
      where s.user_id=a.user_id
        and a.effective_from <= (now() at time zone ${ATTENDANCE_TIME_ZONE})::date
        and (a.effective_to is null or a.effective_to >= (now() at time zone ${ATTENDANCE_TIME_ZONE})::date)
      returning s.user_id::text
    `;
    forcedLogoutUsers = new Set(expired.map((row) => row.user_id)).size;
  }

  return { ok: true, enforcementEnabled, officialDayEnd, fridayStartTime, fridayEndTime, forcedLogoutUsers };
}

async function saveSchedule(body: Record<string, any>, adminId: string) {
  const sql = getSql();
  const id = clean(body.id);
  const name = clean(body.name);
  if (!name) throw new AttendanceError("SCHEDULE_NAME_REQUIRED", "اكتب اسم جدول العمل");
  const periods = validatePeriods(Array.isArray(body.periods) ? body.periods : []);

  return sql.begin(async (tx) => {
    let scheduleId = id;
    if (scheduleId && validUuid(scheduleId)) {
      const [updated] = await tx<any[]>`
        update core.attendance_schedules
        set name=${name},is_active=true,updated_by=${adminId}::uuid,updated_at=now()
        where id=${scheduleId}::uuid
        returning id::text
      `;
      if (!updated) throw new AttendanceError("SCHEDULE_NOT_FOUND", "جدول العمل غير موجود", 404);
    } else {
      const [created] = await tx<any[]>`
        insert into core.attendance_schedules(name,created_by,updated_by)
        values(${name},${adminId}::uuid,${adminId}::uuid)
        returning id::text
      `;
      scheduleId = created.id;
    }

    const keepIds: string[] = [];
    for (const period of periods) {
      if (period.id) {
        const [updated] = await tx<any[]>`
          update core.attendance_periods
          set name=${period.name},start_time=${period.startTime}::time,end_time=${period.endTime}::time,
              grace_minutes=${period.graceMinutes},sort_order=${period.sortOrder},is_active=true,updated_at=now()
          where id=${period.id}::uuid and schedule_id=${scheduleId}::uuid
          returning id::text
        `;
        if (updated) keepIds.push(updated.id);
      }
      if (!period.id || !keepIds.includes(period.id)) {
        const [created] = await tx<any[]>`
          insert into core.attendance_periods(schedule_id,name,start_time,end_time,grace_minutes,sort_order)
          values(${scheduleId}::uuid,${period.name},${period.startTime}::time,${period.endTime}::time,${period.graceMinutes},${period.sortOrder})
          returning id::text
        `;
        keepIds.push(created.id);
      }
    }

    if (keepIds.length) {
      await tx`
        update core.attendance_periods
        set is_active=false,updated_at=now()
        where schedule_id=${scheduleId}::uuid and id::text not in ${tx(keepIds)}
      `;
    }
    return { ok: true, id: scheduleId };
  });
}

async function deleteSchedule(body: Record<string, any>, adminId: string) {
  const sql = getSql();
  const id = clean(body.id);
  if (!validUuid(id)) throw new AttendanceError("SCHEDULE_NOT_FOUND", "جدول العمل غير موجود", 404);
  const [inUse] = await sql<any[]>`
    select 1 from core.attendance_user_schedules
    where schedule_id=${id}::uuid and effective_to is null limit 1
  `;
  if (inUse) throw new AttendanceError("SCHEDULE_IN_USE", "لا يمكن حذف الجدول لأنه معين حاليًا لموظفين");
  await sql`update core.attendance_schedules set is_active=false,updated_by=${adminId}::uuid,updated_at=now() where id=${id}::uuid`;
  await sql`update core.attendance_periods set is_active=false,updated_at=now() where schedule_id=${id}::uuid`;
  return { ok: true };
}

async function assignUsers(body: Record<string, any>, adminId: string) {
  const sql = getSql();
  const userIds = asArray(body.userIds).filter(validUuid);
  const scheduleId = validUuid(clean(body.scheduleId)) ? clean(body.scheduleId) : "";
  const periodIds = normalizedIdList(body.periodIds);
  const requestedBranchId = validUuid(clean(body.branchId)) ? clean(body.branchId) : null;
  const requestedBranchName = clean(body.branchName).slice(0, 120) || null;
  const dailyWorkHoursRaw = clean(body.dailyWorkHours);
  const dailyWorkHours = dailyWorkHoursRaw ? Number(dailyWorkHoursRaw) : null;
  if (dailyWorkHours !== null && (!Number.isFinite(dailyWorkHours) || dailyWorkHours <= 0 || dailyWorkHours > 24)) {
    throw new AttendanceError("INVALID_DAILY_WORK_HOURS", "إجمالي ساعات العمل اليومية يجب أن يكون أكبر من صفر وحتى 24 ساعة");
  }
  const weeklyOffDay = parseWeeklyOffDay(body.weeklyOffDay);
  const requestedPeriodOverrides = normalizePeriodOverrides(body.periodOverrides);
  const enforcementEnabled = await isAttendanceEnforcementEnabled();
  if (!userIds.length) throw new AttendanceError("USERS_REQUIRED", "اختر موظفًا واحدًا على الأقل");

  if (scheduleId) {
    const [schedule] = await sql<any[]>`
      select id::text from core.attendance_schedules
      where id=${scheduleId}::uuid and is_active=true
    `;
    if (!schedule) throw new AttendanceError("INVALID_SCHEDULE", "جدول العمل غير متاح");
    if (!periodIds.length) throw new AttendanceError("PERIODS_REQUIRED", "اختر فترة عمل واحدة على الأقل للموظف");
    const selectedPeriods = await sql<any[]>`
      select id::text,name,start_time::text,end_time::text,sort_order
      from core.attendance_periods
      where schedule_id=${scheduleId}::uuid and is_active=true and id::text in ${sql(periodIds)}
      order by sort_order,start_time
    `;
    if (selectedPeriods.length !== periodIds.length) throw new AttendanceError("INVALID_PERIOD_SELECTION", "بعض فترات العمل المختارة لا تتبع جدول العمل الحالي");
    const assignmentPeriodOverrides = buildSelectedPeriodOverrides(selectedPeriods, requestedPeriodOverrides);
    body.__assignmentPeriodOverrides = assignmentPeriodOverrides;
  }
  if (requestedBranchId) {
    const [branch] = await sql<any[]>`select id::text from core.branches where id=${requestedBranchId}::uuid and is_active=true`;
    if (!branch) throw new AttendanceError("INVALID_BRANCH", "الفرع المختار غير متاح");
  }

  await sql.begin(async (tx) => {
    for (const userId of userIds) {
      const [user] = await tx<any[]>`select id::text from core.users where id=${userId}::uuid and is_active=true and coalesce(is_archived,false)=false`;
      if (!user) continue;
      const [current] = await tx<any[]>`
        select id::text,schedule_id::text,branch_id::text,attendance_branch_name,daily_work_hours,period_ids,period_overrides,weekly_off_day,effective_from::text
        from core.attendance_user_schedules
        where user_id=${userId}::uuid and effective_to is null
        order by effective_from desc,created_at desc limit 1
      `;

      if (!scheduleId) {
        if (!current) continue;
        if (dateOnlyValue(current.effective_from) === currentRiyadhDate()) {
          await tx`delete from core.attendance_user_schedules where id=${current.id}::uuid`;
        } else {
          await tx`
            update core.attendance_user_schedules
            set effective_to=((now() at time zone ${ATTENDANCE_TIME_ZONE})::date - 1)
            where id=${current.id}::uuid
          `;
        }
        if (enforcementEnabled) await tx`delete from core.sessions where user_id=${userId}::uuid`;
        continue;
      }

      let effectiveBranchId: string | null = null;
      let effectiveBranchName: string | null = null;
      if (requestedBranchName) {
        effectiveBranchName = requestedBranchName;
      } else if (requestedBranchId) {
        effectiveBranchId = requestedBranchId;
      } else if (clean(current?.attendance_branch_name)) {
        effectiveBranchName = clean(current.attendance_branch_name).slice(0, 120);
      } else if (validUuid(clean(current?.branch_id))) {
        effectiveBranchId = clean(current.branch_id);
      } else {
        const [preferredBranch] = await tx<any[]>`
          select coalesce(
            (
              select b.id::text
              from core.user_system_branches usb
              join core.branches b on b.id=usb.branch_id and b.is_active=true
              where usb.user_id=${userId}::uuid and usb.system_code='crm'
              order by usb.is_primary desc,b.sort_order,b.name limit 1
            ),
            (
              select b.id::text
              from core.user_branches ub
              join core.branches b on b.id=ub.branch_id and b.is_active=true
              where ub.user_id=${userId}::uuid
              order by ub.is_primary desc,b.sort_order,b.name limit 1
            )
          ) as branch_id
        `;
        effectiveBranchId = validUuid(clean(preferredBranch?.branch_id)) ? clean(preferredBranch.branch_id) : null;
      }

      const currentDailyHours = current?.daily_work_hours === null || current?.daily_work_hours === undefined ? null : Number(current.daily_work_hours);
      const same = current
        && clean(current.schedule_id) === scheduleId
        && clean(current.branch_id) === clean(effectiveBranchId)
        && clean(current.attendance_branch_name) === clean(effectiveBranchName)
        && (currentDailyHours === null ? dailyWorkHours === null : dailyWorkHours !== null && Math.abs(currentDailyHours - dailyWorkHours) < 0.001)
        && sameIdList(current.period_ids, periodIds)
        && periodOverridesEqual(current.period_overrides, body.__assignmentPeriodOverrides)
        && parseWeeklyOffDay(current.weekly_off_day) === weeklyOffDay;
      if (same) continue;

      if (current && dateOnlyValue(current.effective_from) === currentRiyadhDate()) {
        await tx`
          update core.attendance_user_schedules
          set schedule_id=${scheduleId}::uuid,branch_id=${effectiveBranchId}::uuid,attendance_branch_name=${effectiveBranchName},daily_work_hours=${dailyWorkHours},
              period_ids=${periodIds}::uuid[],period_overrides=${JSON.stringify(body.__assignmentPeriodOverrides || {})}::jsonb,weekly_off_day=${weeklyOffDay}
          where id=${current.id}::uuid
        `;
      } else {
        if (current) {
          await tx`
            update core.attendance_user_schedules
            set effective_to=((now() at time zone ${ATTENDANCE_TIME_ZONE})::date - 1)
            where id=${current.id}::uuid
          `;
        }
        await tx`
          insert into core.attendance_user_schedules(user_id,schedule_id,branch_id,attendance_branch_name,daily_work_hours,period_ids,period_overrides,weekly_off_day,effective_from,created_by)
          values(${userId}::uuid,${scheduleId}::uuid,${effectiveBranchId}::uuid,${effectiveBranchName},${dailyWorkHours},${periodIds}::uuid[],${JSON.stringify(body.__assignmentPeriodOverrides || {})}::jsonb,${weeklyOffDay},(now() at time zone ${ATTENDANCE_TIME_ZONE})::date,${adminId}::uuid)
        `;
      }
      if (enforcementEnabled) await tx`delete from core.sessions where user_id=${userId}::uuid`;
    }
  });
  return { ok: true, count: userIds.length };
}

function dateOnlyValue(value: unknown) {
  return clean(value).slice(0, 10);
}

function weekdayForDate(value: string) {
  return new Date(`${value}T00:00:00Z`).getUTCDay();
}

async function reportData(request: VercelRequest) {
  const sql = getSql();
  const today = currentRiyadhDate();
  const nowMinutes = currentRiyadhTimeMinutes();
  const [attendanceSettings] = await sql<{ official_day_end: string; friday_start_time: string | null; friday_end_time: string | null }[]>`
    select official_day_end::text as official_day_end,
      friday_start_time::text as friday_start_time,friday_end_time::text as friday_end_time
    from core.attendance_settings where id=1 limit 1
  `;
  const officialDayEnd = String(attendanceSettings?.official_day_end || "21:00").slice(0, 5);
  const officialDayEndMinutes = timeMinutes(officialDayEnd);
  const fridayStartTime = attendanceSettings?.friday_start_time ? String(attendanceSettings.friday_start_time).slice(0, 5) : "";
  const fridayEndTime = attendanceSettings?.friday_end_time ? String(attendanceSettings.friday_end_time).slice(0, 5) : "";
  const fridayScheduleEnabled = validTime(fridayStartTime) && validTime(fridayEndTime) && fridayStartTime !== fridayEndTime;
  const rawFrom = clean(request.query.from);
  const rawTo = clean(request.query.to);
  let from = validDate(rawFrom) ? rawFrom : "";
  let to = validDate(rawTo) ? rawTo : "";
  if (!from && !to) from = to = today;
  else if (from && !to) to = from;
  else if (!from && to) from = to;
  if (from > to) [from, to] = [to, from];
  const days = dateRange(from, to);
  const rawEmployeeValues = Array.isArray(request.query.employeeIds)
    ? request.query.employeeIds
    : [request.query.employeeIds];
  const employeeIds = Array.from(new Set(
    rawEmployeeValues
      .flatMap((value) => String(value ?? "").split(","))
      .map(clean)
      .filter(validUuid),
  ));
  const legacyEmployeeId = validUuid(clean(request.query.employeeId)) ? clean(request.query.employeeId) : "";
  if (!employeeIds.length && legacyEmployeeId) employeeIds.push(legacyEmployeeId);
  const rawBranchKey = clean(request.query.branchId);
  const branchId = validUuid(rawBranchKey) ? rawBranchKey : "";
  const attendanceBranchName = rawBranchKey.startsWith("attendance:")
    ? decodeURIComponent(rawBranchKey.slice("attendance:".length)).trim()
    : "";

  const users = employeeIds.length
    ? await sql<any[]>`
        select
          u.id::text,u.full_name,u.employee_no,
          coalesce(
            (
              select b.name
              from core.user_system_branches usb
              join core.branches b on b.id=usb.branch_id and b.is_active=true
              where usb.user_id=u.id and usb.system_code='crm'
              order by usb.is_primary desc,b.sort_order,b.name limit 1
            ),
            (
              select b.name
              from core.user_branches ub
              join core.branches b on b.id=ub.branch_id and b.is_active=true
              where ub.user_id=u.id
              order by ub.is_primary desc,b.sort_order,b.name limit 1
            ),
            '—'
          ) as branch_name,
          coalesce(
            (
              select b.id::text
              from core.user_system_branches usb
              join core.branches b on b.id=usb.branch_id and b.is_active=true
              where usb.user_id=u.id and usb.system_code='crm'
              order by usb.is_primary desc,b.sort_order,b.name limit 1
            ),
            (
              select b.id::text
              from core.user_branches ub
              join core.branches b on b.id=ub.branch_id and b.is_active=true
              where ub.user_id=u.id
              order by ub.is_primary desc,b.sort_order,b.name limit 1
            )
          ) as branch_id
        from core.users u
        where u.is_active=true and coalesce(u.is_archived,false)=false
          and u.id::text in ${sql(employeeIds)}
        order by u.full_name
      `
    : await sql<any[]>`
        select
          u.id::text,u.full_name,u.employee_no,
          coalesce(
            (
              select b.name
              from core.user_system_branches usb
              join core.branches b on b.id=usb.branch_id and b.is_active=true
              where usb.user_id=u.id and usb.system_code='crm'
              order by usb.is_primary desc,b.sort_order,b.name limit 1
            ),
            (
              select b.name
              from core.user_branches ub
              join core.branches b on b.id=ub.branch_id and b.is_active=true
              where ub.user_id=u.id
              order by ub.is_primary desc,b.sort_order,b.name limit 1
            ),
            '—'
          ) as branch_name,
          coalesce(
            (
              select b.id::text
              from core.user_system_branches usb
              join core.branches b on b.id=usb.branch_id and b.is_active=true
              where usb.user_id=u.id and usb.system_code='crm'
              order by usb.is_primary desc,b.sort_order,b.name limit 1
            ),
            (
              select b.id::text
              from core.user_branches ub
              join core.branches b on b.id=ub.branch_id and b.is_active=true
              where ub.user_id=u.id
              order by ub.is_primary desc,b.sort_order,b.name limit 1
            )
          ) as branch_id
        from core.users u
        where u.is_active=true and coalesce(u.is_archived,false)=false
        order by u.full_name
      `;
  const userIds = users.map((user) => String(user.id));
  if (!userIds.length) return { ok: true, from, to, today, officialDayEnd, rows: [], periodHeaders: [] };

  const [assignments, periods, records] = await Promise.all([
    sql<any[]>`
      select
        a.id::text,a.user_id::text,a.schedule_id::text,a.branch_id::text,a.attendance_branch_name,a.daily_work_hours,
        coalesce(a.period_ids,'{}'::uuid[]) as period_ids,coalesce(a.period_overrides,'{}'::jsonb) as period_overrides,a.weekly_off_day,
        a.effective_from::text,a.effective_to::text,a.created_at::text,s.name as schedule_name,coalesce(nullif(btrim(a.attendance_branch_name),''),b.name) as branch_name
      from core.attendance_user_schedules a
      join core.attendance_schedules s on s.id=a.schedule_id
      left join core.branches b on b.id=a.branch_id
      where a.user_id::text in ${sql(userIds)}
        and a.effective_from <= ${to}::date
        and (a.effective_to is null or a.effective_to >= ${from}::date)
      order by a.user_id,a.effective_from desc,a.created_at desc
    `,
    sql<any[]>`
      select id::text,schedule_id::text,name,start_time::text,end_time::text,grace_minutes,sort_order,is_active
      from core.attendance_periods
      order by schedule_id,sort_order,start_time
    `,
    sql<any[]>`
      select
        id::text,user_id::text,assignment_id::text,schedule_id::text,period_id::text,
        work_date::text as work_date,period_name,period_sort_order,grace_minutes,
        scheduled_start_at,scheduled_end_at,check_in,check_out,checkout_source,
        early_departure_from_at,early_departure_to_at,
        delay_minutes,work_minutes,status,legacy_source_key
      from core.attendance_records
      where user_id::text in ${sql(userIds)}
        and (
          work_date between ${from}::date and ${to}::date
          or (check_in is not null and (check_in at time zone ${ATTENDANCE_TIME_ZONE})::date between ${from}::date and ${to}::date)
          or (check_out is not null and (check_out at time zone ${ATTENDANCE_TIME_ZONE})::date between ${from}::date and ${to}::date)
        )
      order by coalesce(check_in,scheduled_start_at),user_id,period_sort_order nulls last
    `,
  ]);

  const assignmentMap = new Map<string, any[]>();
  for (const assignment of assignments) {
    const key = String(assignment.user_id);
    if (!assignmentMap.has(key)) assignmentMap.set(key, []);
    assignmentMap.get(key)!.push({
      ...assignment,
      period_overrides: normalizePeriodOverrides(assignment.period_overrides),
    });
  }
  for (const userAssignments of assignmentMap.values()) {
    userAssignments.sort((left, right) => {
      const effectiveFromDiff = dateOnlyValue(right.effective_from).localeCompare(dateOnlyValue(left.effective_from));
      if (effectiveFromDiff) return effectiveFromDiff;
      return clean(right.created_at).localeCompare(clean(left.created_at));
    });
  }

  const periodMap = new Map<string, any[]>();
  for (const period of periods) {
    const key = String(period.schedule_id);
    if (!periodMap.has(key)) periodMap.set(key, []);
    periodMap.get(key)!.push(period);
  }
  const reportDays = new Set(days);
  const recordMap = new Map<string, any[]>();
  for (const record of records) {
    const storedWorkDate = dateOnlyValue(record.work_date);
    const checkInDate = reportDateFromTimestamp(record.check_in);
    const checkOutDate = reportDateFromTimestamp(record.check_out);
    // work_date is the business-day source of truth. The timestamp fallbacks keep
    // records visible if an older deployment saved a malformed/out-of-range work_date.
    const reportDate = reportDays.has(storedWorkDate)
      ? storedWorkDate
      : reportDays.has(checkInDate)
        ? checkInDate
        : reportDays.has(checkOutDate)
          ? checkOutDate
          : storedWorkDate || checkInDate || checkOutDate;
    if (!reportDate || !reportDays.has(reportDate)) continue;
    const key = `${record.user_id}:${reportDate}`;
    if (!recordMap.has(key)) recordMap.set(key, []);
    recordMap.get(key)!.push(record);
  }

  const rawRows: any[] = [];
  const headerMeta = new Map<string, { key: string; label: string; sortOrder: number; firstSeen: number }>();
  let headerSequence = 0;
  const periodKey = (name: unknown) => (
    clean(name)
      .normalize("NFKC")
      .replace(/[\u200B-\u200F\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("ar-SA")
    || "فترة العمل"
  );

  for (const day of days) {
    for (const user of users) {
      const userAssignments = assignmentMap.get(String(user.id)) || [];
      const assignment = userAssignments.find((item) => dateOnlyValue(item.effective_from) <= day && (!item.effective_to || dateOnlyValue(item.effective_to) >= day)) || null;
      const assignmentBranchName = clean(assignment?.attendance_branch_name);
      const effectiveBranchId = assignmentBranchName ? "" : clean(assignment?.branch_id || user.branch_id);
      if (branchId && effectiveBranchId !== branchId) continue;
      if (attendanceBranchName && assignmentBranchName !== attendanceBranchName) continue;
      const dayRecords = recordMap.get(`${user.id}:${day}`) || [];
      const visibleDayRecords = dayRecords.filter((record) => {
        const legacySourceKey = clean(record.legacy_source_key);
        const periodName = clean(record.period_name);
        return !legacySourceKey.startsWith("marketing:") && periodName !== "سجل التسويق السابق";
      });
      const assignedPeriodIds = normalizedIdList(assignment?.period_ids);
      const assignmentOverrides = normalizePeriodOverrides(assignment?.period_overrides);
      let schedulePeriods = assignment
        ? (periodMap.get(String(assignment.schedule_id)) || []).filter((period) => Boolean(period.is_active) && (!assignedPeriodIds.length || assignedPeriodIds.includes(clean(period.id))))
        : [];
      const isFriday = weekdayForDate(day) === 5;
      if (isFriday && fridayScheduleEnabled && schedulePeriods.length > 1) schedulePeriods = [schedulePeriods[0]];
      const isDayOff = Boolean(assignment)
        && parseWeeklyOffDay(assignment.weekly_off_day) !== null
        && weekdayForDate(day) === parseWeeklyOffDay(assignment.weekly_off_day);

      const slots: any[] = schedulePeriods.map((period) => {
        const record = visibleDayRecords.find((item) => clean(item.period_id) === clean(period.id)) || null;
        const override = assignmentOverrides[clean(period.id)];
        const resolvedTimes = resolveAssignedPeriodTimes(period, override);
        const recordStartTime = report24HourTime(record?.scheduled_start_at);
        const recordEndTime = report24HourTime(record?.scheduled_end_at);
        const startTime = isFriday && fridayScheduleEnabled
          ? fridayStartTime
          : resolvedTimes.startTime || recordStartTime || clean(period.start_time).slice(0, 5);
        const configuredEndTime = isFriday && fridayScheduleEnabled
          ? fridayEndTime
          : resolvedTimes.endTime || recordEndTime || clean(period.end_time).slice(0, 5);
        return {
          id: period.id,
          name: clean(period.name) || "فترة العمل",
          startTime,
          endTime: configuredEndTime,
          graceMinutes: Number(period.grace_minutes || 0),
          sortOrder: Number(period.sort_order || 0),
          record,
        };
      });

      for (const record of visibleDayRecords) {
        if (slots.some((slot) => slot.record?.id === record.id)) continue;
        slots.push({
          id: record.period_id || `record:${record.id}`,
          name: clean(record.period_name) || `فترة العمل ${slots.length + 1}`,
          startTime: report24HourTime(record.scheduled_start_at),
          endTime: report24HourTime(record.scheduled_end_at),
          graceMinutes: Number(record.grace_minutes || 0),
          sortOrder: Number(record.period_sort_order || slots.length + 1),
          record,
        });
      }
      slots.sort((a, b) => a.sortOrder - b.sortOrder);

      const periodsByKey = new Map<string, any>();
      for (const slot of slots) {
        const record = slot.record;
        const delayMinutes = reportDelayMinutes(record?.check_in, day, slot.startTime, slot.graceMinutes, Number(record?.delay_minutes || 0));
        let result = "—";
        if (record?.check_in) {
          const statusText = delayMinutes > 0 ? "متأخر" : "حاضر";
          const workText = record.check_out ? `العمل ${formatMinutes(Number(record.work_minutes || 0))}` : "الفترة مفتوحة";
          const delayText = delayMinutes > 0 ? `تأخير ${formatMinutes(delayMinutes)}` : "بدون تأخير";
          const departureText = record.checkout_source === "authorized" ? " • إذن انصراف مبكر" : "";
          result = `${statusText} • ${workText} • ${delayText}${departureText}`;
        } else if (isDayOff) {
          result = "إجازة";
        } else if (day < today) {
          result = "غائب";
        } else if (day === today) {
          const effectiveEnd = validTime(slot.endTime) ? timeMinutes(slot.endTime) : officialDayEndMinutes;
          result = nowMinutes >= effectiveEnd ? "غائب" : "لم يسجل";
        }
        const key = periodKey(slot.name);
        if (!headerMeta.has(key)) {
          headerMeta.set(key, { key, label: slot.name, sortOrder: slot.sortOrder, firstSeen: headerSequence++ });
        } else {
          const meta = headerMeta.get(key)!;
          meta.sortOrder = Math.min(meta.sortOrder, slot.sortOrder);
        }
        periodsByKey.set(key, {
          name: slot.name,
          startTime: slot.startTime,
          endTime: slot.endTime,
          checkIn: record?.check_in || null,
          checkOut: record?.check_out || null,
          checkInText: reportClock(record?.check_in),
          checkOutText: reportClock(record?.check_out),
          checkoutSource: record?.check_out ? (record.checkout_source === "authorized" ? "authorized" : "auto") : null,
          earlyDepartureFrom: record?.early_departure_from_at || null,
          earlyDepartureTo: record?.early_departure_to_at || null,
          earlyDepartureFromText: reportClock(record?.early_departure_from_at),
          earlyDepartureToText: reportClock(record?.early_departure_to_at),
          result,
          delayMinutes,
          workMinutes: liveWorkMinutes(record),
        });
      }

      rawRows.push({
        date: day,
        branch: assignmentBranchName || assignment?.branch_name || user.branch_name || "—",
        userId: user.id,
        employeeNo: user.employee_no,
        name: user.full_name,
        scheduleName: assignment?.schedule_name || null,
        periodsByKey,
      });
    }
  }

  const orderedHeaders = Array.from(headerMeta.values()).sort((a, b) => a.sortOrder - b.sortOrder || a.firstSeen - b.firstSeen || a.label.localeCompare(b.label, "ar"));
  const periodHeaders = orderedHeaders.map((header) => header.label);
  const rows = rawRows.map((row) => ({
    ...row,
    periods: orderedHeaders.map((header) => row.periodsByKey.get(header.key) || null),
    periodsByKey: undefined,
  }));

  return {
    ok: true, from, to, today, officialDayEnd, branchId: rawBranchKey || null, rows, periodHeaders,
    users: users.map((user) => ({ id: user.id, fullName: user.full_name })),
  };
}

async function authorizeEarlyDeparture(body: Record<string, any>, adminId: string) {
  const userId = clean(body.userId);
  const workDate = clean(body.workDate);
  const fromTime = clean(body.fromTime).slice(0, 5);
  const toTime = clean(body.toTime).slice(0, 5);
  if (!validUuid(userId)) throw new AttendanceError("USER_REQUIRED", "المستخدم غير موجود", 404);
  if (!validDate(workDate)) throw new AttendanceError("WORK_DATE_REQUIRED", "تاريخ الحضور غير صحيح");
  if (!validTime(fromTime) || !validTime(toTime)) throw new AttendanceError("EARLY_DEPARTURE_TIME_REQUIRED", "حدد وقت بداية ونهاية إذن الانصراف");
  if (timeMinutes(toTime) <= timeMinutes(fromTime)) throw new AttendanceError("EARLY_DEPARTURE_TIME_INVALID", "نهاية الإذن يجب أن تكون بعد بدايته");

  const sql = getSql();
  return sql.begin(async (tx) => {
    const [user] = await tx<any[]>`
      select id::text,full_name
      from core.users
      where id=${userId}::uuid
      limit 1
    `;
    if (!user) throw new AttendanceError("USER_NOT_FOUND", "المستخدم غير موجود", 404);

    const [record] = await tx<any[]>`
      select id::text,check_in,scheduled_start_at,scheduled_end_at,checkout_source,early_departure_from_at,early_departure_to_at
      from core.attendance_records
      where user_id=${userId}::uuid
        and work_date=${workDate}::date
        and check_in is not null
        and check_out is null
        and scheduled_start_at is not null
        and scheduled_end_at is not null
        and now() >= scheduled_start_at
        and now() < scheduled_end_at
      order by scheduled_start_at desc,period_sort_order desc nulls last
      limit 1
      for update
    `;

    if (!record) {
      const [authorized] = await tx<any[]>`
        select id::text,early_departure_from_at,early_departure_to_at
        from core.attendance_records
        where user_id=${userId}::uuid
          and work_date=${workDate}::date
          and checkout_source='authorized'
        order by check_out desc nulls last
        limit 1
      `;
      if (authorized) return { ok: true, message: `تم تسجيل إذن الانصراف المبكر لـ ${user.full_name} بالفعل` };
      throw new AttendanceError("NO_OPEN_ATTENDANCE", "لا توجد فترة حضور مفتوحة الآن لهذا المستخدم", 400);
    }

    const [permission] = await tx<any[]>`
      select
        ((${workDate}::date + ${fromTime}::time) at time zone ${ATTENDANCE_TIME_ZONE}) as from_at,
        ((${workDate}::date + ${toTime}::time) at time zone ${ATTENDANCE_TIME_ZONE}) as to_at
    `;
    const fromAt = permission?.from_at;
    const toAt = permission?.to_at;
    if (!fromAt || !toAt) throw new AttendanceError("EARLY_DEPARTURE_TIME_INVALID", "تعذر تحديد مدة إذن الانصراف");

    const [validation] = await tx<any[]>`
      select
        ${fromAt}::timestamptz >= ${record.check_in}::timestamptz as after_check_in,
        ${fromAt}::timestamptz >= ${record.scheduled_start_at}::timestamptz as after_schedule_start,
        ${fromAt}::timestamptz <= now() as not_future,
        ${toAt}::timestamptz > ${fromAt}::timestamptz as valid_order,
        ${toAt}::timestamptz <= ${record.scheduled_end_at}::timestamptz as within_schedule
    `;
    if (!validation?.after_check_in || !validation?.after_schedule_start) throw new AttendanceError("EARLY_DEPARTURE_BEFORE_CHECKIN", "بداية الإذن لا يمكن أن تكون قبل تسجيل الحضور");
    if (!validation?.not_future) throw new AttendanceError("EARLY_DEPARTURE_IN_FUTURE", "بداية الإذن لا يمكن أن تكون بعد الوقت الحالي");
    if (!validation?.valid_order) throw new AttendanceError("EARLY_DEPARTURE_TIME_INVALID", "نهاية الإذن يجب أن تكون بعد بدايته");
    if (!validation?.within_schedule) throw new AttendanceError("EARLY_DEPARTURE_AFTER_SHIFT", "نهاية الإذن لا يمكن أن تتجاوز نهاية دوام اليوزر");

    const [updated] = await tx<any[]>`
      update core.attendance_records
      set check_out=${fromAt}::timestamptz,
          checkout_source='authorized',
          early_departure_authorized_at=now(),
          early_departure_authorized_by=${adminId}::uuid,
          early_departure_from_at=${fromAt}::timestamptz,
          early_departure_to_at=${toAt}::timestamptz,
          work_minutes=greatest(0,floor(extract(epoch from (${fromAt}::timestamptz-check_in))/60)::int),
          updated_at=now()
      where id=${record.id}::uuid
      returning id::text,check_out,early_departure_from_at,early_departure_to_at
    `;
    return { ok: true, recordId: updated.id, message: `تم تسجيل إذن الانصراف المبكر لـ ${user.full_name} من ${fromTime} إلى ${toTime}` };
  });
}

async function selfAttendanceStateForSession(user: { id: string; verifiedDeviceId?: string | null }) {
  const state: any = await getSelfAttendanceState(user.id);
  const deviceAttendanceRole = await getUserDeviceAttendanceRole(user.id, user.verifiedDeviceId || null);
  state.deviceAttendanceRole = deviceAttendanceRole;
  if (deviceAttendanceRole === "secondary" || deviceAttendanceRole === "unverified") {
    state.canCheckIn = false;
  }
  return state;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    await ensureAttendanceSchema();
    const user = await requireUser(request, response);
    if (!user) return;

    if (request.method === "GET") {
      const view = clean(request.query.view);
      if (view === "self") {
        return response.status(200).json({ ok: true, state: await selfAttendanceStateForSession(user) });
      }
      if (view === "admin") {
        const admin = await requireAdmin(request, response);
        if (!admin) return;
        return response.status(200).json(await adminBootstrap());
      }
      if (view === "report") {
        const admin = await requireAdmin(request, response);
        if (!admin) return;
        return response.status(200).json(await reportData(request));
      }
      return response.status(404).json({ ok: false, error: "العرض المطلوب غير موجود" });
    }

    if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
    const body = bodyObject(request);
    const action = clean(body.action);

    if (action === "self_check_in") {
      const deviceRole = await getUserDeviceAttendanceRole(user.id, user.verifiedDeviceId || null);
      if (deviceRole === "secondary" || deviceRole === "unverified") throw new AttendanceError("PRIMARY_DEVICE_REQUIRED", "تسجيل الحضور متاح من الجهاز الأساسي فقط", 403);
      await checkInCurrentAttendance(user.id);
      return response.status(200).json({ ok: true, state: await selfAttendanceStateForSession(user) });
    }
    if (action === "self_check_out") {
      throw new AttendanceError("AUTO_CHECKOUT_ONLY", "تسجيل الانصراف يتم تلقائيًا حسب نهاية الدوام المحددة لليوزر", 400);
    }

    const admin = await requireAdmin(request, response);
    if (!admin) return;
    let result: any;
    if (action === "authorize_early_departure") result = await authorizeEarlyDeparture(body, admin.id);
    else if (action === "save_settings") result = await saveSettings(body, admin.id);
    else if (action === "save_schedule") result = await saveSchedule(body, admin.id);
    else if (action === "delete_schedule") result = await deleteSchedule(body, admin.id);
    else if (action === "assign_users") result = await assignUsers(body, admin.id);
    else if (action === "set_device_policy") {
      const userIds = asArray(body.userIds).filter(validUuid);
      if (!userIds.length) throw new AttendanceError("USERS_REQUIRED", "اختر موظفًا واحدًا على الأقل");
      result = await setUserDevicePolicy(userIds, body.required === true, admin.id);
    } else if (action === "approve_device") {
      const deviceRecordId = clean(body.deviceRecordId);
      if (!validUuid(deviceRecordId)) throw new AttendanceError("DEVICE_NOT_FOUND", "الجهاز غير موجود", 404);
      result = await approveUserDevice(deviceRecordId, admin.id);
    } else if (action === "set_primary_device") {
      const deviceRecordId = clean(body.deviceRecordId);
      if (!validUuid(deviceRecordId)) throw new AttendanceError("DEVICE_NOT_FOUND", "الجهاز غير موجود", 404);
      result = await setPrimaryUserDevice(deviceRecordId, admin.id);
    } else if (action === "revoke_device") {
      const deviceRecordId = clean(body.deviceRecordId);
      if (!validUuid(deviceRecordId)) throw new AttendanceError("DEVICE_NOT_FOUND", "الجهاز غير موجود", 404);
      result = await revokeUserDevice(deviceRecordId, admin.id);
    } else throw new AttendanceError("UNSUPPORTED_ACTION", "الإجراء غير مدعوم", 400);
    return response.status(200).json(result);
  } catch (error: any) {
    console.error("Attendance API failed", error);
    const status = error instanceof AttendanceError ? error.status : 400;
    return response.status(status).json({
      ok: false,
      code: error?.code || "ATTENDANCE_ERROR",
      error: clean(error?.message) || "تعذر تنفيذ عملية الحضور والانصراف",
      ...(error?.details || {}),
    });
  }
}
