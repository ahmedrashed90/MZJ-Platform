create table if not exists core.notification_preferences (
  user_id uuid primary key references core.users(id) on delete cascade,
  sound_enabled boolean not null default true,
  toast_enabled boolean not null default true,
  toast_duration_seconds smallint not null default 5 check (toast_duration_seconds in (3,5,8,10)),
  crm_alerts_enabled boolean not null default true,
  marketing_alerts_enabled boolean not null default true,
  operations_alerts_enabled boolean not null default true,
  tracking_alerts_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
