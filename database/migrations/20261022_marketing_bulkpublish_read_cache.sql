-- Shared, rate-limited, read-only BulkPublish organic cache for TikTok/Snapchat.
-- Run once against the active Marketing database. No follower history is removed.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '12s';
create schema if not exists marketing;
create table if not exists marketing.social_bulkpublish_read_cache (
  cache_key text primary key,
  payload jsonb,
  fetched_at timestamptz,
  blocked_until timestamptz not null default 'epoch'::timestamptz,
  last_status smallint,
  created_at timestamptz not null default now()
);
create index if not exists social_bulkpublish_read_cache_blocked_until
  on marketing.social_bulkpublish_read_cache(blocked_until);
comment on table marketing.social_bulkpublish_read_cache is
  'Private read-only connector cache; SHA256 credential/path keys, never raw API tokens.';
commit;
