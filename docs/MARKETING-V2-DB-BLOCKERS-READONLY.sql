-- READ ONLY. Run in Neon SQL Editor if 504/lock waits persist after deployment.
-- Do NOT blindly terminate database sessions without investigating ownership.
SELECT
  pid,
  state,
  wait_event_type,
  wait_event,
  pg_blocking_pids(pid) AS blocking_pids,
  now() - query_start AS running_for,
  left(regexp_replace(query, '[[:space:]]+', ' ', 'g'), 250) AS query_preview
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND (cardinality(pg_blocking_pids(pid)) > 0
       OR query ILIKE '%marketing%')
ORDER BY cardinality(pg_blocking_pids(pid)) DESC, query_start NULLS LAST
LIMIT 50;
