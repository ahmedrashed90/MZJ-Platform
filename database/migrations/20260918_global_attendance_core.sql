-- Global attendance core schema
-- Generated from server/_attendance-schema.ts.
-- Legacy marketing attendance rows are migrated conditionally by ensureAttendanceSchema at runtime.

create table if not exists core.attendance_locations (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references core.branches(id) on delete set null,
  name text not null,
  latitude numeric(10,7) not null,
  longitude numeric(10,7) not null,
  radius_m integer not null default 150 check (radius_m between 10 and 50000),
  is_active boolean not null default true,
  created_by uuid references core.users(id) on delete set null,
  updated_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists attendance_locations_active_idx on core.attendance_locations(is_active,name);

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
  location_id uuid references core.attendance_locations(id) on delete set null,
  effective_from date not null,
  effective_to date,
  created_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
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
  required_location_id uuid references core.attendance_locations(id) on delete set null,
  required_location_name text,
  required_latitude numeric(10,7),
  required_longitude numeric(10,7),
  required_radius_m integer,
  check_in_latitude numeric(10,7),
  check_in_longitude numeric(10,7),
  check_in_accuracy_m numeric(10,2),
  check_in_distance_m numeric(12,2),
  location_result text not null default 'not_required'
    check (location_result in ('matched','mismatched','not_required','unknown')),
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
