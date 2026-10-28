-- Keep final rejections as terminal requirements of the original task.
-- Must be applied AFTER 20261028_marketing_three_revisions_two_raters.sql (schema-8).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '12s';
alter table marketing.work_items drop constraint if exists work_items_status_check;
alter table marketing.work_items add constraint work_items_status_check
  check(status in ('in_progress','submitted','revision','editing','approved','rejected'));
insert into marketing.workflow_migrations(code) values('schema-9') on conflict do nothing;
commit;
