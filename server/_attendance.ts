import { getSql, withDatabaseAdvisoryLock } from "./_db.js";
import { ensureAttendanceSchema } from "./_attendance-schema.js";

export const ATTENDANCE_TIME_ZONE = "Asia/Riyadh";

export type ActiveAttendancePeriod = {
  assignment_id: string;
  user_id: string;
  schedule_id: string;
  schedule_name: string;
  period_id: string;
  period_name: string;
  period_sort_order: number;
  start_time: string;
  end_time: string;
  grace_minutes: number;
  work_date: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
};

export class AttendanceError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, status = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = "AttendanceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function dateOnly(value: unknown) {
  return String(value ?? "").slice(0, 10);
}

export function formatMinutes(minutes: number) {
  const safe = Math.max(0, Math.floor(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!hours) return `${rest} د`;
  if (!rest) return `${hours} س`;
  return `${hours} س ${rest} د`;
}

export async function isAttendanceEnforcementEnabled() {
  await ensureAttendanceSchema();
  const sql = getSql();
  const [row] = await sql<{ enforcement_enabled: boolean }[]>`
    select enforcement_enabled
    from core.attendance_settings
    where id=1
    limit 1
  `;
  return Boolean(row?.enforcement_enabled);
}

async function officialAttendanceDayState() {
  const sql = getSql();
  const [row] = await sql<{ official_day_end: string; after_official_day_end: boolean }[]>`
    select
      official_day_end::text as official_day_end,
      ((now() at time zone ${ATTENDANCE_TIME_ZONE})::time >= official_day_end) as after_official_day_end
    from core.attendance_settings
    where id=1
    limit 1
  `;
  return {
    officialDayEnd: String(row?.official_day_end || "21:00").slice(0, 5),
    afterOfficialDayEnd: Boolean(row?.after_official_day_end),
  };
}

async function currentAssignment(userId: string) {
  const sql = getSql();
  const [row] = await sql<any[]>`
    select
      a.id::text as assignment_id,a.user_id::text,a.schedule_id::text,s.name as schedule_name,
      a.weekly_off_day,a.period_ids,a.effective_from::text,a.effective_to::text,
      (a.weekly_off_day is not null and extract(dow from (now() at time zone ${ATTENDANCE_TIME_ZONE})::date)::int=a.weekly_off_day) as is_day_off
    from core.attendance_user_schedules a
    join core.attendance_schedules s on s.id=a.schedule_id and s.is_active=true
    where a.user_id=${userId}::uuid
      and a.effective_from <= (now() at time zone ${ATTENDANCE_TIME_ZONE})::date
      and (a.effective_to is null or a.effective_to >= (now() at time zone ${ATTENDANCE_TIME_ZONE})::date)
    order by a.effective_from desc,a.created_at desc
    limit 1
  `;
  return row || null;
}

export async function getActiveAttendancePeriod(userId: string): Promise<ActiveAttendancePeriod | null> {
  await ensureAttendanceSchema();
  const sql = getSql();
  const [row] = await sql<any[]>`
    with clock as (
      select now() as current_at,
        (now() at time zone ${ATTENDANCE_TIME_ZONE})::date as local_date,
        (now() at time zone ${ATTENDANCE_TIME_ZONE})::time as local_time
    ),
    settings as (
      select official_day_end from core.attendance_settings where id=1
    ),
    candidates as (
      select
        a.id::text as assignment_id,a.user_id::text,a.schedule_id::text,s.name as schedule_name,
        a.weekly_off_day,a.period_ids,
        p.id::text as period_id,p.name as period_name,p.sort_order as period_sort_order,
        p.start_time::text as start_time,p.end_time::text as end_time,p.grace_minutes,
        st.official_day_end,
        a.effective_from,a.effective_to,
        case
          when p.end_time <= p.start_time and c.local_time < p.end_time then c.local_date - 1
          else c.local_date
        end as work_date,
        c.current_at
      from clock c
      cross join settings st
      join core.attendance_user_schedules a
        on a.user_id=${userId}::uuid
       and a.effective_from <= c.local_date
       and (a.effective_to is null or a.effective_to >= c.local_date - 1)
      join core.attendance_schedules s on s.id=a.schedule_id and s.is_active=true
      join core.attendance_periods p on p.schedule_id=s.id and p.is_active=true
       and (a.period_ids is null or cardinality(a.period_ids)=0 or p.id=any(a.period_ids))
    ),
    timed as (
      select *,
        ((work_date + start_time::time) at time zone ${ATTENDANCE_TIME_ZONE}) as scheduled_start_at,
        least(
          (((work_date + case when end_time::time <= start_time::time then 1 else 0 end) + end_time::time) at time zone ${ATTENDANCE_TIME_ZONE}),
          ((work_date + official_day_end) at time zone ${ATTENDANCE_TIME_ZONE})
        ) as scheduled_end_at
      from candidates
      where effective_from <= work_date and (effective_to is null or effective_to >= work_date)
        and (weekly_off_day is null or extract(dow from work_date)::int <> weekly_off_day)
    )
    select *
    from timed
    where current_at >= scheduled_start_at and current_at < scheduled_end_at
    order by period_sort_order,start_time
    limit 1
  `;

  if (!row) return null;
  return {
    assignment_id: String(row.assignment_id),
    user_id: String(row.user_id),
    schedule_id: String(row.schedule_id),
    schedule_name: String(row.schedule_name || ""),
    period_id: String(row.period_id),
    period_name: String(row.period_name || ""),
    period_sort_order: Number(row.period_sort_order || 0),
    start_time: String(row.start_time || "").slice(0, 5),
    end_time: String(row.end_time || "").slice(0, 5),
    grace_minutes: Math.max(0, Number(row.grace_minutes || 0)),
    work_date: dateOnly(row.work_date),
    scheduled_start_at: new Date(row.scheduled_start_at).toISOString(),
    scheduled_end_at: new Date(row.scheduled_end_at).toISOString(),
  };
}

async function recordForPeriod(userId: string, period: ActiveAttendancePeriod) {
  const sql = getSql();
  const [row] = await sql<any[]>`
    select *,id::text,user_id::text,assignment_id::text,schedule_id::text,period_id::text,
      work_date::text as work_date
    from core.attendance_records
    where user_id=${userId}::uuid
      and period_id=${period.period_id}::uuid
      and work_date=${period.work_date}::date
    limit 1
  `;
  return row || null;
}

async function closeExpiredAttendanceForUser(userId: string) {
  const sql = getSql();
  const closed = await sql<{ id: string }[]>`
    update core.attendance_records r
    set
      check_out=least(r.scheduled_end_at,((r.work_date + st.official_day_end) at time zone ${ATTENDANCE_TIME_ZONE})),
      checkout_source='auto',
      work_minutes=greatest(0,floor(extract(epoch from (least(r.scheduled_end_at,((r.work_date + st.official_day_end) at time zone ${ATTENDANCE_TIME_ZONE}))-r.check_in))/60))::int,
      updated_at=now()
    from core.attendance_settings st
    where st.id=1
      and r.user_id=${userId}::uuid
      and r.check_in is not null
      and r.check_out is null
      and r.scheduled_end_at is not null
      and least(r.scheduled_end_at,((r.work_date + st.official_day_end) at time zone ${ATTENDANCE_TIME_ZONE})) <= now()
    returning r.id::text
  `;
  return closed.length;
}

export async function getLoginAttendanceState(userId: string) {
  await ensureAttendanceSchema();
  await closeExpiredAttendanceForUser(userId);
  const [activePeriod, officialDay] = await Promise.all([
    getActiveAttendancePeriod(userId),
    officialAttendanceDayState(),
  ]);
  const assignment = activePeriod ? null : await currentAssignment(userId);
  if (!activePeriod) {
    return {
      assigned: Boolean(assignment),
      activePeriod: null,
      record: null,
      scheduleName: assignment?.schedule_name || null,
      isDayOff: Boolean(assignment?.is_day_off),
      weeklyOffDay: assignment?.weekly_off_day === null || assignment?.weekly_off_day === undefined ? null : Number(assignment.weekly_off_day),
      officialDayEnd: officialDay.officialDayEnd,
      afterOfficialDayEnd: officialDay.afterOfficialDayEnd,
    };
  }
  const record = await recordForPeriod(userId, activePeriod);
  return {
    assigned: true, activePeriod, record, scheduleName: activePeriod.schedule_name, isDayOff: false, weeklyOffDay: null,
    officialDayEnd: officialDay.officialDayEnd, afterOfficialDayEnd: officialDay.afterOfficialDayEnd,
  };
}

function isoOrNull(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function getSelfAttendanceState(userId: string) {
  const [state, enforcementEnabled] = await Promise.all([
    getLoginAttendanceState(userId),
    isAttendanceEnforcementEnabled(),
  ]);
  const period = state.activePeriod;
  const record = state.record;
  const checkedIn = Boolean(record?.check_in);
  const checkedOut = Boolean(record?.check_out);

  return {
    enforcementEnabled,
    assigned: state.assigned,
    scheduleName: state.scheduleName || null,
    isDayOff: Boolean(state.isDayOff),
    weeklyOffDay: state.weeklyOffDay,
    officialDayEnd: state.officialDayEnd,
    afterOfficialDayEnd: Boolean(state.afterOfficialDayEnd),
    activePeriod: period ? {
      id: period.period_id,
      name: period.period_name,
      startTime: period.start_time,
      endTime: period.end_time,
      graceMinutes: period.grace_minutes,
      workDate: period.work_date,
      scheduledStartAt: period.scheduled_start_at,
      scheduledEndAt: period.scheduled_end_at,
    } : null,
    record: record ? {
      id: String(record.id || ""),
      checkIn: isoOrNull(record.check_in),
      checkOut: isoOrNull(record.check_out),
      checkoutSource: record.checkout_source || null,
      delayMinutes: Math.max(0, Number(record.delay_minutes || 0)),
      workMinutes: Math.max(0, Number(record.work_minutes || 0)),
      status: String(record.status || ""),
    } : null,
    canCheckIn: Boolean(period && !checkedIn),
    canCheckOut: Boolean(checkedIn && !checkedOut),
  };
}

export async function checkInCurrentAttendance(userId: string) {
  const state = await getLoginAttendanceState(userId);
  if (!state.assigned) {
    throw new AttendanceError("ATTENDANCE_NOT_ASSIGNED", "لم يتم تحديد جدول عمل لهذا المستخدم", 400);
  }
  if (!state.activePeriod) {
    if (state.isDayOff) {
      throw new AttendanceError("WEEKLY_DAY_OFF", "اليوم هو يوم الإجازة الأسبوعية المحدد لك", 400);
    }
    throw new AttendanceError("OUTSIDE_WORK_PERIOD", "لا توجد فترة عمل فعالة الآن لتسجيل الحضور", 400);
  }
  if (state.record?.check_in && !state.record?.check_out) return state.record;
  if (state.record?.check_out) {
    throw new AttendanceError("ATTENDANCE_PERIOD_CLOSED", "تم تسجيل الانصراف لهذه الفترة بالفعل", 400);
  }
  return registerAttendanceCheckIn(userId, state.activePeriod);
}

export async function requireAttendanceForLogin(
  userId: string,
  options: { confirmCheckIn?: boolean } = {},
) {
  const enforcementEnabled = await isAttendanceEnforcementEnabled();
  const state = await getLoginAttendanceState(userId);

  if (!state.assigned) return { enforced: false, checkedIn: false, state };

  if (!state.activePeriod) {
    if (!enforcementEnabled || state.afterOfficialDayEnd) return { enforced: false, checkedIn: false, state };
    if (state.isDayOff) {
      throw new AttendanceError(
        "WEEKLY_DAY_OFF",
        "اليوم هو يوم الإجازة الأسبوعية المحدد لك",
        403,
        { scheduleName: state.scheduleName, weeklyOffDay: state.weeklyOffDay },
      );
    }
    throw new AttendanceError(
      "OUTSIDE_WORK_PERIOD",
      state.scheduleName ? `لا توجد فترة عمل فعالة الآن ضمن جدول ${state.scheduleName}` : "لا توجد فترة عمل فعالة الآن",
      403,
      { scheduleName: state.scheduleName },
    );
  }

  const attendanceDetails = {
    attendanceRequired: true,
    scheduleName: state.activePeriod.schedule_name,
    periodName: state.activePeriod.period_name,
    startTime: state.activePeriod.start_time,
    endTime: state.activePeriod.end_time,
  };

  if (state.record?.check_in && !state.record?.check_out) {
    return { enforced: enforcementEnabled, checkedIn: true, state };
  }
  if (state.record?.check_out) {
    if (!enforcementEnabled) return { enforced: false, checkedIn: false, state };
    throw new AttendanceError("ATTENDANCE_PERIOD_CLOSED", "تم إنهاء هذه الفترة بالفعل. انتظر فترة العمل التالية.", 403);
  }

  if (options.confirmCheckIn) {
    const record = await registerAttendanceCheckIn(userId, state.activePeriod);
    return { enforced: enforcementEnabled, checkedIn: true, state: { ...state, record } };
  }

  if (enforcementEnabled) {
    throw new AttendanceError(
      "ATTENDANCE_REQUIRED",
      "سجل الحضور لإكمال الدخول إلى المنصة",
      409,
      attendanceDetails,
    );
  }

  return { enforced: false, checkedIn: false, state };
}

export async function registerAttendanceCheckIn(
  userId: string,
  period: ActiveAttendancePeriod,
) {
  await ensureAttendanceSchema();
  return withDatabaseAdvisoryLock(`mzj:attendance-check-in:${userId}`, async () => {
    const sql = getSql();
    const existing = await recordForPeriod(userId, period);
    if (existing?.check_in) return existing;

    const scheduledStart = new Date(period.scheduled_start_at).getTime();
    const lateAfter = scheduledStart + period.grace_minutes * 60000;
    const delayMinutes = Math.max(0, Math.floor((Date.now() - lateAfter) / 60000));
    const status = delayMinutes > 0 ? "late" : "present";

    const [row] = await sql<any[]>`
      insert into core.attendance_records(
        user_id,assignment_id,schedule_id,period_id,work_date,
        period_name,period_sort_order,scheduled_start_at,scheduled_end_at,grace_minutes,
        check_in,delay_minutes,work_minutes,status,created_at,updated_at
      ) values (
        ${userId}::uuid,${period.assignment_id}::uuid,${period.schedule_id}::uuid,${period.period_id}::uuid,${period.work_date}::date,
        ${period.period_name},${period.period_sort_order},${period.scheduled_start_at}::timestamptz,${period.scheduled_end_at}::timestamptz,${period.grace_minutes},
        now(),${delayMinutes},0,${status},now(),now()
      )
      on conflict(user_id,period_id,work_date) where period_id is not null
      do update set
        check_in=coalesce(core.attendance_records.check_in,excluded.check_in),
        delay_minutes=case when core.attendance_records.check_in is null then excluded.delay_minutes else core.attendance_records.delay_minutes end,
        status=case when core.attendance_records.check_in is null then excluded.status else core.attendance_records.status end,
        updated_at=now()
      returning *,id::text,user_id::text,assignment_id::text,schedule_id::text,period_id::text,work_date::text as work_date
    `;
    if (!row?.check_in) {
      throw new AttendanceError("ATTENDANCE_CHECK_IN_NOT_SAVED", "تعذر حفظ وقت الحضور. حاول مرة أخرى.", 500);
    }
    return row;
  });
}

export async function isAttendanceSessionAllowed(userId: string, verifiedDeviceId?: string | null) {
  await ensureAttendanceSchema();
  const sql = getSql();

  const normalizedDeviceId = String(verifiedDeviceId || "").trim();
  const [deviceState] = await sql<{ verification_required: boolean; status: string | null; is_primary: boolean | null }[]>`
    select coalesce(p.verification_required,false) as verification_required,d.status,d.is_primary
    from core.users u
    left join core.user_device_policies p on p.user_id=u.id
    left join core.user_devices d on d.user_id=u.id and d.device_id=${normalizedDeviceId || "__NO_DEVICE__"}
    where u.id=${userId}::uuid
    limit 1
  `.catch(() => [] as any);
  if (deviceState?.verification_required) {
    if (!normalizedDeviceId || deviceState.status !== "approved") return false;
    if (deviceState.is_primary === false) return true;
  }

  if (!(await isAttendanceEnforcementEnabled())) return true;
  const [row] = await sql<{ allowed: boolean }[]>`
    with clock as (
      select now() as current_at,
        (now() at time zone ${ATTENDANCE_TIME_ZONE})::date as local_date,
        (now() at time zone ${ATTENDANCE_TIME_ZONE})::time as local_time
    ),
    settings as (select official_day_end from core.attendance_settings where id=1),
    current_assignment as (
      select a.id
      from clock c
      join core.attendance_user_schedules a
        on a.user_id=${userId}::uuid
       and a.effective_from <= c.local_date
       and (a.effective_to is null or a.effective_to >= c.local_date)
      join core.attendance_schedules s on s.id=a.schedule_id and s.is_active=true
      limit 1
    ),
    period_candidates as (
      select
        a.id as assignment_id,a.schedule_id,a.weekly_off_day,p.id as period_id,p.start_time,p.end_time,
        case
          when p.end_time <= p.start_time and c.local_time < p.end_time then c.local_date - 1
          else c.local_date
        end as work_date,
        c.current_at
      from clock c
      join core.attendance_user_schedules a
        on a.user_id=${userId}::uuid
       and a.effective_from <= c.local_date
       and (a.effective_to is null or a.effective_to >= c.local_date - 1)
      join core.attendance_schedules s on s.id=a.schedule_id and s.is_active=true
      join core.attendance_periods p on p.schedule_id=s.id and p.is_active=true
       and (a.period_ids is null or cardinality(a.period_ids)=0 or p.id=any(a.period_ids))
    ),
    active_period as (
      select pc.*
      from period_candidates pc
      where pc.assignment_id in (
        select a.id
        from core.attendance_user_schedules a
        where a.id=pc.assignment_id
          and a.effective_from <= pc.work_date
          and (a.effective_to is null or a.effective_to >= pc.work_date)
      )
        and (pc.weekly_off_day is null or extract(dow from pc.work_date)::int <> pc.weekly_off_day)
        and pc.current_at >= ((pc.work_date + pc.start_time) at time zone ${ATTENDANCE_TIME_ZONE})
        and pc.current_at < (((pc.work_date + case when pc.end_time <= pc.start_time then 1 else 0 end) + pc.end_time) at time zone ${ATTENDANCE_TIME_ZONE})
      limit 1
    )
    select case
      when (select local_time from clock) >= (select official_day_end from settings) then true
      when not exists(select 1 from current_assignment) and not exists(select 1 from active_period) then true
      else exists(
        select 1
        from active_period ap
        join core.attendance_records r
          on r.user_id=${userId}::uuid
         and r.period_id=ap.period_id
         and r.work_date=ap.work_date
         and r.check_in is not null
         and r.check_out is null
      )
    end as allowed
  `;
  return Boolean(row?.allowed);
}

export async function checkoutCurrentAttendance(
  userId: string,
  options: { allowMissing?: boolean; revokeSessions?: boolean } = {},
) {
  await ensureAttendanceSchema();
  return withDatabaseAdvisoryLock(`mzj:attendance-check-out:${userId}`, async () => {
    const sql = getSql();
    const [row] = await sql<any[]>`
      update core.attendance_records r
      set
        check_out=least(now(),r.scheduled_end_at,((r.work_date + st.official_day_end) at time zone ${ATTENDANCE_TIME_ZONE})),
        checkout_source='manual',
        work_minutes=greatest(0,floor(extract(epoch from (least(now(),r.scheduled_end_at,((r.work_date + st.official_day_end) at time zone ${ATTENDANCE_TIME_ZONE}))-r.check_in))/60))::int,
        updated_at=now()
      from core.attendance_settings st
      where st.id=1 and r.id=(
        select id
        from core.attendance_records
        where user_id=${userId}::uuid and check_in is not null and check_out is null
        order by check_in desc
        limit 1
      )
      returning r.*,r.id::text,r.user_id::text,r.assignment_id::text,r.schedule_id::text,r.period_id::text,r.work_date::text as work_date
    `;
    if (!row) {
      if (options.allowMissing) return null;
      throw new AttendanceError("NO_OPEN_ATTENDANCE", "لا توجد فترة حضور مفتوحة لتسجيل الانصراف", 400);
    }
    if (options.revokeSessions !== false) {
      await sql`delete from core.sessions where user_id=${userId}::uuid`;
    }
    return row;
  });
}

export async function runAttendanceTick() {
  await ensureAttendanceSchema();
  const enforcementEnabled = await isAttendanceEnforcementEnabled();
  const sql = getSql();
  const closed = await sql<{ user_id: string }[]>`
    update core.attendance_records r
    set
      check_out=least(r.scheduled_end_at,((r.work_date + st.official_day_end) at time zone ${ATTENDANCE_TIME_ZONE})),
      checkout_source='auto',
      work_minutes=greatest(0,floor(extract(epoch from (least(r.scheduled_end_at,((r.work_date + st.official_day_end) at time zone ${ATTENDANCE_TIME_ZONE}))-r.check_in))/60))::int,
      updated_at=now()
    from core.attendance_settings st
    where st.id=1
      and r.check_in is not null
      and r.check_out is null
      and r.scheduled_end_at is not null
      and least(r.scheduled_end_at,((r.work_date + st.official_day_end) at time zone ${ATTENDANCE_TIME_ZONE})) <= now()
    returning r.user_id::text
  `;
  const closedUserIds = [...new Set(closed.map((row) => String(row.user_id)).filter(Boolean))];

  if (enforcementEnabled && closedUserIds.length) {
    await sql`delete from core.sessions where user_id::text in ${sql(closedUserIds)}`;
  }

  return {
    ok: true,
    enforcementEnabled,
    closedRecords: closed.length,
    forcedLogoutUsers: enforcementEnabled ? closedUserIds.length : 0,
  };
}
