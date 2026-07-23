import { runSqlScript } from "./_db.js";

let marketingSchemaPromise: Promise<void> | null = null;

export const MARKETING_SCHEMA_SQL = String.raw`
create schema if not exists marketing;

create table if not exists marketing.campaigns (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  campaign_code text unique,
  name text not null,
  campaign_type text,
  objective text,
  brief text,
  status text not null default 'في انتظار اعتماد الهيكل',
  starts_at timestamptz,
  ends_at timestamptz,
  due_at timestamptz,
  budget_total numeric(14,2) not null default 0,
  structure_approved_by uuid references core.users(id),
  structure_approved_at timestamptz,
  publish_ready_at timestamptz,
  raw_root_path text,
  folder_created_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references core.users(id),
  updated_by uuid references core.users(id),
  archived_at timestamptz,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.creatives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  instance_key text not null,
  creative_type text not null,
  name text not null,
  description text,
  quantity integer not null default 1,
  status text not null default 'في انتظار اعتماد الهيكل',
  cars jsonb not null default '[]'::jsonb,
  departments jsonb not null default '[]'::jsonb,
  budget numeric(14,2) not null default 0,
  sort_order integer not null default 0,
  raw_path text,
  output_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketing.tasks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_id uuid references marketing.creatives(id) on delete cascade,
  task_key text not null,
  task_type text not null default 'execution',
  title text not null,
  department_code text not null,
  assigned_to uuid references core.users(id),
  paired_content_user_id uuid references core.users(id),
  status text not null,
  due_at timestamptz,
  completed_at timestamptz,
  notes text,
  template_data jsonb not null default '{}'::jsonb,
  action_data jsonb not null default '[]'::jsonb,
  final_file_path text,
  final_file_name text,
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references core.users(id),
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into core.roles(code,name,is_system) values
('marketing_user','مستخدم التسويق',true)
on conflict(code) do update set name=excluded.name,is_system=true;

create schema if not exists marketing;

alter table marketing.campaigns add column if not exists brief text;
alter table marketing.campaigns add column if not exists budget_total numeric(14,2) not null default 0;
alter table marketing.campaigns add column if not exists structure_approved_by uuid references core.users(id);
alter table marketing.campaigns add column if not exists structure_approved_at timestamptz;
alter table marketing.campaigns add column if not exists publish_ready_at timestamptz;
alter table marketing.campaigns add column if not exists raw_root_path text;
alter table marketing.campaigns add column if not exists folder_created_at timestamptz;
alter table marketing.campaigns add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table marketing.campaigns add column if not exists updated_by uuid references core.users(id);
alter table marketing.campaigns add column if not exists archived_at timestamptz;
alter table marketing.campaigns alter column status set default 'في انتظار اعتماد الهيكل';

alter table marketing.creatives add column if not exists instance_key text;
alter table marketing.creatives add column if not exists name text;
alter table marketing.creatives add column if not exists description text;
alter table marketing.creatives add column if not exists cars jsonb not null default '[]'::jsonb;
alter table marketing.creatives add column if not exists departments jsonb not null default '[]'::jsonb;
alter table marketing.creatives add column if not exists budget numeric(14,2) not null default 0;
alter table marketing.creatives add column if not exists sort_order integer not null default 0;
alter table marketing.creatives add column if not exists raw_path text;
alter table marketing.creatives add column if not exists output_path text;
alter table marketing.creatives add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table marketing.creatives add column if not exists updated_at timestamptz not null default now();
update marketing.creatives set instance_key = coalesce(nullif(instance_key,''), 'legacy-' || id::text), name = coalesce(nullif(name,''), creative_type) where instance_key is null or name is null;
alter table marketing.creatives alter column instance_key set not null;
alter table marketing.creatives alter column name set not null;
create unique index if not exists marketing_creatives_campaign_instance_uidx on marketing.creatives(campaign_id, instance_key);

alter table marketing.tasks add column if not exists task_key text;
alter table marketing.tasks add column if not exists task_type text not null default 'execution';
alter table marketing.tasks add column if not exists title text;
alter table marketing.tasks add column if not exists notes text;
alter table marketing.tasks add column if not exists template_data jsonb not null default '{}'::jsonb;
alter table marketing.tasks add column if not exists action_data jsonb not null default '[]'::jsonb;
alter table marketing.tasks add column if not exists final_file_path text;
alter table marketing.tasks add column if not exists final_file_name text;
alter table marketing.tasks add column if not exists submitted_at timestamptz;
alter table marketing.tasks add column if not exists approved_at timestamptz;
alter table marketing.tasks add column if not exists approved_by uuid references core.users(id);
alter table marketing.tasks add column if not exists sort_order integer not null default 0;
alter table marketing.tasks add column if not exists metadata jsonb not null default '{}'::jsonb;
update marketing.tasks set task_key = coalesce(nullif(task_key,''), 'legacy-' || id::text), title = coalesce(nullif(title,''), department_code) where task_key is null or title is null;
alter table marketing.tasks alter column task_key set not null;
alter table marketing.tasks alter column title set not null;
create unique index if not exists marketing_tasks_campaign_key_uidx on marketing.tasks(campaign_id, task_key);
create index if not exists marketing_tasks_assigned_status_idx on marketing.tasks(assigned_to, status, due_at);

create table if not exists marketing.agenda_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  item_type text not null default 'task',
  starts_at timestamptz not null,
  ends_at timestamptz,
  owner_id uuid references core.users(id),
  campaign_id uuid references marketing.campaigns(id) on delete set null,
  status text not null default 'مجدول',
  notes text,
  created_by uuid references core.users(id),
  updated_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists marketing_agenda_starts_idx on marketing.agenda_items(starts_at, status);

create table if not exists marketing.publishing_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references marketing.campaigns(id) on delete cascade,
  creative_id uuid not null references marketing.creatives(id) on delete cascade,
  platform_code text not null,
  post_type text not null,
  scheduled_at timestamptz,
  caption text,
  hashtags text,
  media_path text,
  status text not null default 'مسودة',
  published_at timestamptz,
  external_post_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references core.users(id),
  updated_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists marketing_publishing_schedule_idx on marketing.publishing_items(scheduled_at, status);

create table if not exists marketing.creative_type_settings (
  code text primary key,
  name text not null,
  department_codes text[] not null default array['content'],
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into marketing.creative_type_settings(code,name,department_codes,sort_order) values
('SHOWROOM_REEL','تصوير ريل - معرضنا - SHOWROOM',array['content','photography'],10),
('PHOTO_STORY','تصوير ستوري - معرضنا - SHOWROOM',array['content','photography'],20),
('REEL','REEL',array['content','montage'],30),
('VIDEO','VIDEO',array['content','montage'],40),
('STORY','STORY',array['content','montage'],50),
('POST','POST',array['content','design'],60),
('CAROUSEL','CAROUSEL',array['content','design'],70),
('PANNER','PANNER',array['content','design'],80),
('MOTION','MOTION',array['content','design'],90),
('GIF','GIF',array['content','design'],100),
('PRINT','مطبوعات اوفلاين',array['content','design'],110),
('MZJ_INTERIAL','MZJ-INTERIAL',array['content','design'],120)
on conflict(code) do update set name=excluded.name,department_codes=excluded.department_codes,sort_order=excluded.sort_order,is_active=true,updated_at=now();

create table if not exists marketing.platform_settings (
  code text primary key,
  name text not null,
  post_types text[] not null default '{}',
  is_active boolean not null default true,
  connection_status text not null default 'غير مربوط',
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into marketing.platform_settings(code,name,post_types,connection_status,sort_order) values
('instagram','Instagram',array['Post','Reel','Story','Carousel'],'جاهز',10),
('facebook','Facebook',array['Post','Reel','Story'],'جاهز',20),
('tiktok','TikTok',array['Video','Draft Upload'],'Sandbox / Draft Upload',30),
('snapchat','Snapchat',array['Story','Spotlight','Saved Story'],'بانتظار موافقة Public Profile API',40),
('youtube','YouTube',array['Video','Short'],'غير مربوط',50),
('x','X',array['Post','Video'],'غير مربوط',60)
on conflict(code) do update set name=excluded.name,post_types=excluded.post_types,connection_status=excluded.connection_status,sort_order=excluded.sort_order,updated_at=now();

create table if not exists marketing.activity_log (
  id bigserial primary key,
  campaign_id uuid references marketing.campaigns(id) on delete cascade,
  task_id uuid references marketing.tasks(id) on delete cascade,
  user_id uuid references core.users(id),
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists marketing_activity_campaign_idx on marketing.activity_log(campaign_id, created_at desc);

insert into core.permissions(code,name,system_code) values
('marketing.view','عرض التسويق','marketing'),
('marketing.campaigns.manage','إدارة الحملات','marketing'),
('marketing.structure.approve','اعتماد هيكل الحملات','marketing'),
('marketing.templates.manage','تنفيذ Task Template','marketing'),
('marketing.templates.approve','اعتماد Task Template','marketing'),
('marketing.tasks.execute','تنفيذ تكليفات التسويق','marketing'),
('marketing.tasks.approve','اعتماد تنفيذ تكليفات التسويق','marketing'),
('marketing.publishing.manage','إدارة تجهيز النشر','marketing'),
('marketing.settings.manage','إدارة إعدادات التسويق','marketing')
on conflict(code) do update set name=excluded.name,system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code in ('admin','system_admin') and p.system_code='marketing'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('marketing.view','marketing.templates.manage','marketing.tasks.execute')
where r.code='marketing_user'
on conflict do nothing;
`;

export function ensureMarketingSchema() {
  if (!marketingSchemaPromise) {
    marketingSchemaPromise = runSqlScript(MARKETING_SCHEMA_SQL).catch((error) => {
      marketingSchemaPromise = null;
      throw error;
    });
  }
  return marketingSchemaPromise;
}
