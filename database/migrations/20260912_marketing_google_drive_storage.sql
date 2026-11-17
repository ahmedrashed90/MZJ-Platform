begin;

create table if not exists marketing.google_drive_connection (
  id smallint primary key default 1 check(id = 1),
  status text not null default 'disconnected',
  root_folder_id text,
  root_folder_name text,
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

create table if not exists marketing.google_drive_oauth_states (
  state_hash text primary key,
  user_id uuid not null references core.users(id) on delete cascade,
  redirect_uri text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists marketing_google_drive_oauth_states_expiry_idx on marketing.google_drive_oauth_states(expires_at);

create table if not exists marketing.google_drive_upload_tickets (
  ticket_hash text primary key,
  file_id uuid not null references marketing.files(id) on delete cascade,
  final_media_group_id uuid not null references marketing.final_media_groups(id) on delete cascade,
  task_id uuid not null references marketing.tasks(id) on delete cascade,
  status text not null default 'prepared',
  expires_at timestamptz not null,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists marketing_google_drive_upload_tickets_expiry_idx on marketing.google_drive_upload_tickets(expires_at,status);

commit;
