-- MZJ v1.19.2 - authentication-safe central access schema bootstrap.
-- Run the v1.19.0 central access migration before this file when deploying manually.
-- The application also applies the same idempotent central schema under an advisory lock before authentication.

create table if not exists core.access_control_schema_state (
  id smallint primary key default 1 check(id=1),
  version integer not null,
  updated_at timestamptz not null default now()
);

insert into core.access_control_schema_state(id,version,updated_at)
values(1,1192,now())
on conflict(id) do update
set version=greatest(core.access_control_schema_state.version,excluded.version),
    updated_at=now();
