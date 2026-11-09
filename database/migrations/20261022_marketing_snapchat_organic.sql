-- Run once in the same database as the Marketing workflow (safe if table is absent).
-- Allows the existing follower history store to support both organic networks.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '12s';
create schema if not exists marketing;
create table if not exists marketing.social_follower_snapshots (
  platform text not null,
  channel_id bigint not null,
  account_name text not null default '',
  snapshot_date date not null,
  followers bigint not null check(followers >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(platform,channel_id,snapshot_date)
);
alter table marketing.social_follower_snapshots drop constraint if exists social_follower_snapshots_platform_check;
alter table marketing.social_follower_snapshots
  add constraint social_follower_snapshots_platform_check check (platform in ('tiktok','snapchat'));
create index if not exists social_follower_snapshots_date
  on marketing.social_follower_snapshots(snapshot_date desc,channel_id);
commit;
