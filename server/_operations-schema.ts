import { runSqlScript } from "./_db.js";

let operationsSchemaPromise: Promise<void> | null = null;

export const OPERATIONS_SCHEMA_SQL = String.raw`
create schema if not exists operations;
create sequence if not exists operations.transfer_request_no_seq;

insert into core.roles(code,name,is_system) values
('system_admin','مدير النظام',true),
('operations_manager','مدير العمليات',true),
('finance_manager','مدير الحسابات',true)
on conflict (code) do update set name=excluded.name,is_system=true;

insert into core.permissions(code,name,system_code) values
('operations.view','عرض نظام العمليات','operations'),
('operations.vehicle.create','إضافة السيارات','operations'),
('operations.vehicle.edit','تعديل السيارات','operations'),
('operations.vehicle.delete','مسح السيارة','operations'),
('operations.vehicle.archive','أرشفة السيارة','operations'),
('operations.vehicle.import','استيراد السيارات','operations'),
('operations.vehicle.export','تصدير السيارات','operations'),
('operations.movement.create','تنفيذ حركة السيارات','operations'),
('operations.movement.view','عرض سجل الحركات','operations'),
('operations.transfer.create','إنشاء طلب نقل','operations'),
('operations.transfer.view','عرض طلبات النقل','operations'),
('operations.transfer.receive_order','استلام طلب النقل','operations'),
('operations.transfer.send_vehicle','إرسال السيارة','operations'),
('operations.transfer.receive_vehicle','استلام السيارة','operations'),
('operations.transfer.complete','إنهاء طلب النقل','operations'),
('operations.transfer.cancel','إلغاء طلب النقل','operations'),
('operations.transfer.delete','حذف طلب النقل قبل التنفيذ','operations'),
('operations.approval.view','عرض الموافقات','operations'),
('operations.approval.financial','تنفيذ الموافقة المالية','operations'),
('operations.approval.administrative','تنفيذ الموافقة الإدارية','operations'),
('operations.settings.manage','إدارة إعدادات العمليات','operations'),
('tracking.orders.delete','حذف طلبات التراكينج','tracking')
on conflict (code) do update set name=excluded.name,system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code in ('admin','system_admin')
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in (
  'operations.view','operations.vehicle.create','operations.vehicle.edit','operations.vehicle.archive',
  'operations.vehicle.import','operations.vehicle.export','operations.movement.create','operations.movement.view',
  'operations.transfer.create','operations.transfer.view','operations.transfer.receive_order','operations.transfer.send_vehicle',
  'operations.transfer.receive_vehicle','operations.transfer.complete','operations.transfer.cancel','operations.approval.view',
  'operations.approval.administrative'
)
where r.code in ('operations_manager','operations_user')
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in (
  'operations.view','operations.approval.view','operations.approval.financial','operations.movement.view','operations.vehicle.export'
)
where r.code in ('finance_manager')
on conflict do nothing;

create table if not exists operations.vehicle_statuses (
  code text primary key,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_actual_stock boolean not null default false,
  is_delivery_status boolean not null default false,
  is_terminal boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into operations.vehicle_statuses(code,name,sort_order,is_actual_stock,is_delivery_status,is_terminal) values
('available_for_sale','متاح للبيع',10,true,false,false),
('reserved','حجز',20,true,false,false),
('has_notes','بها ملاحظات',30,true,false,false),
('under_delivery','مباع تحت التسليم',40,false,true,false),
('delivered','مباع تم التسليم',50,false,true,true)
on conflict (code) do update set name=excluded.name,sort_order=excluded.sort_order,is_actual_stock=excluded.is_actual_stock,is_delivery_status=excluded.is_delivery_status,is_terminal=excluded.is_terminal,is_active=true;

alter table operations.locations add column if not exists branch_code text;
alter table operations.locations add column if not exists is_agency boolean not null default false;
alter table operations.locations add column if not exists updated_at timestamptz not null default now();
update operations.locations set branch_code=case code when 'hall' then 'hall' when 'qadisiyah' then 'qadisiyah' when 'multaqa' then 'multaqa' else null end where branch_code is null;
update operations.locations set is_agency=(code='agency');

alter table operations.vehicles add column if not exists is_inventory_active boolean not null default true;
alter table operations.vehicles add column if not exists state_note text;
alter table operations.vehicles add column if not exists shortage_note text;
alter table operations.vehicles add column if not exists archived_at timestamptz;
alter table operations.vehicles add column if not exists archived_by uuid references core.users(id);
alter table operations.vehicles add column if not exists archived_by_name text;
alter table operations.vehicles add column if not exists archive_reason text;
alter table operations.vehicles add column if not exists created_by uuid references core.users(id);
alter table operations.vehicles add column if not exists created_by_name text;
alter table operations.vehicles add column if not exists updated_by uuid references core.users(id);
alter table operations.vehicles add column if not exists updated_by_name text;
alter table operations.vehicles add column if not exists legacy_id text;
alter table operations.vehicles add column if not exists version integer not null default 1;
create index if not exists operations_vehicles_vin_text_idx on operations.vehicles(vin);
create index if not exists operations_vehicles_search_idx on operations.vehicles(lower(coalesce(car_name,'')),lower(coalesce(statement,'')));
create index if not exists operations_vehicles_active_idx on operations.vehicles(is_deleted,is_inventory_active,archived_at,location_id,status_code);

update operations.vehicles set status_code=case trim(status_code)
  when 'متاح للبيع' then 'available_for_sale'
  when 'محجوز' then 'reserved'
  when 'حجز' then 'reserved'
  when 'بها ملاحظات' then 'has_notes'
  when 'مباع تحت التسليم' then 'under_delivery'
  when 'مباع تحت التسلم' then 'under_delivery'
  when 'مباع تم التسليم' then 'delivered'
  else status_code end;
update operations.vehicles set has_notes=(status_code='has_notes' or coalesce(nullif(trim(notes),''),null) is not null) where has_notes=false;

create table if not exists operations.vehicle_status_notes (
  id bigserial primary key,
  vehicle_id uuid not null references operations.vehicles(id),
  status_code text not null,
  note text not null,
  movement_id uuid,
  created_by uuid references core.users(id),
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists operations_vehicle_status_notes_idx on operations.vehicle_status_notes(vehicle_id,created_at desc);

create table if not exists operations.check_item_definitions (
  code text primary key,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);
insert into operations.check_item_definitions(code,name,sort_order) values
('mats','فرشات',10),('extinguisher','طفاية',20),('safety_bag','شنطة',30),('spare_tire','اسبير',40),
('remote','ريموت',50),('screen','شاشة',60),('radio','مسجل',70),('ac','مكيف',80),('camera','كاميرا',90),('sensor','حساس',100)
on conflict (code) do update set name=excluded.name,sort_order=excluded.sort_order,is_active=true;

create table if not exists operations.vehicle_check_values (
  vehicle_id uuid not null references operations.vehicles(id),
  item_code text not null references operations.check_item_definitions(code),
  status text not null default 'unknown',
  note text,
  updated_by uuid references core.users(id),
  updated_by_name text,
  updated_at timestamptz not null default now(),
  primary key(vehicle_id,item_code)
);

create table if not exists operations.vehicle_check_history (
  id bigserial primary key,
  vehicle_id uuid not null references operations.vehicles(id),
  item_code text not null,
  old_status text,
  new_status text,
  note text,
  movement_id uuid,
  changed_by uuid references core.users(id),
  changed_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists operations_vehicle_check_history_idx on operations.vehicle_check_history(vehicle_id,created_at desc);

alter table operations.vehicle_approvals add column if not exists cycle_no integer not null default 1;
alter table operations.vehicle_approvals add column if not exists financial_note text;
alter table operations.vehicle_approvals add column if not exists administrative_note text;
alter table operations.vehicle_approvals add column if not exists financial_approved_at timestamptz;
alter table operations.vehicle_approvals add column if not exists administrative_approved_at timestamptz;
alter table operations.vehicle_approvals add column if not exists financial_approved_by_name text;
alter table operations.vehicle_approvals add column if not exists administrative_approved_by_name text;
alter table operations.vehicle_approvals add column if not exists is_active boolean not null default true;
alter table operations.vehicle_approvals add column if not exists created_at timestamptz not null default now();
with ranked as (
  select id,row_number() over(partition by vehicle_id order by created_at desc,id desc) as row_no
  from operations.vehicle_approvals where is_active=true
) update operations.vehicle_approvals a set is_active=false from ranked r where a.id=r.id and r.row_no>1;
create unique index if not exists operations_vehicle_approvals_active_unique on operations.vehicle_approvals(vehicle_id) where is_active=true;

create table if not exists operations.approval_events (
  id bigserial primary key,
  approval_id uuid references operations.vehicle_approvals(id),
  vehicle_id uuid not null references operations.vehicles(id),
  cycle_no integer not null,
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
create index if not exists operations_approval_events_vehicle_idx on operations.approval_events(vehicle_id,created_at desc);

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
create index if not exists operations_movements_vehicle_time_idx on operations.movements(vehicle_id,created_at desc);
create index if not exists operations_movements_batch_idx on operations.movements(batch_id);

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
create index if not exists operations_transfer_requests_status_idx on operations.transfer_requests(request_kind,status,is_deleted,requested_at desc);

alter table operations.transfer_request_vehicles add column if not exists source_location_id uuid references operations.locations(id);
alter table operations.transfer_request_vehicles add column if not exists source_status text;
alter table operations.transfer_request_vehicles add column if not exists created_at timestamptz not null default now();

create table if not exists operations.transfer_request_events (
  id bigserial primary key,
  transfer_request_id uuid references operations.transfer_requests(id),
  stage text,
  action text,
  note text,
  actor_id uuid references core.users(id),
  actor_name text,
  actor_role text,
  actor_branch text,
  before_data jsonb,
  after_data jsonb,
  is_override boolean not null default false,
  override_reason text,
  created_at timestamptz not null default now()
);
-- Compatibility with an earlier production table that existed without transfer_request_id.
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
-- Preserve legacy history when the previous table used request_id or transfer_id.
update operations.transfer_request_events e
set transfer_request_id = coalesce(to_jsonb(e)->>'request_id',to_jsonb(e)->>'transfer_id')::uuid
where e.transfer_request_id is null
  and coalesce(to_jsonb(e)->>'request_id',to_jsonb(e)->>'transfer_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1 from operations.transfer_requests r
    where r.id = coalesce(to_jsonb(e)->>'request_id',to_jsonb(e)->>'transfer_id')::uuid
  );
create index if not exists operations_transfer_events_idx on operations.transfer_request_events(transfer_request_id,created_at);

create table if not exists operations.photography_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text unique,
  status text not null default 'request_received',
  requested_by uuid references core.users(id),
  requested_by_name text,
  requested_by_branch text,
  requested_at timestamptz not null default now(),
  photography_date date,
  note text,
  is_deleted boolean not null default false,
  completed_at timestamptz
);
create table if not exists operations.photography_request_vehicles (
  request_id uuid not null references operations.photography_requests(id) on delete cascade,
  vehicle_id uuid not null references operations.vehicles(id),
  primary key(request_id,vehicle_id)
);

create table if not exists operations.vehicle_archive_events (
  id bigserial primary key,
  vehicle_id uuid not null references operations.vehicles(id),
  action text not null,
  reason text,
  actor_id uuid references core.users(id),
  actor_name text,
  snapshot jsonb,
  created_at timestamptz not null default now()
);
create index if not exists operations_vehicle_archive_events_idx on operations.vehicle_archive_events(vehicle_id,created_at desc);

create table if not exists operations.import_batches (
  id uuid primary key default gen_random_uuid(),
  mode text not null,
  file_name text,
  total_rows integer not null default 0,
  inserted_rows integer not null default 0,
  updated_rows integer not null default 0,
  skipped_rows integer not null default 0,
  failed_rows integer not null default 0,
  report jsonb not null default '{}'::jsonb,
  imported_by uuid references core.users(id),
  imported_by_name text,
  created_at timestamptz not null default now()
);

create table if not exists operations.vehicle_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  vehicle_internal_id uuid not null,
  vin text not null,
  vehicle_snapshot jsonb not null,
  reason text not null,
  deleted_by uuid references core.users(id),
  deleted_by_name text,
  deleted_by_email text,
  deleted_by_role text,
  request_id text not null,
  deleted_at timestamptz not null default now()
);
create index if not exists operations_vehicle_deletion_audit_vin_idx on operations.vehicle_deletion_audit(vin,deleted_at desc);

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
create index if not exists operations_event_outbox_status_idx on operations.event_outbox(status,created_at);

alter table tracking.orders add column if not exists source_identity text;
alter table tracking.orders add column if not exists source_fingerprint text;
alter table tracking.orders add column if not exists source_sheet_id text;
alter table tracking.orders add column if not exists source_sheet_name text;
alter table tracking.orders add column if not exists source_row_number text;
alter table tracking.orders add column if not exists source_message_id text;
alter table tracking.orders add column if not exists source_original_id text;
alter table tracking.orders drop constraint if exists orders_sales_order_no_key;
create index if not exists tracking_orders_sales_order_no_idx on tracking.orders(sales_order_no);
with ranked as (
  select id,row_number() over(partition by source_identity order by updated_at desc,id desc) as row_no
  from tracking.orders where source_identity is not null and coalesce(is_deleted,false)=false
) update tracking.orders o set source_identity=null from ranked r where o.id=r.id and r.row_no>1;
create unique index if not exists tracking_orders_source_identity_unique on tracking.orders(source_identity) where source_identity is not null and coalesce(is_deleted,false)=false;

alter table tracking.order_vehicles add column if not exists vehicle_id uuid references operations.vehicles(id) on delete set null;
alter table tracking.order_vehicles add column if not exists source_item_identity text;
create index if not exists tracking_order_vehicles_vehicle_id_idx on tracking.order_vehicles(vehicle_id);

alter table tracking.deleted_orders add column if not exists order_internal_id uuid;
alter table tracking.deleted_orders add column if not exists source_identity text;
alter table tracking.deleted_orders add column if not exists source_fingerprint text;
alter table tracking.deleted_orders add column if not exists request_id text;
alter table tracking.deleted_orders add column if not exists deleted_by_email text;
alter table tracking.deleted_orders add column if not exists deleted_by_role text;
create index if not exists tracking_deleted_orders_source_idx on tracking.deleted_orders(source_identity,deleted_at desc);

-- Compatibility only: old rows must never permanently block reusing a business order number.
update tracking.deleted_order_blocks
set is_blocked=false,released_at=coalesce(released_at,now())
where is_blocked=true;
`;

export function ensureOperationsSchema() {
  if (!operationsSchemaPromise) {
    operationsSchemaPromise = runSqlScript(OPERATIONS_SCHEMA_SQL).catch((error) => {
      operationsSchemaPromise = null;
      throw error;
    });
  }
  return operationsSchemaPromise;
}
