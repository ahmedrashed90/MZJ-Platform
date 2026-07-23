-- MZJ Marketing local publisher runtime. Additive and isolated to marketing schema.

create table if not exists marketing.publisher_import_plans (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references marketing.publisher_devices(id) on delete cascade,
  root_folder_name text not null,
  raw_plan jsonb not null default '{}'::jsonb,
  job_count integer not null default 0,
  status text not null default 'imported',
  created_at timestamptz not null default now(),
  constraint marketing_publisher_import_plans_status_check check (status in ('imported','processing','completed','failed','cancelled'))
);

create table if not exists marketing.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  import_plan_id uuid references marketing.publisher_import_plans(id) on delete set null,
  device_id uuid not null references marketing.publisher_devices(id) on delete cascade,
  source_day text not null,
  post_type text not null,
  caption text,
  media jsonb not null default '[]'::jsonb,
  status text not null default 'queued',
  idempotency_key text not null unique,
  lease_token_hash text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  result jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint marketing_publish_jobs_status_check check (status in ('queued','leased','uploading','processing','completed','failed','blocked','cancelled'))
);

create index if not exists marketing_publish_jobs_device_status_idx on marketing.publish_jobs(device_id,status,created_at);
create index if not exists marketing_publish_jobs_lease_idx on marketing.publish_jobs(status,lease_expires_at);
