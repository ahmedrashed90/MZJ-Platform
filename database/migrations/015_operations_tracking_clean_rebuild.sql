-- MZJ Platform v1.15.0
-- Clean Native Operations rebuild from v1.13.2 Tracking FULL baseline.
-- Non-destructive, idempotent migration. Test on staging and back up production before execution.

create schema if not exists operations;

create table if not exists operations.system_migrations (
  migration_key text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists operations.vehicle_statuses (
  code text primary key,
  name text not null,
  requires_note boolean not null default false,
  counts_in_actual_inventory boolean not null default true,
  is_terminal boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table operations.vehicle_statuses add column if not exists requires_note boolean not null default false;
alter table operations.vehicle_statuses add column if not exists counts_in_actual_inventory boolean not null default true;
alter table operations.vehicle_statuses add column if not exists is_terminal boolean not null default false;
alter table operations.vehicle_statuses add column if not exists sort_order integer not null default 0;
alter table operations.vehicle_statuses add column if not exists is_active boolean not null default true;
alter table operations.vehicle_statuses add column if not exists created_at timestamptz not null default now();
alter table operations.vehicle_statuses add column if not exists updated_at timestamptz not null default now();

insert into operations.vehicle_statuses(code,name,requires_note,counts_in_actual_inventory,is_terminal,sort_order) values
('available_for_sale','متاح للبيع',false,true,false,10),
('reserved','حجز',false,true,false,20),
('has_notes','بها ملاحظات',true,true,false,30),
('under_delivery','مباع تحت التسليم',false,false,false,40),
('delivered','مباع تم التسليم',false,false,true,50)
on conflict (code) do update set
  name=excluded.name,
  requires_note=excluded.requires_note,
  counts_in_actual_inventory=excluded.counts_in_actual_inventory,
  is_terminal=excluded.is_terminal,
  sort_order=excluded.sort_order,
  updated_at=now();

update operations.vehicles set status_code='available_for_sale' where status_code in ('متاح للبيع','available','available_sale');
update operations.vehicles set status_code='reserved' where status_code in ('حجز','محجوز','reservation');
update operations.vehicles set status_code='has_notes' where status_code in ('بها ملاحظات','ملاحظات','has_note');
update operations.vehicles set status_code='under_delivery' where status_code in ('مباع تحت التسليم','sold_under_delivery');
update operations.vehicles set status_code='delivered' where status_code in ('مباع تم التسليم','sold_delivered');

alter table operations.locations add column if not exists updated_at timestamptz not null default now();

create table if not exists operations.location_branches (
  location_id uuid not null references operations.locations(id) on delete cascade,
  branch_id uuid not null references core.branches(id) on delete cascade,
  primary key(location_id,branch_id)
);
insert into operations.location_branches(location_id,branch_id)
select l.id,b.id from operations.locations l join core.branches b on b.code=l.code
on conflict do nothing;

alter table operations.vehicles add column if not exists branch_id uuid references core.branches(id);
alter table operations.vehicles add column if not exists status_note text;
alter table operations.vehicles add column if not exists shortage_location_note text;
alter table operations.vehicles add column if not exists created_by uuid references core.users(id);
alter table operations.vehicles add column if not exists updated_by uuid references core.users(id);
alter table operations.vehicles add column if not exists deleted_at timestamptz;
alter table operations.vehicles add column if not exists deleted_by uuid references core.users(id);
alter table operations.vehicles add column if not exists delete_reason text;
alter table operations.vehicles add column if not exists archived_at timestamptz;
alter table operations.vehicles add column if not exists archived_by uuid references core.users(id);
alter table operations.vehicles add column if not exists archive_reason text;
alter table operations.vehicles add column if not exists legacy_id text;
update operations.vehicles v set branch_id=b.id
from operations.locations l join core.branches b on b.code=l.code
where v.branch_id is null and v.location_id=l.id;
create index if not exists operations_vehicles_vin_search_idx on operations.vehicles(vin);
create index if not exists operations_vehicles_name_search_idx on operations.vehicles((lower(coalesce(car_name,''))));
create index if not exists operations_vehicles_branch_idx on operations.vehicles(branch_id) where is_deleted=false;
create index if not exists operations_vehicles_archive_idx on operations.vehicles(archived_at) where is_deleted=false;

alter table operations.vehicle_approvals add column if not exists cycle_no integer not null default 1;
alter table operations.vehicle_approvals add column if not exists is_current boolean not null default true;
alter table operations.vehicle_approvals add column if not exists financial_note text;
alter table operations.vehicle_approvals add column if not exists administrative_note text;
alter table operations.vehicle_approvals add column if not exists financial_approved_at timestamptz;
alter table operations.vehicle_approvals add column if not exists administrative_approved_at timestamptz;
alter table operations.vehicle_approvals add column if not exists financial_reverted_by uuid references core.users(id);
alter table operations.vehicle_approvals add column if not exists administrative_reverted_by uuid references core.users(id);
alter table operations.vehicle_approvals add column if not exists financial_reverted_at timestamptz;
alter table operations.vehicle_approvals add column if not exists administrative_reverted_at timestamptz;
alter table operations.vehicle_approvals add column if not exists created_at timestamptz not null default now();
with ranked as (
  select id,row_number() over(partition by vehicle_id order by updated_at desc nulls last,created_at desc,id desc) as rn
  from operations.vehicle_approvals where is_current=true
)
update operations.vehicle_approvals a set is_current=false from ranked r where a.id=r.id and r.rn>1;
create unique index if not exists operations_vehicle_approvals_current_idx on operations.vehicle_approvals(vehicle_id) where is_current=true;

create table if not exists operations.vehicle_approval_cycles (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id) on delete restrict,
  cycle_no integer not null default 1,
  is_active boolean not null default true,
  financial_approved boolean not null default false,
  administrative_approved boolean not null default false,
  financial_note text,
  administrative_note text,
  financial_approved_by uuid references core.users(id),
  financial_approved_by_name text,
  financial_approved_at timestamptz,
  administrative_approved_by uuid references core.users(id),
  administrative_approved_by_name text,
  administrative_approved_at timestamptz,
  started_by uuid references core.users(id),
  started_by_name text,
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(vehicle_id,cycle_no)
);
insert into operations.vehicle_approvals(
  vehicle_id,cycle_no,is_current,financial_approved,administrative_approved,financial_note,administrative_note,
  financial_approved_by,administrative_approved_by,financial_approved_at,administrative_approved_at,created_at,updated_at
)
select c.vehicle_id,c.cycle_no,true,c.financial_approved,c.administrative_approved,c.financial_note,c.administrative_note,
  c.financial_approved_by,c.administrative_approved_by,c.financial_approved_at,c.administrative_approved_at,c.started_at,c.updated_at
from operations.vehicle_approval_cycles c
where c.is_active=true and not exists(
  select 1 from operations.vehicle_approvals a where a.vehicle_id=c.vehicle_id and a.is_current=true
)
on conflict do nothing;

create table if not exists operations.approval_events (
  id bigserial primary key,
  approval_id uuid not null references operations.vehicle_approvals(id) on delete restrict,
  vehicle_id uuid not null references operations.vehicles(id) on delete restrict,
  approval_type text not null check (approval_type in ('financial','administrative','all')),
  action text not null check (action in ('approved','reverted','note_updated','reset')),
  note text,
  actor_id uuid references core.users(id),
  actor_name text,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists operations_approval_events_vehicle_idx on operations.approval_events(vehicle_id,created_at desc);

create table if not exists operations.vehicle_status_notes (
  id bigserial primary key,
  vehicle_id uuid not null references operations.vehicles(id) on delete restrict,
  status_code text not null,
  note text not null,
  movement_id uuid,
  created_by uuid references core.users(id),
  created_by_name text,
  created_at timestamptz not null default now()
);

create table if not exists operations.vehicle_check_items (
  vehicle_id uuid not null references operations.vehicles(id) on delete restrict,
  item_code text not null,
  item_name text not null,
  status text not null default 'not_checked',
  note text,
  updated_by uuid references core.users(id),
  updated_by_name text,
  updated_at timestamptz not null default now(),
  primary key(vehicle_id,item_code)
);

create table if not exists operations.vehicle_check_history (
  id bigserial primary key,
  vehicle_id uuid not null references operations.vehicles(id) on delete restrict,
  item_code text not null,
  item_name text not null,
  old_status text,
  new_status text,
  note text,
  movement_id uuid,
  actor_id uuid references core.users(id),
  actor_name text,
  created_at timestamptz not null default now()
);
alter table operations.vehicle_check_history add column if not exists note text;
alter table operations.vehicle_check_history add column if not exists actor_id uuid references core.users(id);
alter table operations.vehicle_check_history add column if not exists actor_name text;
alter table operations.vehicle_check_history add column if not exists created_at timestamptz not null default now();
-- Compatibility with the unapproved operations attempts that used different history column names.
alter table operations.vehicle_check_history add column if not exists old_note text;
alter table operations.vehicle_check_history add column if not exists new_note text;
alter table operations.vehicle_check_history add column if not exists request_id uuid;
alter table operations.vehicle_check_history add column if not exists changed_by uuid references core.users(id);
alter table operations.vehicle_check_history add column if not exists changed_by_name text;
alter table operations.vehicle_check_history add column if not exists changed_at timestamptz not null default now();
update operations.vehicle_check_history set
  note=coalesce(note,new_note),
  actor_id=coalesce(actor_id,changed_by),
  actor_name=coalesce(actor_name,changed_by_name),
  created_at=coalesce(changed_at,created_at);

create table if not exists operations.movement_batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text not null unique,
  vehicle_count integer not null default 0,
  destination_location_id uuid references operations.locations(id),
  new_status text,
  to_location_id uuid references operations.locations(id),
  to_status_code text,
  general_note text,
  performed_by uuid references core.users(id),
  performed_by_name text,
  created_at timestamptz not null default now()
);
alter table operations.movement_batches add column if not exists vehicle_count integer not null default 0;
alter table operations.movement_batches add column if not exists destination_location_id uuid references operations.locations(id);
alter table operations.movement_batches add column if not exists new_status text;
alter table operations.movement_batches add column if not exists to_location_id uuid references operations.locations(id);
alter table operations.movement_batches add column if not exists to_status_code text;
alter table operations.movement_batches add column if not exists general_note text;
alter table operations.movement_batches add column if not exists performed_by uuid references core.users(id);
alter table operations.movement_batches add column if not exists performed_by_name text;
alter table operations.movement_batches add column if not exists created_at timestamptz not null default now();

alter table operations.movements add column if not exists batch_id uuid references operations.movement_batches(id) on delete restrict;
alter table operations.movements add column if not exists request_id text;
alter table operations.movements add column if not exists transfer_request_id uuid;
alter table operations.movements add column if not exists performed_by_name text;
alter table operations.movements add column if not exists before_data jsonb not null default '{}'::jsonb;
alter table operations.movements add column if not exists after_data jsonb not null default '{}'::jsonb;
alter table operations.movements add column if not exists status_note text;
alter table operations.movements add column if not exists shortage_location_note text;
alter table operations.movements add column if not exists idempotency_key text;
create unique index if not exists operations_movements_idempotency_idx on operations.movements(idempotency_key) where idempotency_key is not null;
create index if not exists operations_movements_created_idx on operations.movements(created_at desc);

alter table operations.transfer_requests add column if not exists request_type text not null default 'transfer';
alter table operations.transfer_requests add column if not exists current_stage text not null default 'request_received';
alter table operations.transfer_requests add column if not exists notes text;
alter table operations.transfer_requests add column if not exists requested_by_name text;
alter table operations.transfer_requests add column if not exists source_branch_id uuid references core.branches(id);
alter table operations.transfer_requests add column if not exists destination_branch_id uuid references core.branches(id);
alter table operations.transfer_requests add column if not exists cancelled_at timestamptz;
alter table operations.transfer_requests add column if not exists cancelled_by uuid references core.users(id);
alter table operations.transfer_requests add column if not exists cancel_reason text;
alter table operations.transfer_requests add column if not exists deleted_at timestamptz;
alter table operations.transfer_requests add column if not exists deleted_by uuid references core.users(id);
alter table operations.transfer_requests add column if not exists delete_reason text;
alter table operations.transfer_requests add column if not exists idempotency_key text;
-- Preserve data written by earlier, unapproved schemas that used singular/alternate names.
alter table operations.transfer_requests add column if not exists note text;
alter table operations.transfer_requests add column if not exists cancellation_reason text;
alter table operations.transfer_requests add column if not exists deletion_reason text;
update operations.transfer_requests set
  notes=coalesce(notes,note),
  cancel_reason=coalesce(cancel_reason,cancellation_reason),
  delete_reason=coalesce(delete_reason,deletion_reason);
update operations.transfer_requests
set request_type=case when lower(coalesce(transfer_type,'')) in ('photo','photography','تصوير') then 'photo' else 'transfer' end
where request_type is null or (request_type='transfer' and lower(coalesce(transfer_type,'')) in ('photo','photography','تصوير'));
update operations.transfer_requests
set current_stage=case
  when lower(coalesce(status,'')) in ('completed','done','تم الانتهاء') then 'completed'
  when lower(coalesce(status,'')) in ('vehicle_received','received','تم استلام السيارة') then 'vehicle_received'
  when lower(coalesce(status,'')) in ('vehicle_sent','sent','تم إرسال السيارة') then 'vehicle_sent'
  when lower(coalesce(status,'')) in ('cancelled','canceled','ملغي') then 'cancelled'
  else 'request_received'
end
where current_stage is null or current_stage='request_received';
create unique index if not exists operations_transfer_requests_idempotency_idx on operations.transfer_requests(idempotency_key) where idempotency_key is not null;
create index if not exists operations_transfer_requests_stage_idx on operations.transfer_requests(request_type,current_stage,requested_at desc) where deleted_at is null;

alter table operations.transfer_request_vehicles add column if not exists source_location_id uuid references operations.locations(id);
alter table operations.transfer_request_vehicles add column if not exists source_status_code text;
alter table operations.transfer_request_vehicles add column if not exists source_status text;
alter table operations.transfer_request_vehicles add column if not exists vehicle_snapshot jsonb not null default '{}'::jsonb;
update operations.transfer_request_vehicles set source_status_code=coalesce(source_status_code,source_status);

create table if not exists operations.transfer_request_events (
  id bigserial primary key,
  transfer_request_id uuid not null references operations.transfer_requests(id) on delete restrict,
  stage text not null,
  stage_code text,
  action text not null,
  note text,
  actor_id uuid references core.users(id),
  actor_name text,
  actor_branch_codes text[] not null default '{}',
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table operations.transfer_request_events add column if not exists stage text;
alter table operations.transfer_request_events add column if not exists stage_code text;
alter table operations.transfer_request_events add column if not exists actor_branch_codes text[] not null default '{}';
alter table operations.transfer_request_events add column if not exists before_data jsonb not null default '{}'::jsonb;
alter table operations.transfer_request_events add column if not exists after_data jsonb not null default '{}'::jsonb;
alter table operations.transfer_request_events add column if not exists created_at timestamptz not null default now();
update operations.transfer_request_events set stage=coalesce(stage,stage_code,'request_received'),stage_code=coalesce(stage_code,stage,'request_received');
create index if not exists operations_transfer_events_request_idx on operations.transfer_request_events(transfer_request_id,created_at);

create table if not exists operations.vehicle_archives (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id) on delete restrict,
  reason text not null,
  snapshot jsonb not null default '{}'::jsonb,
  archived_by uuid references core.users(id),
  archived_by_name text,
  archived_at timestamptz not null default now(),
  restored_by uuid references core.users(id),
  restored_by_name text,
  restored_at timestamptz,
  restore_reason text
);
alter table operations.vehicle_archives add column if not exists restored_by uuid references core.users(id);
alter table operations.vehicle_archives add column if not exists restored_by_name text;
alter table operations.vehicle_archives add column if not exists restored_at timestamptz;
alter table operations.vehicle_archives add column if not exists restore_reason text;
create index if not exists operations_vehicle_archives_vehicle_idx on operations.vehicle_archives(vehicle_id,archived_at desc);

create table if not exists operations.vehicle_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  vehicle_internal_id uuid not null,
  vin text not null,
  vehicle_snapshot jsonb not null,
  reason text not null,
  deleted_by uuid,
  deleted_by_name text,
  deleted_by_email text,
  deleted_by_roles text[] not null default '{}',
  request_id text not null,
  deleted_at timestamptz not null default now()
);
create index if not exists operations_vehicle_deletion_vin_idx on operations.vehicle_deletion_audit(vin,deleted_at desc);

create table if not exists operations.import_batches (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('replace','append','update')),
  file_name text,
  total_rows integer not null default 0,
  inserted_rows integer not null default 0,
  updated_rows integer not null default 0,
  skipped_rows integer not null default 0,
  failed_rows integer not null default 0,
  status text not null default 'processing',
  created_by uuid references core.users(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table operations.import_batches add column if not exists completed_at timestamptz;

create table if not exists operations.import_rows (
  id bigserial primary key,
  batch_id uuid not null references operations.import_batches(id) on delete cascade,
  row_no integer not null,
  vin text,
  payload jsonb not null default '{}'::jsonb,
  result text not null,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists operations.event_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  entity_type text,
  entity_id text,
  aggregate_type text,
  aggregate_id text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table operations.event_outbox add column if not exists entity_type text;
alter table operations.event_outbox add column if not exists entity_id text;
alter table operations.event_outbox add column if not exists aggregate_type text;
alter table operations.event_outbox add column if not exists aggregate_id text;
create index if not exists operations_event_outbox_status_idx on operations.event_outbox(status,created_at);

alter table operations.vehicle_approvals drop constraint if exists vehicle_approvals_vehicle_id_fkey;
alter table operations.vehicle_approvals add constraint vehicle_approvals_vehicle_id_fkey foreign key(vehicle_id) references operations.vehicles(id) on delete restrict;
alter table operations.vehicle_shortages drop constraint if exists vehicle_shortages_vehicle_id_fkey;
alter table operations.vehicle_shortages add constraint vehicle_shortages_vehicle_id_fkey foreign key(vehicle_id) references operations.vehicles(id) on delete restrict;
alter table operations.transfer_request_vehicles drop constraint if exists transfer_request_vehicles_vehicle_id_fkey;
alter table operations.transfer_request_vehicles add constraint transfer_request_vehicles_vehicle_id_fkey foreign key(vehicle_id) references operations.vehicles(id) on delete restrict;
alter table operations.movements drop constraint if exists movements_vehicle_id_fkey;
alter table operations.movements add constraint movements_vehicle_id_fkey foreign key(vehicle_id) references operations.vehicles(id) on delete restrict;

insert into core.permissions(code,name,system_code) values
('operations.view','عرض نظام العمليات','operations'),
('operations.vehicle.manage','إضافة وتعديل السيارات','operations'),
('operations.vehicle.delete','مسح السيارة','operations'),
('operations.movement.create','تنفيذ حركة السيارات','operations'),
('operations.transfer.view','عرض طلبات النقل','operations'),
('operations.transfer.create','إنشاء طلبات النقل','operations'),
('operations.transfer.progress','تنفيذ مراحل طلبات النقل','operations'),
('operations.transfer.delete','حذف طلب نقل قبل بدء التنفيذ','operations'),
('operations.transfer.cancel','إلغاء طلب نقل','operations'),
('operations.approvals.view','عرض الموافقات','operations'),
('operations.approvals.financial','الموافقة المالية','operations'),
('operations.approvals.administrative','الموافقة الإدارية','operations'),
('operations.approvals.reset','مسح الموافقات','operations'),
('operations.archive.manage','إدارة أرشيف العمليات','operations'),
('operations.import','استيراد مخزون السيارات','operations'),
('operations.export','تصدير بيانات العمليات','operations'),
('tracking.orders.delete','حذف طلبات التراكينج','tracking')
on conflict (code) do update set name=excluded.name,system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code in ('admin','system_admin') and p.system_code in ('operations','tracking')
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in (
  'operations.view','operations.movement.create','operations.transfer.view','operations.transfer.create','operations.transfer.progress','operations.export'
)
where r.code='operations_user'
on conflict do nothing;

insert into operations.system_migrations(migration_key)
values ('operations_clean_rebuild_v1_15_0')
on conflict (migration_key) do nothing;

create schema if not exists tracking;

alter table tracking.orders add column if not exists customer_vat text;
alter table tracking.orders add column if not exists branch text;
alter table tracking.orders add column if not exists delivery_date date;
alter table tracking.orders add column if not exists sales_person text;
alter table tracking.orders add column if not exists subtotal_before_tax numeric(14,2) not null default 0;
alter table tracking.orders add column if not exists tax_value numeric(14,2) not null default 0;
alter table tracking.orders add column if not exists total_incl_vat numeric(14,2) not null default 0;
alter table tracking.orders add column if not exists registration_fee numeric(14,2) not null default 0;
alter table tracking.orders add column if not exists source text;
alter table tracking.orders add column if not exists source_payload jsonb not null default '{}'::jsonb;
alter table tracking.orders add column if not exists source_identity text;
alter table tracking.orders add column if not exists source_fingerprint text;
alter table tracking.orders add column if not exists source_sheet_id text;
alter table tracking.orders add column if not exists source_row_number text;
alter table tracking.orders add column if not exists source_message_id text;
alter table tracking.orders add column if not exists source_original_id text;
alter table tracking.orders add column if not exists source_updated_at timestamptz;
update tracking.orders set source_identity=coalesce(source_identity,'legacy:'||id::text),source_fingerprint=coalesce(source_fingerprint,'legacy:'||id::text) where source_identity is null or source_fingerprint is null;
with duplicated as (
  select id,source_fingerprint,row_number() over(partition by source_fingerprint order by created_at,id) as rn
  from tracking.orders where source_fingerprint is not null
)
update tracking.orders o set source_fingerprint=o.source_fingerprint||':'||o.id::text
from duplicated d where o.id=d.id and d.rn>1;
alter table tracking.orders drop constraint if exists orders_sales_order_no_key;
create index if not exists tracking_orders_sales_order_no_idx on tracking.orders(sales_order_no,updated_at desc);
create unique index if not exists tracking_orders_source_fingerprint_uidx on tracking.orders(source_fingerprint);
alter table tracking.orders add column if not exists is_deleted boolean not null default false;
alter table tracking.orders add column if not exists deleted_at timestamptz;
alter table tracking.orders add column if not exists deleted_by uuid references core.users(id);
alter table tracking.orders add column if not exists deleted_reason text;
alter table tracking.orders add column if not exists archived_at timestamptz;
alter table tracking.orders add column if not exists archived_by uuid references core.users(id);
alter table tracking.orders add column if not exists archived_by_name text;
alter table tracking.orders add column if not exists archive_reason text;

alter table tracking.order_vehicles add column if not exists operations_vehicle_id uuid references operations.vehicles(id) on delete set null;
alter table tracking.order_vehicles add column if not exists item_no text;
alter table tracking.order_vehicles add column if not exists item_type text;
alter table tracking.order_vehicles add column if not exists item_category text;
alter table tracking.order_vehicles add column if not exists item_model text;
alter table tracking.order_vehicles add column if not exists interior_color text;
alter table tracking.order_vehicles add column if not exists exterior_color text;
alter table tracking.order_vehicles add column if not exists dealer text;
alter table tracking.order_vehicles add column if not exists qty numeric(12,2) not null default 1;
alter table tracking.order_vehicles add column if not exists unit_price numeric(14,2) not null default 0;
alter table tracking.order_vehicles add column if not exists item_value numeric(14,2) not null default 0;
alter table tracking.order_vehicles add column if not exists subtotal_excl_vat numeric(14,2) not null default 0;
alter table tracking.order_vehicles add column if not exists tax_value numeric(14,2) not null default 0;
alter table tracking.order_vehicles add column if not exists total_incl_vat numeric(14,2) not null default 0;
alter table tracking.order_vehicles add column if not exists registration_fee numeric(14,2) not null default 0;
alter table tracking.order_vehicles add column if not exists raw_payload jsonb not null default '{}'::jsonb;
alter table tracking.order_vehicles add column if not exists created_at timestamptz not null default now();
alter table tracking.order_vehicles add column if not exists updated_at timestamptz not null default now();
create index if not exists tracking_order_vehicles_item_idx on tracking.order_vehicles(order_id, item_no);
create index if not exists tracking_order_vehicles_vin_idx on tracking.order_vehicles(vin);
create index if not exists tracking_order_vehicles_operations_vehicle_idx on tracking.order_vehicles(operations_vehicle_id);

alter table tracking.stages add column if not exists description text;
alter table tracking.stages add column if not exists updated_at timestamptz not null default now();

create table if not exists tracking.vehicle_stages (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references tracking.order_vehicles(id) on delete cascade,
  stage_id uuid not null references tracking.stages(id),
  status text not null default 'pending' check (status in ('pending','completed')),
  completed_by uuid references core.users(id),
  completed_at timestamptz,
  reverted_by uuid references core.users(id),
  reverted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(vehicle_id, stage_id)
);
create index if not exists tracking_vehicle_stages_vehicle_idx on tracking.vehicle_stages(vehicle_id);

create table if not exists tracking.stage_events (
  id bigserial primary key,
  order_id uuid not null references tracking.orders(id) on delete cascade,
  vehicle_id uuid not null references tracking.order_vehicles(id) on delete cascade,
  stage_id uuid not null references tracking.stages(id),
  action text not null check (action in ('completed','reverted')),
  actor_id uuid references core.users(id),
  actor_name text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists tracking_stage_events_order_idx on tracking.stage_events(order_id, created_at desc);

create table if not exists tracking.deleted_orders (
  id uuid primary key default gen_random_uuid(),
  sales_order_no text not null,
  customer_name text,
  customer_mobile text,
  reason text not null,
  snapshot jsonb not null default '{}'::jsonb,
  deleted_by uuid references core.users(id),
  deleted_by_name text,
  deleted_at timestamptz not null default now()
);
alter table tracking.deleted_orders add column if not exists internal_order_id uuid;
alter table tracking.deleted_orders add column if not exists source text;
alter table tracking.deleted_orders add column if not exists source_identity text;
alter table tracking.deleted_orders add column if not exists source_fingerprint text;
alter table tracking.deleted_orders add column if not exists source_sheet_id text;
alter table tracking.deleted_orders add column if not exists source_row_number text;
alter table tracking.deleted_orders add column if not exists source_message_id text;
alter table tracking.deleted_orders add column if not exists source_original_id text;
alter table tracking.deleted_orders add column if not exists request_id text;
create index if not exists tracking_deleted_orders_no_idx on tracking.deleted_orders(sales_order_no, deleted_at desc);

create table if not exists tracking.deleted_source_identities (
  source_fingerprint text primary key,
  source_identity text,
  internal_order_id uuid not null,
  sales_order_no text not null,
  deleted_order_id uuid references tracking.deleted_orders(id) on delete cascade,
  deleted_at timestamptz not null default now()
);

create table if not exists tracking.deleted_order_blocks (
  sales_order_no text primary key,
  is_blocked boolean not null default true,
  reason text,
  deleted_by uuid references core.users(id),
  deleted_at timestamptz not null default now(),
  released_by uuid references core.users(id),
  released_at timestamptz
);

create table if not exists tracking.sms_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references tracking.orders(id) on delete set null,
  vehicle_id uuid references tracking.order_vehicles(id) on delete set null,
  stage_id uuid references tracking.stages(id) on delete set null,
  phone text not null,
  message text not null,
  firestore_document_id text,
  status text not null default 'pending',
  queued_by uuid references core.users(id),
  queued_by_name text,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  error_message text
);
create index if not exists tracking_sms_messages_order_idx on tracking.sms_messages(order_id, queued_at desc);

create table if not exists tracking.system_migrations (
  migration_key text primary key,
  applied_at timestamptz not null default now()
);

with applied as (
  insert into tracking.system_migrations(migration_key)
  values ('archive_initial_tracking_history_except_active_7_v1')
  on conflict (migration_key) do nothing
  returning migration_key
)
update tracking.orders
set is_archived=true,
    archived_at=coalesce(archived_at, now()),
    archived_by_name=coalesce(archived_by_name, 'ترحيل النظام القديم'),
    archive_reason=coalesce(archive_reason, 'طلبات مكتملة قبل تشغيل نظام التتبع داخل المنصة'),
    updated_at=now()
where exists (select 1 from applied)
  and coalesce(is_deleted,false)=false
  and sales_order_no <= 'SAL-ORD-2026-00759'
  and sales_order_no not in (
    'SAL-ORD-2026-00711',
    'SAL-ORD-2026-00758',
    'SAL-ORD-2026-00757',
    'SAL-ORD-2026-00753',
    'SAL-ORD-2026-00754',
    'SAL-ORD-2026-00751',
    'SAL-ORD-2026-00748'
  );

insert into tracking.stages(code,name,description,owner_type,sort_order,sms_enabled,is_active) values
('stage_1','طلب الشراء (خاص بالعميل)','تم تسجيل طلب الشراء في النظام بنجاح.','customer',1,true,true),
('stage_2','إيصال الدفع (خاص بالعميل)','يتم استلام مبلغ الدفعة أو ترتيب خيار الدفع المناسب.','customer',2,false,true),
('stage_3','التواصل من قِبل ممثلي خدمة العملاء بإرسال البطاقة الجمركية (خاص بالمعرض)','خدمة العملاء تتواصل مع العميل لاستكمال البيانات وإرسال البطاقة الجمركية.','showroom',3,false,true),
('stage_4','سداد رسوم التسجيل (خاص بالعميل)','يتم سداد رسوم التسجيل الرسمية الخاصة بالمركبة.','customer',4,false,true),
('stage_5','التأمين – شرط الربط على السيستم (خاص بالعميل)','إصدار وثيقة التأمين وربطها بنظام المرور.','customer',5,false,true),
('stage_6','استيفاء المبالغ المتبقية (خاص بالعميل)','استكمال جميع المبالغ المطلوبة لإتمام الطلب.','customer',6,false,true),
('stage_7','استيفاء الأوراق المتبقية (خاص بالعميل)','استكمال جميع المستندات والأوراق المطلوبة.','customer',7,false,true),
('stage_8','إصدار اللوحات أو نقل الملكية (خاص بالمعرض)','إصدار اللوحات الجديدة أو إتمام إجراء نقل الملكية.','showroom',8,false,true),
('stage_9','جاهزية السيارة للاستلام (خاص بالمعرض)','السيارة جاهزة للاستلام من المعرض أو لطلب الشحن للمدينة المطلوبة.','showroom',9,true,true),
('stage_10','إتمام عملية التسليم بنجاح','تم تسليم السيارة وإغلاق الطلب بنجاح.','showroom',10,true,true)
on conflict (code) do nothing;

insert into tracking.system_migrations(migration_key)
values ('tracking_source_identity_delete_v1_15_0')
on conflict (migration_key) do nothing;
