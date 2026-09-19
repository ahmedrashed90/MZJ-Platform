-- MZJ Device Agent v1
create table if not exists core.user_device_policies (
  user_id uuid primary key references core.users(id) on delete cascade,
  verification_required boolean not null default false,
  updated_by uuid references core.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists core.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  device_id text not null,
  device_name text,
  platform text not null default 'windows',
  agent_version text,
  public_key_pem text not null,
  fingerprint_hash text,
  status text not null default 'pending' check (status in ('pending','approved','revoked')),
  approved_by uuid references core.users(id) on delete set null,
  approved_at timestamptz,
  revoked_by uuid references core.users(id) on delete set null,
  revoked_at timestamptz,
  last_verified_at timestamptz,
  last_ip inet,
  last_user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,device_id)
);
create index if not exists user_devices_user_status_idx on core.user_devices(user_id,status,updated_at desc);
create index if not exists user_devices_device_id_idx on core.user_devices(device_id);
with duplicate_approved as (
  select id,row_number() over(partition by user_id order by approved_at desc nulls last,updated_at desc,id desc) as rn
  from core.user_devices
  where status='approved'
)
update core.user_devices d
set status='revoked',revoked_at=coalesce(d.revoked_at,now()),updated_at=now()
from duplicate_approved r
where d.id=r.id and r.rn>1;
create unique index if not exists user_devices_one_approved_per_user_idx on core.user_devices(user_id) where status='approved';

create table if not exists core.device_login_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  challenge text not null,
  poll_token_hash text not null,
  attendance_check_in boolean not null default true,
  device_id text,
  proof_verified_at timestamptz,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists device_login_challenges_user_idx on core.device_login_challenges(user_id,created_at desc);
create index if not exists device_login_challenges_expiry_idx on core.device_login_challenges(expires_at) where consumed_at is null;

alter table core.sessions add column if not exists verified_device_id text;
create index if not exists core_sessions_verified_device_idx on core.sessions(user_id,verified_device_id) where verified_device_id is not null;
