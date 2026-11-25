-- Durable outbox for Cloudflare Worker NEXT ERP -> MZJ Operations.
-- Run once: wrangler d1 execute mzj-operations-stock --file=stock-sync-d1.sql --remote
create table if not exists mzj_operations_stock_jobs (
  receipt text not null primary key,
  event text not null default 'on_submit',
  state text not null default 'pending' check(state in ('pending','delivered')),
  attempts integer not null default 0,
  next_attempt_at integer not null,
  locked_until integer not null default 0,
  last_error text,
  created_at integer not null,
  updated_at integer not null,
  delivered_at integer
);
create index if not exists mzj_ops_stock_jobs_due
  on mzj_operations_stock_jobs(state,next_attempt_at,locked_until);
