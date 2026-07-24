-- Rollback central access control schema. Operational data and legacy role links are preserved.
drop table if exists core.permission_change_log;
drop table if exists core.user_permission_overrides;
drop table if exists core.user_system_departments;
drop table if exists core.user_system_branches;
drop table if exists core.user_systems;
drop table if exists core.system_pages;
drop table if exists core.systems;
