begin;

alter table operations.vehicle_check_history add column if not exists vehicle_id uuid references operations.vehicles(id);
alter table operations.vehicle_check_history add column if not exists item_code text;
alter table operations.vehicle_check_history add column if not exists old_status text;
alter table operations.vehicle_check_history add column if not exists new_status text;
alter table operations.vehicle_check_history add column if not exists note text;
alter table operations.vehicle_check_history add column if not exists movement_id uuid;
alter table operations.vehicle_check_history add column if not exists changed_by uuid references core.users(id);
alter table operations.vehicle_check_history add column if not exists changed_by_name text;
alter table operations.vehicle_check_history add column if not exists created_at timestamptz not null default now();

alter table operations.vehicle_approvals add column if not exists pending_delivery jsonb;

commit;
