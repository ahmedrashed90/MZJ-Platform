import { getSql, runSqlScript, withDatabaseAdvisoryLock } from './_db.js';
const FORM_SCHEMA_SQL = String.raw`-- Isolated MZJ Marketing Lead Forms feature. Additive only; no existing tables changed.
create schema if not exists marketing;
create extension if not exists pgcrypto;
create table if not exists marketing.lead_forms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null default '',
  template text not null default 'steps' check (template in ('steps','visual','chat','quiz','minimal','classic')),
  status text not null default 'draft' check(status in ('draft','published','paused','archived')),
  config jsonb not null default '{}'::jsonb,
  published_config jsonb,
  published_metadata jsonb,
  sheet_id text not null default '',
  sheet_tab text not null default 'Sheet1',
  sheet_columns jsonb not null default '["name","phone","source","campaign","vehicle","purchase","timeline","submitted_at"]'::jsonb,
  created_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
alter table marketing.lead_forms add column if not exists published_metadata jsonb;
-- Reusable user-created visual form designs; independent of published form instances.
create table if not exists marketing.form_design_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  template text not null check (template in ('steps','visual','chat','quiz','minimal','classic')),
  config jsonb not null,
  created_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists marketing.form_visits (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references marketing.lead_forms(id) on delete cascade,
  visitor_key text not null,
  source text not null default 'direct',
  campaign text not null default '',
  medium text not null default '',
  ad_id text not null default '',
  created_at timestamptz not null default now(),
  unique(form_id,visitor_key)
);
create index if not exists marketing_form_visits_created_idx on marketing.form_visits(form_id,created_at desc);
create table if not exists marketing.form_step_events (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references marketing.lead_forms(id) on delete cascade,
  visitor_key text not null,
  step_id text not null,
  created_at timestamptz not null default now(),
  unique(form_id,visitor_key,step_id)
);
create table if not exists marketing.form_leads (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references marketing.lead_forms(id) on delete cascade,
  submission_key text not null,
  name text not null,
  phone text not null,
  answers jsonb not null default '{}'::jsonb,
  source text not null default 'direct',
  campaign text not null default '',
  medium text not null default '',
  ad_id text not null default '',
  sheet_status text not null default 'not_configured' check(sheet_status in ('not_configured','pending','sent','failed')),
  sheet_error text,
  sheet_synced_at timestamptz,
  ip_hash text,
  created_at timestamptz not null default now(),
  unique(form_id,submission_key)
);
create index if not exists marketing_form_leads_created_idx on marketing.form_leads(form_id,created_at desc);
create index if not exists marketing_form_leads_ip_rate_idx on marketing.form_leads(ip_hash,created_at desc);
create index if not exists marketing_form_leads_sync_idx on marketing.form_leads(sheet_status,created_at) where sheet_status in ('pending','failed');
`;
let ready: Promise<void> | null = null;
export function ensureMarketingLeadFormsSchema() {
  if (!ready) ready = (async () => {
    const sql = getSql();
    const [check] = await sql<{ ok: boolean }[]>`select to_regclass('marketing.lead_forms') is not null and to_regclass('marketing.form_visits') is not null and to_regclass('marketing.form_leads') is not null and to_regclass('marketing.form_step_events') is not null and to_regclass('marketing.form_design_templates') is not null as ok`;
    if (check?.ok) return;
    await withDatabaseAdvisoryLock('mzj:marketing-lead-forms:20261025', async () => {
      const [again] = await sql<{ ok: boolean }[]>`select to_regclass('marketing.form_step_events') is not null and to_regclass('marketing.form_design_templates') is not null as ok`;
      if (again?.ok) return;
      await runSqlScript(FORM_SCHEMA_SQL);
    });
  })().catch(error => { ready = null; throw error; });
  return ready;
}
