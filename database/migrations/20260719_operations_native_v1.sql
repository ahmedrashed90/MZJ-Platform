create extension if not exists pg_trgm;

insert into core.roles(code,name,is_system) values
('system_admin','مدير النظام',true),
('operations_admin','مدير العمليات',true),
('operations_branch_admin','إداري فرع العمليات',true)
on conflict (code) do update set name=excluded.name,is_system=true;

insert into core.permissions(code,name,system_code) values
('operations.view','عرض العمليات','operations'),
('operations.vehicles.view','عرض السيارات','operations'),
('operations.vehicles.create','إضافة سيارة','operations'),
('operations.vehicles.update','تعديل سيارة','operations'),
('operations.vehicles.change_vin','تغيير رقم الهيكل','operations'),
('operations.vehicles.import','استيراد السيارات','operations'),
('operations.vehicles.export','تصدير السيارات','operations'),
('operations.movements.create','تنفيذ حركة فردية','operations'),
('operations.movements.batch','تنفيذ حركة جماعية','operations'),
('operations.requests.create_transfer','إنشاء طلب نقل','operations'),
('operations.requests.create_photo','إنشاء طلب تصوير','operations'),
('operations.requests.view_outgoing','عرض الطلبات الصادرة','operations'),
('operations.requests.view_incoming','عرض الطلبات الواردة','operations'),
('operations.requests.view_all','عرض جميع الطلبات','operations'),
('operations.requests.receive','استلام الطلب','operations'),
('operations.requests.send_vehicle','إرسال السيارة','operations'),
('operations.requests.receive_vehicle','استلام السيارة','operations'),
('operations.requests.complete','إنهاء الطلب','operations'),
('operations.requests.delete','حذف طلب قبل التنفيذ','operations'),
('operations.requests.cancel','إلغاء الطلب','operations'),
('operations.checks.update','تعديل التشيك','operations'),
('operations.notes.update','تعديل النواقص والملاحظات','operations'),
('operations.approvals.financial','تنفيذ الموافقة المالية','operations'),
('operations.approvals.administrative','تنفيذ الموافقة الإدارية','operations'),
('operations.approvals.revert','التراجع عن الموافقة','operations'),
('operations.approvals.clear','مسح الموافقات','operations'),
('operations.archive.create','أرشفة سيارة','operations'),
('operations.archive.view','عرض الأرشيف','operations'),
('operations.movements.view','عرض سجل الحركات','operations'),
('operations.movements.export','تصدير سجل الحركات','operations'),
('operations.settings.manage','إدارة إعدادات العمليات','operations'),
('operations.tracking.view','عرض حالة التراكينج','operations'),
('operations.tracking.open','فتح طلب التراكينج','operations'),
('operations.audit.view','عرض سجل التدقيق','operations'),
('operations.override','تجاوز إداري','operations')
on conflict (code) do update set name=excluded.name,system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code in ('system_admin','admin','operations_admin') and p.system_code='operations'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in (
'operations.view','operations.vehicles.view','operations.movements.view','operations.movements.create','operations.movements.batch',
'operations.requests.create_transfer','operations.requests.create_photo','operations.requests.view_outgoing','operations.requests.view_incoming',
'operations.requests.receive','operations.requests.send_vehicle','operations.requests.receive_vehicle','operations.requests.complete',
'operations.checks.update','operations.notes.update','operations.tracking.view'
)
where r.code in ('operations_user','operations_branch_admin','branch_manager')
on conflict do nothing;

alter table operations.locations add column if not exists branch_code text;
alter table operations.locations add column if not exists location_type text not null default 'branch';
alter table operations.locations add column if not exists updated_at timestamptz not null default now();
update operations.locations set branch_code=case code when 'hall' then 'hall' when 'qadisiyah' then 'qadisiyah' when 'multaqa' then 'multaqa' else branch_code end;
update operations.locations set location_type=case when code='agency' then 'agency' when code='warehouse' then 'warehouse' else 'branch' end;
create index if not exists operations_locations_branch_idx on operations.locations(branch_code,is_active);

create table if not exists operations.vehicle_statuses (
  code text primary key,
  name text not null unique,
  sort_order integer not null default 0,
  is_inventory boolean not null default true,
  requires_status_note boolean not null default false,
  starts_delivery_cycle boolean not null default false,
  is_final_delivery boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into operations.vehicle_statuses(code,name,sort_order,is_inventory,requires_status_note,starts_delivery_cycle,is_final_delivery) values
('available_for_sale','متاح للبيع',10,true,false,false,false),
('reserved','محجوز',20,true,false,false,false),
('has_notes','بها ملاحظات',30,true,true,false,false),
('under_delivery','مباع تحت التسليم',40,false,false,true,false),
('delivered','مباع تم التسليم',50,false,false,false,true)
on conflict (code) do update set name=excluded.name,sort_order=excluded.sort_order,is_inventory=excluded.is_inventory,requires_status_note=excluded.requires_status_note,starts_delivery_cycle=excluded.starts_delivery_cycle,is_final_delivery=excluded.is_final_delivery,is_active=true;

alter table operations.vehicles add column if not exists legacy_id text;
alter table operations.vehicles add column if not exists branch_code text;
alter table operations.vehicles add column if not exists status_note text;
alter table operations.vehicles add column if not exists reservation_shortage_location_note text;
alter table operations.vehicles add column if not exists is_archived boolean not null default false;
alter table operations.vehicles add column if not exists archived_at timestamptz;
alter table operations.vehicles add column if not exists archived_by uuid references core.users(id);
alter table operations.vehicles add column if not exists archive_reason text;
alter table operations.vehicles add column if not exists created_by uuid references core.users(id);
alter table operations.vehicles add column if not exists updated_by uuid references core.users(id);
alter table operations.vehicles add column if not exists version integer not null default 1;
alter table operations.vehicles add column if not exists source_payload jsonb not null default '{}'::jsonb;
update operations.vehicles v set branch_code=coalesce(v.branch_code,l.branch_code) from operations.locations l where l.id=v.location_id;
create unique index if not exists operations_vehicles_legacy_id_unique on operations.vehicles(legacy_id) where legacy_id is not null;
create index if not exists operations_vehicles_vin_trgm_idx on operations.vehicles using gin (vin gin_trgm_ops);
create index if not exists operations_vehicles_car_name_trgm_idx on operations.vehicles using gin (coalesce(car_name,'') gin_trgm_ops);
create index if not exists operations_vehicles_branch_idx on operations.vehicles(branch_code) where is_deleted=false;
create index if not exists operations_vehicles_archive_idx on operations.vehicles(is_archived,updated_at desc) where is_deleted=false;

create table if not exists operations.vehicle_notes (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  note_type text not null check (note_type in ('vehicle','status','reservation_shortage_location')),
  note text not null,
  movement_id uuid,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now()
);
create index if not exists operations_vehicle_notes_vehicle_idx on operations.vehicle_notes(vehicle_id,created_at desc);

create table if not exists operations.check_items (
  code text primary key,
  name text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true
);
insert into operations.check_items(code,name,sort_order) values
('mats','فرشات',10),('extinguisher','طفاية',20),('bag','شنطة',30),('spare_tire','اسبير',40),('remote','ريموت',50),
('screen','شاشة',60),('radio','مسجل',70),('air_conditioner','مكيف',80),('camera','كاميرا',90),('sensor','حساس',100)
on conflict (code) do update set name=excluded.name,sort_order=excluded.sort_order,is_active=true;

create table if not exists operations.vehicle_checks (
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  item_code text not null references operations.check_items(code),
  status text not null default 'unknown' check (status in ('unknown','available','missing','damaged')),
  note text,
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now(),
  movement_id uuid,
  request_id uuid,
  primary key(vehicle_id,item_code)
);
create table if not exists operations.vehicle_check_history (
  id bigserial primary key,
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  item_code text not null references operations.check_items(code),
  old_status text,
  new_status text not null,
  old_note text,
  new_note text,
  changed_by uuid references core.users(id),
  movement_id uuid,
  request_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists operations_vehicle_check_history_idx on operations.vehicle_check_history(vehicle_id,created_at desc);

alter table operations.vehicle_approvals add column if not exists delivery_cycle_id uuid;
alter table operations.vehicle_approvals add column if not exists financial_note text;
alter table operations.vehicle_approvals add column if not exists administrative_note text;
alter table operations.vehicle_approvals add column if not exists financial_approved_at timestamptz;
alter table operations.vehicle_approvals add column if not exists administrative_approved_at timestamptz;
alter table operations.vehicle_approvals add column if not exists financial_reverted_at timestamptz;
alter table operations.vehicle_approvals add column if not exists administrative_reverted_at timestamptz;
alter table operations.vehicle_approvals add column if not exists financial_reverted_by uuid references core.users(id);
alter table operations.vehicle_approvals add column if not exists administrative_reverted_by uuid references core.users(id);
alter table operations.vehicle_approvals add column if not exists created_at timestamptz not null default now();
create index if not exists operations_vehicle_approvals_vehicle_idx on operations.vehicle_approvals(vehicle_id,created_at desc);

create table if not exists operations.approval_events (
  id bigserial primary key,
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  approval_id uuid references operations.vehicle_approvals(id) on delete set null,
  approval_type text not null check (approval_type in ('financial','administrative','both')),
  action text not null check (action in ('initialized','approved','reverted','note_updated','cleared')),
  actor_id uuid references core.users(id),
  actor_name text,
  reason text,
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
  performed_by uuid references core.users(id),
  performed_by_name text,
  created_at timestamptz not null default now()
);

alter table operations.movements add column if not exists batch_id uuid references operations.movement_batches(id);
alter table operations.movements add column if not exists request_id uuid;
alter table operations.movements add column if not exists status_note text;
alter table operations.movements add column if not exists reservation_shortage_location_note text;
alter table operations.movements add column if not exists performed_by_name text;
alter table operations.movements add column if not exists performed_role text;
alter table operations.movements add column if not exists performed_branch text;
alter table operations.movements add column if not exists before_data jsonb;
alter table operations.movements add column if not exists after_data jsonb;
alter table operations.movements add column if not exists idempotency_key text;
create unique index if not exists operations_movements_idempotency_unique on operations.movements(idempotency_key) where idempotency_key is not null;
create index if not exists operations_movements_created_idx on operations.movements(created_at desc);
create index if not exists operations_movements_batch_idx on operations.movements(batch_id);

alter table operations.transfer_requests add column if not exists request_type text not null default 'transfer';
alter table operations.transfer_requests add column if not exists source_branch_code text;
alter table operations.transfer_requests add column if not exists destination_branch_code text;
alter table operations.transfer_requests add column if not exists photography_date date;
alter table operations.transfer_requests add column if not exists notes text;
alter table operations.transfer_requests add column if not exists requested_by_name text;
alter table operations.transfer_requests add column if not exists requested_by_branch text;
alter table operations.transfer_requests add column if not exists cancelled_at timestamptz;
alter table operations.transfer_requests add column if not exists cancelled_by uuid references core.users(id);
alter table operations.transfer_requests add column if not exists cancellation_reason text;
alter table operations.transfer_requests add column if not exists is_deleted boolean not null default false;
alter table operations.transfer_requests add column if not exists deleted_at timestamptz;
alter table operations.transfer_requests add column if not exists deleted_by uuid references core.users(id);
alter table operations.transfer_requests add column if not exists version integer not null default 1;
alter table operations.transfer_requests add column if not exists updated_at timestamptz not null default now();
create sequence if not exists operations.request_number_seq start with 1000;
create index if not exists operations_transfer_requests_status_idx on operations.transfer_requests(status,requested_at desc) where is_deleted=false;
create index if not exists operations_transfer_requests_branches_idx on operations.transfer_requests(source_branch_code,destination_branch_code,status);

alter table operations.transfer_request_vehicles add column if not exists source_location_id uuid references operations.locations(id);
alter table operations.transfer_request_vehicles add column if not exists source_branch_code text;
alter table operations.transfer_request_vehicles add column if not exists status_at_request text;
alter table operations.transfer_request_vehicles add column if not exists created_at timestamptz not null default now();

create table if not exists operations.request_stage_events (
  id bigserial primary key,
  request_id uuid not null references operations.transfer_requests(id) on delete cascade,
  stage_code text not null check (stage_code in ('created','request_received','vehicle_sent','vehicle_received','completed','cancelled','deleted','override')),
  action text not null,
  actor_id uuid references core.users(id),
  actor_name text,
  actor_role text,
  actor_branch text,
  note text,
  before_data jsonb,
  after_data jsonb,
  is_override boolean not null default false,
  override_reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists operations_request_stage_once_idx on operations.request_stage_events(request_id,stage_code) where stage_code in ('request_received','vehicle_sent','vehicle_received','completed');
create index if not exists operations_request_stage_events_idx on operations.request_stage_events(request_id,created_at);

create table if not exists operations.vehicle_archives (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id) on delete restrict,
  status_at_archive text not null,
  approval_snapshot jsonb not null default '{}'::jsonb,
  tracking_snapshot jsonb not null default '{}'::jsonb,
  reason text not null,
  archived_by uuid references core.users(id),
  archived_by_name text,
  archived_at timestamptz not null default now(),
  unique(vehicle_id)
);

alter table tracking.order_vehicles add column if not exists operations_vehicle_id uuid references operations.vehicles(id) on delete set null;
create index if not exists tracking_order_vehicles_operations_vehicle_idx on tracking.order_vehicles(operations_vehicle_id);

update tracking.order_vehicles tv
set operations_vehicle_id=v.id
from operations.vehicles v
where tv.operations_vehicle_id is null and tv.vin=v.vin;

create table if not exists operations.tracking_link_reviews (
  id uuid primary key default gen_random_uuid(),
  tracking_vehicle_id uuid not null references tracking.order_vehicles(id) on delete cascade,
  vin text not null,
  issue text not null,
  resolved_vehicle_id uuid references operations.vehicles(id),
  resolved_by uuid references core.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists operations_tracking_link_reviews_open_unique
on operations.tracking_link_reviews(tracking_vehicle_id) where resolved_at is null;

insert into operations.tracking_link_reviews(tracking_vehicle_id,vin,issue)
select tv.id,tv.vin,'لم يتم العثور على سيارة عمليات مطابقة لرقم الهيكل'
from tracking.order_vehicles tv
where tv.operations_vehicle_id is null
on conflict do nothing;

create table if not exists operations.event_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  source_system text not null default 'operations',
  aggregate_type text not null,
  aggregate_id text not null,
  title text,
  description text,
  target_roles text[] not null default '{}',
  target_user_ids uuid[] not null default '{}',
  internal_path text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists operations_event_outbox_pending_idx on operations.event_outbox(status,created_at);

create or replace view operations.vehicle_tracking_summary as
select
  v.id as vehicle_id,
  tv.id as tracking_vehicle_id,
  o.id as tracking_request_id,
  o.sales_order_no as request_no,
  o.status,
  o.is_archived,
  coalesce(o.is_deleted,false) as is_deleted,
  case when count(vs.id) filter (where s.is_active=true)=0 then 0
       else round(100.0 * count(vs.id) filter (where s.is_active=true and vs.status='completed') / nullif(count(vs.id) filter (where s.is_active=true),0))::int end as progress,
  max(s.sort_order) filter (where vs.status='completed') as current_stage_order,
  max(o.created_at) as created_at,
  max(o.updated_at) as updated_at
from operations.vehicles v
join tracking.order_vehicles tv on tv.operations_vehicle_id=v.id or (tv.operations_vehicle_id is null and tv.vin=v.vin)
join tracking.orders o on o.id=tv.order_id
left join tracking.vehicle_stages vs on vs.vehicle_id=tv.id
left join tracking.stages s on s.id=vs.stage_id
group by v.id,tv.id,o.id,o.sales_order_no,o.status,o.is_archived,o.is_deleted;
