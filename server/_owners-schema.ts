import { getSql } from "./_db.js";
import { ensureCrmSchema } from "./_crm-schema.js";

const OWNERS_SCHEMA_SQL = String.raw`
create schema if not exists owners;

create table if not exists owners.settings (
  id text primary key default 'default',
  is_enabled boolean not null default true,
  otp_template_id uuid references crm.message_templates(id) on delete set null,
  welcome_template_id uuid references crm.message_templates(id) on delete set null,
  otp_expiry_minutes integer not null default 5 check (otp_expiry_minutes between 1 and 30),
  otp_resend_seconds integer not null default 60 check (otp_resend_seconds between 15 and 600),
  otp_max_attempts integer not null default 5 check (otp_max_attempts between 1 and 20),
  points_unique_open integer not null default 1 check (points_unique_open >= 0),
  points_registration integer not null default 10 check (points_registration >= 0),
  points_qualified integer not null default 25 check (points_qualified >= 0),
  points_sale integer not null default 500 check (points_sale >= 0),
  daily_open_points_cap integer not null default 25 check (daily_open_points_cap >= 0),
  referral_default_service text not null default 'cash',
  referral_default_branch text not null default 'online',
  friend_benefit_title text not null default 'ميزة خاصة من عميل MZJ',
  friend_benefit_text text not null default 'سجل بياناتك من رابط الدعوة وسيقوم فريق MZJ بالتواصل معك.',
  welcome_message_enabled boolean not null default false,
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);
insert into owners.settings(id) values('default') on conflict(id) do nothing;

create table if not exists owners.members (
  id uuid primary key default gen_random_uuid(),
  phone_normalized text not null unique,
  customer_name text,
  crm_lead_id uuid references crm.leads(id) on delete set null,
  source_sale_id uuid references crm.sales_transactions(id) on delete set null,
  referral_code text not null unique,
  status text not null default 'active',
  points_balance integer not null default 0,
  tier_code text not null default 'member',
  first_sale_at timestamptz,
  last_sale_at timestamptz,
  activated_at timestamptz not null default now(),
  last_login_at timestamptz,
  welcome_sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owners_members_lead_idx on owners.members(crm_lead_id);

create table if not exists owners.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_member_id uuid not null references owners.members(id) on delete cascade,
  referred_name text,
  referred_phone_normalized text,
  crm_lead_id uuid references crm.leads(id) on delete set null,
  sale_transaction_id uuid references crm.sales_transactions(id) on delete set null,
  status text not null default 'clicked',
  registered_at timestamptz,
  qualified_at timestamptz,
  sold_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists owners_referral_phone_per_referrer_unique
  on owners.referrals(referrer_member_id,referred_phone_normalized)
  where referred_phone_normalized is not null;
create unique index if not exists owners_referral_phone_unique on owners.referrals(referred_phone_normalized) where referred_phone_normalized is not null;
create index if not exists owners_referrals_status_idx on owners.referrals(status,created_at desc);

create table if not exists owners.referral_visits (
  id uuid primary key default gen_random_uuid(),
  referrer_member_id uuid not null references owners.members(id) on delete cascade,
  visitor_hash text not null,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now(),
  unique(referrer_member_id,visitor_hash)
);

create table if not exists owners.points_ledger (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references owners.members(id) on delete cascade,
  points integer not null,
  event_type text not null,
  event_key text not null unique,
  referral_id uuid references owners.referrals(id) on delete set null,
  reward_id uuid,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists owners_points_member_idx on owners.points_ledger(member_id,created_at desc);

create table if not exists owners.rewards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  points_cost integer not null check(points_cost > 0),
  stock_quantity integer,
  redeemed_quantity integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references core.users(id),
  updated_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists owners.redemptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references owners.members(id) on delete cascade,
  reward_id uuid not null references owners.rewards(id),
  points_cost integer not null,
  status text not null default 'requested',
  note text,
  reviewed_by uuid references core.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owners_redemptions_status_idx on owners.redemptions(status,created_at desc);

create table if not exists owners.otp_challenges (
  id uuid primary key default gen_random_uuid(),
  phone_normalized text not null,
  code_hash text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists owners_otp_phone_idx on owners.otp_challenges(phone_normalized,created_at desc);

create table if not exists owners.sessions (
  token_hash text primary key,
  member_id uuid not null references owners.members(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists owners_sessions_member_idx on owners.sessions(member_id,expires_at desc);

insert into core.sources(code,name,sort_order,is_active,delivery_route,allow_free_text)
values('owners_referral','MZJ Owners Community',990,true,'whatsapp',false)
on conflict(code) do update set name=excluded.name,is_active=true;
insert into crm.sources(code,name,sort_order,is_active)
values('owners_referral','MZJ Owners Community',990,true)
on conflict(code) do update set name=excluded.name,is_active=true;
`;

let promise: Promise<void> | null = null;
export function ensureOwnersSchema() {
  if (!promise) {
    promise = (async () => {
      await ensureCrmSchema();
      const sql = getSql();
      await sql.unsafe(OWNERS_SCHEMA_SQL);
    })().catch((error) => { promise = null; throw error; });
  }
  return promise;
}
