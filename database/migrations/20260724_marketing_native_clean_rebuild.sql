create extension if not exists pgcrypto;

create schema if not exists marketing;

create table if not exists marketing.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_content boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);



alter table marketing.departments add column if not exists core_department_id uuid;

do $marketing_department_core_fk$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'marketing_departments_core_department_fk'
      and conrelid = 'marketing.departments'::regclass
  ) then
    alter table marketing.departments
      add constraint marketing_departments_core_department_fk
      foreign key(core_department_id) references core.departments(id) on delete restrict;
  end if;
end
$marketing_department_core_fk$;

-- Each marketing department owns one canonical core department. The core row is
-- the id stored by the centralized users and permissions screen.
update marketing.departments md
set core_department_id = (
  select cd.id
  from core.departments cd
  where cd.system_code='marketing'
    and translate(regexp_replace(lower(trim(cd.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
      = translate(regexp_replace(lower(trim(md.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
  order by cd.is_active desc,cd.created_at,cd.id
  limit 1
)
where md.core_department_id is null
  and exists(
    select 1
    from core.departments cd
    where cd.system_code='marketing'
      and translate(regexp_replace(lower(trim(cd.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
        = translate(regexp_replace(lower(trim(md.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
  );

insert into core.departments(code,name,system_code,is_active)
select 'marketing_'||left(replace(md.id::text,'-',''),20),md.name,'marketing',md.is_active
from marketing.departments md
where md.core_department_id is null
on conflict(code) do update set
  name=excluded.name,
  system_code='marketing',
  is_active=excluded.is_active,
  updated_at=now();

update marketing.departments md
set core_department_id=cd.id
from core.departments cd
where md.core_department_id is null
  and cd.code='marketing_'||left(replace(md.id::text,'-',''),20);

update core.departments cd
set name=md.name,system_code='marketing',is_active=md.is_active,updated_at=now()
from marketing.departments md
where md.core_department_id=cd.id
  and (cd.name is distinct from md.name or cd.system_code is distinct from 'marketing' or cd.is_active is distinct from md.is_active);

-- Older releases could create a second core row with the same visible marketing
-- department name. Move every centralized assignment to the canonical row so all
-- allowed departments are returned, not only the primary department.
with duplicate_links as (
  select duplicate.id as duplicate_id,md.core_department_id as canonical_id
  from marketing.departments md
  join core.departments canonical on canonical.id=md.core_department_id
  join core.departments duplicate
    on duplicate.system_code='marketing'
   and duplicate.id<>md.core_department_id
   and translate(regexp_replace(lower(trim(duplicate.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
     = translate(regexp_replace(lower(trim(md.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
)
insert into core.user_system_departments(user_id,system_code,department_id,is_primary)
select usd.user_id,'marketing',links.canonical_id,usd.is_primary
from duplicate_links links
join core.user_system_departments usd
  on usd.department_id=links.duplicate_id and usd.system_code='marketing'
on conflict(user_id,system_code,department_id) do update
set is_primary=core.user_system_departments.is_primary or excluded.is_primary;

with duplicate_links as (
  select duplicate.id as duplicate_id,md.core_department_id as canonical_id
  from marketing.departments md
  join core.departments duplicate
    on duplicate.system_code='marketing'
   and duplicate.id<>md.core_department_id
   and translate(regexp_replace(lower(trim(duplicate.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
     = translate(regexp_replace(lower(trim(md.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
)
delete from core.user_system_departments usd
using duplicate_links links
where usd.system_code='marketing' and usd.department_id=links.duplicate_id;

with duplicate_links as (
  select duplicate.id as duplicate_id,md.core_department_id as canonical_id
  from marketing.departments md
  join core.departments duplicate
    on duplicate.system_code='marketing'
   and duplicate.id<>md.core_department_id
   and translate(regexp_replace(lower(trim(duplicate.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
     = translate(regexp_replace(lower(trim(md.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
)
insert into core.user_departments(user_id,department_id,is_primary)
select ud.user_id,links.canonical_id,ud.is_primary
from duplicate_links links
join core.user_departments ud on ud.department_id=links.duplicate_id
on conflict(user_id,department_id) do update
set is_primary=core.user_departments.is_primary or excluded.is_primary;

with duplicate_links as (
  select duplicate.id as duplicate_id,md.core_department_id as canonical_id
  from marketing.departments md
  join core.departments duplicate
    on duplicate.system_code='marketing'
   and duplicate.id<>md.core_department_id
   and translate(regexp_replace(lower(trim(duplicate.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
     = translate(regexp_replace(lower(trim(md.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
)
delete from core.user_departments ud
using duplicate_links links
where ud.department_id=links.duplicate_id
  and not exists(
    select 1 from core.user_system_departments usd
    where usd.user_id=ud.user_id and usd.department_id=ud.department_id
  );

with duplicate_links as (
  select duplicate.id as duplicate_id,md.core_department_id as canonical_id
  from marketing.departments md
  join core.departments duplicate
    on duplicate.system_code='marketing'
   and duplicate.id<>md.core_department_id
   and translate(regexp_replace(lower(trim(duplicate.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
     = translate(regexp_replace(lower(trim(md.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
)
update core.departments duplicate
set is_active=false,updated_at=now()
from duplicate_links links
where duplicate.id=links.duplicate_id;

create unique index if not exists marketing_departments_core_department_uidx
  on marketing.departments(core_department_id)
  where core_department_id is not null;


create table if not exists marketing.department_users (
  department_id uuid not null references marketing.departments(id) on delete cascade,
  user_id uuid not null references core.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(department_id,user_id)
);

-- Keep the old table only for database compatibility. It is imported once for
-- users that do not yet have centralized marketing departments.
with legacy_memberships as (
  select
    du.user_id,
    md.core_department_id as department_id,
    row_number() over(partition by du.user_id order by md.is_content desc,md.name,md.id)=1 as is_primary
  from marketing.department_users du
  join marketing.departments md on md.id=du.department_id and md.is_active=true
  join core.user_systems us on us.user_id=du.user_id and us.system_code='marketing' and us.is_enabled=true
  where md.core_department_id is not null
    and not exists(
      select 1 from core.user_system_departments current_membership
      where current_membership.user_id=du.user_id and current_membership.system_code='marketing'
    )
)
insert into core.user_system_departments(user_id,system_code,department_id,is_primary)
select user_id,'marketing',department_id,is_primary
from legacy_memberships
on conflict(user_id,system_code,department_id) do nothing;

insert into core.user_departments(user_id,department_id,is_primary)
select user_id,department_id,is_primary
from core.user_system_departments
where system_code='marketing'
on conflict(user_id,department_id) do update
set is_primary=core.user_departments.is_primary or excluded.is_primary;


create table if not exists marketing.assignment_actions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references marketing.departments(id) on delete cascade,
  name text not null,
  percentage numeric(6,2) not null default 0 check(percentage >= 0 and percentage <= 100),
  admin_only boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.creative_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  short_code text not null,
  primary_department_id uuid references marketing.departments(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.campaign_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  short_code text not null,
  code_prefix text not null,
  sequence_value integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.platforms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.platform_post_types (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references marketing.platforms(id) on delete cascade,
  name text not null,
  width integer,
  height integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform_id,name)
);

create table if not exists marketing.funnels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  source text not null default 'dashboard',
  created_at timestamptz not null default now()
);
alter table marketing.funnels add column if not exists active boolean not null default true;
alter table marketing.funnels add column if not exists source text not null default 'dashboard';
alter table marketing.funnels add column if not exists created_at timestamptz not null default now();
create unique index if not exists marketing_funnels_name_uq on marketing.funnels(name);

insert into marketing.funnels(name,active,source)
select seed.name,true,'dashboard'
from (values ('Awareness'),('Leads'),('Conversion Message')) as seed(name)
where not exists (select 1 from marketing.funnels current where current.name=seed.name);
update marketing.funnels set active=true,source=coalesce(nullif(source,''),'dashboard');

create table if not exists marketing.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  price numeric(14,2) not null default 0,
  cash_discount numeric(6,2) not null default 0,
  registration_fees boolean not null default false,
  insurance boolean not null default false,
  issuance_fees boolean not null default false,
  care_features jsonb not null default '[]'::jsonb,
  delivery_home boolean not null default false,
  delivery_region boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.campaigns (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  campaign_code text unique,
  name text not null,
  campaign_type text,
  campaign_type_id uuid references marketing.campaign_types(id) on delete set null,
  objective text,
  status text not null default 'required',
  campaign_date date not null default current_date,
  publish_start date,
  publish_end date,
  starts_at timestamptz,
  ends_at timestamptz,
  due_at timestamptz,
  required_from_content text,
  payload jsonb not null default '{}'::jsonb,
  progress numeric(6,2) not null default 0,
  result_file_id uuid,
  links jsonb not null default '[]'::jsonb,
  archived_at timestamptz,
  archived_by uuid references core.users(id),
  created_by uuid references core.users(id),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table marketing.campaigns add column if not exists legacy_id text;
alter table marketing.campaigns add column if not exists campaign_code text;
alter table marketing.campaigns add column if not exists name text;
alter table marketing.campaigns add column if not exists campaign_type text;
alter table marketing.campaigns add column if not exists objective text;
alter table marketing.campaigns add column if not exists status text not null default 'required';
alter table marketing.campaigns add column if not exists starts_at timestamptz;
alter table marketing.campaigns add column if not exists ends_at timestamptz;
alter table marketing.campaigns add column if not exists due_at timestamptz;
alter table marketing.campaigns add column if not exists created_by uuid references core.users(id);
alter table marketing.campaigns add column if not exists is_deleted boolean not null default false;
alter table marketing.campaigns add column if not exists created_at timestamptz not null default now();
alter table marketing.campaigns add column if not exists updated_at timestamptz not null default now();
alter table marketing.campaigns add column if not exists campaign_date date not null default current_date;
alter table marketing.campaigns add column if not exists campaign_type_id uuid references marketing.campaign_types(id) on delete set null;
alter table marketing.campaigns add column if not exists required_from_content text;
alter table marketing.campaigns add column if not exists publish_start date;
alter table marketing.campaigns add column if not exists publish_end date;
alter table marketing.campaigns add column if not exists payload jsonb not null default '{}'::jsonb;
alter table marketing.campaigns add column if not exists progress numeric(6,2) not null default 0;
alter table marketing.campaigns add column if not exists result_file_id uuid;
alter table marketing.campaigns add column if not exists links jsonb not null default '[]'::jsonb;
alter table marketing.campaigns add column if not exists archived_at timestamptz;
alter table marketing.campaigns add column if not exists archived_by uuid references core.users(id);

create table if not exists marketing.agendas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  month_key text not null,
  publish_start date not null,
  publish_end date not null,
  status text not null default 'required',
  payload jsonb not null default '{}'::jsonb,
  progress numeric(6,2) not null default 0,
  result_file_id uuid,
  links jsonb not null default '[]'::jsonb,
  archived_at timestamptz,
  archived_by uuid references core.users(id),
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.creatives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references marketing.campaigns(id) on delete cascade,
  agenda_id uuid references marketing.agendas(id) on delete cascade,
  creative_type text not null,
  creative_type_id uuid references marketing.creative_types(id) on delete set null,
  quantity integer not null default 1,
  status text not null default 'required',
  instance_code text,
  name text,
  primary_department_id uuid references marketing.departments(id) on delete set null,
  cars jsonb not null default '[]'::jsonb,
  content_assignments jsonb not null default '[]'::jsonb,
  primary_assignments jsonb not null default '[]'::jsonb,
  optional_assignments jsonb not null default '[]'::jsonb,
  platform_assignments jsonb not null default '[]'::jsonb,
  schedule_day date,
  notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table marketing.creatives add column if not exists campaign_id uuid references marketing.campaigns(id) on delete cascade;
alter table marketing.creatives add column if not exists creative_type text;
alter table marketing.creatives add column if not exists quantity integer not null default 1;
alter table marketing.creatives add column if not exists status text not null default 'required';
alter table marketing.creatives add column if not exists created_at timestamptz not null default now();
alter table marketing.creatives add column if not exists updated_at timestamptz not null default now();
alter table marketing.creatives alter column campaign_id drop not null;
alter table marketing.creatives add column if not exists agenda_id uuid references marketing.agendas(id) on delete cascade;
alter table marketing.creatives add column if not exists creative_type_id uuid references marketing.creative_types(id) on delete set null;
alter table marketing.creatives add column if not exists instance_code text;
alter table marketing.creatives add column if not exists name text;
alter table marketing.creatives add column if not exists primary_department_id uuid references marketing.departments(id) on delete set null;
alter table marketing.creatives add column if not exists cars jsonb not null default '[]'::jsonb;
alter table marketing.creatives add column if not exists content_assignments jsonb not null default '[]'::jsonb;
alter table marketing.creatives add column if not exists primary_assignments jsonb not null default '[]'::jsonb;
alter table marketing.creatives add column if not exists optional_assignments jsonb not null default '[]'::jsonb;
alter table marketing.creatives add column if not exists platform_assignments jsonb not null default '[]'::jsonb;
alter table marketing.creatives add column if not exists schedule_day date;
alter table marketing.creatives add column if not exists notes jsonb not null default '{}'::jsonb;

create table if not exists marketing.files (
  id uuid primary key default gen_random_uuid(),
  storage_key text not null unique,
  original_name text not null,
  mime_type text,
  file_size bigint,
  category text not null,
  source_type text,
  source_id uuid,
  task_id uuid,
  status text not null default 'uploading',
  uploaded_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.task_templates (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check(source_type in ('campaign','agenda')),
  source_id uuid not null,
  creative_id uuid references marketing.creatives(id) on delete cascade,
  content_user_id uuid not null references core.users(id),
  task_no text not null unique,
  status text not null default 'not_started',
  progress numeric(6,2) not null default 0,
  due_on date,
  department_note text,
  admin_note text,
  template_data jsonb not null default '{}'::jsonb,
  approved_data jsonb not null default '{}'::jsonb,
  file_id uuid references marketing.files(id) on delete set null,
  received_at timestamptz,
  reviewed_by uuid references core.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.tasks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references marketing.campaigns(id) on delete cascade,
  agenda_id uuid references marketing.agendas(id) on delete cascade,
  source_type text not null default 'campaign',
  source_id uuid,
  creative_id uuid references marketing.creatives(id) on delete cascade,
  department_code text not null,
  department_id uuid references marketing.departments(id) on delete set null,
  assigned_to uuid references core.users(id),
  paired_content_user_id uuid references core.users(id),
  task_template_id uuid references marketing.task_templates(id) on delete set null,
  task_kind text not null default 'execution',
  title text,
  status text not null default 'required',
  due_at timestamptz,
  progress numeric(6,2) not null default 0,
  received_at timestamptz,
  completed_at timestamptz,
  note text,
  final_file_id uuid references marketing.files(id) on delete set null,
  approved_template_data jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table marketing.tasks add column if not exists campaign_id uuid references marketing.campaigns(id) on delete cascade;
alter table marketing.tasks add column if not exists creative_id uuid references marketing.creatives(id) on delete cascade;
alter table marketing.tasks add column if not exists department_code text;
alter table marketing.tasks add column if not exists assigned_to uuid references core.users(id);
alter table marketing.tasks add column if not exists paired_content_user_id uuid references core.users(id);
alter table marketing.tasks add column if not exists status text not null default 'required';
alter table marketing.tasks add column if not exists due_at timestamptz;
alter table marketing.tasks add column if not exists completed_at timestamptz;
alter table marketing.tasks add column if not exists created_at timestamptz not null default now();
alter table marketing.tasks add column if not exists updated_at timestamptz not null default now();
alter table marketing.tasks alter column campaign_id drop not null;
alter table marketing.tasks add column if not exists agenda_id uuid references marketing.agendas(id) on delete cascade;
alter table marketing.tasks add column if not exists source_type text not null default 'campaign';
alter table marketing.tasks add column if not exists source_id uuid;
alter table marketing.tasks add column if not exists department_id uuid references marketing.departments(id) on delete set null;
alter table marketing.tasks add column if not exists task_template_id uuid references marketing.task_templates(id) on delete set null;
alter table marketing.tasks add column if not exists task_kind text not null default 'execution';
alter table marketing.tasks add column if not exists title text;
alter table marketing.tasks add column if not exists progress numeric(6,2) not null default 0;
alter table marketing.tasks add column if not exists received_at timestamptz;
alter table marketing.tasks add column if not exists note text;
alter table marketing.tasks add column if not exists final_file_id uuid references marketing.files(id) on delete set null;
alter table marketing.tasks add column if not exists approved_template_data jsonb not null default '{}'::jsonb;
alter table marketing.tasks add column if not exists is_deleted boolean not null default false;

update marketing.campaigns set name=coalesce(nullif(name,''),'حملة') where name is null or name='';
update marketing.campaigns set status=coalesce(nullif(status,''),'required') where status is null or status='';
update marketing.creatives set creative_type=coalesce(nullif(creative_type,''),'creative') where creative_type is null or creative_type='';
update marketing.creatives set status=coalesce(nullif(status,''),'required') where status is null or status='';
update marketing.tasks set department_code=coalesce(nullif(department_code,''),'marketing') where department_code is null or department_code='';
update marketing.tasks set status=coalesce(nullif(status,''),'required') where status is null or status='';

create table if not exists marketing.task_action_progress (
  task_id uuid not null references marketing.tasks(id) on delete cascade,
  action_id uuid not null references marketing.assignment_actions(id) on delete cascade,
  completed boolean not null default false,
  completed_by uuid references core.users(id),
  completed_at timestamptz,
  primary key(task_id,action_id)
);

create table if not exists marketing.task_review_history (
  id uuid primary key default gen_random_uuid(),
  task_template_id uuid not null references marketing.task_templates(id) on delete cascade,
  action text not null,
  note text,
  before_data jsonb,
  after_data jsonb,
  actor_id uuid references core.users(id),
  actor_name text,
  created_at timestamptz not null default now()
);

create table if not exists marketing.budget_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  funnel_id uuid references marketing.funnels(id) on delete set null,
  creative_id uuid references marketing.creatives(id) on delete set null,
  ads_count integer not null default 1,
  content_goal text,
  expected_goal text,
  platform_amounts jsonb not null default '[]'::jsonb,
  total numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists marketing.publish_schedule (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null default gen_random_uuid(),
  source_type text not null check(source_type in ('campaign','agenda')),
  source_id uuid not null,
  creative_id uuid references marketing.creatives(id) on delete cascade,
  task_id uuid references marketing.tasks(id) on delete cascade,
  publish_date date not null,
  platform_id uuid references marketing.platforms(id) on delete set null,
  post_type_id uuid references marketing.platform_post_types(id) on delete set null,
  caption text,
  hashtags text,
  status text not null default 'waiting',
  published_at timestamptz,
  publish_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table marketing.publish_schedule add column if not exists group_id uuid default gen_random_uuid();
update marketing.publish_schedule set group_id=gen_random_uuid() where group_id is null;
alter table marketing.publish_schedule alter column group_id set default gen_random_uuid();
alter table marketing.publish_schedule alter column group_id set not null;
alter table marketing.publish_schedule add column if not exists task_id uuid references marketing.tasks(id) on delete cascade;

create table if not exists marketing.platform_connections (
  platform text primary key check(platform in ('facebook','instagram')),
  connected boolean not null default false,
  status text not null default 'disconnected',
  state text not null default 'idle',
  source text,
  account_id text,
  account_name text,
  page_id text,
  page_name text,
  ig_user_id text,
  username text,
  pages jsonb not null default '[]'::jsonb,
  access_token_encrypted text,
  user_access_token_encrypted text,
  page_access_token_encrypted text,
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references core.users(id)
);

create table if not exists marketing.publish_logs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references marketing.publish_schedule(id) on delete set null,
  platform text not null,
  status text not null,
  result jsonb not null default '{}'::jsonb,
  error text,
  published_by uuid references core.users(id),
  created_at timestamptz not null default now()
);

create table if not exists marketing.attendance_settings (
  singleton boolean primary key default true check(singleton),
  work_start time not null default '09:00',
  work_end time not null default '17:00',
  grace_minutes integer not null default 15,
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);
insert into marketing.attendance_settings(singleton) values(true) on conflict(singleton) do nothing;

create table if not exists marketing.attendance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  attendance_date date not null default current_date,
  check_in timestamptz,
  check_out timestamptz,
  delay_minutes integer not null default 0,
  work_minutes integer not null default 0,
  status text not null default 'not_registered',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,attendance_date)
);

create table if not exists marketing.presence_status (
  user_id uuid primary key references core.users(id) on delete cascade,
  online boolean not null default false,
  last_activity_at timestamptz not null default now(),
  last_activity_type text,
  updated_at timestamptz not null default now()
);
alter table marketing.presence_status add column if not exists last_activity_type text;

create table if not exists marketing.user_colors (
  user_id uuid primary key references core.users(id) on delete cascade,
  color text not null default '#c65f3c',
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);

alter table operations.transfer_request_vehicles add column if not exists item_note text;

create table if not exists marketing.stock_vehicle_state (
  vehicle_id uuid primary key references operations.vehicles(id) on delete cascade,
  photographed boolean not null default false,
  photographed_at timestamptz,
  content_usage jsonb not null default '[]'::jsonb,
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_campaigns_status_idx on marketing.campaigns(status,archived_at,created_at desc);
create index if not exists marketing_agendas_status_idx on marketing.agendas(status,archived_at,created_at desc);
create index if not exists marketing_tasks_source_idx on marketing.tasks(source_type,source_id,status,is_deleted);
create index if not exists marketing_tasks_assigned_idx on marketing.tasks(assigned_to,status,is_deleted);
create index if not exists marketing_templates_source_idx on marketing.task_templates(source_type,source_id,status);
create index if not exists marketing_schedule_date_idx on marketing.publish_schedule(publish_date,status);
create index if not exists marketing_schedule_group_idx on marketing.publish_schedule(group_id);
create index if not exists marketing_schedule_task_idx on marketing.publish_schedule(task_id);

insert into core.permissions(code,name,system_code) values
('marketing.view','عرض سيستم التسويق','marketing'),
('marketing.task.receive','استلام تاسكات التسويق','marketing'),
('marketing.task.execute','تنفيذ إجراءات التكليف','marketing'),
('marketing.file.upload','رفع ملفات التسويق','marketing'),
('marketing.manage','إدارة سيستم التسويق','marketing')
on conflict(code) do update set name=excluded.name,system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code='marketing_user' and p.code in ('marketing.view','marketing.task.receive','marketing.task.execute','marketing.file.upload')
on conflict do nothing;
