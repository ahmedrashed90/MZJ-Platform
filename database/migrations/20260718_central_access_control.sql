-- MZJ central access-control schema migration
-- Idempotent and non-destructive: it adds/extends central core tables and does not delete operational data.

begin;

create table if not exists core.systems (
  code text primary key,
  name_ar text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists core.system_pages (
  id uuid primary key default gen_random_uuid(),
  system_code text not null references core.systems(code) on delete cascade,
  code text not null,
  name_ar text not null,
  route text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(system_code, code)
);

alter table core.permissions add column if not exists page_code text;
alter table core.permissions add column if not exists action_code text;
alter table core.permissions add column if not exists name_ar text;
alter table core.permissions add column if not exists description_ar text;
alter table core.permissions add column if not exists category text not null default 'action';
alter table core.permissions add column if not exists is_sensitive boolean not null default false;
alter table core.permissions add column if not exists is_active boolean not null default true;
alter table core.permissions add column if not exists sort_order integer not null default 0;
alter table core.permissions add column if not exists updated_at timestamptz not null default now();
update core.permissions set name_ar = coalesce(nullif(name_ar, ''), name) where name_ar is null or name_ar = '';

alter table core.users add column if not exists permission_version bigint not null default 1;

create table if not exists core.user_systems (
  user_id uuid not null references core.users(id) on delete cascade,
  system_code text not null references core.systems(code) on delete cascade,
  is_enabled boolean not null default false,
  role_id uuid references core.roles(id) on delete set null,
  data_scope text not null default 'assigned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, system_code),
  constraint core_user_systems_data_scope_check check (data_scope in (
    'self','assigned','created_by_me','branch','branches','department','departments',
    'branch_and_department','source_branch','destination_branch','workflow_assigned','all'
  ))
);

create table if not exists core.user_permission_overrides (
  user_id uuid not null references core.users(id) on delete cascade,
  permission_id uuid not null references core.permissions(id) on delete cascade,
  effect text not null,
  reason text,
  created_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, permission_id),
  constraint core_user_permission_overrides_effect_check check (effect in ('allow','deny'))
);

create table if not exists core.user_scope_rules (
  user_id uuid not null references core.users(id) on delete cascade,
  system_code text not null references core.systems(code) on delete cascade,
  scope_code text not null,
  branch_ids uuid[] not null default '{}',
  department_ids uuid[] not null default '{}',
  created_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, system_code),
  constraint core_user_scope_rules_scope_check check (scope_code in (
    'self','assigned','created_by_me','branch','branches','department','departments',
    'branch_and_department','source_branch','destination_branch','workflow_assigned','all'
  ))
);

create table if not exists core.permission_change_log (
  id bigserial primary key,
  target_user_id uuid references core.users(id) on delete set null,
  target_role_id uuid references core.roles(id) on delete set null,
  changed_by uuid references core.users(id) on delete set null,
  change_type text not null,
  permission_code text,
  system_code text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  request_id text,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists core_permissions_system_page_idx on core.permissions(system_code, page_code, sort_order);
create index if not exists core_user_systems_enabled_idx on core.user_systems(user_id, is_enabled);
create index if not exists core_user_permission_overrides_user_idx on core.user_permission_overrides(user_id, effect);
create index if not exists core_permission_change_log_target_idx on core.permission_change_log(target_user_id, created_at desc);

alter table audit.activity_log add column if not exists page_code text;
alter table audit.activity_log add column if not exists permission_code text;
alter table audit.activity_log add column if not exists branch_code text;
alter table audit.activity_log add column if not exists department_code text;
alter table audit.activity_log add column if not exists user_agent text;
alter table audit.activity_log add column if not exists request_id text;
alter table audit.activity_log add column if not exists result text not null default 'success';
alter table audit.activity_log add column if not exists rejection_reason text;

commit;
