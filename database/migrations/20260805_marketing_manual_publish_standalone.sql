begin;

alter table marketing.publish_schedule
  drop constraint if exists publish_schedule_source_type_check;
alter table marketing.publish_schedule
  add constraint publish_schedule_source_type_check
  check (source_type in ('campaign','agenda','manual'));

alter table marketing.published_posts
  drop constraint if exists published_posts_source_type_check;
alter table marketing.published_posts
  add constraint published_posts_source_type_check
  check (source_type in ('campaign','agenda','manual'));

commit;
