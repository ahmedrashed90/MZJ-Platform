import { getSql } from "./_db.js";

let operationsSchemaPromise: Promise<void> | null = null;

const OPERATIONS_SCHEMA_SQL = String.raw`create table if not exists operations.vehicle_statuses (
  code text primary key,
  name text not null,
  sort_order integer not null default 0,
  is_inventory boolean not null default true,
  requires_status_note boolean not null default false,
  requires_delivery_approvals boolean not null default false,
  is_final boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into operations.vehicle_statuses(code,name,sort_order,is_inventory,requires_status_note,requires_delivery_approvals,is_final) values
('available_for_sale','متاح للبيع',10,true,false,false,false),
('reserved','محجوز',20,true,false,false,false),
('has_notes','بها ملاحظات',30,true,true,false,false),
('under_delivery','مباع تحت التسليم',40,false,false,true,false),
('delivered','مباع تم التسليم',50,false,false,false,true)
on conflict (code) do update set name=excluded.name,sort_order=excluded.sort_order,is_inventory=excluded.is_inventory,requires_status_note=excluded.requires_status_note,requires_delivery_approvals=excluded.requires_delivery_approvals,is_final=excluded.is_final,is_active=true,updated_at=now();

alter table operations.locations add column if not exists branch_id uuid references core.branches(id);
alter table operations.locations add column if not exists updated_at timestamptz not null default now();

update operations.locations l set branch_id=b.id
from core.branches b
where l.branch_id is null and b.code=l.code;

create table if not exists operations.location_branches (
  location_id uuid not null references operations.locations(id) on delete cascade,
  branch_id uuid not null references core.branches(id) on delete cascade,
  primary key(location_id,branch_id)
);

insert into operations.location_branches(location_id,branch_id)
select l.id,b.id from operations.locations l join core.branches b on b.code=l.code
on conflict do nothing;

alter table operations.vehicles add column if not exists status_note text;
alter table operations.vehicles add column if not exists shortage_location_note text;
alter table operations.vehicles add column if not exists created_by uuid references core.users(id);
alter table operations.vehicles add column if not exists updated_by uuid references core.users(id);
alter table operations.vehicles add column if not exists archived_at timestamptz;
alter table operations.vehicles add column if not exists archived_by uuid references core.users(id);
alter table operations.vehicles add column if not exists archive_reason text;
alter table operations.vehicles add column if not exists version integer not null default 1;

update operations.vehicles set status_code='available_for_sale' where status_code is null or btrim(status_code)='';
create index if not exists operations_vehicles_vin_search_idx on operations.vehicles(vin text_pattern_ops);
create index if not exists operations_vehicles_car_search_idx on operations.vehicles(lower(coalesce(car_name,'')));
create index if not exists operations_vehicles_active_idx on operations.vehicles(is_deleted,archived_at,location_id,status_code);

create table if not exists operations.vehicle_status_notes (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id),
  status_code text not null,
  note text not null,
  movement_id uuid,
  created_by uuid references core.users(id),
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists operations_vehicle_status_notes_idx on operations.vehicle_status_notes(vehicle_id,created_at desc);

create table if not exists operations.vehicle_check_items (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id),
  item_code text not null,
  item_name text not null,
  status text not null default 'unknown',
  note text,
  updated_by uuid references core.users(id),
  updated_by_name text,
  updated_at timestamptz not null default now(),
  unique(vehicle_id,item_code)
);
create index if not exists operations_vehicle_check_items_idx on operations.vehicle_check_items(vehicle_id);

create table if not exists operations.vehicle_check_history (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id),
  item_code text not null,
  item_name text not null,
  old_status text,
  new_status text not null,
  old_note text,
  new_note text,
  movement_id uuid,
  request_id uuid,
  changed_by uuid references core.users(id),
  changed_by_name text,
  changed_at timestamptz not null default now()
);
create index if not exists operations_vehicle_check_history_idx on operations.vehicle_check_history(vehicle_id,changed_at desc);

create table if not exists operations.movement_batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text not null unique,
  vehicle_count integer not null default 0,
  destination_location_id uuid references operations.locations(id),
  new_status text,
  general_note text,
  performed_by uuid references core.users(id),
  performed_by_name text,
  performed_role text,
  performed_branch text,
  request_id text,
  created_at timestamptz not null default now()
);

alter table operations.movements add column if not exists batch_id uuid references operations.movement_batches(id);
alter table operations.movements add column if not exists status_note text;
alter table operations.movements add column if not exists shortage_location_note text;
alter table operations.movements add column if not exists performed_by_name text;
alter table operations.movements add column if not exists performed_role text;
alter table operations.movements add column if not exists performed_branch text;
alter table operations.movements add column if not exists transfer_request_id uuid;
alter table operations.movements add column if not exists before_data jsonb not null default '{}'::jsonb;
alter table operations.movements add column if not exists after_data jsonb not null default '{}'::jsonb;
alter table operations.movements add column if not exists request_id text;
create index if not exists operations_movements_created_idx on operations.movements(created_at desc);
create index if not exists operations_movements_vehicle_created_idx on operations.movements(vehicle_id,created_at desc);

create table if not exists operations.vehicle_approval_cycles (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id),
  cycle_no integer not null,
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
create unique index if not exists operations_vehicle_active_approval_cycle_idx on operations.vehicle_approval_cycles(vehicle_id) where is_active=true;

create table if not exists operations.vehicle_approval_events (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references operations.vehicle_approval_cycles(id),
  vehicle_id uuid not null references operations.vehicles(id),
  approval_type text not null,
  action text not null,
  note text,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  actor_id uuid references core.users(id),
  actor_name text,
  actor_role text,
  request_id text,
  created_at timestamptz not null default now()
);
create index if not exists operations_vehicle_approval_events_idx on operations.vehicle_approval_events(vehicle_id,created_at desc);

alter table operations.vehicle_approvals add column if not exists cycle_id uuid references operations.vehicle_approval_cycles(id);
alter table operations.vehicle_approvals add column if not exists financial_note text;
alter table operations.vehicle_approvals add column if not exists administrative_note text;
alter table operations.vehicle_approvals add column if not exists financial_approved_at timestamptz;
alter table operations.vehicle_approvals add column if not exists administrative_approved_at timestamptz;

alter table operations.transfer_requests add column if not exists source_branch_id uuid references core.branches(id);
alter table operations.transfer_requests add column if not exists destination_branch_id uuid references core.branches(id);
alter table operations.transfer_requests add column if not exists note text;
alter table operations.transfer_requests add column if not exists requested_by_name text;
alter table operations.transfer_requests add column if not exists requested_by_role text;
alter table operations.transfer_requests add column if not exists requested_by_branch text;
alter table operations.transfer_requests add column if not exists cancelled_at timestamptz;
alter table operations.transfer_requests add column if not exists cancelled_by uuid references core.users(id);
alter table operations.transfer_requests add column if not exists cancellation_reason text;
alter table operations.transfer_requests add column if not exists deleted_at timestamptz;
alter table operations.transfer_requests add column if not exists deleted_by uuid references core.users(id);
alter table operations.transfer_requests add column if not exists deletion_reason text;
alter table operations.transfer_requests add column if not exists version integer not null default 1;
alter table operations.transfer_requests add column if not exists request_id text;
update operations.transfer_requests set transfer_type='transfer' where transfer_type is null or btrim(transfer_type)='';

alter table operations.transfer_request_vehicles add column if not exists source_location_id uuid references operations.locations(id);
alter table operations.transfer_request_vehicles add column if not exists source_status text;
alter table operations.transfer_request_vehicles add column if not exists received_movement_id uuid references operations.movements(id);
alter table operations.transfer_request_vehicles add column if not exists created_at timestamptz not null default now();

create table if not exists operations.transfer_request_events (
  id uuid primary key default gen_random_uuid(),
  transfer_request_id uuid not null references operations.transfer_requests(id),
  stage_code text not null,
  action text not null,
  note text,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  actor_id uuid references core.users(id),
  actor_name text,
  actor_role text,
  actor_branch text,
  is_override boolean not null default false,
  override_reason text,
  request_id text,
  created_at timestamptz not null default now()
);
create index if not exists operations_transfer_events_idx on operations.transfer_request_events(transfer_request_id,created_at);
create index if not exists operations_transfer_status_idx on operations.transfer_requests(status,requested_at desc);

create table if not exists operations.vehicle_archives (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id),
  reason text not null,
  snapshot jsonb not null default '{}'::jsonb,
  archived_by uuid references core.users(id),
  archived_by_name text,
  request_id text,
  archived_at timestamptz not null default now()
);
create index if not exists operations_vehicle_archives_idx on operations.vehicle_archives(vehicle_id,archived_at desc);

create table if not exists operations.import_batches (
  id uuid primary key default gen_random_uuid(),
  mode text not null,
  file_name text,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  inserted_rows integer not null default 0,
  updated_rows integer not null default 0,
  skipped_rows integer not null default 0,
  failed_rows integer not null default 0,
  status text not null default 'previewed',
  created_by uuid references core.users(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists operations.import_rows (
  id bigserial primary key,
  batch_id uuid not null references operations.import_batches(id),
  row_no integer not null,
  vin text,
  payload jsonb not null default '{}'::jsonb,
  status text not null,
  error_code text,
  error_message text,
  vehicle_id uuid references operations.vehicles(id),
  created_at timestamptz not null default now()
);
create index if not exists operations_import_rows_batch_idx on operations.import_rows(batch_id,row_no);

create table if not exists operations.event_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  title text,
  description text,
  payload jsonb not null default '{}'::jsonb,
  target_roles text[] not null default '{}',
  target_user_ids uuid[] not null default '{}',
  status text not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists operations_event_outbox_status_idx on operations.event_outbox(status,available_at);

create table if not exists audit.vehicle_deletions (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null,
  vin text not null,
  reason text not null,
  snapshot jsonb not null,
  deleted_by uuid references core.users(id),
  deleted_by_name text,
  deleted_by_email text,
  deleted_by_role text,
  request_id text,
  deleted_at timestamptz not null default now()
);
create index if not exists audit_vehicle_deletions_vin_idx on audit.vehicle_deletions(vin,deleted_at desc);

alter table operations.vehicle_approvals drop constraint if exists vehicle_approvals_vehicle_id_fkey;
alter table operations.vehicle_approvals add constraint vehicle_approvals_vehicle_id_fkey foreign key(vehicle_id) references operations.vehicles(id);
alter table operations.vehicle_shortages drop constraint if exists vehicle_shortages_vehicle_id_fkey;
alter table operations.vehicle_shortages add constraint vehicle_shortages_vehicle_id_fkey foreign key(vehicle_id) references operations.vehicles(id);
alter table operations.transfer_request_vehicles drop constraint if exists transfer_request_vehicles_vehicle_id_fkey;
alter table operations.transfer_request_vehicles add constraint transfer_request_vehicles_vehicle_id_fkey foreign key(vehicle_id) references operations.vehicles(id);
alter table operations.movements drop constraint if exists movements_vehicle_id_fkey;
alter table operations.movements add constraint movements_vehicle_id_fkey foreign key(vehicle_id) references operations.vehicles(id);

alter table tracking.orders add column if not exists source_key text;
alter table tracking.orders add column if not exists source_identity text;
alter table tracking.orders add column if not exists source_fingerprint text;
alter table tracking.orders add column if not exists source_row_number text;
alter table tracking.orders add column if not exists source_sheet_id text;
alter table tracking.orders add column if not exists source_sheet_name text;
alter table tracking.orders add column if not exists source_message_id text;
alter table tracking.orders add column if not exists source_original_id text;
update tracking.orders set source_key='legacy:'||id::text where source_key is null;
alter table tracking.orders drop constraint if exists orders_sales_order_no_key;
alter table tracking.orders drop constraint if exists tracking_orders_sales_order_no_key;
create unique index if not exists tracking_orders_source_key_unique_idx on tracking.orders(source_key) where source_key is not null;
create index if not exists tracking_orders_sales_order_no_idx on tracking.orders(sales_order_no,created_at desc);

alter table tracking.order_vehicles add column if not exists operations_vehicle_id uuid references operations.vehicles(id);
create index if not exists tracking_order_vehicles_operations_vehicle_idx on tracking.order_vehicles(operations_vehicle_id);

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
create index if not exists tracking_deleted_orders_no_idx on tracking.deleted_orders(sales_order_no,deleted_at desc);

alter table tracking.deleted_orders add column if not exists order_internal_id uuid;
alter table tracking.deleted_orders add column if not exists source_key text;
alter table tracking.deleted_orders add column if not exists source_identity text;
alter table tracking.deleted_orders add column if not exists source_fingerprint text;
alter table tracking.deleted_orders add column if not exists source_payload jsonb not null default '{}'::jsonb;
alter table tracking.deleted_orders add column if not exists request_id text;
alter table tracking.deleted_orders add column if not exists deleted_by_email text;
alter table tracking.deleted_orders add column if not exists deleted_by_role text;
create index if not exists tracking_deleted_orders_source_key_idx on tracking.deleted_orders(source_key,deleted_at desc);

insert into core.permissions(code,name,system_code) values
('operations.view','عرض نظام العمليات','operations'),
('operations.vehicle.create','إضافة السيارات','operations'),
('operations.vehicle.edit','تعديل السيارات','operations'),
('operations.vehicle.delete','مسح السيارة','operations'),
('operations.vehicle.archive','أرشفة السيارات','operations'),
('operations.movement.execute','تنفيذ حركة السيارات','operations'),
('operations.transfer.create','إنشاء طلبات النقل','operations'),
('operations.transfer.advance','تنفيذ مراحل طلبات النقل','operations'),
('operations.transfer.cancel','إلغاء طلبات النقل','operations'),
('operations.transfer.delete','حذف طلب النقل قبل التنفيذ','operations'),
('operations.approval.financial','الموافقة المالية','operations'),
('operations.approval.administrative','الموافقة الإدارية','operations'),
('operations.approval.reset','مسح الموافقات','operations'),
('operations.import','استيراد مخزون السيارات','operations'),
('operations.import.replace','الاستبدال الكامل لمخزون السيارات','operations'),
('operations.export','تصدير بيانات العمليات','operations'),
('operations.settings.manage','إدارة إعدادات العمليات','operations'),
('tracking.orders.delete','حذف طلبات التراكينج','tracking')
on conflict (code) do update set name=excluded.name,system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code='admin' and p.code like 'operations.%'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code='admin' and p.code='tracking.orders.delete'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code='operations_user' and p.code in ('operations.view','operations.movement.execute','operations.transfer.create','operations.transfer.advance','operations.export')
on conflict do nothing;
`;

export function ensureOperationsSchema() {
  if (!operationsSchemaPromise) {
    operationsSchemaPromise = (async () => {
      const sql = getSql();
      await sql.begin(async (tx) => {
        await tx`create schema if not exists operations`;
        await tx`create table if not exists operations.system_migrations (migration_key text primary key, applied_at timestamptz not null default now())`;
        await tx`select pg_advisory_xact_lock(hashtext('mzj_operations_native_v1_13_3'))`;
        const [applied] = await tx<{ migration_key: string }[]>`select migration_key from operations.system_migrations where migration_key='operations_native_v1_13_3'`;
        if (applied) return;
        const statements = OPERATIONS_SCHEMA_SQL.split(/;\s*(?:\r?\n|$)/g).map((statement) => statement.trim()).filter(Boolean);
        for (const statement of statements) await tx.unsafe(statement);
        await tx`insert into operations.system_migrations(migration_key) values ('operations_native_v1_13_3') on conflict do nothing`;
      });
    })().catch((error) => {
      operationsSchemaPromise = null;
      throw error;
    });
  }
  return operationsSchemaPromise;
}
