-- Non-destructive rollback companion for central access control.
-- Application rollback: redeploy the previous source version.
-- Data rollback is intentionally not destructive: central tables and migrated access data remain available for a later redeploy.
-- Do not DROP these tables in production because they contain permission history and may be referenced by user records.

begin;
-- Invalidate active sessions so the previous application reloads identity safely after redeploy.
delete from core.sessions;
commit;
