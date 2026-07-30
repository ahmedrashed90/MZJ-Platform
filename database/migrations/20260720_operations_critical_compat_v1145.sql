begin;

-- Movement tables: compatibility with partially-created production schemas.
create table if not exists operations.movement_batches (
  id uuid primary key default gen_random_uuid(),
  destination_location_id uuid references operations.locations(id),
  new_status text,
  general_note text,
  requested_count integer not null default 0,
  performed_by uuid references core.users(id),
  performed_by_name text,
  performed_by_role text,
  performed_by_branch text,
  created_at timestamptz not null default now()
);
alter table operations.movement_batches add column if not exists destination_location_id uuid references operations.locations(id);
alter table operations.movement_batches add column if not exists new_status text;
alter table operations.movement_batches add column if not exists general_note text;
alter table operations.movement_batches add column if not exists requested_count integer not null default 0;
alter table operations.movement_batches add column if not exists performed_by uuid references core.users(id);
alter table operations.movement_batches add column if not exists performed_by_name text;
alter table operations.movement_batches add column if not exists performed_by_role text;
alter table operations.movement_batches add column if not exists performed_by_branch text;
alter table operations.movement_batches add column if not exists created_at timestamptz not null default now();

alter table operations.movements add column if not exists vehicle_id uuid references operations.vehicles(id);
alter table operations.movements add column if not exists from_location_id uuid references operations.locations(id);
alter table operations.movements add column if not exists to_location_id uuid references operations.locations(id);
alter table operations.movements add column if not exists old_status text;
alter table operations.movements add column if not exists new_status text;
alter table operations.movements add column if not exists note text;
alter table operations.movements add column if not exists performed_by uuid references core.users(id);
alter table operations.movements add column if not exists created_at timestamptz not null default now();
alter table operations.movements add column if not exists batch_id uuid references operations.movement_batches(id);
alter table operations.movements add column if not exists transfer_request_id uuid references operations.transfer_requests(id);
alter table operations.movements add column if not exists movement_type text not null default 'direct';
alter table operations.movements add column if not exists state_note text;
alter table operations.movements add column if not exists shortage_note text;
alter table operations.movements add column if not exists performed_by_name text;
alter table operations.movements add column if not exists performed_by_role text;
alter table operations.movements add column if not exists performed_by_branch text;
alter table operations.movements add column if not exists before_data jsonb;
alter table operations.movements add column if not exists after_data jsonb;

-- Transfer tables.
alter table operations.transfer_requests add column if not exists request_no text;
alter table operations.transfer_requests add column if not exists department_code text;
alter table operations.transfer_requests add column if not exists transfer_type text;
alter table operations.transfer_requests add column if not exists source_location_id uuid references operations.locations(id);
alter table operations.transfer_requests add column if not exists destination_location_id uuid references operations.locations(id);
alter table operations.transfer_requests add column if not exists status text not null default 'request_received';
alter table operations.transfer_requests add column if not exists requested_by uuid references core.users(id);
alter table operations.transfer_requests add column if not exists requested_at timestamptz not null default now();
alter table operations.transfer_requests add column if not exists completed_at timestamptz;
alter table operations.transfer_requests add column if not exists request_kind text not null default 'transfer';
alter table operations.transfer_requests add column if not exists source_branch_code text;
alter table operations.transfer_requests add column if not exists destination_branch_code text;
alter table operations.transfer_requests add column if not exists note text;
alter table operations.transfer_requests add column if not exists requested_by_name text;
alter table operations.transfer_requests add column if not exists requested_by_role text;
alter table operations.transfer_requests add column if not exists requested_by_branch text;
alter table operations.transfer_requests add column if not exists cancelled_at timestamptz;
alter table operations.transfer_requests add column if not exists cancelled_by uuid references core.users(id);
alter table operations.transfer_requests add column if not exists cancellation_reason text;
alter table operations.transfer_requests add column if not exists is_deleted boolean not null default false;
alter table operations.transfer_requests add column if not exists deleted_at timestamptz;
alter table operations.transfer_requests add column if not exists deleted_by uuid references core.users(id);
alter table operations.transfer_requests add column if not exists version integer not null default 1;
alter table operations.transfer_requests add column if not exists updated_at timestamptz not null default now();

alter table operations.transfer_request_vehicles add column if not exists transfer_request_id uuid references operations.transfer_requests(id) on delete cascade;
alter table operations.transfer_request_vehicles add column if not exists vehicle_id uuid references operations.vehicles(id) on delete cascade;
alter table operations.transfer_request_vehicles add column if not exists source_location_id uuid references operations.locations(id);
alter table operations.transfer_request_vehicles add column if not exists source_status text;
alter table operations.transfer_request_vehicles add column if not exists created_at timestamptz not null default now();

alter table operations.transfer_request_events add column if not exists transfer_request_id uuid references operations.transfer_requests(id);
alter table operations.transfer_request_events add column if not exists stage text;
alter table operations.transfer_request_events add column if not exists action text;
alter table operations.transfer_request_events add column if not exists note text;
alter table operations.transfer_request_events add column if not exists actor_id uuid references core.users(id);
alter table operations.transfer_request_events add column if not exists actor_name text;
alter table operations.transfer_request_events add column if not exists actor_role text;
alter table operations.transfer_request_events add column if not exists actor_branch text;
alter table operations.transfer_request_events add column if not exists before_data jsonb;
alter table operations.transfer_request_events add column if not exists after_data jsonb;
alter table operations.transfer_request_events add column if not exists is_override boolean not null default false;
alter table operations.transfer_request_events add column if not exists override_reason text;
alter table operations.transfer_request_events add column if not exists created_at timestamptz not null default now();

do $$
declare legacy_col text;
begin
  foreach legacy_col in array array['request_id','transfer_id'] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema='operations' and table_name='transfer_request_events' and column_name=legacy_col
    ) then
      execute format('alter table operations.transfer_request_events alter column %I drop not null', legacy_col);
    end if;
  end loop;
end $$;

-- Event outbox is optional and must not block movement, transfer, or tracking deletion.
create table if not exists operations.event_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  system_code text not null default 'operations',
  entity_type text,
  entity_id text,
  vehicle_id uuid,
  vin text,
  actor_id uuid,
  actor_name text,
  source_branch text,
  destination_branch text,
  title text,
  description text,
  internal_url text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table operations.event_outbox add column if not exists event_type text;
alter table operations.event_outbox add column if not exists system_code text not null default 'operations';
alter table operations.event_outbox add column if not exists entity_type text;
alter table operations.event_outbox add column if not exists entity_id text;
alter table operations.event_outbox add column if not exists vehicle_id uuid;
alter table operations.event_outbox add column if not exists vin text;
alter table operations.event_outbox add column if not exists actor_id uuid;
alter table operations.event_outbox add column if not exists actor_name text;
alter table operations.event_outbox add column if not exists source_branch text;
alter table operations.event_outbox add column if not exists destination_branch text;
alter table operations.event_outbox add column if not exists title text;
alter table operations.event_outbox add column if not exists description text;
alter table operations.event_outbox add column if not exists internal_url text;
alter table operations.event_outbox add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table operations.event_outbox add column if not exists status text not null default 'pending';
alter table operations.event_outbox add column if not exists attempts integer not null default 0;
alter table operations.event_outbox add column if not exists created_at timestamptz not null default now();
alter table operations.event_outbox add column if not exists processed_at timestamptz;
update operations.event_outbox set event_type=coalesce(nullif(event_type,''),'legacy.event') where event_type is null or event_type='';
alter table operations.event_outbox alter column event_type set not null;

commit;
