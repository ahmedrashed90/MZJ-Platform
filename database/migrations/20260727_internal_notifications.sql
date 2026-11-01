create table if not exists core.notifications (
  id uuid primary key default gen_random_uuid(),
  system_code text not null check (system_code in ('crm','marketing','operations','tracking')),
  event_type text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id text,
  action_url text,
  severity text not null default 'info' check (severity in ('info','success','warning','danger')),
  actor_id uuid references core.users(id) on delete set null,
  actor_name text,
  audience_user_ids uuid[] not null default '{}'::uuid[],
  branch_codes text[] not null default '{}'::text[],
  department_codes text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create unique index if not exists core_notifications_dedupe_unique on core.notifications(dedupe_key) where dedupe_key is not null;
create index if not exists core_notifications_system_created_idx on core.notifications(system_code,created_at desc);
create index if not exists core_notifications_audience_idx on core.notifications using gin(audience_user_ids);
create table if not exists core.notification_user_state (
  notification_id uuid not null references core.notifications(id) on delete cascade,
  user_id uuid not null references core.users(id) on delete cascade,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(notification_id,user_id)
);
create index if not exists core_notification_state_user_idx on core.notification_user_state(user_id,read_at,dismissed_at);
