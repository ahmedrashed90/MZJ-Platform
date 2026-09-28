-- Attendance assignment-specific period times
alter table core.attendance_user_schedules
  add column if not exists period_overrides jsonb not null default '{}'::jsonb;

update core.attendance_user_schedules
set period_overrides='{}'::jsonb
where period_overrides is null;
