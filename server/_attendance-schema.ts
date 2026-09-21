import { getSql, runSqlScript, withDatabaseAdvisoryLock } from "./_db.js";
import { ensureAccessControlSchema } from "./_access-control-schema.js";

export const ATTENDANCE_SCHEMA_VERSION = "20260921-global-attendance-v7-official-day-end";

export const ATTENDANCE_SCHEMA_SQL = String.raw`
create table if not exists core.attendance_settings (
  id smallint primary key default 1 check (id = 1),
  enforcement_enabled boolean not null default false,
  official_day_end time not null default '21:00',
  updated_by uuid references core.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table core.attendance_settings add column if not exists official_day_end time not null default '21:00';
insert into core.attendance_settings(id,enforcement_enabled,official_day_end) values(1,false,'21:00')
on conflict(id) do nothing;

create table if not exists core.attendance_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_by uuid references core.users(id) on delete set null,
  updated_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists attendance_schedules_name_unique
  on core.attendance_schedules(lower(btrim(name))) where is_active=true;

create table if not exists core.attendance_periods (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references core.attendance_schedules(id) on delete cascade,
  name text not null,
  start_time time not null,
  end_time time not null,
  grace_minutes integer not null default 0 check (grace_minutes between 0 and 360),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists attendance_periods_schedule_idx
  on core.attendance_periods(schedule_id,is_active,sort_order,start_time);

create table if not exists core.attendance_user_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  schedule_id uuid not null references core.attendance_schedules(id) on delete restrict,
  branch_id uuid references core.branches(id) on delete set null,
  period_ids uuid[],
  weekly_off_day smallint,
  effective_from date not null,
  effective_to date,
  created_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint attendance_user_schedules_weekly_off_day_check check (weekly_off_day is null or weekly_off_day between 0 and 6),
  check (effective_to is null or effective_to >= effective_from)
);
alter table core.attendance_user_schedules add column if not exists branch_id uuid references core.branches(id) on delete set null;
alter table core.attendance_user_schedules add column if not exists period_ids uuid[];
alter table core.attendance_user_schedules add column if not exists weekly_off_day smallint;
update core.attendance_user_schedules a
set period_ids=(
  select array_agg(p.id order by p.sort_order,p.start_time,p.id)
  from core.attendance_periods p
  where p.schedule_id=a.schedule_id and p.is_active=true
)
where a.period_ids is null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='attendance_user_schedules_weekly_off_day_check'
      and conrelid='core.attendance_user_schedules'::regclass
  ) then
    alter table core.attendance_user_schedules
      add constraint attendance_user_schedules_weekly_off_day_check
      check (weekly_off_day is null or weekly_off_day between 0 and 6);
  end if;
end $$;
create index if not exists attendance_user_schedules_user_dates_idx
  on core.attendance_user_schedules(user_id,effective_from desc,effective_to);
create unique index if not exists attendance_user_schedules_current_unique
  on core.attendance_user_schedules(user_id) where effective_to is null;

create table if not exists core.attendance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  assignment_id uuid references core.attendance_user_schedules(id) on delete set null,
  schedule_id uuid references core.attendance_schedules(id) on delete set null,
  period_id uuid references core.attendance_periods(id) on delete set null,
  work_date date not null,
  period_name text,
  period_sort_order integer,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  grace_minutes integer not null default 0,
  check_in timestamptz,
  check_out timestamptz,
  checkout_source text check (checkout_source in ('manual','auto','legacy')),
  delay_minutes integer not null default 0,
  work_minutes integer not null default 0,
  status text not null default 'present',
  legacy_source_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists attendance_records_user_period_day_unique
  on core.attendance_records(user_id,period_id,work_date) where period_id is not null;
create index if not exists attendance_records_user_date_idx
  on core.attendance_records(user_id,work_date desc,period_sort_order);
create index if not exists attendance_records_open_end_idx
  on core.attendance_records(scheduled_end_at) where check_in is not null and check_out is null;
create index if not exists attendance_records_date_idx
  on core.attendance_records(work_date desc);

insert into core.system_pages(system_code,code,name_ar,route,sort_order,is_active) values
('core','attendance','الحضور والانصراف','/attendance',15,true)
on conflict(system_code,code) do update
set name_ar=excluded.name_ar,route=excluded.route,sort_order=excluded.sort_order,is_active=true,updated_at=now();

update core.system_pages set is_active=false,updated_at=now()
where system_code='marketing' and code='attendance';
update core.permissions set is_active=false
where code in ('marketing.attendance.view','marketing.attendance.manage');
`;

let attendanceSchemaPromise: Promise<void> | null = null;

async function attendanceSchemaReady() {
  const sql = getSql();
  const [state] = await sql<{ ready: boolean }[]>`
    select (
      to_regclass('core.attendance_settings') is not null
      and to_regclass('core.attendance_schedules') is not null
      and to_regclass('core.attendance_periods') is not null
      and to_regclass('core.attendance_user_schedules') is not null
      and to_regclass('core.attendance_records') is not null
      and exists (
        select 1 from information_schema.columns
        where table_schema='core' and table_name='attendance_user_schedules' and column_name='weekly_off_day'
      )
      and exists (
        select 1 from information_schema.columns
        where table_schema='core' and table_name='attendance_user_schedules' and column_name='branch_id'
      )
      and exists (
        select 1 from information_schema.columns
        where table_schema='core' and table_name='attendance_user_schedules' and column_name='period_ids'
      )
      and exists (
        select 1 from information_schema.columns
        where table_schema='core' and table_name='attendance_records' and column_name='period_id'
      )
      and exists (
        select 1 from information_schema.columns
        where table_schema='core' and table_name='attendance_settings' and column_name='official_day_end'
      )
    ) as ready
  `;
  return Boolean(state?.ready);
}

async function migrateLegacyMarketingAttendance() {
  const sql = getSql();
  const [state] = await sql<{ exists: boolean }[]>`
    select to_regclass('marketing.attendance_records') is not null as exists
  `;
  if (!state?.exists) return;

  await sql`
    insert into core.attendance_records(
      user_id,work_date,period_name,period_sort_order,
      check_in,check_out,checkout_source,delay_minutes,work_minutes,status,
      legacy_source_key,created_at,updated_at
    )
    select
      r.user_id,r.attendance_date,'سجل التسويق السابق',1,
      r.check_in,r.check_out,
      case when r.check_out is not null then 'legacy' else null end,
      coalesce(r.delay_minutes,0),coalesce(r.work_minutes,0),
      case
        when r.status='late' then 'late'
        when r.status='absent' then 'absent'
        else 'present'
      end,
      'marketing:' || r.id::text,
      coalesce(r.created_at,now()),coalesce(r.updated_at,now())
    from marketing.attendance_records r
    on conflict(legacy_source_key) do nothing
  `;
}

export function ensureAttendanceSchema() {
  if (!attendanceSchemaPromise) {
    attendanceSchemaPromise = (async () => {
      await ensureAccessControlSchema();
      if (!(await attendanceSchemaReady())) {
        await withDatabaseAdvisoryLock(
          `mzj:attendance-schema:${ATTENDANCE_SCHEMA_VERSION}`,
          async () => {
            if (await attendanceSchemaReady()) return;
            await runSqlScript(ATTENDANCE_SCHEMA_SQL);
            if (!(await attendanceSchemaReady())) throw new Error("ATTENDANCE_SCHEMA_NOT_READY");
          },
        );
      } else {
        await runSqlScript(String.raw`
          create table if not exists core.attendance_settings (
            id smallint primary key default 1 check (id = 1),
            enforcement_enabled boolean not null default false,
            official_day_end time not null default '21:00',
            updated_by uuid references core.users(id) on delete set null,
            updated_at timestamptz not null default now()
          );
          alter table core.attendance_settings add column if not exists official_day_end time not null default '21:00';
          insert into core.attendance_settings(id,enforcement_enabled,official_day_end) values(1,false,'21:00')
          on conflict(id) do nothing;
          insert into core.system_pages(system_code,code,name_ar,route,sort_order,is_active) values
          ('core','attendance','الحضور والانصراف','/attendance',15,true)
          on conflict(system_code,code) do update
          set name_ar=excluded.name_ar,route=excluded.route,sort_order=excluded.sort_order,is_active=true,updated_at=now();
          update core.system_pages set is_active=false,updated_at=now() where system_code='marketing' and code='attendance';
          update core.permissions set is_active=false where code in ('marketing.attendance.view','marketing.attendance.manage');
        `);
      }
      await migrateLegacyMarketingAttendance();
    })().catch((error) => {
      attendanceSchemaPromise = null;
      throw error;
    });
  }
  return attendanceSchemaPromise;
}
