-- Exact reconciliation between original schedule targets and Publish Prep targets.

alter table marketing.publish_targets
  add column if not exists schedule_target_id uuid references marketing.publish_schedule_targets(id) on delete set null;

create unique index if not exists marketing_publish_target_schedule_unique
  on marketing.publish_targets(publish_prep_item_id, schedule_target_id)
  where schedule_target_id is not null;

create index if not exists marketing_publish_target_schedule_lookup_idx
  on marketing.publish_targets(schedule_target_id, status);
