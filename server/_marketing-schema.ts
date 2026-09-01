import { runSqlScript } from "./_db.js";

let ready: Promise<void> | null = null;

const MARKETING_SCHEMA_SQL = String.raw`begin;

create extension if not exists pgcrypto;

create schema if not exists marketing;

do $marketing_schema_reset$
declare
  current_version integer;
begin
  if to_regclass('marketing.schema_state') is not null then
    begin
      execute 'select version from marketing.schema_state where id = 1' into current_version;
    exception when others then
      current_version := null;
    end;
  end if;

  if current_version is distinct from 1 then
    execute 'drop schema marketing cascade';
    execute 'create schema marketing';
  end if;
end
$marketing_schema_reset$;

create table if not exists marketing.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_content boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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


create table if not exists marketing.package_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.package_sales_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into marketing.package_categories(name,sort_order)
select seed.name,seed.sort_order
from (values ('العناية',10),('الفضية',20),('الذهبية',30),('VIP',40)) as seed(name,sort_order)
where not exists(select 1 from marketing.package_categories current where lower(btrim(current.name))=lower(btrim(seed.name)));

insert into marketing.package_sales_types(name,sort_order)
select seed.name,seed.sort_order
from (values ('مبيعات الكاش',10),('مبيعات القسط',20)) as seed(name,sort_order)
where not exists(select 1 from marketing.package_sales_types current where lower(btrim(current.name))=lower(btrim(seed.name)));

create table if not exists marketing.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  category_id uuid references marketing.package_categories(id) on delete set null,
  sales_type text,
  sales_type_id uuid references marketing.package_sales_types(id) on delete set null,
  price numeric(14,2) not null default 0,
  cash_discount numeric(6,2) not null default 0,
  registration_fees boolean not null default false,
  insurance boolean not null default false,
  insurance_description text,
  issuance_fees boolean not null default false,
  care_features jsonb not null default '[]'::jsonb,
  delivery_home boolean not null default false,
  delivery_region boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table marketing.packages add column if not exists category_id uuid references marketing.package_categories(id) on delete set null;
alter table marketing.packages add column if not exists sales_type text;
alter table marketing.packages add column if not exists sales_type_id uuid references marketing.package_sales_types(id) on delete set null;
alter table marketing.packages add column if not exists insurance_description text;
update marketing.packages p set category_id=c.id from marketing.package_categories c where p.category_id is null and lower(btrim(p.category))=lower(btrim(c.name));
update marketing.packages p set sales_type_id=s.id,sales_type=s.name from marketing.package_sales_types s where p.sales_type_id is null and lower(btrim(s.name))=lower(btrim(coalesce(p.sales_type,'مبيعات الكاش')));

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

-- Persistent monotonic counters for creatives/task-template batches.
-- These counters deliberately survive creative deletion so a later create never
-- reuses a number that was already allocated inside the same campaign/agenda.
create table if not exists marketing.entity_sequences (
  source_type text not null check(source_type in ('campaign','agenda')),
  source_id uuid not null,
  next_creative_index bigint not null default 1 check(next_creative_index > 0),
  next_task_batch bigint not null default 1 check(next_task_batch > 0),
  updated_at timestamptz not null default now(),
  primary key(source_type,source_id)
);

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
  completed_by uuid references core.users(id),
  note text,
  final_file_id uuid references marketing.files(id) on delete set null,
  approved_template_data jsonb not null default '{}'::jsonb,
  execution_folders jsonb not null default '{}'::jsonb,
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
alter table marketing.tasks add column if not exists completed_by uuid references core.users(id);
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
alter table marketing.tasks add column if not exists execution_folders jsonb not null default '{}'::jsonb;
alter table marketing.tasks add column if not exists is_deleted boolean not null default false;
alter table marketing.tasks add column if not exists publish_prep_removed_at timestamptz;
alter table marketing.tasks add column if not exists publish_prep_removed_by uuid references core.users(id) on delete set null;

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

create table if not exists marketing.budget_item_creatives (
  budget_item_id uuid not null references marketing.budget_items(id) on delete cascade,
  creative_id uuid not null references marketing.creatives(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(budget_item_id,creative_id)
);
create index if not exists marketing_budget_item_creatives_creative_idx on marketing.budget_item_creatives(creative_id,budget_item_id);
insert into marketing.budget_item_creatives(budget_item_id,creative_id)
select id,creative_id from marketing.budget_items where creative_id is not null
on conflict do nothing;

create table if not exists marketing.publish_schedule (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null default gen_random_uuid(),
  source_type text not null check(source_type in ('campaign','agenda','manual')),
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
alter table marketing.publish_schedule add column if not exists publish_options jsonb not null default '{}'::jsonb;
alter table marketing.publish_schedule drop constraint if exists publish_schedule_source_type_check;
alter table marketing.publish_schedule add constraint publish_schedule_source_type_check check(source_type in ('campaign','agenda','manual'));

create table if not exists marketing.platform_publish_settings (
  platform text primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_publish_settings_platform_check check(platform in ('youtube'))
);

insert into marketing.platform_publish_settings(platform,settings)
values('youtube','{"privacyStatus":"unlisted","madeForKids":false,"categoryId":"2","defaultLanguage":"ar","defaultPlaylistId":"","notifySubscribers":true,"embeddable":true,"license":"youtube","publicStatsViewable":true,"defaultTags":[],"descriptionTemplate":""}'::jsonb)
on conflict(platform) do nothing;

insert into marketing.platform_post_types(platform_id,name,width,height,is_active)
select p.id,seed.name,seed.width,seed.height,true
from marketing.platforms p
cross join (values ('فيديو',1920,1080),('Shorts',1080,1920)) as seed(name,width,height)
where lower(p.code)='youtube'
on conflict(platform_id,name) do update set width=excluded.width,height=excluded.height,is_active=true,updated_at=now();

update marketing.platform_post_types pt
set is_active=false,updated_at=now()
from marketing.platforms p
where p.id=pt.platform_id and lower(p.code)='youtube'
  and lower(btrim(pt.name)) in ('عام','غير مدرج','خاص','public','unlisted','private');

create table if not exists marketing.platform_connections (
  platform text primary key,
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
  scopes jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  access_token_encrypted text,
  user_access_token_encrypted text,
  page_access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  last_verified_at timestamptz,
  last_error text,
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  connected_by uuid references core.users(id),
  disconnected_by uuid references core.users(id),
  updated_by uuid references core.users(id),
  constraint platform_connections_platform_check check(platform in ('facebook','instagram','tiktok','youtube'))
);

alter table marketing.platform_connections drop constraint if exists platform_connections_platform_check;
alter table marketing.platform_connections add constraint platform_connections_platform_check check(platform in ('facebook','instagram','tiktok','youtube'));
alter table marketing.platform_connections add column if not exists scopes jsonb not null default '[]'::jsonb;
alter table marketing.platform_connections add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table marketing.platform_connections add column if not exists refresh_token_encrypted text;
alter table marketing.platform_connections add column if not exists token_expires_at timestamptz;
alter table marketing.platform_connections add column if not exists refresh_token_expires_at timestamptz;
alter table marketing.platform_connections add column if not exists last_verified_at timestamptz;
alter table marketing.platform_connections add column if not exists last_error text;
alter table marketing.platform_connections add column if not exists disconnected_at timestamptz;
alter table marketing.platform_connections add column if not exists created_at timestamptz not null default now();
alter table marketing.platform_connections add column if not exists connected_by uuid references core.users(id);
alter table marketing.platform_connections add column if not exists disconnected_by uuid references core.users(id);

create table if not exists marketing.platform_oauth_states (
  state_hash text primary key,
  provider text not null check(provider in ('meta','tiktok','youtube')),
  user_id uuid not null references core.users(id) on delete cascade,
  return_origin text not null,
  return_path text not null default '/marketing/platforms',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists marketing_platform_oauth_states_expiry_idx on marketing.platform_oauth_states(expires_at);

create table if not exists marketing.platform_connection_drafts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider in ('meta','tiktok','youtube')),
  user_id uuid not null references core.users(id) on delete cascade,
  payload_encrypted text not null,
  public_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique(provider,user_id)
);
create index if not exists marketing_platform_connection_drafts_expiry_idx on marketing.platform_connection_drafts(expires_at);

create table if not exists marketing.platform_connection_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider in ('meta','tiktok','youtube')),
  action text not null,
  status text not null,
  account_name text,
  details jsonb not null default '{}'::jsonb,
  user_id uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists marketing_platform_connection_events_created_idx on marketing.platform_connection_events(created_at desc);

-- Clean cutover from the old manual-token screen. Legacy rows must never remain
-- active because they were not created or verified by the OAuth flow below.
update marketing.platform_connections
set connected=false,
    status='reauthorization_required',
    state='legacy_connection',
    access_token_encrypted=null,
    user_access_token_encrypted=null,
    page_access_token_encrypted=null,
    refresh_token_encrypted=null,
    token_expires_at=null,
    refresh_token_expires_at=null,
    last_verified_at=null,
    last_error='يلزم إعادة الربط من تدفق OAuth الجديد',
    updated_at=now()
where connected=true and coalesce(source,'') not like 'oauth-%';

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
create index if not exists marketing_tasks_publish_prep_visible_idx on marketing.tasks(task_kind,created_at) where is_deleted=false and publish_prep_removed_at is null;
create index if not exists marketing_templates_source_idx on marketing.task_templates(source_type,source_id,status);
create index if not exists marketing_schedule_date_idx on marketing.publish_schedule(publish_date,status);
create index if not exists marketing_schedule_group_idx on marketing.publish_schedule(group_id);
create index if not exists marketing_schedule_task_idx on marketing.publish_schedule(task_id);

insert into core.permissions(code,name,system_code) values
('marketing.view','عرض سيستم التسويق','marketing'),
('marketing.task.receive','استلام تاسكات التسويق','marketing'),
('marketing.task.execute','تنفيذ إجراءات التكليف','marketing'),
('marketing.file.upload','رفع ملفات التسويق','marketing')
on conflict(code) do update set name=excluded.name,system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code='marketing_user' and p.code in ('marketing.view','marketing.task.receive','marketing.task.execute','marketing.file.upload')
on conflict do nothing;

-- Repair duplicate marketing department names left by older central-access versions.
-- The selected canonical UUID is kept, all memberships and marketing references are moved,
-- and no role or role_id data is touched.
do $marketing_department_duplicate_repair$
declare
  name_group record;
  duplicate_department record;
  canonical_id uuid;
  canonical_name text;
  temporary_name text;
begin
  for name_group in
    select lower(btrim(name)) as normalized_name
    from core.departments
    where system_code='marketing'
    group by lower(btrim(name))
    having count(*) > 1
  loop
    select d.id,d.name into canonical_id,canonical_name
    from core.departments d
    where d.system_code='marketing' and lower(btrim(d.name))=name_group.normalized_name
    order by exists(select 1 from marketing.departments md where md.id=d.id) desc,d.is_active desc,d.created_at,d.id
    limit 1;

    for duplicate_department in
      select d.id
      from core.departments d
      where d.system_code='marketing'
        and lower(btrim(d.name))=name_group.normalized_name
        and d.id<>canonical_id
      order by d.created_at,d.id
    loop
      update core.users set permission_version=permission_version+1,updated_at=now()
      where id in (
        select user_id from core.user_system_departments where department_id=duplicate_department.id
        union
        select user_id from core.user_departments where department_id=duplicate_department.id
      );
      delete from core.sessions where user_id in (
        select user_id from core.user_system_departments where department_id=duplicate_department.id
        union
        select user_id from core.user_departments where department_id=duplicate_department.id
      );

      if exists(select 1 from marketing.departments where id=duplicate_department.id) then
        if not exists(select 1 from marketing.departments where id=canonical_id) then
          temporary_name := canonical_name || ' [merge-' || substr(canonical_id::text,1,8) || '-' || substr(duplicate_department.id::text,1,8) || ']';
          insert into marketing.departments(id,name,is_content,is_active,created_by,created_at,updated_at)
          select canonical_id,temporary_name,is_content,is_active,created_by,created_at,updated_at
          from marketing.departments where id=duplicate_department.id
          on conflict(id) do nothing;
        else
          update marketing.departments canonical
          set is_content=canonical.is_content or duplicate.is_content,
              is_active=canonical.is_active or duplicate.is_active,
              updated_at=greatest(canonical.updated_at,duplicate.updated_at)
          from marketing.departments duplicate
          where canonical.id=canonical_id and duplicate.id=duplicate_department.id;
        end if;
      end if;

      if to_regclass('marketing.department_users') is not null then
        insert into marketing.department_users(department_id,user_id,created_at)
        select canonical_id,user_id,created_at from marketing.department_users where department_id=duplicate_department.id
        on conflict do nothing;
        delete from marketing.department_users where department_id=duplicate_department.id;
      end if;

      insert into core.user_system_departments(user_id,system_code,department_id,is_primary)
      select user_id,system_code,canonical_id,is_primary
      from core.user_system_departments where department_id=duplicate_department.id
      on conflict(user_id,system_code,department_id) do update
      set is_primary=core.user_system_departments.is_primary or excluded.is_primary;
      delete from core.user_system_departments where department_id=duplicate_department.id;

      insert into core.user_departments(user_id,department_id,is_primary)
      select user_id,canonical_id,is_primary from core.user_departments where department_id=duplicate_department.id
      on conflict(user_id,department_id) do update
      set is_primary=core.user_departments.is_primary or excluded.is_primary;
      delete from core.user_departments where department_id=duplicate_department.id;

      update marketing.assignment_actions set department_id=canonical_id where department_id=duplicate_department.id;
      update marketing.creative_types set primary_department_id=canonical_id where primary_department_id=duplicate_department.id;
      update marketing.creatives set primary_department_id=canonical_id where primary_department_id=duplicate_department.id;
      update marketing.tasks set department_id=canonical_id where department_id=duplicate_department.id;
      update marketing.creatives
      set optional_assignments=replace(optional_assignments::text,duplicate_department.id::text,canonical_id::text)::jsonb
      where optional_assignments::text like '%' || duplicate_department.id::text || '%';
      update marketing.campaigns
      set payload=replace(payload::text,duplicate_department.id::text,canonical_id::text)::jsonb
      where payload::text like '%' || duplicate_department.id::text || '%';
      update marketing.agendas
      set payload=replace(payload::text,duplicate_department.id::text,canonical_id::text)::jsonb
      where payload::text like '%' || duplicate_department.id::text || '%';

      delete from marketing.departments where id=duplicate_department.id;
      delete from core.departments where id=duplicate_department.id and system_code='marketing';
    end loop;

    update marketing.departments md set name=canonical_name,updated_at=now()
    where md.id=canonical_id
      and not exists(
        select 1 from marketing.departments conflict
        where conflict.id<>canonical_id and lower(btrim(conflict.name))=lower(btrim(canonical_name))
      );
  end loop;
end
$marketing_department_duplicate_repair$;

-- Canonicalize marketing departments on core.departments IDs and migrate legacy membership once.
do $marketing_department_canonical_sync$
declare
  dep record;
  canonical_id uuid;
  generated_code text;
begin
  for dep in select * from marketing.departments order by created_at loop
    canonical_id := null;
    select d.id into canonical_id from core.departments d where d.id=dep.id and d.system_code='marketing' limit 1;
    if canonical_id is null then
      select d.id into canonical_id from core.departments d where d.system_code='marketing' and lower(trim(d.name))=lower(trim(dep.name)) order by d.created_at limit 1;
    end if;
    if canonical_id is null then
      generated_code := 'marketing_' || substr(md5(dep.id::text),1,16);
      if not exists(select 1 from core.departments where id=dep.id) then
        insert into core.departments(id,code,name,system_code,is_active,created_at,updated_at)
        values(dep.id,generated_code,dep.name,'marketing',dep.is_active,dep.created_at,dep.updated_at)
        on conflict(code) do nothing;
        select d.id into canonical_id from core.departments d where d.id=dep.id and d.system_code='marketing';
      end if;
      if canonical_id is null then
        insert into core.departments(code,name,system_code,is_active)
        values(generated_code || '_' || substr(md5(random()::text),1,6),dep.name,'marketing',dep.is_active)
        returning id into canonical_id;
      end if;
    end if;

    if canonical_id is distinct from dep.id then
      -- Use a temporary unique name while both the legacy row and the canonical row coexist.
      insert into marketing.departments(id,name,is_content,is_active,created_by,created_at,updated_at)
      values(canonical_id,dep.name || ' [id-sync-' || substr(dep.id::text,1,8) || ']',dep.is_content,dep.is_active,dep.created_by,dep.created_at,dep.updated_at)
      on conflict(id) do update set is_content=excluded.is_content,is_active=excluded.is_active,updated_at=excluded.updated_at;
      if to_regclass('marketing.department_users') is not null then
        insert into marketing.department_users(department_id,user_id,created_at)
        select canonical_id,user_id,created_at from marketing.department_users where department_id=dep.id
        on conflict do nothing;
        delete from marketing.department_users where department_id=dep.id;
      end if;
      update marketing.assignment_actions set department_id=canonical_id where department_id=dep.id;
      update marketing.creative_types set primary_department_id=canonical_id where primary_department_id=dep.id;
      update marketing.creatives set primary_department_id=canonical_id where primary_department_id=dep.id;
      update marketing.tasks set department_id=canonical_id where department_id=dep.id;
      update marketing.creatives
      set optional_assignments=replace(optional_assignments::text,dep.id::text,canonical_id::text)::jsonb
      where optional_assignments::text like '%' || dep.id::text || '%';
      update marketing.campaigns
      set payload=replace(payload::text,dep.id::text,canonical_id::text)::jsonb
      where payload::text like '%' || dep.id::text || '%';
      update marketing.agendas
      set payload=replace(payload::text,dep.id::text,canonical_id::text)::jsonb
      where payload::text like '%' || dep.id::text || '%';
      delete from marketing.departments where id=dep.id;
    end if;
    update marketing.departments md set name=cd.name,is_active=cd.is_active,updated_at=greatest(md.updated_at,cd.updated_at) from core.departments cd where md.id=canonical_id and cd.id=canonical_id and cd.system_code='marketing';
  end loop;
end
$marketing_department_canonical_sync$;

do $marketing_departments_core_fk$
begin
  if not exists(select 1 from pg_constraint where conname='marketing_departments_core_department_fk') then
    alter table marketing.departments add constraint marketing_departments_core_department_fk foreign key(id) references core.departments(id) on delete cascade;
  end if;
end
$marketing_departments_core_fk$;

do $marketing_department_membership_migration$
begin
  if to_regclass('marketing.department_users') is not null then
    insert into core.user_system_departments(user_id,system_code,department_id,is_primary)
    select du.user_id,'marketing',du.department_id,false
    from marketing.department_users du
    join core.departments d on d.id=du.department_id and d.system_code='marketing'
    on conflict(user_id,system_code,department_id) do nothing;

    insert into core.user_departments(user_id,department_id,is_primary)
    select usd.user_id,usd.department_id,bool_or(usd.is_primary)
    from core.user_system_departments usd
    where usd.system_code='marketing'
    group by usd.user_id,usd.department_id
    on conflict(user_id,department_id) do update set is_primary=core.user_departments.is_primary or excluded.is_primary;

    drop table marketing.department_users;
  end if;
end
$marketing_department_membership_migration$;



-- Zoho WorkDrive publishing storage. The connection is system-wide and tokens are encrypted.
create table if not exists marketing.zoho_workdrive_connection (
  id smallint primary key default 1 check(id = 1),
  status text not null default 'disconnected',
  account_email text,
  accounts_domain text not null default 'https://accounts.zoho.sa',
  api_domain text not null default 'https://www.zohoapis.sa',
  upload_domain text not null default 'https://files.zoho.sa',
  root_folder_id text,
  scopes jsonb not null default '[]'::jsonb,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  last_verified_at timestamptz,
  last_error text,
  connected_by uuid references core.users(id),
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists marketing.zoho_oauth_states (
  state_hash text primary key,
  user_id uuid not null references core.users(id) on delete cascade,
  redirect_uri text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists marketing_zoho_oauth_states_expiry_idx on marketing.zoho_oauth_states(expires_at);

create table if not exists marketing.final_media_groups (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references marketing.tasks(id) on delete cascade,
  media_kind text not null check(media_kind in ('image','carousel','video','file')),
  file_count integer not null default 0,
  status text not null default 'uploading',
  is_active boolean not null default true,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists marketing_final_media_groups_task_idx on marketing.final_media_groups(task_id,is_active,created_at desc);
alter table marketing.final_media_groups drop constraint if exists final_media_groups_media_kind_check;
alter table marketing.final_media_groups add constraint final_media_groups_media_kind_check check(media_kind in ('image','carousel','video','file'));

alter table marketing.tasks add column if not exists final_media_group_id uuid references marketing.final_media_groups(id) on delete set null;
alter table marketing.files add column if not exists storage_provider text not null default 'r2';
alter table marketing.files add column if not exists external_id text;
alter table marketing.files add column if not exists external_parent_id text;
alter table marketing.files add column if not exists external_url text;
alter table marketing.files add column if not exists final_media_group_id uuid references marketing.final_media_groups(id) on delete set null;
alter table marketing.files add column if not exists order_index integer not null default 0;
alter table marketing.files add column if not exists upload_error text;
create index if not exists marketing_files_final_group_idx on marketing.files(final_media_group_id,order_index) where final_media_group_id is not null;

create table if not exists marketing.zoho_upload_tickets (
  ticket_hash text primary key,
  file_id uuid not null references marketing.files(id) on delete cascade,
  final_media_group_id uuid not null references marketing.final_media_groups(id) on delete cascade,
  task_id uuid not null references marketing.tasks(id) on delete cascade,
  file_name text not null,
  mime_type text,
  file_size bigint,
  parent_folder_id text not null,
  upload_strategy text not null default 'standard',
  upload_id text,
  status text not null default 'prepared',
  expires_at timestamptz not null,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint marketing_zoho_upload_tickets_strategy_check check(upload_strategy in ('standard','stream'))
);
alter table marketing.zoho_upload_tickets add column if not exists upload_strategy text;
alter table marketing.zoho_upload_tickets drop constraint if exists marketing_zoho_upload_tickets_strategy_check;
update marketing.zoho_upload_tickets set upload_strategy='stream' where upload_strategy='chunk';
update marketing.zoho_upload_tickets set upload_strategy='standard' where upload_strategy is null or upload_strategy not in ('standard','stream');
alter table marketing.zoho_upload_tickets alter column upload_strategy set default 'standard';
alter table marketing.zoho_upload_tickets alter column upload_strategy set not null;
alter table marketing.zoho_upload_tickets alter column upload_id drop not null;
alter table marketing.zoho_upload_tickets add constraint marketing_zoho_upload_tickets_strategy_check check(upload_strategy in ('standard','stream'));
create index if not exists marketing_zoho_upload_tickets_expiry_idx on marketing.zoho_upload_tickets(expires_at,status);


create table if not exists marketing.published_posts (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null unique references marketing.publish_schedule(id) on delete cascade,
  source_type text not null check(source_type in ('campaign','agenda','manual')),
  source_id uuid not null,
  creative_id uuid references marketing.creatives(id) on delete set null,
  task_id uuid references marketing.tasks(id) on delete set null,
  platform text not null check(platform in ('facebook','instagram','tiktok','snapchat','youtube')),
  account_id text not null,
  provider_post_id text,
  provider_media_id text,
  permalink text,
  post_type_name text,
  published_at timestamptz not null default now(),
  likes_count bigint not null default 0,
  comments_count bigint not null default 0,
  shares_count bigint not null default 0,
  saves_count bigint not null default 0,
  views_count bigint not null default 0,
  reach_count bigint not null default 0,
  last_synced_at timestamptz,
  sync_status text not null default 'pending' check(sync_status in ('pending','synced','failed')),
  sync_error text,
  raw_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table marketing.published_posts alter column provider_post_id drop not null;
create index if not exists marketing_published_posts_provider_idx on marketing.published_posts(platform,account_id,provider_post_id);
create index if not exists marketing_published_posts_media_idx on marketing.published_posts(platform,provider_media_id) where provider_media_id is not null;
create index if not exists marketing_published_posts_source_idx on marketing.published_posts(source_type,source_id,published_at desc);
alter table marketing.published_posts add column if not exists archived_at timestamptz;
alter table marketing.published_posts add column if not exists archived_by uuid references core.users(id);
alter table marketing.published_posts add column if not exists is_deleted boolean not null default false;
alter table marketing.published_posts add column if not exists deleted_at timestamptz;
alter table marketing.published_posts add column if not exists deleted_by uuid references core.users(id);
create index if not exists marketing_published_posts_active_idx on marketing.published_posts(published_at desc) where is_deleted=false;
alter table marketing.published_posts drop constraint if exists published_posts_source_type_check;
alter table marketing.published_posts add constraint published_posts_source_type_check check(source_type in ('campaign','agenda','manual'));
alter table marketing.published_posts drop constraint if exists published_posts_platform_check;
alter table marketing.published_posts add constraint published_posts_platform_check check(platform in ('facebook','instagram','tiktok','snapchat','youtube'));

create table if not exists marketing.post_comments (
  id uuid primary key default gen_random_uuid(),
  published_post_id uuid not null references marketing.published_posts(id) on delete cascade,
  platform text not null check(platform in ('facebook','instagram','tiktok','snapchat','youtube')),
  provider_comment_id text not null,
  provider_post_id text,
  account_id text not null,
  commenter_id text not null,
  commenter_name text,
  comment_text text,
  commented_at timestamptz,
  crm_lead_id uuid,
  processing_status text not null default 'pending' check(processing_status in ('pending','created','reused','ignored','failed')),
  processing_error text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform,provider_comment_id)
);
create index if not exists marketing_post_comments_post_idx on marketing.post_comments(published_post_id,commented_at desc,created_at desc);
create index if not exists marketing_post_comments_commenter_idx on marketing.post_comments(platform,account_id,commenter_id);
create index if not exists marketing_post_comments_lead_idx on marketing.post_comments(crm_lead_id) where crm_lead_id is not null;
alter table marketing.post_comments drop constraint if exists post_comments_platform_check;
alter table marketing.post_comments add constraint post_comments_platform_check check(platform in ('facebook','instagram','tiktok','snapchat','youtube'));

create table if not exists marketing.post_engagements (
  id uuid primary key default gen_random_uuid(),
  published_post_id uuid not null references marketing.published_posts(id) on delete cascade,
  platform text not null check(platform in ('facebook','instagram','tiktok','snapchat','youtube')),
  engagement_type text not null check(engagement_type in ('comment','like','share')),
  provider_event_id text not null,
  provider_post_id text,
  account_id text not null,
  actor_id text not null,
  actor_name text,
  event_text text,
  engaged_at timestamptz,
  crm_lead_id uuid,
  processing_status text not null default 'pending' check(processing_status in ('pending','created','reused','ignored','failed')),
  processing_error text,
  raw_payload jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  archived_by uuid references core.users(id),
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform,engagement_type,provider_event_id)
);
create index if not exists marketing_post_engagements_post_idx on marketing.post_engagements(published_post_id,engaged_at desc,created_at desc) where is_deleted=false;
create index if not exists marketing_post_engagements_actor_idx on marketing.post_engagements(platform,account_id,actor_id) where is_deleted=false;
create index if not exists marketing_post_engagements_lead_idx on marketing.post_engagements(crm_lead_id) where crm_lead_id is not null and is_deleted=false;
create index if not exists marketing_post_engagements_type_idx on marketing.post_engagements(engagement_type,engaged_at desc) where is_deleted=false;
alter table marketing.post_engagements drop constraint if exists post_engagements_platform_check;
alter table marketing.post_engagements add constraint post_engagements_platform_check check(platform in ('facebook','instagram','tiktok','snapchat','youtube'));

insert into marketing.post_engagements(
  id,published_post_id,platform,engagement_type,provider_event_id,provider_post_id,account_id,actor_id,actor_name,event_text,
  engaged_at,crm_lead_id,processing_status,processing_error,raw_payload,created_at,updated_at
)
select pc.id,pc.published_post_id,pc.platform,'comment',pc.provider_comment_id,pc.provider_post_id,pc.account_id,pc.commenter_id,
  pc.commenter_name,pc.comment_text,pc.commented_at,pc.crm_lead_id,pc.processing_status,pc.processing_error,pc.raw_payload,pc.created_at,pc.updated_at
from marketing.post_comments pc
on conflict(platform,engagement_type,provider_event_id) do nothing;

create table if not exists marketing.data_migrations (
  migration_key text primary key,
  applied_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);

create table if not exists marketing.engagement_snapshots (
  id bigserial primary key,
  published_post_id uuid not null references marketing.published_posts(id) on delete cascade,
  snapshot_date date not null default current_date,
  likes_count bigint not null default 0,
  comments_count bigint not null default 0,
  shares_count bigint not null default 0,
  saves_count bigint not null default 0,
  views_count bigint not null default 0,
  reach_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(published_post_id,snapshot_date)
);

create table if not exists marketing.schema_state (
  id smallint primary key default 1 check(id = 1),
  version integer not null,
  updated_at timestamptz not null default now()
);
insert into marketing.schema_state(id,version,updated_at) values(1,1,now())
on conflict(id) do update set version=excluded.version,updated_at=excluded.updated_at;

commit;
`;

export async function ensureMarketingSchema() {
  if (!ready) {
    ready = runSqlScript(MARKETING_SCHEMA_SQL).catch((error) => {
      ready = null;
      throw error;
    });
  }
  await ready;
}

export { MARKETING_SCHEMA_SQL };
