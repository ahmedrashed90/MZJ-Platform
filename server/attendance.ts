import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin, requireUser } from "./_auth.js";
import { getSql } from "./_db.js";
import { ensureAttendanceSchema } from "./_attendance-schema.js";
import { AttendanceError, ATTENDANCE_TIME_ZONE, checkInCurrentAttendance, formatMinutes, getSelfAttendanceState, isAttendanceEnforcementEnabled } from "./_attendance.js";

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

function attendanceCoordinates(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const latitude = Number(source.latitude);
  const longitude = Number(source.longitude);
  const accuracy = source.accuracy === null || source.accuracy === undefined ? null : Number(source.accuracy);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
  };
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

async function adminBootstrap() {
  const sql = getSql();
  const [settings] = await sql<{ enforcement_enabled: boolean }[]>`
    select enforcement_enabled from core.attendance_settings where id=1 limit 1
  `;
  const [locations, schedules, periods, users, branches] = await Promise.all([
    sql<any[]>`
      select id::text,branch_id::text,name,latitude::float8,longitude::float8,radius_m,is_active
      from core.attendance_locations
      where is_active=true
      order by name
    `,
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
        coalesce(ab.id::text,crm_branch.id,global_branch.id) as branch_id,
        coalesce(ab.name,crm_branch.name,global_branch.name,'—') as branch_name,
        a.id::text as assignment_id,a.schedule_id::text,a.location_id::text,a.weekly_off_day,
        coalesce(a.period_ids,'{}'::uuid[]) as period_ids,
        s.name as schedule_name,l.name as location_name
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
      left join core.attendance_locations l on l.id=a.location_id
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
      where u.is_active=true
      order by u.full_name
    `,
    sql<any[]>`select id::text,code,name from core.branches where is_active=true order by sort_order,name`,
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

  return {
    ok: true,
    settings: { enforcementEnabled: Boolean(settings?.enforcement_enabled) },
    locations,
    schedules: schedules.map((schedule) => ({ ...schedule, periods: periodMap.get(String(schedule.id)) || [] })),
    users,
    branches,
  };
}

async function saveSettings(body: Record<string, any>, adminId: string) {
  const sql = getSql();
  const enforcementEnabled = body.enforcementEnabled === true;
  const [current] = await sql<{ enforcement_enabled: boolean }[]>`
    select enforcement_enabled from core.attendance_settings where id=1 limit 1
  `;
  await sql`
    insert into core.attendance_settings(id,enforcement_enabled,updated_by,updated_at)
    values(1,${enforcementEnabled},${adminId}::uuid,now())
    on conflict(id) do update
    set enforcement_enabled=excluded.enforcement_enabled,updated_by=excluded.updated_by,updated_at=now()
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

  return { ok: true, enforcementEnabled, forcedLogoutUsers };
}

async function saveLocation(body: Record<string, any>, adminId: string) {
  const sql = getSql();
  const id = clean(body.id);
  const name = clean(body.name);
  const branchId = validUuid(clean(body.branchId)) ? clean(body.branchId) : null;
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const radiusM = Math.max(10, Math.min(50000, Math.floor(Number(body.radiusM) || 150)));
  if (!name) throw new AttendanceError("LOCATION_NAME_REQUIRED", "اكتب اسم مكان الحضور");
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw new AttendanceError("INVALID_LOCATION", "أدخل إحداثيات صحيحة لمكان الحضور");
  }
  if (id && validUuid(id)) {
    const [row] = await sql<any[]>`
      update core.attendance_locations
      set branch_id=${branchId}::uuid,name=${name},latitude=${latitude},longitude=${longitude},radius_m=${radiusM},
          is_active=true,updated_by=${adminId}::uuid,updated_at=now()
      where id=${id}::uuid
      returning id::text
    `;
    if (!row) throw new AttendanceError("LOCATION_NOT_FOUND", "مكان الحضور غير موجود", 404);
    return { ok: true, id: row.id };
  }
  const [row] = await sql<any[]>`
    insert into core.attendance_locations(branch_id,name,latitude,longitude,radius_m,created_by,updated_by)
    values(${branchId}::uuid,${name},${latitude},${longitude},${radiusM},${adminId}::uuid,${adminId}::uuid)
    returning id::text
  `;
  return { ok: true, id: row.id };
}

async function deleteLocation(body: Record<string, any>, adminId: string) {
  const sql = getSql();
  const id = clean(body.id);
  if (!validUuid(id)) throw new AttendanceError("LOCATION_NOT_FOUND", "مكان الحضور غير موجود", 404);
  const [inUse] = await sql<any[]>`
    select 1
    from core.attendance_user_schedules
    where location_id=${id}::uuid and effective_to is null
    limit 1
  `;
  if (inUse) throw new AttendanceError("LOCATION_IN_USE", "لا يمكن حذف المكان لأنه محدد حاليًا لموظفين");
  await sql`update core.attendance_locations set is_active=false,updated_by=${adminId}::uuid,updated_at=now() where id=${id}::uuid`;
  return { ok: true };
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
  const locationId = validUuid(clean(body.locationId)) ? clean(body.locationId) : null;
  const requestedBranchId = validUuid(clean(body.branchId)) ? clean(body.branchId) : null;
  const weeklyOffDay = parseWeeklyOffDay(body.weeklyOffDay);
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
    assertSelectedPeriodsDoNotOverlap(selectedPeriods);
  }
  if (locationId) {
    const [location] = await sql<any[]>`select id::text from core.attendance_locations where id=${locationId}::uuid and is_active=true`;
    if (!location) throw new AttendanceError("INVALID_LOCATION", "مكان الحضور غير متاح");
  }
  if (requestedBranchId) {
    const [branch] = await sql<any[]>`select id::text from core.branches where id=${requestedBranchId}::uuid and is_active=true`;
    if (!branch) throw new AttendanceError("INVALID_BRANCH", "الفرع المختار غير متاح");
  }

  await sql.begin(async (tx) => {
    for (const userId of userIds) {
      const [user] = await tx<any[]>`select id::text from core.users where id=${userId}::uuid and is_active=true`;
      if (!user) continue;
      const [current] = await tx<any[]>`
        select id::text,schedule_id::text,location_id::text,branch_id::text,period_ids,weekly_off_day,effective_from::text
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

      let effectiveBranchId = requestedBranchId || (validUuid(clean(current?.branch_id)) ? clean(current.branch_id) : null);
      if (!effectiveBranchId) {
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

      const same = current
        && clean(current.schedule_id) === scheduleId
        && clean(current.location_id) === clean(locationId)
        && clean(current.branch_id) === clean(effectiveBranchId)
        && sameIdList(current.period_ids, periodIds)
        && parseWeeklyOffDay(current.weekly_off_day) === weeklyOffDay;
      if (same) continue;

      if (current && dateOnlyValue(current.effective_from) === currentRiyadhDate()) {
        await tx`
          update core.attendance_user_schedules
          set schedule_id=${scheduleId}::uuid,location_id=${locationId}::uuid,branch_id=${effectiveBranchId}::uuid,
              period_ids=${periodIds}::uuid[],weekly_off_day=${weeklyOffDay}
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
          insert into core.attendance_user_schedules(user_id,schedule_id,location_id,branch_id,period_ids,weekly_off_day,effective_from,created_by)
          values(${userId}::uuid,${scheduleId}::uuid,${locationId}::uuid,${effectiveBranchId}::uuid,${periodIds}::uuid[],${weeklyOffDay},(now() at time zone ${ATTENDANCE_TIME_ZONE})::date,${adminId}::uuid)
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
          ) as branch_name
        from core.users u
        where u.is_active=true
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
          ) as branch_name
        from core.users u
        where u.is_active=true
        order by u.full_name
      `;
  const userIds = users.map((user) => String(user.id));
  if (!userIds.length) return { ok: true, from, to, rows: [], periodHeaders: [] };

  const [assignments, periods, records] = await Promise.all([
    sql<any[]>`
      select
        a.id::text,a.user_id::text,a.schedule_id::text,a.location_id::text,a.branch_id::text,
        coalesce(a.period_ids,'{}'::uuid[]) as period_ids,a.weekly_off_day,
        a.effective_from::text,a.effective_to::text,s.name as schedule_name,l.name as location_name,b.name as branch_name
      from core.attendance_user_schedules a
      join core.attendance_schedules s on s.id=a.schedule_id
      left join core.attendance_locations l on l.id=a.location_id
      left join core.branches b on b.id=a.branch_id
      where a.user_id::text in ${sql(userIds)}
        and a.effective_from <= ${to}::date
        and (a.effective_to is null or a.effective_to >= ${from}::date)
      order by a.user_id,a.effective_from desc
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
        delay_minutes,work_minutes,status,
        required_location_name,
        check_in_latitude::float8,check_in_longitude::float8,check_in_accuracy_m::float8,check_in_distance_m::float8,
        location_result
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
    assignmentMap.get(key)!.push(assignment);
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
      const dayRecords = recordMap.get(`${user.id}:${day}`) || [];
      const assignedPeriodIds = normalizedIdList(assignment?.period_ids);
      const schedulePeriods = assignment
        ? (periodMap.get(String(assignment.schedule_id)) || []).filter((period) => Boolean(period.is_active) && (!assignedPeriodIds.length || assignedPeriodIds.includes(clean(period.id))))
        : [];
      const isDayOff = Boolean(assignment)
        && parseWeeklyOffDay(assignment.weekly_off_day) !== null
        && weekdayForDate(day) === parseWeeklyOffDay(assignment.weekly_off_day);

      const slots: any[] = schedulePeriods.map((period) => {
        const record = dayRecords.find((item) => clean(item.period_id) === clean(period.id)) || null;
        return {
          id: period.id,
          name: clean(period.name) || "فترة العمل",
          startTime: clean(period.start_time).slice(0, 5),
          endTime: clean(period.end_time).slice(0, 5),
          graceMinutes: Number(period.grace_minutes || 0),
          sortOrder: Number(period.sort_order || 0),
          record,
        };
      });

      for (const record of dayRecords) {
        if (slots.some((slot) => slot.record?.id === record.id)) continue;
        slots.push({
          id: record.period_id || `record:${record.id}`,
          name: clean(record.period_name) || `فترة العمل ${slots.length + 1}`,
          startTime: record.scheduled_start_at ? new Intl.DateTimeFormat("en-GB", { timeZone: ATTENDANCE_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(record.scheduled_start_at)) : "",
          endTime: record.scheduled_end_at ? new Intl.DateTimeFormat("en-GB", { timeZone: ATTENDANCE_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(record.scheduled_end_at)) : "",
          graceMinutes: Number(record.grace_minutes || 0),
          sortOrder: Number(record.period_sort_order || slots.length + 1),
          record,
        });
      }
      slots.sort((a, b) => a.sortOrder - b.sortOrder);

      const checkedRecords = slots.map((slot) => slot.record).filter(Boolean);
      const locatedRecords = checkedRecords.filter((record) =>
        record.check_in_latitude !== null
        && record.check_in_latitude !== undefined
        && record.check_in_longitude !== null
        && record.check_in_longitude !== undefined
      );
      const primaryLocatedRecord = locatedRecords[0] || null;
      const actualLocations = Array.from(new Set(locatedRecords
        .map((record) => `${Number(record.check_in_latitude).toFixed(6)}, ${Number(record.check_in_longitude).toFixed(6)}`)));
      const requiredLocations = Array.from(new Set(checkedRecords
        .map((record) => clean(record.required_location_name))
        .filter(Boolean)));
      const hasRequiredLocation = requiredLocations.length > 0 || Boolean(assignment?.location_id);
      const hasRecordedCheckIn = checkedRecords.some((record) => Boolean(record.check_in));
      const missingRequiredLocationCapture = hasRequiredLocation && hasRecordedCheckIn && locatedRecords.length === 0;
      let locationResult = hasRequiredLocation ? "—" : "غير مطلوب";
      if (hasRequiredLocation && checkedRecords.length) {
        locationResult = checkedRecords.some((record) => record.location_result === "mismatched") ? "غير مطابق"
          : checkedRecords.some((record) => record.location_result === "matched") ? "مطابق"
          : "—";
      }

      const periodsByKey = new Map<string, any>();
      for (const slot of slots) {
        const record = slot.record;
        let result = "—";
        if (record?.check_in) {
          const statusText = Number(record.delay_minutes || 0) > 0 ? "متأخر" : "حاضر";
          const workText = record.check_out ? `العمل ${formatMinutes(Number(record.work_minutes || 0))}` : "الفترة مفتوحة";
          const delayText = Number(record.delay_minutes || 0) > 0 ? `تأخير ${Number(record.delay_minutes)} د` : "بدون تأخير";
          result = `${statusText} • ${workText} • ${delayText}`;
        } else if (isDayOff) {
          result = "إجازة";
        } else if (day < today) {
          result = "غائب";
        } else if (day === today) {
          result = "لم يسجل";
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
          checkoutSource: record?.checkout_source || null,
          result,
          delayMinutes: Number(record?.delay_minutes || 0),
          workMinutes: Number(record?.work_minutes || 0),
        });
      }

      rawRows.push({
        date: day,
        branch: assignment?.branch_name || user.branch_name || "—",
        userId: user.id,
        employeeNo: user.employee_no,
        name: user.full_name,
        location: {
          actual: actualLocations.length ? actualLocations.join(" / ") : missingRequiredLocationCapture ? "لم يتم حفظ اللوكيشن" : "—",
          required: requiredLocations.length ? requiredLocations.join(" / ") : assignment?.location_name || "غير مطلوب",
          result: locationResult,
          missingRequiredCapture: missingRequiredLocationCapture,
          latitude: primaryLocatedRecord ? Number(primaryLocatedRecord.check_in_latitude) : null,
          longitude: primaryLocatedRecord ? Number(primaryLocatedRecord.check_in_longitude) : null,
          distanceM: primaryLocatedRecord?.check_in_distance_m === null || primaryLocatedRecord?.check_in_distance_m === undefined
            ? null
            : Number(primaryLocatedRecord.check_in_distance_m),
          accuracyM: primaryLocatedRecord?.check_in_accuracy_m === null || primaryLocatedRecord?.check_in_accuracy_m === undefined
            ? null
            : Number(primaryLocatedRecord.check_in_accuracy_m),
          captures: actualLocations.length,
        },
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

  return { ok: true, from, to, rows, periodHeaders, users: users.map((user) => ({ id: user.id, fullName: user.full_name })) };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    await ensureAttendanceSchema();
    const user = await requireUser(request, response);
    if (!user) return;

    if (request.method === "GET") {
      const view = clean(request.query.view);
      if (view === "self") {
        return response.status(200).json({ ok: true, state: await getSelfAttendanceState(user.id) });
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
      const coordinates = attendanceCoordinates(body.location);
      const stateBefore = await getSelfAttendanceState(user.id);
      if (stateBefore.locationRequired && !coordinates) {
        throw new AttendanceError("ATTENDANCE_LOCATION_REQUIRED", "يجب تحديد الموقع لتسجيل الحضور", 409, {
          locationRequired: true,
          requiredLocationName: stateBefore.requiredLocationName,
          periodName: stateBefore.activePeriod?.name || null,
        });
      }
      await checkInCurrentAttendance(user.id, coordinates);
      return response.status(200).json({ ok: true, state: await getSelfAttendanceState(user.id) });
    }

    const admin = await requireAdmin(request, response);
    if (!admin) return;
    let result: any;
    if (action === "save_settings") result = await saveSettings(body, admin.id);
    else if (action === "save_location") result = await saveLocation(body, admin.id);
    else if (action === "delete_location") result = await deleteLocation(body, admin.id);
    else if (action === "save_schedule") result = await saveSchedule(body, admin.id);
    else if (action === "delete_schedule") result = await deleteSchedule(body, admin.id);
    else if (action === "assign_users") result = await assignUsers(body, admin.id);
    else throw new AttendanceError("UNSUPPORTED_ACTION", "الإجراء غير مدعوم", 400);
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
