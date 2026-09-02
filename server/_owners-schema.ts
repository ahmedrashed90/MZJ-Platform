import { getSql, runSqlScript, withDatabaseAdvisoryLock } from "./_db.js";
import { ensureCrmSchema } from "./_crm-schema.js";

const OWNERS_SCHEMA_SQL = String.raw`
create schema if not exists owners;

create table if not exists owners.settings (
  id text primary key default 'default',
  is_enabled boolean not null default true,
  otp_expiry_minutes integer not null default 5 check (otp_expiry_minutes between 1 and 30),
  otp_resend_seconds integer not null default 60 check (otp_resend_seconds between 15 and 600),
  otp_max_attempts integer not null default 5 check (otp_max_attempts between 1 and 20),
  otp_hourly_limit integer not null default 5 check (otp_hourly_limit between 1 and 30),
  points_purchase_enabled boolean not null default true,
  points_purchase integer not null default 500 check (points_purchase >= 0),
  purchase_points_effective_at timestamptz not null default now(),
  points_repurchase_enabled boolean not null default true,
  points_repurchase integer not null default 500 check (points_repurchase >= 0),
  points_unique_open_enabled boolean not null default true,
  points_unique_open integer not null default 50 check (points_unique_open >= 0),
  points_registration_enabled boolean not null default true,
  points_registration integer not null default 10 check (points_registration >= 0),
  points_qualified_enabled boolean not null default true,
  points_qualified integer not null default 25 check (points_qualified >= 0),
  points_sale_enabled boolean not null default true,
  points_sale integer not null default 700 check (points_sale >= 0),
  daily_open_points_cap integer not null default 25 check (daily_open_points_cap >= 0),
  silver_points integer not null default 1000 check (silver_points >= 0),
  gold_points integer not null default 3000 check (gold_points >= 0),
  platinum_points integer not null default 7000 check (platinum_points >= 0),
  referral_default_service text not null default 'cash',
  referral_default_branch text not null default 'online',
  friend_benefit_title text not null default 'دعوة من مجموعة محمد بن ذعار العجمي',
  friend_benefit_text text not null default 'سجل بياناتك من رابط الدعوة للاستفادة من المزايا المتاحة.',
  welcome_message_enabled boolean not null default false,
  welcome_message_template text,
  updated_by uuid references core.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into owners.settings(id) values('default') on conflict(id) do nothing;

alter table owners.settings add column if not exists otp_hourly_limit integer not null default 5;
alter table owners.settings add column if not exists welcome_message_template text;
alter table owners.settings add column if not exists points_purchase_enabled boolean not null default true;
alter table owners.settings add column if not exists points_purchase integer not null default 500;
alter table owners.settings add column if not exists purchase_points_effective_at timestamptz not null default now();
alter table owners.settings add column if not exists points_repurchase_enabled boolean not null default true;
alter table owners.settings add column if not exists points_repurchase integer not null default 500;
alter table owners.settings add column if not exists points_unique_open_enabled boolean not null default true;
alter table owners.settings alter column points_purchase_enabled set default true;
alter table owners.settings alter column points_unique_open set default 50;
alter table owners.settings alter column points_sale set default 700;
alter table owners.settings add column if not exists points_registration_enabled boolean not null default true;
alter table owners.settings add column if not exists points_qualified_enabled boolean not null default true;
alter table owners.settings add column if not exists points_sale_enabled boolean not null default true;
alter table owners.settings add column if not exists silver_points integer not null default 1000;
alter table owners.settings add column if not exists gold_points integer not null default 3000;
alter table owners.settings add column if not exists platinum_points integer not null default 7000;

create table if not exists owners.members (
  id uuid primary key default gen_random_uuid(),
  phone_normalized text not null unique,
  customer_name text,
  crm_lead_id uuid references crm.leads(id) on delete set null,
  source_sale_id uuid references crm.sales_transactions(id) on delete set null,
  referral_code text not null unique,
  status text not null default 'active' check (status in ('active','suspended','closed')),
  points_balance integer not null default 0,
  lifetime_points integer not null default 0,
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
alter table owners.members add column if not exists lifetime_points integer not null default 0;
create index if not exists owners_members_lead_idx on owners.members(crm_lead_id);
create index if not exists owners_members_status_idx on owners.members(status,created_at desc);


create table if not exists owners.legacy_customer_codes (
  id uuid primary key default gen_random_uuid(),
  crm_lead_id uuid not null unique references crm.leads(id) on delete cascade,
  phone_normalized text,
  customer_name text,
  referral_code text not null unique,
  status text not null default 'active' check(status in ('active','converted')),
  converted_member_id uuid references owners.members(id) on delete set null,
  converted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owners_legacy_customer_codes_phone_idx on owners.legacy_customer_codes(phone_normalized,status);
create index if not exists owners_legacy_customer_codes_status_idx on owners.legacy_customer_codes(status,updated_at desc);
alter table owners.legacy_customer_codes alter column phone_normalized drop not null;
alter table owners.legacy_customer_codes add column if not exists welcome_sent_at timestamptz;

create table if not exists owners.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_member_id uuid not null references owners.members(id) on delete cascade,
  referred_name text,
  referred_phone_normalized text,
  crm_lead_id uuid references crm.leads(id) on delete set null,
  sale_transaction_id uuid references crm.sales_transactions(id) on delete set null,
  status text not null default 'registered' check (status in ('registered','qualified','sold','rejected')),
  registered_at timestamptz,
  qualified_at timestamptz,
  sold_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists owners_referral_phone_unique
  on owners.referrals(referred_phone_normalized)
  where referred_phone_normalized is not null;
create index if not exists owners_referrals_referrer_idx on owners.referrals(referrer_member_id,created_at desc);
create index if not exists owners_referrals_lead_idx on owners.referrals(crm_lead_id);
create index if not exists owners_referrals_status_idx on owners.referrals(status,created_at desc);
alter table owners.referrals alter column referrer_member_id drop not null;
alter table owners.referrals add column if not exists referrer_legacy_customer_code_id uuid references owners.legacy_customer_codes(id) on delete set null;
create index if not exists owners_referrals_legacy_referrer_idx on owners.referrals(referrer_legacy_customer_code_id,created_at desc);

create table if not exists owners.referral_visits (
  id uuid primary key default gen_random_uuid(),
  referrer_member_id uuid not null references owners.members(id) on delete cascade,
  visitor_hash text not null,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now(),
  unique(referrer_member_id,visitor_hash)
);
create index if not exists owners_referral_visits_created_idx on owners.referral_visits(referrer_member_id,created_at desc);
alter table owners.referral_visits alter column referrer_member_id drop not null;
alter table owners.referral_visits add column if not exists referrer_legacy_customer_code_id uuid references owners.legacy_customer_codes(id) on delete set null;
create index if not exists owners_referral_visits_legacy_referrer_idx on owners.referral_visits(referrer_legacy_customer_code_id,created_at desc);
create unique index if not exists owners_referral_visits_legacy_unique
  on owners.referral_visits(referrer_legacy_customer_code_id,visitor_hash)
  where referrer_legacy_customer_code_id is not null;

create table if not exists owners.rewards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  reward_type text not null default 'gift' check (reward_type in ('gift','discount','service','voucher')),
  reward_value text,
  show_on_member_card boolean not null default false,
  show_on_member_page boolean not null default false,
  available_for_referral_purchase boolean not null default false,
  available_for_existing_customer_purchase boolean not null default false,
  available_for_friend_referral_purchase boolean not null default false,
  available_for_repurchase boolean not null default false,
  checkout_discount_type text not null default 'amount' check(checkout_discount_type in ('amount','percentage')),
  checkout_discount_value numeric(12,2) not null default 0 check(checkout_discount_value >= 0),
  checkout_discount_amount numeric(12,2) not null default 0 check(checkout_discount_amount >= 0),
  points_cost integer not null check(points_cost > 0),
  stock_quantity integer,
  redeemed_quantity integer not null default 0,
  referral_purchase_redeemed_quantity integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references core.users(id) on delete set null,
  updated_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table owners.rewards add column if not exists reward_type text not null default 'gift';
alter table owners.rewards add column if not exists reward_value text;
alter table owners.rewards add column if not exists show_on_member_card boolean not null default false;
alter table owners.rewards add column if not exists show_on_member_page boolean not null default false;
alter table owners.rewards add column if not exists available_for_referral_purchase boolean not null default false;
alter table owners.rewards add column if not exists available_for_existing_customer_purchase boolean not null default false;
alter table owners.rewards add column if not exists available_for_friend_referral_purchase boolean not null default false;
alter table owners.rewards add column if not exists available_for_repurchase boolean not null default false;
alter table owners.rewards add column if not exists checkout_discount_type text not null default 'amount';
alter table owners.rewards add column if not exists checkout_discount_value numeric(12,2) not null default 0;
alter table owners.rewards add column if not exists checkout_discount_amount numeric(12,2) not null default 0;
alter table owners.rewards add column if not exists referral_purchase_redeemed_quantity integer not null default 0;
update owners.rewards
set checkout_discount_value=checkout_discount_amount
where checkout_discount_value=0 and checkout_discount_amount>0;

create table if not exists owners.referral_purchase_benefits (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid references owners.referrals(id) on delete cascade,
  referrer_member_id uuid not null references owners.members(id) on delete cascade,
  referred_phone_normalized text not null,
  customer_kind text not null default 'new' check(customer_kind in ('new','existing')),
  reward_id uuid not null references owners.rewards(id),
  reward_name text not null,
  reward_type text not null,
  reward_value text,
  checkout_discount_type text not null default 'amount' check(checkout_discount_type in ('amount','percentage')),
  checkout_discount_value numeric(12,2) not null default 0 check(checkout_discount_value >= 0),
  checkout_discount_amount numeric(12,2) not null default 0,
  website_order_id text not null,
  next_erp_sales_order text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(website_order_id)
);
alter table owners.referral_purchase_benefits
  drop constraint if exists referral_purchase_benefits_referred_phone_normalized_key;
create index if not exists owners_referral_purchase_benefits_phone_idx
  on owners.referral_purchase_benefits(referred_phone_normalized,created_at desc);
create index if not exists owners_referral_purchase_benefits_referrer_idx
  on owners.referral_purchase_benefits(referrer_member_id,created_at desc);
alter table owners.referral_purchase_benefits alter column referral_id drop not null;
alter table owners.referral_purchase_benefits alter column referrer_member_id drop not null;
alter table owners.referral_purchase_benefits add column if not exists legacy_customer_code_id uuid references owners.legacy_customer_codes(id) on delete set null;
alter table owners.referral_purchase_benefits add column if not exists referrer_kind text not null default 'member' check(referrer_kind in ('member','legacy'));
alter table owners.referral_purchase_benefits add column if not exists customer_kind text not null default 'new';
alter table owners.referral_purchase_benefits add column if not exists checkout_discount_type text not null default 'amount';
alter table owners.referral_purchase_benefits add column if not exists checkout_discount_value numeric(12,2) not null default 0;
update owners.referral_purchase_benefits
set checkout_discount_value=checkout_discount_amount
where checkout_discount_value=0 and checkout_discount_amount>0;
create index if not exists owners_referral_purchase_benefits_reward_idx
  on owners.referral_purchase_benefits(reward_id,created_at desc);

create table if not exists owners.points_ledger (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references owners.members(id) on delete cascade,
  points integer not null,
  event_type text not null,
  event_key text not null unique,
  referral_id uuid references owners.referrals(id) on delete set null,
  reward_id uuid references owners.rewards(id) on delete set null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists owners_points_member_idx on owners.points_ledger(member_id,created_at desc);
create index if not exists owners_points_event_idx on owners.points_ledger(event_type,created_at desc);

create table if not exists owners.redemptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references owners.members(id) on delete cascade,
  reward_id uuid not null references owners.rewards(id),
  points_cost integer not null,
  status text not null default 'requested' check(status in ('requested','approved','delivered','rejected','cancelled')),
  redemption_code text,
  note text,
  reviewed_by uuid references core.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table owners.redemptions add column if not exists redemption_code text;
alter table owners.redemptions add column if not exists website_order_id text;
alter table owners.redemptions add column if not exists next_erp_sales_order text;
alter table owners.redemptions add column if not exists used_channel text;
alter table owners.redemptions add column if not exists used_by_phone_normalized text;
create unique index if not exists owners_redemptions_code_unique on owners.redemptions(redemption_code) where redemption_code is not null;
drop index if exists owners.owners_redemptions_website_order_unique;
create index if not exists owners_redemptions_website_order_idx on owners.redemptions(website_order_id) where website_order_id is not null;
create index if not exists owners_redemptions_status_idx on owners.redemptions(status,created_at desc);
create index if not exists owners_redemptions_member_idx on owners.redemptions(member_id,created_at desc);

create table if not exists owners.personal_code_uses (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references owners.members(id) on delete cascade,
  code_snapshot text not null,
  used_by_phone_normalized text not null,
  self_use boolean not null default false,
  website_order_id text not null,
  vehicle_id text,
  car_pre_tax numeric(14,2) not null default 0 check(car_pre_tax >= 0),
  discount_amount numeric(14,2) not null default 0 check(discount_amount >= 0),
  next_erp_sales_order text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(website_order_id)
);
-- Canonical v1224 shape: a sold member may reuse their own customer code on
-- later purchases. Keep one ledger row per website order for idempotency and
-- audit history, but remove the former global one-use constraint per member.
alter table owners.personal_code_uses drop constraint if exists personal_code_uses_member_id_key;
create index if not exists owners_personal_code_uses_member_idx on owners.personal_code_uses(member_id,created_at desc);
create index if not exists owners_personal_code_uses_phone_idx on owners.personal_code_uses(used_by_phone_normalized,created_at desc);

-- A member invite code may be used by many different customers, but the same
-- customer phone may use the same member invite code only once. This table is
-- deliberately separate from personal_code_uses, where the member's own code
-- is reusable across separate purchases and remains idempotent per website order.
create table if not exists owners.friend_code_uses (
  id uuid primary key default gen_random_uuid(),
  referrer_member_id uuid not null references owners.members(id) on delete cascade,
  code_snapshot text not null,
  used_by_phone_normalized text not null,
  website_order_id text not null,
  next_erp_sales_order text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(referrer_member_id,used_by_phone_normalized),
  unique(website_order_id)
);
create index if not exists owners_friend_code_uses_phone_idx on owners.friend_code_uses(used_by_phone_normalized,created_at desc);
create index if not exists owners_friend_code_uses_referrer_idx on owners.friend_code_uses(referrer_member_id,created_at desc);

-- Preserve the one-use-per-phone rule for friend codes that were already used
-- before this schema version. Historical purchase benefits are the source of truth.
insert into owners.friend_code_uses(
  referrer_member_id,code_snapshot,used_by_phone_normalized,website_order_id,next_erp_sales_order,created_at,updated_at
)
select distinct on (benefit.referrer_member_id,benefit.referred_phone_normalized)
  benefit.referrer_member_id,
  coalesce(nullif(benefit.metadata->>'referralCode',''),member.referral_code),
  benefit.referred_phone_normalized,
  regexp_replace(benefit.website_order_id,':(primary|bonus)$',''),
  benefit.next_erp_sales_order,
  benefit.created_at,
  benefit.updated_at
from owners.referral_purchase_benefits benefit
join owners.members member on member.id=benefit.referrer_member_id
where benefit.referrer_member_id is not null
  and coalesce(benefit.referrer_kind,'member')='member'
  and coalesce(benefit.metadata->>'selfUse','false')='false'
  and coalesce(benefit.referred_phone_normalized,'')<>''
order by benefit.referrer_member_id,benefit.referred_phone_normalized,benefit.created_at,benefit.id
on conflict do nothing;

create table if not exists owners.otp_challenges (
  id uuid primary key,
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
  member_id uuid references owners.members(id) on delete cascade,
  legacy_customer_code_id uuid references owners.legacy_customer_codes(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint owners_sessions_identity_check check(member_id is not null or legacy_customer_code_id is not null)
);
alter table owners.sessions alter column member_id drop not null;
alter table owners.sessions add column if not exists legacy_customer_code_id uuid references owners.legacy_customer_codes(id) on delete cascade;
do $$
begin
  if not exists (
    select 1
    from pg_constraint constraint_row
    join pg_class table_row on table_row.oid=constraint_row.conrelid
    join pg_namespace namespace_row on namespace_row.oid=table_row.relnamespace
    where namespace_row.nspname='owners'
      and table_row.relname='sessions'
      and constraint_row.conname='owners_sessions_identity_check'
  ) then
    alter table owners.sessions
      add constraint owners_sessions_identity_check
      check(member_id is not null or legacy_customer_code_id is not null);
  end if;
end $$;
create index if not exists owners_sessions_member_idx on owners.sessions(member_id,expires_at desc);
create index if not exists owners_sessions_legacy_idx on owners.sessions(legacy_customer_code_id,expires_at desc);

delete from owners.sessions where expires_at <= now();
delete from owners.otp_challenges where expires_at < now() - interval '1 day';

insert into core.sources(code,name,sort_order,is_active,system_codes,delivery_route,allow_free_text,report_group)
values('owners_referral','MZJ Club Community',990,true,array['crm','marketing'],'whatsapp',false,'direct')
on conflict(code) do update set
  name=excluded.name,
  is_active=true,
  system_codes=excluded.system_codes,
  delivery_route=excluded.delivery_route,
  allow_free_text=excluded.allow_free_text,
  report_group=excluded.report_group,
  updated_at=now();

insert into crm.sources(code,name,sort_order,is_active)
values('owners_referral','MZJ Club Community',990,true)
on conflict(code) do update set name=excluded.name,is_active=true;

create table if not exists owners.schema_state (
  id smallint primary key default 1 check(id=1),
  version integer not null,
  updated_at timestamptz not null default now()
);
insert into owners.schema_state(id,version,updated_at) values(1,0,now())
on conflict(id) do nothing;

-- v1222: finish the experimental points period once, reset existing members to a
-- single 500-point opening purchase row, and start the new configurable menu values.
-- The opening event key belongs to the member, not the historical sale. This is
-- intentional: legacy CRM data can resolve the same sale to more than one member,
-- while points_ledger.event_key is globally unique. Sale metadata is still kept so
-- normal purchase reconciliation does not award the same historical purchase again.
do $$
declare
  current_version integer := 0;
begin
  select coalesce(version,0) into current_version from owners.schema_state where id=1;
  if current_version < 1222 then
    update owners.settings set
      points_purchase_enabled=true,
      points_purchase=500,
      purchase_points_effective_at=now(),
      points_repurchase_enabled=true,
      points_repurchase=500,
      points_unique_open_enabled=true,
      points_unique_open=50,
      points_sale_enabled=true,
      points_sale=700,
      daily_open_points_cap=greatest(daily_open_points_cap,50),
      updated_at=now()
    where id='default';

    delete from owners.points_ledger;

    with first_sales as (
      select
        member.id as member_id,
        sale.id as sale_id,
        sale.sale_at,
        sale.source_reference as sale_order_reference
      from owners.members member
      left join lateral (
        select st.id,st.sale_at,st.source_reference
        from crm.sales_transactions st
        join crm.leads lead on lead.id=st.lead_id and lead.is_deleted=false
        where coalesce(st.is_cancelled,false)=false
          and (
            (member.source_sale_id is not null and st.id=member.source_sale_id)
            or (member.crm_lead_id is not null and st.lead_id=member.crm_lead_id)
            or (
              nullif(member.phone_normalized,'') is not null
              and nullif(lead.phone_normalized,'') is not null
              and lead.phone_normalized=member.phone_normalized
            )
          )
        order by st.sale_at,st.created_at,st.id
        limit 1
      ) sale on true
    )
    insert into owners.points_ledger(member_id,points,event_type,event_key,description,metadata,created_at)
    select
      member.id,
      500,
      'purchase',
      'purchase:member:'||member.id::text||':initial',
      'شراء العميل',
      jsonb_build_object(
        'purchaseKind','first',
        'purchaseAwardPoints',500,
        'pointsResetVersion',1222,
        'pointsResetBaseline',true,
        'baseline',true,
        'saleId',case when first_sales.sale_id is not null then first_sales.sale_id::text else null end,
        'saleAt',first_sales.sale_at,
        'saleOrderReference',first_sales.sale_order_reference
      ),
      coalesce(first_sales.sale_at,member.activated_at,member.created_at,now())
    from owners.members member
    left join first_sales on first_sales.member_id=member.id;

    update owners.members member set
      points_balance=500,
      lifetime_points=500,
      tier_code=case
        when 500 >= (select platinum_points from owners.settings where id='default') then 'platinum'
        when 500 >= (select gold_points from owners.settings where id='default') then 'gold'
        when 500 >= (select silver_points from owners.settings where id='default') then 'silver'
        else 'member'
      end,
      updated_at=now();
  end if;
end $$;

-- v1225: production launch reset for MZJ Club points.
-- Everything before this release was an experimental period. Existing active
-- sold members keep a virtual 500-point opening balance, while their movement
-- ledger is cleared completely. The opening balance is stored on the member
-- metadata rather than as a ledger movement so the customer starts with an
-- empty production activity log. Historical sales before the launch timestamp
-- must never be re-awarded by later syncs.
do $$
declare
  current_version integer := 0;
  launch_at timestamptz := now();
begin
  select coalesce(version,0) into current_version from owners.schema_state where id=1;
  if current_version < 1225 then
    update owners.settings set
      points_purchase_enabled=true,
      points_purchase=500,
      purchase_points_effective_at=launch_at,
      updated_at=now()
    where id='default';

    delete from owners.points_ledger ledger
    where exists(
      select 1 from owners.members member
      where member.id=ledger.member_id and member.status='active'
    );

    update owners.members set
      points_balance=500,
      lifetime_points=500,
      tier_code='member',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'pointsProductionReset',true,
        'pointsProductionResetVersion',1225,
        'pointsProductionOpeningBalance',500,
        'pointsProductionOpeningAt',launch_at
      ),
      updated_at=now()
    where status='active';

    -- Existing referral records are retained, but tagged with the same launch
    -- boundary so historical experimental referral conversions cannot recreate
    -- points after the ledger reset.
    update owners.referrals set
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'pointsProductionResetVersion',1225,
        'pointsProductionResetAt',launch_at
      ),
      updated_at=now();

    update owners.schema_state set version=1225,updated_at=now() where id=1;
  end if;
end $$;

-- v1226: pre-sale registered customers may own referral links without being promoted to sold members.
update owners.schema_state set version=greatest(version,1226),updated_at=now() where id=1;
`;

let schemaPromise: Promise<void> | null = null;

async function ownersSchemaReady() {
  const sql = getSql();
  const [shape] = await sql<{ ready: boolean }[]>`
    select
      exists(select 1 from information_schema.tables where table_schema='owners' and table_name='settings')
      and exists(select 1 from information_schema.tables where table_schema='owners' and table_name='members')
      and exists(select 1 from information_schema.tables where table_schema='owners' and table_name='referrals')
      and exists(select 1 from information_schema.tables where table_schema='owners' and table_name='points_ledger')
      and exists(select 1 from information_schema.tables where table_schema='owners' and table_name='otp_challenges')
      and exists(select 1 from information_schema.tables where table_schema='owners' and table_name='schema_state')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='settings' and column_name='otp_hourly_limit')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='settings' and column_name='welcome_message_template')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='settings' and column_name='points_purchase_enabled')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='settings' and column_name='points_purchase')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='settings' and column_name='purchase_points_effective_at')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='settings' and column_name='points_repurchase_enabled')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='settings' and column_name='points_repurchase')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='settings' and column_name='points_unique_open_enabled')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='settings' and column_name='points_registration_enabled')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='settings' and column_name='points_qualified_enabled')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='settings' and column_name='points_sale_enabled')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='members' and column_name='lifetime_points')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='rewards' and column_name='reward_value')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='rewards' and column_name='show_on_member_card')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='rewards' and column_name='show_on_member_page')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='rewards' and column_name='available_for_referral_purchase')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='rewards' and column_name='available_for_existing_customer_purchase')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='rewards' and column_name='available_for_friend_referral_purchase')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='rewards' and column_name='available_for_repurchase')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='rewards' and column_name='checkout_discount_type')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='rewards' and column_name='checkout_discount_value')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='rewards' and column_name='checkout_discount_amount')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='rewards' and column_name='referral_purchase_redeemed_quantity')
      and exists(select 1 from information_schema.tables where table_schema='owners' and table_name='referral_purchase_benefits')
      and exists(select 1 from information_schema.tables where table_schema='owners' and table_name='legacy_customer_codes')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='legacy_customer_codes' and column_name='welcome_sent_at')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='redemptions' and column_name='redemption_code')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='redemptions' and column_name='website_order_id')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='redemptions' and column_name='next_erp_sales_order')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='redemptions' and column_name='used_channel')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='redemptions' and column_name='used_by_phone_normalized')
      and exists(select 1 from information_schema.tables where table_schema='owners' and table_name='personal_code_uses')
      and exists(select 1 from information_schema.tables where table_schema='owners' and table_name='friend_code_uses')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='friend_code_uses' and column_name='referrer_member_id')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='friend_code_uses' and column_name='used_by_phone_normalized')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='friend_code_uses' and column_name='website_order_id')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='sessions' and column_name='legacy_customer_code_id')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='personal_code_uses' and column_name='member_id')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='personal_code_uses' and column_name='website_order_id')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='personal_code_uses' and column_name='car_pre_tax')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='personal_code_uses' and column_name='discount_amount')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='personal_code_uses' and column_name='next_erp_sales_order')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='referral_purchase_benefits' and column_name='customer_kind')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='referral_purchase_benefits' and column_name='checkout_discount_type')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='referral_purchase_benefits' and column_name='checkout_discount_value')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='referral_purchase_benefits' and column_name='legacy_customer_code_id')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='referral_purchase_benefits' and column_name='referrer_kind')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='referrals' and column_name='referrer_legacy_customer_code_id')
      and exists(select 1 from information_schema.columns where table_schema='owners' and table_name='referral_visits' and column_name='referrer_legacy_customer_code_id')
      as ready
  `;
  if (!shape?.ready) return false;
  const [state] = await sql<{ version: number }[]>`select version::int from owners.schema_state where id=1`;
  return Number(state?.version || 0) >= 1226;
}

export function ensureOwnersSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await ensureCrmSchema();
      if (await ownersSchemaReady()) return;
      await withDatabaseAdvisoryLock("mzj:owners-community-schema:v1", async () => {
        if (await ownersSchemaReady()) return;
        await runSqlScript(OWNERS_SCHEMA_SQL);
        if (!(await ownersSchemaReady())) throw new Error("OWNERS_COMMUNITY_SCHEMA_NOT_READY");
      });
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}
