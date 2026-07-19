begin;

create schema if not exists operations;

create table if not exists operations.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table operations.locations add column if not exists location_type text not null default 'branch';
alter table operations.locations add column if not exists branch_id uuid references core.branches(id);
alter table operations.locations add column if not exists updated_at timestamptz not null default now();

insert into operations.locations(code,name,location_type,sort_order) values
  ('warehouse','المستودع','warehouse',10),
  ('agency','الوكالة','agency',20),
  ('hall','الصالة','branch',30),
  ('qadisiyah','القادسية','branch',40),
  ('multaqa','الملتقى','branch',50)
on conflict (code) do update set
  name=excluded.name,location_type=excluded.location_type,sort_order=excluded.sort_order,is_active=true,updated_at=now();
update operations.locations l set branch_id=b.id from core.branches b where l.code=b.code and l.branch_id is null;

create table if not exists operations.vehicle_statuses (
  code text primary key,
  name text not null,
  sort_order integer not null default 0,
  counts_in_actual_inventory boolean not null default true,
  requires_approvals boolean not null default false,
  allows_archive boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into operations.vehicle_statuses(code,name,sort_order,counts_in_actual_inventory,requires_approvals,allows_archive) values
  ('available_for_sale','متاح للبيع',10,true,false,false),
  ('reserved','حجز',20,true,false,false),
  ('has_notes','بها ملاحظات',30,true,false,false),
  ('under_delivery','مباع تحت التسليم',40,false,true,false),
  ('delivered','مباع تم التسليم',50,false,false,true),
  ('archived','مؤرشف',60,false,false,false)
on conflict (code) do update set
  name=excluded.name,sort_order=excluded.sort_order,counts_in_actual_inventory=excluded.counts_in_actual_inventory,
  requires_approvals=excluded.requires_approvals,allows_archive=excluded.allows_archive,is_active=true,updated_at=now();

create table if not exists operations.vehicles (
  id uuid primary key default gen_random_uuid(),
  vin text not null unique,
  car_name text,
  statement text,
  agent_name text,
  exterior_color text,
  interior_color text,
  model_year text,
  plate_no text,
  batch_no text,
  location_id uuid references operations.locations(id),
  status_code text not null,
  source_type text,
  has_notes boolean not null default false,
  notes text,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table operations.vehicles add column if not exists legacy_id text;
alter table operations.vehicles add column if not exists location_note text;
alter table operations.vehicles add column if not exists shortage_note text;
alter table operations.vehicles add column if not exists contents jsonb not null default '{}'::jsonb;
alter table operations.vehicles add column if not exists is_archived boolean not null default false;
alter table operations.vehicles add column if not exists archived_at timestamptz;
alter table operations.vehicles add column if not exists archived_by uuid references core.users(id);
alter table operations.vehicles add column if not exists archive_note text;
alter table operations.vehicles add column if not exists created_by uuid references core.users(id);
alter table operations.vehicles add column if not exists updated_by uuid references core.users(id);
alter table operations.vehicles alter column status_code set default 'available_for_sale';
update operations.vehicles set status_code=case trim(status_code)
  when 'متاح للبيع' then 'available_for_sale'
  when 'محجوز' then 'reserved'
  when 'حجز' then 'reserved'
  when 'بها ملاحظات' then 'has_notes'
  when 'مباع تحت التسليم' then 'under_delivery'
  when 'تحت التسليم' then 'under_delivery'
  when 'مباع تم التسليم' then 'delivered'
  when 'تم التسليم' then 'delivered'
  when 'مؤرشف' then 'archived'
  else status_code end
where status_code is not null;
update operations.vehicles set is_archived=true where status_code='archived' and is_archived=false;
create unique index if not exists operations_vehicles_legacy_unique on operations.vehicles(legacy_id) where legacy_id is not null;
create index if not exists operations_vehicles_active_idx on operations.vehicles(location_id,status_code,updated_at desc) where is_deleted=false and is_archived=false;
create index if not exists operations_vehicles_search_idx on operations.vehicles(vin,car_name,model_year);

create table if not exists operations.vehicle_approvals (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  financial_approved boolean not null default false,
  administrative_approved boolean not null default false,
  financial_approved_by uuid references core.users(id),
  administrative_approved_by uuid references core.users(id),
  updated_at timestamptz not null default now()
);
alter table operations.vehicle_approvals add column if not exists financial_note text;
alter table operations.vehicle_approvals add column if not exists administrative_note text;
alter table operations.vehicle_approvals add column if not exists financial_approved_at timestamptz;
alter table operations.vehicle_approvals add column if not exists administrative_approved_at timestamptz;
alter table operations.vehicle_approvals add column if not exists financial_reverted_by uuid references core.users(id);
alter table operations.vehicle_approvals add column if not exists administrative_reverted_by uuid references core.users(id);
alter table operations.vehicle_approvals add column if not exists financial_reverted_at timestamptz;
alter table operations.vehicle_approvals add column if not exists administrative_reverted_at timestamptz;
alter table operations.vehicle_approvals add column if not exists created_at timestamptz not null default now();
create index if not exists operations_vehicle_approvals_vehicle_idx on operations.vehicle_approvals(vehicle_id,updated_at desc);

create table if not exists operations.vehicle_shortages (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  shortage_type text not null,
  note text,
  is_resolved boolean not null default false,
  resolved_by uuid references core.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table operations.vehicle_shortages add column if not exists created_by uuid references core.users(id);
alter table operations.vehicle_shortages add column if not exists updated_at timestamptz not null default now();
create index if not exists operations_vehicle_shortages_active_idx on operations.vehicle_shortages(vehicle_id,created_at desc) where is_resolved=false;

create table if not exists operations.transfer_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text unique,
  department_code text,
  transfer_type text,
  source_location_id uuid references operations.locations(id),
  destination_location_id uuid references operations.locations(id),
  status text not null,
  requested_by uuid references core.users(id),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table operations.transfer_requests add column if not exists target_status_code text;
alter table operations.transfer_requests add column if not exists current_stage integer not null default 0;
alter table operations.transfer_requests add column if not exists photo_date date;
alter table operations.transfer_requests add column if not exists notes text;
alter table operations.transfer_requests add column if not exists requested_by_name text;
alter table operations.transfer_requests add column if not exists completed_by uuid references core.users(id);
alter table operations.transfer_requests add column if not exists is_deleted boolean not null default false;
alter table operations.transfer_requests add column if not exists deleted_by uuid references core.users(id);
alter table operations.transfer_requests add column if not exists deleted_at timestamptz;
alter table operations.transfer_requests add column if not exists created_at timestamptz not null default now();
alter table operations.transfer_requests add column if not exists updated_at timestamptz not null default now();
alter table operations.transfer_requests alter column transfer_type set default 'transfer';
alter table operations.transfer_requests alter column status set default 'not_started';
update operations.transfer_requests set current_stage=case status
  when 'request_received' then 1 when 'vehicle_sent' then 2 when 'vehicle_received' then 3 when 'completed' then 4
  else coalesce(current_stage,0) end;
create index if not exists operations_transfer_requests_status_idx on operations.transfer_requests(is_deleted,status,current_stage,updated_at desc);

create table if not exists operations.transfer_request_vehicles (
  transfer_request_id uuid not null references operations.transfer_requests(id) on delete cascade,
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  primary key (transfer_request_id,vehicle_id)
);
alter table operations.transfer_request_vehicles add column if not exists source_location_id uuid references operations.locations(id);
alter table operations.transfer_request_vehicles add column if not exists destination_location_id uuid references operations.locations(id);
alter table operations.transfer_request_vehicles add column if not exists target_status_code text;
alter table operations.transfer_request_vehicles add column if not exists note text;
alter table operations.transfer_request_vehicles add column if not exists created_at timestamptz not null default now();

create table if not exists operations.request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references operations.transfer_requests(id) on delete cascade,
  stage_no integer not null,
  action text not null,
  actor_id uuid references core.users(id),
  actor_name text,
  note text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists operations_request_events_request_idx on operations.request_events(request_id,created_at desc);

create table if not exists operations.movement_batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text not null unique,
  movement_type text not null default 'direct',
  destination_location_id uuid references operations.locations(id),
  target_status_code text,
  note text,
  request_id uuid references operations.transfer_requests(id) on delete set null,
  performed_by uuid references core.users(id),
  performed_by_name text,
  created_at timestamptz not null default now()
);

create table if not exists operations.movements (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  from_location_id uuid references operations.locations(id),
  to_location_id uuid references operations.locations(id),
  old_status text,
  new_status text,
  note text,
  performed_by uuid references core.users(id),
  created_at timestamptz not null default now()
);
alter table operations.movements add column if not exists movement_batch_id uuid references operations.movement_batches(id) on delete set null;
alter table operations.movements add column if not exists request_id uuid references operations.transfer_requests(id) on delete set null;
alter table operations.movements add column if not exists movement_type text not null default 'direct';
alter table operations.movements add column if not exists before_data jsonb;
alter table operations.movements add column if not exists after_data jsonb;
alter table operations.movements add column if not exists performed_by_name text;
create index if not exists operations_movements_vehicle_idx on operations.movements(vehicle_id,created_at desc);
create index if not exists operations_movements_request_idx on operations.movements(request_id,created_at desc);

insert into core.permissions(code,name,system_code) values
('operations.view','دخول نظام العمليات','operations'),
('operations.vehicles.view','عرض السيارات والمخزون','operations'),
('operations.vehicles.create','إضافة سيارة','operations'),
('operations.vehicles.update','تعديل سيارة','operations'),
('operations.vehicles.import','استيراد السيارات','operations'),
('operations.vehicles.export','تصدير السيارات','operations'),
('operations.vehicles.archive','أرشفة السيارات','operations'),
('operations.movements.view','عرض حركة السيارات','operations'),
('operations.movements.create','تنفيذ حركة سيارات','operations'),
('operations.requests.view','عرض طلبات النقل والتصوير','operations'),
('operations.requests.create','إنشاء طلب نقل أو تصوير','operations'),
('operations.requests.receive','استلام طلب العمليات','operations'),
('operations.requests.dispatch','إرسال السيارة','operations'),
('operations.requests.confirm_receipt','تأكيد استلام السيارة','operations'),
('operations.requests.complete','إنهاء الطلب','operations'),
('operations.requests.delete_before_receipt','حذف الطلب قبل استلام السيارة','operations'),
('operations.approvals.financial','الاعتماد المالي للسيارات','operations'),
('operations.approvals.administrative','الاعتماد الإداري للسيارات','operations'),
('operations.reports.all_cars','عرض تقرير جميع السيارات','operations'),
('operations.logs.view','عرض سجل الحركات','operations'),
('operations.logs.export','تصدير سجل الحركات','operations'),
('operations.settings.manage','إدارة إعدادات العمليات','operations')
on conflict (code) do update set name=excluded.name,system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code='admin' and p.system_code='operations' on conflict do nothing;
insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code='operations_user' and p.system_code='operations' and p.code<>'operations.settings.manage' on conflict do nothing;
insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code='sales_manager' and p.code in (
  'operations.view','operations.vehicles.view','operations.vehicles.export','operations.movements.view',
  'operations.requests.view','operations.approvals.financial','operations.approvals.administrative',
  'operations.reports.all_cars','operations.logs.view','operations.logs.export'
) on conflict do nothing;
insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code='branch_manager' and p.code in (
  'operations.view','operations.vehicles.view','operations.movements.view','operations.requests.view',
  'operations.reports.all_cars','operations.logs.view'
) on conflict do nothing;

commit;
