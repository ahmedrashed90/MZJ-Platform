begin;
set local lock_timeout = '3s';
set local statement_timeout = '12s';
create table if not exists marketing.work_item_review_notes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references marketing.work_items(id) on delete cascade,
  category_id uuid references marketing.work_review_categories(id) on delete set null,
  note text not null check(length(trim(note))>0),
  created_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  deleted_at timestamptz,
  legacy_import boolean not null default false
);
create unique index if not exists work_item_review_notes_legacy_unique
  on marketing.work_item_review_notes(item_id) where legacy_import;
create index if not exists work_item_review_notes_active
  on marketing.work_item_review_notes(item_id, created_at desc) where responded_at is null and deleted_at is null;
-- Import the original single review note exactly once without discarding it.
insert into marketing.work_item_review_notes(item_id,category_id,note,created_at,legacy_import)
select i.id,i.review_note_type_id,i.review_note,coalesce(i.review_note_created_at,i.updated_at),true
from marketing.work_items i where length(trim(i.review_note))>0
on conflict do nothing;
create table if not exists marketing.social_follower_snapshots (
  platform text not null check(platform in ('tiktok','snapchat')),
  channel_id bigint not null,
  account_name text not null default '',
  snapshot_date date not null,
  followers bigint not null check(followers >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(platform,channel_id,snapshot_date)
);
create index if not exists social_follower_snapshots_date
  on marketing.social_follower_snapshots(snapshot_date desc,channel_id);
insert into marketing.workflow_migrations(code) values ('schema-6') on conflict do nothing;
commit;
