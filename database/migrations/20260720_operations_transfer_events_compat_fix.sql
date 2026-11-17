-- Fix for production databases where operations.transfer_request_events existed
-- before the Native V2 schema and did not contain transfer_request_id.

alter table operations.transfer_request_events
  add column if not exists transfer_request_id uuid references operations.transfer_requests(id);
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

update operations.transfer_request_events e
set transfer_request_id = coalesce(to_jsonb(e)->>'request_id',to_jsonb(e)->>'transfer_id')::uuid
where e.transfer_request_id is null
  and coalesce(to_jsonb(e)->>'request_id',to_jsonb(e)->>'transfer_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1 from operations.transfer_requests r
    where r.id = coalesce(to_jsonb(e)->>'request_id',to_jsonb(e)->>'transfer_id')::uuid
  );

create index if not exists operations_transfer_events_idx
  on operations.transfer_request_events(transfer_request_id,created_at);
