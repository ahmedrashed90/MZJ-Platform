alter table core.attendance_settings
  add column if not exists official_day_end time not null default '21:00';

update core.attendance_settings
set official_day_end=coalesce(official_day_end,'21:00'::time)
where id=1;
