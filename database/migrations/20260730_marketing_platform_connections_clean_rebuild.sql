begin;

create schema if not exists marketing;

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
  updated_by uuid references core.users(id)
);

alter table marketing.platform_connections drop constraint if exists platform_connections_platform_check;
alter table marketing.platform_connections add constraint platform_connections_platform_check
  check(platform in ('facebook','instagram','tiktok','youtube'));
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
create index if not exists marketing_platform_oauth_states_expiry_idx
  on marketing.platform_oauth_states(expires_at);

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
create index if not exists marketing_platform_connection_drafts_expiry_idx
  on marketing.platform_connection_drafts(expires_at);

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
create index if not exists marketing_platform_connection_events_created_idx
  on marketing.platform_connection_events(created_at desc);

-- The old page accepted raw tokens manually. Keep existing rows only as data,
-- but mark them for explicit OAuth re-authorization so no legacy manual token
-- is treated as a verified connection by the rebuilt tab.
update marketing.platform_connections
set connected=false, status='reauthorization_required', state='legacy_connection',
    access_token_encrypted=null, user_access_token_encrypted=null,
    page_access_token_encrypted=null, refresh_token_encrypted=null,
    token_expires_at=null, refresh_token_expires_at=null, last_verified_at=null,
    last_error='يلزم إعادة الربط من تدفق OAuth الجديد', updated_at=now()
where connected=true and coalesce(source,'') not like 'oauth-%';

commit;
