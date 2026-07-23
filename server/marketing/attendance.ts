import type { VercelRequest } from "@vercel/node";
import type { SessionUser } from "../_auth.js";
import { getSql } from "../_db.js";
import { MarketingError, clean, dateValue, hasPermission, isAdmin, pageValues } from "./common.js";

export async function attendanceData(request: VercelRequest, user: SessionUser) {
  const sql = getSql();
  const [settings] = await sql<any[]>`select * from marketing.attendance_settings where id=true`;
  const from = dateValue(request.query.from) || new Date().toISOString().slice(0,10);
  const to = dateValue(request.query.to) || from;
  const userId = clean(request.query.userId);
  const status = clean(request.query.status);
  const canManage = isAdmin(user) || hasPermission(user,"marketing.attendance.manage");
  const { page, pageSize, offset } = pageValues(request);
  const [today] = await sql<any[]>`
    select s.*,s.id::text,u.full_name,p.status presence_status,p.last_seen_at,p.last_activity_at
    from marketing.attendance_sessions s join core.users u on u.id=s.user_id left join marketing.presence p on p.user_id=s.user_id
    where s.user_id=${user.id}::uuid and s.work_date=(now() at time zone ${settings?.timezone || 'Asia/Riyadh'})::date
  `;
  const attendanceWhere = sql`
    s.work_date between ${from}::date and ${to}::date
      and (${userId}='' or s.user_id::text=${userId})
      and (${status}='' or (${status}='late' and s.late_minutes>0) or (${status}='present' and s.checked_in_at is not null) or (${status}='no_checkout' and s.checked_out_at is null))
  `;
  const rows = canManage ? await sql<any[]>`
    select s.*,s.id::text,u.full_name,u.email,p.status presence_status,p.last_seen_at,p.last_activity_at
    from marketing.attendance_sessions s join core.users u on u.id=s.user_id left join marketing.presence p on p.user_id=s.user_id
    where ${attendanceWhere}
    order by s.work_date desc,s.checked_in_at desc limit ${pageSize} offset ${offset}
  ` : today ? [today] : [];
  const [count] = canManage
    ? await sql<{ total: number }[]>`select count(*)::int total from marketing.attendance_sessions s where ${attendanceWhere}`
    : [{ total: today ? 1 : 0 }];
  const users = canManage ? await sql<any[]>`
    select distinct u.id::text,u.full_name from core.users u
    left join marketing.department_members dm on dm.user_id=u.id
    left join core.user_departments ud on ud.user_id=u.id left join core.departments d on d.id=ud.department_id
    where u.is_active=true and (dm.user_id is not null or d.code='marketing') order by u.full_name
  ` : [];
  const [summary] = canManage ? await sql<any[]>`
    select count(*)::int sessions,count(*) filter(where late_minutes>0)::int late_count,count(*) filter(where checked_out_at is null)::int no_checkout,
      coalesce(sum(work_minutes),0)::int total_work_minutes,count(distinct user_id)::int present_users
    from marketing.attendance_sessions where work_date between ${from}::date and ${to}::date
  ` : [{}];
  return { ok: true, settings, today: today || null, rows, users, summary: summary || {}, total: Number(count?.total || 0), canManage };
}

export async function attendanceAction(user: SessionUser, body: Record<string, any>, userAgent: string) {
  const sql = getSql();
  const action = clean(body.action);
  const [settings] = await sql<any[]>`select * from marketing.attendance_settings where id=true`;
  const timezone = settings?.timezone || "Asia/Riyadh";
  if (action === "attendance_check_in") {
    if (!hasPermission(user,"marketing.attendance.self") && !isAdmin(user)) throw new MarketingError(403,"لا توجد لديك صلاحية تسجيل الحضور","FORBIDDEN");
    const [row] = await sql<any[]>`
      insert into marketing.attendance_sessions(user_id,work_date,checked_in_at,late_minutes,check_in_source,user_agent)
      values (${user.id}::uuid,(now() at time zone ${timezone})::date,now(),greatest(0,extract(epoch from ((now() at time zone ${timezone})::time - (${settings?.work_start || '16:00'}::time + (${Number(settings?.grace_minutes || 15)} * interval '1 minute'))))/60)::int,'web',${userAgent.slice(0,500) || null})
      on conflict(user_id,work_date) do update set checked_in_at=coalesce(marketing.attendance_sessions.checked_in_at,excluded.checked_in_at),late_minutes=case when marketing.attendance_sessions.checked_in_at is null then excluded.late_minutes else marketing.attendance_sessions.late_minutes end,updated_at=now()
      returning *,id::text
    `;
    await sql`insert into marketing.presence(user_id,status,last_seen_at,last_activity_at,user_agent,updated_at) values (${user.id}::uuid,'online',now(),now(),${userAgent.slice(0,500) || null},now()) on conflict(user_id) do update set status='online',last_seen_at=now(),last_activity_at=now(),user_agent=excluded.user_agent,updated_at=now()`;
    return { ok:true,row,message:"تم تسجيل الحضور" };
  }
  if (action === "attendance_check_out") {
    const [row] = await sql<any[]>`
      update marketing.attendance_sessions set checked_out_at=now(),work_minutes=greatest(0,extract(epoch from (now()-checked_in_at))/60)::int,check_out_source='web',updated_at=now()
      where user_id=${user.id}::uuid and work_date=(now() at time zone ${timezone})::date and checked_out_at is null returning *,id::text
    `;
    if (!row) throw new MarketingError(409,"لا يوجد حضور مفتوح اليوم","NO_OPEN_ATTENDANCE");
    await sql`insert into marketing.presence(user_id,status,last_seen_at,last_activity_at,user_agent,updated_at) values (${user.id}::uuid,'offline',now(),now(),${userAgent.slice(0,500) || null},now()) on conflict(user_id) do update set status='offline',last_seen_at=now(),last_activity_at=now(),updated_at=now()`;
    return { ok:true,row,message:"تم تسجيل الانصراف" };
  }
  if (action === "attendance_heartbeat") {
    const idle = body.idle === true;
    await sql`insert into marketing.presence(user_id,status,last_seen_at,last_activity_at,user_agent,updated_at) values (${user.id}::uuid,${idle ? 'idle':'online'},now(),case when ${idle} then coalesce((select last_activity_at from marketing.presence where user_id=${user.id}::uuid),now()) else now() end,${userAgent.slice(0,500) || null},now()) on conflict(user_id) do update set status=excluded.status,last_seen_at=now(),last_activity_at=case when excluded.status='idle' then marketing.presence.last_activity_at else now() end,user_agent=excluded.user_agent,updated_at=now()`;
    return { ok:true };
  }
  throw new MarketingError(400,"إجراء الحضور غير مدعوم","INVALID_ACTION");
}
