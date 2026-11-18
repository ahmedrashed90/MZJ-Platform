-- Local campaign-manager annotations across ALL paid advertising platforms.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '12s';
create table if not exists marketing.campaign_report_managers (
  platform text not null,
  account_id text not null,
  campaign_id text not null,
  manager_name text not null default '',
  updated_by uuid references core.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(platform,account_id,campaign_id)
);
commit;
