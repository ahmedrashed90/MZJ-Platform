create schema if not exists operations;
create schema if not exists audit;

alter table core.roles add column if not exists is_system boolean not null default false;

insert into core.roles(code,name,is_system) values
('system_admin','مدير النظام',true),
('accounting_manager','مدير الحسابات',true),
('operations_manager','مدير العمليات',true),
('operations_user','مستخدم العمليات',true)
on conflict (code) do update set name=excluded.name,is_system=true;

insert into core.permissions(code,name,system_code) values
('operations.view','عرض العمليات','operations'),
('operations.vehicles.view','عرض السيارات','operations'),
('operations.vehicles.create','إضافة سيارة','operations'),
('operations.vehicles.update','تعديل سيارة','operations'),
('operations.vehicle.delete','مسح سيارة نهائيًا','operations'),
('operations.vehicles.import','استيراد السيارات','operations'),
('operations.vehicles.replace','الاستبدال الكامل للمخزون','operations'),
('operations.vehicles.export','تصدير السيارات','operations'),
('operations.movements.create','تنفيذ حركة','operations'),
('operations.requests.view','عرض الطلبات','operations'),
('operations.requests.create','إنشاء طلب نقل','operations'),
('operations.requests.progress','تنفيذ مراحل الطلب','operations'),
('operations.requests.cancel','إلغاء الطلب','operations'),
('operations.approvals.view','عرض الموافقات','operations'),
('operations.approvals.financial','تنفيذ أو التراجع عن الموافقة المالية','operations'),
('operations.approvals.administrative','تنفيذ أو التراجع عن الموافقة الإدارية','operations'),
('operations.archive.view','عرض الأرشيف','operations'),
('operations.archive.create','أرشفة السيارات','operations'),
('operations.settings.manage','إدارة إعدادات العمليات','operations'),
('operations.audit.view','عرض سجل التدقيق','operations'),
('operations.tracking.view','عرض حالة التتبع','operations'),
('operations.tracking.open','فتح طلب التتبع','operations')
on conflict (code) do update set name=excluded.name,system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r cross join core.permissions p
where r.code='system_admin'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.code in ('operations.view','operations.vehicles.view','operations.requests.view','operations.approvals.view','operations.approvals.financial','operations.vehicles.export')
where r.code='accounting_manager'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id from core.roles r join core.permissions p on p.system_code='operations' and p.code not in ('operations.vehicle.delete','operations.vehicles.replace')
where r.code='operations_manager'
on conflict do nothing;

create table if not exists operations.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  branch_code text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table operations.locations add column if not exists branch_code text;
alter table operations.locations add column if not exists updated_at timestamptz not null default now();

insert into operations.locations(code,name,branch_code,sort_order) values
('warehouse','المستودع',null,10),
('agency','الوكالة',null,20),
('hall','الصالة','hall',30),
('qadisiyah','القادسية','qadisiyah',40),
('multaqa','الملتقى','multaqa',50)
on conflict (code) do update set name=excluded.name,branch_code=excluded.branch_code,sort_order=excluded.sort_order,is_active=true,updated_at=now();

create table if not exists operations.vehicle_statuses (
  code text primary key,
  name text not null unique,
  sort_order integer not null default 0,
  counts_as_active_inventory boolean not null default false,
  is_final boolean not null default false,
  requires_status_note boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into operations.vehicle_statuses(code,name,sort_order,counts_as_active_inventory,is_final,requires_status_note) values
('available_for_sale','متاح للبيع',10,true,false,false),
('reserved','محجوز',20,true,false,false),
('reservation','حجز',30,true,false,false),
('has_notes','بها ملاحظات',40,true,false,true),
('sold_under_delivery','مباع تحت التسليم',50,false,false,false),
('sold_delivered','مباع تم التسليم',60,false,true,false)
on conflict (code) do update set name=excluded.name,sort_order=excluded.sort_order,counts_as_active_inventory=excluded.counts_as_active_inventory,is_final=excluded.is_final,requires_status_note=excluded.requires_status_note,is_active=true,updated_at=now();

create table if not exists operations.vehicles (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
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
  branch_code text,
  status_code text not null default 'available_for_sale',
  source_type text,
  has_notes boolean not null default false,
  notes text,
  status_notes text,
  missing_reservation_location text,
  version integer not null default 1,
  is_archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references core.users(id),
  archive_reason text,
  created_by uuid references core.users(id),
  updated_by uuid references core.users(id),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table operations.vehicles add column if not exists legacy_id text;
alter table operations.vehicles add column if not exists branch_code text;
alter table operations.vehicles add column if not exists status_notes text;
alter table operations.vehicles add column if not exists missing_reservation_location text;
alter table operations.vehicles add column if not exists version integer not null default 1;
alter table operations.vehicles add column if not exists is_archived boolean not null default false;
alter table operations.vehicles add column if not exists archived_at timestamptz;
alter table operations.vehicles add column if not exists archived_by uuid references core.users(id);
alter table operations.vehicles add column if not exists archive_reason text;
alter table operations.vehicles add column if not exists created_by uuid references core.users(id);
alter table operations.vehicles add column if not exists updated_by uuid references core.users(id);
create unique index if not exists operations_vehicles_vin_unique on operations.vehicles(vin) where coalesce(is_deleted,false)=false;
create index if not exists operations_vehicles_vin_pattern_idx on operations.vehicles(vin text_pattern_ops);
create index if not exists operations_vehicles_search_idx on operations.vehicles using gin (to_tsvector('simple',coalesce(vin,'')||' '||coalesce(car_name,'')||' '||coalesce(statement,'')||' '||coalesce(model_year,'')));
create index if not exists operations_vehicles_scope_idx on operations.vehicles(branch_code,location_id,status_code,is_archived) where coalesce(is_deleted,false)=false;

alter table operations.vehicles add column if not exists inventory_active boolean not null default true;
alter table operations.vehicles add column if not exists last_import_batch_id uuid;
create index if not exists operations_vehicles_inventory_active_idx on operations.vehicles(inventory_active,is_archived,status_code) where coalesce(is_deleted,false)=false;

create table if not exists operations.import_batches (
  id uuid primary key default gen_random_uuid(),
  mode text not null check(mode in ('replace','add','update')),
  request_key text unique,
  status text not null default 'processing',
  source_name text,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  added_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  requested_by uuid references core.users(id),
  requested_by_name text,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table operations.import_batches add column if not exists request_key text;
create unique index if not exists operations_import_batches_request_key_unique on operations.import_batches(request_key) where request_key is not null;
create index if not exists operations_import_batches_created_idx on operations.import_batches(created_at desc);


create table if not exists operations.vehicle_status_notes (
  id bigserial primary key,
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  status_code text not null,
  note text not null,
  created_by uuid references core.users(id),
  created_at timestamptz not null default now()
);

create table if not exists operations.checklist_items (
  code text primary key,
  name text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true
);
insert into operations.checklist_items(code,name,sort_order) values
('mats','فرشات',10),('extinguisher','طفاية',20),('bag','شنطة',30),('spare','اسبير',40),('remote','ريموت',50),('screen','شاشة',60),('recorder','مسجل',70),('ac','مكيف',80),('camera','كاميرا',90),('sensor','حساس',100)
on conflict (code) do update set name=excluded.name,sort_order=excluded.sort_order,is_active=true;

create table if not exists operations.vehicle_checklist (
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  item_code text not null references operations.checklist_items(code),
  is_present boolean not null default false,
  note text,
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now(),
  primary key(vehicle_id,item_code)
);
create table if not exists operations.vehicle_checklist_history (
  id bigserial primary key,
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  item_code text not null,
  previous_value boolean,
  new_value boolean not null,
  note text,
  movement_id uuid,
  changed_by uuid references core.users(id),
  created_at timestamptz not null default now()
);

create table if not exists operations.vehicle_approvals (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  cycle_no integer not null default 1,
  is_current boolean not null default true,
  financial_approved boolean not null default false,
  administrative_approved boolean not null default false,
  financial_note text,
  administrative_note text,
  financial_approved_by uuid references core.users(id),
  administrative_approved_by uuid references core.users(id),
  financial_approved_at timestamptz,
  administrative_approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(vehicle_id,cycle_no)
);
alter table operations.vehicle_approvals add column if not exists cycle_no integer not null default 1;
alter table operations.vehicle_approvals add column if not exists is_current boolean not null default true;
alter table operations.vehicle_approvals add column if not exists financial_note text;
alter table operations.vehicle_approvals add column if not exists administrative_note text;
alter table operations.vehicle_approvals add column if not exists financial_approved_at timestamptz;
alter table operations.vehicle_approvals add column if not exists administrative_approved_at timestamptz;
alter table operations.vehicle_approvals add column if not exists created_at timestamptz not null default now();
with ranked as (
  select id,row_number() over(partition by vehicle_id order by updated_at desc nulls last,id desc) as rn
  from operations.vehicle_approvals
)
update operations.vehicle_approvals a
set cycle_no=ranked.rn,is_current=(ranked.rn=1)
from ranked where ranked.id=a.id;
create unique index if not exists operations_vehicle_approval_cycle_unique on operations.vehicle_approvals(vehicle_id,cycle_no);
create unique index if not exists operations_vehicle_current_approval_unique on operations.vehicle_approvals(vehicle_id) where is_current=true;

create table if not exists operations.approval_events (
  id bigserial primary key,
  approval_id uuid not null references operations.vehicle_approvals(id) on delete cascade,
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  approval_type text not null check(approval_type in ('financial','administrative','all')),
  action text not null check(action in ('approve','reverse','note','reset')),
  previous_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  reason text,
  actor_id uuid references core.users(id),
  actor_name text,
  actor_role text,
  created_at timestamptz not null default now()
);

create table if not exists operations.movement_batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text not null unique,
  request_key text unique,
  destination_location_id uuid not null references operations.locations(id),
  new_status_code text not null,
  vehicle_count integer not null,
  performed_by uuid references core.users(id),
  performed_by_name text,
  performed_by_role text,
  performed_by_branch text,
  created_at timestamptz not null default now()
);

alter table operations.movement_batches add column if not exists request_key text;
create unique index if not exists operations_movement_batches_request_key_unique on operations.movement_batches(request_key) where request_key is not null;

create table if not exists operations.movements (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references operations.movement_batches(id),
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  from_location_id uuid references operations.locations(id),
  to_location_id uuid references operations.locations(id),
  old_status text,
  new_status text,
  note text,
  status_note text,
  missing_reservation_location text,
  request_id uuid,
  performed_by uuid references core.users(id),
  performed_by_name text,
  performed_by_role text,
  performed_by_branch text,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table operations.movements add column if not exists batch_id uuid references operations.movement_batches(id);
alter table operations.movements add column if not exists status_note text;
alter table operations.movements add column if not exists missing_reservation_location text;
alter table operations.movements add column if not exists request_id uuid;
alter table operations.movements add column if not exists performed_by_name text;
alter table operations.movements add column if not exists performed_by_role text;
alter table operations.movements add column if not exists performed_by_branch text;
alter table operations.movements add column if not exists before_data jsonb not null default '{}'::jsonb;
alter table operations.movements add column if not exists after_data jsonb not null default '{}'::jsonb;
create index if not exists operations_movements_vehicle_date_idx on operations.movements(vehicle_id,created_at desc);
create index if not exists operations_movements_date_idx on operations.movements(created_at desc);
do $$
begin
  if not exists(select 1 from pg_constraint where conname='operations_checklist_history_movement_fk') then
    alter table operations.vehicle_checklist_history
      add constraint operations_checklist_history_movement_fk foreign key(movement_id) references operations.movements(id) on delete set null;
  end if;
end $$;

create table if not exists operations.requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique,
  legacy_transfer_request_id uuid unique,
  request_type text not null check(request_type in ('transfer','photo')),
  source_location_id uuid references operations.locations(id),
  destination_location_id uuid references operations.locations(id),
  source_branch_code text,
  destination_branch_code text,
  status text not null default 'new',
  current_stage integer not null default 0,
  reason text,
  priority text,
  photography_type text,
  photography_date date,
  notes text,
  requested_by uuid references core.users(id),
  requested_by_name text,
  requested_by_branch text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references core.users(id),
  cancellation_reason text,
  deleted_at timestamptz,
  deleted_by uuid references core.users(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table operations.requests add column if not exists legacy_transfer_request_id uuid;
create unique index if not exists operations_requests_legacy_transfer_unique on operations.requests(legacy_transfer_request_id) where legacy_transfer_request_id is not null;
create index if not exists operations_requests_status_idx on operations.requests(status,request_type,requested_at desc);
create index if not exists operations_requests_branches_idx on operations.requests(source_branch_code,destination_branch_code,status);

create table if not exists operations.request_vehicles (
  request_id uuid not null references operations.requests(id) on delete cascade,
  vehicle_id uuid not null references operations.vehicles(id),
  source_location_id uuid references operations.locations(id),
  source_branch_code text,
  vehicle_snapshot jsonb not null default '{}'::jsonb,
  primary key(request_id,vehicle_id)
);
create index if not exists operations_request_vehicles_vehicle_idx on operations.request_vehicles(vehicle_id);
do $$
begin
  if not exists(select 1 from pg_constraint where conname='operations_movements_request_fk') then
    alter table operations.movements
      add constraint operations_movements_request_fk foreign key(request_id) references operations.requests(id) on delete set null;
  end if;
end $$;

-- One-time, idempotent migration from the small legacy transfer tables that already
-- existed in the clean platform baseline. They remain untouched for rollback/audit.
do $$
begin
  if to_regclass('operations.transfer_requests') is not null
     and to_regclass('operations.transfer_request_vehicles') is not null then
    insert into operations.requests(
      legacy_transfer_request_id,request_no,request_type,source_location_id,destination_location_id,
      status,current_stage,requested_by,requested_by_name,requested_at,completed_at,created_at,updated_at
    )
    select tr.id,
      coalesce(nullif(trim(tr.request_no),''),'LEGACY-'||tr.id::text),
      case when lower(coalesce(tr.transfer_type,'')) like '%photo%' or coalesce(tr.transfer_type,'') like '%تصوير%' then 'photo' else 'transfer' end,
      tr.source_location_id,tr.destination_location_id,
      case
        when lower(coalesce(tr.status,'')) in ('completed','complete','done') or coalesce(tr.status,'') in ('تم الانتهاء','مكتمل') then 'completed'
        when lower(coalesce(tr.status,'')) in ('cancelled','canceled') or coalesce(tr.status,'')='ملغي' then 'cancelled'
        when lower(coalesce(tr.status,'')) in ('vehicle_received','received_vehicle') or coalesce(tr.status,'')='تم استلام السيارة' then 'vehicle_received'
        when lower(coalesce(tr.status,'')) in ('vehicle_sent','sent') or coalesce(tr.status,'')='تم إرسال السيارة' then 'vehicle_sent'
        when lower(coalesce(tr.status,'')) in ('request_received','received') or coalesce(tr.status,'')='تم استلام الطلب' then 'request_received'
        else 'new'
      end,
      case
        when lower(coalesce(tr.status,'')) in ('completed','complete','done') or coalesce(tr.status,'') in ('تم الانتهاء','مكتمل') then 4
        when lower(coalesce(tr.status,'')) in ('vehicle_received','received_vehicle') or coalesce(tr.status,'')='تم استلام السيارة' then 3
        when lower(coalesce(tr.status,'')) in ('vehicle_sent','sent') or coalesce(tr.status,'')='تم إرسال السيارة' then 2
        when lower(coalesce(tr.status,'')) in ('request_received','received') or coalesce(tr.status,'')='تم استلام الطلب' then 1
        else 0
      end,
      tr.requested_by,u.full_name,tr.requested_at,tr.completed_at,tr.requested_at,coalesce(tr.completed_at,tr.requested_at)
    from operations.transfer_requests tr
    left join core.users u on u.id=tr.requested_by
    where not exists(select 1 from operations.requests r where r.legacy_transfer_request_id=tr.id or r.request_no=coalesce(nullif(trim(tr.request_no),''),'LEGACY-'||tr.id::text))
    on conflict do nothing;

    insert into operations.request_vehicles(request_id,vehicle_id,source_location_id,source_branch_code,vehicle_snapshot)
    select r.id,trv.vehicle_id,v.location_id,v.branch_code,
      jsonb_build_object('vin',v.vin,'car_name',v.car_name,'statement',v.statement,'model_year',v.model_year,
        'interior_color',v.interior_color,'exterior_color',v.exterior_color,'status_code',v.status_code)
    from operations.transfer_request_vehicles trv
    join operations.requests r on r.legacy_transfer_request_id=trv.transfer_request_id
    join operations.vehicles v on v.id=trv.vehicle_id
    on conflict(request_id,vehicle_id) do nothing;
  end if;
end $$;

create table if not exists operations.request_events (
  id bigserial primary key,
  request_id uuid not null references operations.requests(id) on delete cascade,
  stage integer,
  stage_code text,
  action text not null,
  note text,
  previous_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  actor_id uuid references core.users(id),
  actor_name text,
  actor_role text,
  actor_branch text,
  is_override boolean not null default false,
  override_reason text,
  created_at timestamptz not null default now()
);

create table if not exists operations.vehicle_archives (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id),
  approval_id uuid references operations.vehicle_approvals(id),
  tracking_order_id uuid references tracking.orders(id),
  reason text not null,
  status_at_archive text,
  archived_by uuid references core.users(id),
  archived_by_name text,
  archived_at timestamptz not null default now(),
  snapshot jsonb not null default '{}'::jsonb
);

alter table tracking.order_vehicles add column if not exists operations_vehicle_id uuid references operations.vehicles(id);
update tracking.order_vehicles ov
set operations_vehicle_id=v.id
from operations.vehicles v
where ov.operations_vehicle_id is null and ov.vin=v.vin and coalesce(v.is_deleted,false)=false;
create index if not exists tracking_order_vehicles_operations_vehicle_idx on tracking.order_vehicles(operations_vehicle_id);

create table if not exists operations.vehicle_tracking_links (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  tracking_order_id uuid not null references tracking.orders(id) on delete cascade,
  tracking_vehicle_id uuid references tracking.order_vehicles(id) on delete cascade,
  linked_by_vin boolean not null default false,
  created_at timestamptz not null default now(),
  unique(vehicle_id,tracking_order_id,tracking_vehicle_id)
);
create index if not exists operations_tracking_vehicle_idx on operations.vehicle_tracking_links(vehicle_id);
create index if not exists operations_tracking_order_idx on operations.vehicle_tracking_links(tracking_order_id);

create table if not exists operations.event_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  source_system text not null default 'operations',
  entity_type text,
  entity_id text,
  vehicle_id uuid references operations.vehicles(id),
  request_id uuid references operations.requests(id),
  actor_id uuid references core.users(id),
  target_roles text[] not null default '{}',
  target_branches text[] not null default '{}',
  title text,
  description text,
  internal_path text,
  metadata jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

alter table audit.activity_log add column if not exists actor_name text;
alter table audit.activity_log add column if not exists actor_role text;
alter table audit.activity_log add column if not exists reason text;
alter table audit.activity_log add column if not exists is_override boolean not null default false;
alter table audit.activity_log add column if not exists request_id text;
