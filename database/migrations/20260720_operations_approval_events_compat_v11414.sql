begin;

create schema if not exists operations;

create table if not exists operations.approval_events (
  id bigserial primary key,
  approval_id uuid references operations.vehicle_approvals(id),
  vehicle_id uuid not null references operations.vehicles(id),
  cycle_no integer not null default 1,
  approval_type text not null,
  action text not null,
  note text,
  actor_id uuid references core.users(id),
  actor_name text,
  actor_role text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

alter table operations.approval_events add column if not exists approval_id uuid references operations.vehicle_approvals(id);
alter table operations.approval_events add column if not exists vehicle_id uuid references operations.vehicles(id);
alter table operations.approval_events add column if not exists cycle_no integer;
alter table operations.approval_events add column if not exists approval_type text;
alter table operations.approval_events add column if not exists action text;
alter table operations.approval_events add column if not exists note text;
alter table operations.approval_events add column if not exists actor_id uuid references core.users(id);
alter table operations.approval_events add column if not exists actor_name text;
alter table operations.approval_events add column if not exists actor_role text;
alter table operations.approval_events add column if not exists before_data jsonb;
alter table operations.approval_events add column if not exists after_data jsonb;
alter table operations.approval_events add column if not exists created_at timestamptz default now();

update operations.approval_events e
set cycle_no=coalesce(a.cycle_no,1)
from operations.vehicle_approvals a
where e.approval_id=a.id and (e.cycle_no is null or e.cycle_no<1);

update operations.approval_events
set cycle_no=1
where cycle_no is null or cycle_no<1;

alter table operations.approval_events alter column cycle_no set default 1;
alter table operations.approval_events alter column cycle_no set not null;

update operations.approval_events
set created_at=now()
where created_at is null;

alter table operations.approval_events alter column created_at set default now();

create index if not exists operations_approval_events_vehicle_idx
on operations.approval_events(vehicle_id,created_at desc);

commit;
