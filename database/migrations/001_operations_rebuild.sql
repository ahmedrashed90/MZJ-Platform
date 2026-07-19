create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create schema if not exists operations;

insert into core.roles(code,name,is_system)
values ('system_admin','مدير النظام',true)
on conflict (code) do update set name=excluded.name,is_system=true;

insert into core.user_roles(user_id,role_id)
select ur.user_id,sa.id
from core.user_roles ur
join core.roles legacy on legacy.id=ur.role_id and legacy.code='admin'
join core.roles sa on sa.code='system_admin'
on conflict do nothing;

update core.roles set name='مدير منصة قديم' where code='admin' and name='مدير النظام';

alter table operations.locations add column if not exists branch_id uuid references core.branches(id);
alter table operations.locations add column if not exists notes text;
alter table operations.locations add column if not exists created_by uuid references core.users(id);
alter table operations.locations add column if not exists updated_by uuid references core.users(id);
alter table operations.locations add column if not exists updated_at timestamptz not null default now();

update operations.locations l
set branch_id=b.id
from core.branches b
where l.branch_id is null and (b.code=l.code or (l.code='warehouse' and b.code='hall') or (l.code='agency' and b.code='hall'));

create table if not exists operations.vehicle_statuses (
  code text primary key,
  name text not null unique,
  counts_in_inventory boolean not null default true,
  is_final boolean not null default false,
  requires_approvals boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references core.users(id),
  updated_by uuid references core.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into operations.vehicle_statuses(code,name,counts_in_inventory,is_final,requires_approvals,sort_order) values
('available_for_sale','متاح للبيع',true,false,false,10),
('reserved','حجز',true,false,false,20),
('has_notes','بها ملاحظات',true,false,false,30),
('under_delivery','مباع تحت التسليم',false,false,true,40),
('delivered','مباع تم التسليم',false,true,true,50)
on conflict (code) do update set
  name=excluded.name,
  counts_in_inventory=excluded.counts_in_inventory,
  is_final=excluded.is_final,
  requires_approvals=excluded.requires_approvals,
  sort_order=excluded.sort_order,
  is_active=true,
  updated_at=now();

alter table operations.vehicles add column if not exists booking_shortage_location_notes text;
alter table operations.vehicles add column if not exists place_notes text;
alter table operations.vehicles add column if not exists status_note text;
alter table operations.vehicles add column if not exists created_by uuid references core.users(id);
alter table operations.vehicles add column if not exists updated_by uuid references core.users(id);
alter table operations.vehicles add column if not exists archived_at timestamptz;
alter table operations.vehicles add column if not exists archived_by uuid references core.users(id);
alter table operations.vehicles add column if not exists archive_reason text;
alter table operations.vehicles add column if not exists legacy_id text;
alter table operations.vehicles add column if not exists version integer not null default 1;

update operations.vehicles
set vin=upper(regexp_replace(trim(vin),'\s+','','g')),
    status_code=case trim(coalesce(status_code,''))
      when 'متاح للبيع' then 'available_for_sale'
      when 'محجوز' then 'reserved'
      when 'حجز' then 'reserved'
      when 'بها ملاحظات' then 'has_notes'
      when 'مباع تحت التسليم' then 'under_delivery'
      when 'مباع تم التسليم' then 'delivered'
      else coalesce(nullif(trim(status_code),''),'available_for_sale') end;

insert into operations.vehicle_statuses(code,name,counts_in_inventory,is_final,requires_approvals,sort_order)
select distinct v.status_code,v.status_code,true,false,false,900
from operations.vehicles v
where coalesce(trim(v.status_code),'')<>''
on conflict (code) do nothing;

create unique index if not exists operations_vehicles_vin_canonical_uidx
  on operations.vehicles ((upper(regexp_replace(trim(vin),'\s+','','g'))))
  where coalesce(is_deleted,false)=false;
create index if not exists operations_vehicles_vin_trgm_idx
  on operations.vehicles using gin ((upper(vin)) gin_trgm_ops);
create index if not exists operations_vehicles_location_idx on operations.vehicles(location_id,archived_at,updated_at desc);
create index if not exists operations_vehicles_status_idx on operations.vehicles(status_code,archived_at,updated_at desc);
create index if not exists operations_vehicles_model_idx on operations.vehicles(model_year);
create index if not exists operations_vehicles_archive_idx on operations.vehicles(archived_at,updated_at desc);

create table if not exists operations.vehicle_notes (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  note_type text not null,
  note text not null,
  movement_id uuid,
  request_id uuid,
  created_by uuid not null references core.users(id),
  creator_name text not null,
  created_at timestamptz not null default now()
);
create index if not exists operations_vehicle_notes_idx on operations.vehicle_notes(vehicle_id,note_type,created_at desc);

create table if not exists operations.check_item_definitions (
  code text primary key,
  name text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

insert into operations.check_item_definitions(code,name,sort_order) values
('mats','فرشات',10),('extinguisher','طفاية',20),('safety_bag','شنطة',30),('spare_tire','اسبير',40),
('remote','ريموت',50),('screen','شاشة',60),('recorder','مسجل',70),('air_conditioner','مكيف',80),
('camera','كاميرا',90),('sensors','حساس',100)
on conflict (code) do update set name=excluded.name,sort_order=excluded.sort_order,is_active=true;

create table if not exists operations.vehicle_check_items (
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  item_code text not null references operations.check_item_definitions(code),
  is_present boolean not null default false,
  note text,
  updated_by uuid references core.users(id),
  updated_at timestamptz not null default now(),
  primary key(vehicle_id,item_code)
);

create table if not exists operations.vehicle_check_history (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  item_code text not null references operations.check_item_definitions(code),
  old_value boolean,
  new_value boolean not null,
  note text,
  movement_id uuid,
  request_id uuid,
  changed_by uuid not null references core.users(id),
  changer_name text not null,
  created_at timestamptz not null default now()
);
create index if not exists operations_vehicle_check_history_idx on operations.vehicle_check_history(vehicle_id,created_at desc);

alter table operations.vehicle_approvals add column if not exists financial_approved_at timestamptz;
alter table operations.vehicle_approvals add column if not exists financial_note text;
alter table operations.vehicle_approvals add column if not exists financial_revoked_by uuid references core.users(id);
alter table operations.vehicle_approvals add column if not exists financial_revoked_at timestamptz;
alter table operations.vehicle_approvals add column if not exists administrative_approved_at timestamptz;
alter table operations.vehicle_approvals add column if not exists administrative_note text;
alter table operations.vehicle_approvals add column if not exists administrative_revoked_by uuid references core.users(id);
alter table operations.vehicle_approvals add column if not exists administrative_revoked_at timestamptz;
alter table operations.vehicle_approvals add column if not exists created_at timestamptz not null default now();
alter table operations.vehicle_approvals add column if not exists updated_at timestamptz not null default now();
alter table operations.vehicle_approvals add column if not exists cycle_no integer not null default 0;

create table if not exists operations.vehicle_approval_legacy_snapshots (
  source_approval_id uuid primary key,
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  snapshot jsonb not null,
  migration_reason text not null,
  migrated_at timestamptz not null default now()
);

with ranked as (
  select a.id,a.vehicle_id,row_number() over (
    partition by a.vehicle_id
    order by coalesce(a.updated_at,a.created_at) desc,a.id desc
  ) as row_no
  from operations.vehicle_approvals a
)
insert into operations.vehicle_approval_legacy_snapshots(source_approval_id,vehicle_id,snapshot,migration_reason)
select a.id,a.vehicle_id,to_jsonb(a),'duplicate approval snapshot preserved before consolidation'
from operations.vehicle_approvals a join ranked r on r.id=a.id
where r.row_no>1
on conflict(source_approval_id) do nothing;

with ranked as (
  select a.id,row_number() over (
    partition by a.vehicle_id
    order by coalesce(a.updated_at,a.created_at) desc,a.id desc
  ) as row_no
  from operations.vehicle_approvals a
)
delete from operations.vehicle_approvals a using ranked r where a.id=r.id and r.row_no>1;

create unique index if not exists operations_vehicle_approvals_vehicle_uidx on operations.vehicle_approvals(vehicle_id);
insert into operations.vehicle_approvals(vehicle_id,financial_approved,administrative_approved,cycle_no)
select v.id,false,false,1 from operations.vehicles v
where v.status_code='under_delivery' and coalesce(v.is_deleted,false)=false
on conflict(vehicle_id) do nothing;
update operations.vehicle_approvals a set cycle_no=1,updated_at=now()
from operations.vehicles v where v.id=a.vehicle_id and v.status_code='under_delivery' and a.cycle_no=0;

create table if not exists operations.vehicle_approval_history (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  approval_type text not null,
  action text not null,
  performed_by uuid not null references core.users(id),
  performer_name text not null,
  performer_role text,
  performer_branch text,
  note text,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  cycle_no integer not null default 0,
  created_at timestamptz not null default now()
);
alter table operations.vehicle_approval_history add column if not exists cycle_no integer not null default 0;
create index if not exists operations_approval_history_vehicle_idx on operations.vehicle_approval_history(vehicle_id,created_at desc);

alter table operations.vehicle_shortages add column if not exists created_by uuid references core.users(id);
alter table operations.vehicle_shortages add column if not exists updated_at timestamptz not null default now();
create index if not exists operations_vehicle_shortages_open_idx on operations.vehicle_shortages(vehicle_id,created_at desc) where is_resolved=false;

create table if not exists operations.movement_batches (
  id uuid primary key default gen_random_uuid(),
  movement_type text not null default 'manual',
  vehicle_count integer not null default 0,
  note text,
  idempotency_key text,
  performed_by uuid not null references core.users(id),
  performer_name text not null,
  performer_role text,
  performer_branch text,
  created_at timestamptz not null default now()
);
create unique index if not exists operations_movement_batches_idempotency_uidx on operations.movement_batches(idempotency_key) where idempotency_key is not null;

alter table operations.movements add column if not exists batch_id uuid references operations.movement_batches(id);
alter table operations.movements add column if not exists request_id uuid references operations.transfer_requests(id);
alter table operations.movements add column if not exists movement_type text not null default 'manual';
alter table operations.movements add column if not exists status_note text;
alter table operations.movements add column if not exists place_note text;
alter table operations.movements add column if not exists shortage_note text;
alter table operations.movements add column if not exists performer_name text;
alter table operations.movements add column if not exists performer_role text;
alter table operations.movements add column if not exists performer_branch text;
alter table operations.movements add column if not exists old_check_state jsonb;
alter table operations.movements add column if not exists new_check_state jsonb;
alter table operations.movements add column if not exists before_data jsonb;
alter table operations.movements add column if not exists after_data jsonb;
create index if not exists operations_movements_vehicle_created_idx on operations.movements(vehicle_id,created_at desc);
create index if not exists operations_movements_request_idx on operations.movements(request_id);
create index if not exists operations_movements_created_idx on operations.movements(created_at desc);

alter table operations.transfer_requests add column if not exists photography_date date;
alter table operations.transfer_requests add column if not exists target_status_code text references operations.vehicle_statuses(code);
alter table operations.transfer_requests add column if not exists notes text;
alter table operations.transfer_requests add column if not exists source_branch_id uuid references core.branches(id);
alter table operations.transfer_requests add column if not exists destination_branch_id uuid references core.branches(id);
alter table operations.transfer_requests add column if not exists updated_by uuid references core.users(id);
alter table operations.transfer_requests add column if not exists updated_at timestamptz not null default now();
alter table operations.transfer_requests add column if not exists deleted_at timestamptz;
alter table operations.transfer_requests add column if not exists deleted_by uuid references core.users(id);
alter table operations.transfer_requests add column if not exists delete_reason text;
alter table operations.transfer_requests add column if not exists cancelled_at timestamptz;
alter table operations.transfer_requests add column if not exists cancelled_by uuid references core.users(id);
alter table operations.transfer_requests add column if not exists cancellation_reason text;
alter table operations.transfer_requests add column if not exists started_at timestamptz;
alter table operations.transfer_requests add column if not exists legacy_id text;
alter table operations.transfer_requests add column if not exists version integer not null default 1;

update operations.transfer_requests set transfer_type='transfer' where coalesce(trim(transfer_type),'')='';
update operations.transfer_requests set status='draft' where coalesce(trim(status),'')='';
update operations.transfer_requests r set source_branch_id=l.branch_id from operations.locations l where r.source_branch_id is null and l.id=r.source_location_id;
update operations.transfer_requests r set destination_branch_id=l.branch_id from operations.locations l where r.destination_branch_id is null and l.id=r.destination_location_id;

alter table operations.transfer_request_vehicles add column if not exists current_location_id uuid references operations.locations(id);
alter table operations.transfer_request_vehicles add column if not exists current_branch_id uuid references core.branches(id);
alter table operations.transfer_request_vehicles add column if not exists current_status_code text;
alter table operations.transfer_request_vehicles add column if not exists received_location_id uuid references operations.locations(id);
alter table operations.transfer_request_vehicles add column if not exists received_status_code text;
alter table operations.transfer_request_vehicles add column if not exists notes text;
alter table operations.transfer_request_vehicles add column if not exists snapshot jsonb not null default '{}'::jsonb;
alter table operations.transfer_request_vehicles add column if not exists created_at timestamptz not null default now();
create index if not exists operations_transfer_requests_status_idx on operations.transfer_requests(status,updated_at desc) where deleted_at is null;
create index if not exists operations_transfer_requests_source_branch_idx on operations.transfer_requests(source_branch_id,status,updated_at desc);
create index if not exists operations_transfer_requests_destination_branch_idx on operations.transfer_requests(destination_branch_id,status,updated_at desc);
create index if not exists operations_request_vehicles_vehicle_idx on operations.transfer_request_vehicles(vehicle_id,transfer_request_id);

create table if not exists operations.vehicle_request_locks (
  vehicle_id uuid primary key references operations.vehicles(id) on delete cascade,
  request_id uuid not null references operations.transfer_requests(id) on delete cascade,
  request_type text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists operations_vehicle_request_locks_request_vehicle_uidx on operations.vehicle_request_locks(request_id,vehicle_id);

create table if not exists operations.request_stage_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references operations.transfer_requests(id) on delete cascade,
  stage_code text not null,
  action text not null default 'stage_completed',
  performed_by uuid not null references core.users(id),
  performer_name text not null,
  performer_role text,
  performer_branch text,
  note text,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  is_override boolean not null default false,
  override_reason text,
  session_data jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);
create unique index if not exists operations_request_stage_unique_uidx on operations.request_stage_events(request_id,stage_code) where action='stage_completed';
create index if not exists operations_request_events_idx on operations.request_stage_events(request_id,created_at);

create table if not exists operations.request_cancellations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references operations.transfer_requests(id) on delete restrict,
  stage_code text,
  reason text not null,
  cancelled_by uuid not null references core.users(id),
  cancelled_by_name text not null,
  created_at timestamptz not null default now()
);
create index if not exists operations_request_cancellations_idx on operations.request_cancellations(request_id,created_at desc);

create table if not exists operations.vehicle_tracking_links (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references operations.vehicles(id) on delete cascade,
  tracking_order_id uuid not null references tracking.orders(id) on delete cascade,
  tracking_vehicle_id uuid references tracking.order_vehicles(id) on delete cascade,
  legacy_vin text,
  match_method text not null default 'vehicle_id',
  match_status text not null default 'matched',
  matched_by uuid references core.users(id),
  matched_at timestamptz not null default now(),
  notes text,
  unique(vehicle_id,tracking_order_id,tracking_vehicle_id)
);
create index if not exists operations_vehicle_tracking_links_vehicle_idx on operations.vehicle_tracking_links(vehicle_id,matched_at desc);
create index if not exists operations_vehicle_tracking_links_order_idx on operations.vehicle_tracking_links(tracking_order_id);

alter table tracking.orders add column if not exists is_cancelled boolean not null default false;
alter table tracking.orders add column if not exists cancelled_at timestamptz;
alter table tracking.orders add column if not exists cancelled_reason text;
alter table tracking.orders add column if not exists is_rejected boolean not null default false;
alter table tracking.orders add column if not exists rejected_at timestamptz;
alter table tracking.orders add column if not exists rejected_reason text;
alter table tracking.order_vehicles add column if not exists operations_vehicle_id uuid references operations.vehicles(id);
create index if not exists tracking_order_vehicles_operations_vehicle_idx on tracking.order_vehicles(operations_vehicle_id);
create index if not exists tracking_orders_state_updated_idx on tracking.orders(status,is_deleted,is_cancelled,is_rejected,updated_at desc);

create or replace view operations.tracking_vehicle_read_model as
select
  v.id as vehicle_id,
  o.id as tracking_order_id,
  ov.id as tracking_vehicle_id,
  o.sales_order_no as request_no,
  o.status,
  coalesce(o.is_deleted,false) as is_deleted,
  coalesce(o.is_cancelled,false) as is_cancelled,
  coalesce(o.is_rejected,false) as is_rejected,
  coalesce(o.is_archived,false) as is_archived,
  case
    when coalesce(o.is_deleted,false) then 0
    when coalesce(o.is_cancelled,false) or coalesce(o.is_rejected,false) then 0
    when count(vs.id) filter (where s.is_active=true)=0 then case when o.status='completed' or o.is_archived then 100 else 0 end
    else round(100.0 * count(vs.id) filter (where s.is_active=true and vs.status='completed') / nullif(count(vs.id) filter (where s.is_active=true),0))::int
  end as progress,
  (
    select s2.name
    from tracking.vehicle_stages vs2
    join tracking.stages s2 on s2.id=vs2.stage_id and s2.is_active=true
    where vs2.vehicle_id=ov.id and vs2.status<>'completed'
    order by s2.sort_order
    limit 1
  ) as current_stage,
  o.created_at,
  o.updated_at,
  coalesce(o.archived_at,o.updated_at) as completed_at,
  ov.operations_vehicle_id,
  ov.vin,
  row_number() over (
    partition by v.id
    order by
      case when coalesce(o.is_deleted,false)=false and coalesce(o.is_cancelled,false)=false and coalesce(o.is_rejected,false)=false and coalesce(o.is_archived,false)=false and o.status<>'completed' then 0 else 1 end,
      o.updated_at desc
  ) as display_rank
from operations.vehicles v
join tracking.order_vehicles ov on ov.operations_vehicle_id=v.id or (ov.operations_vehicle_id is null and upper(regexp_replace(trim(ov.vin),'\s+','','g'))=upper(regexp_replace(trim(v.vin),'\s+','','g')))
join tracking.orders o on o.id=ov.order_id
left join tracking.vehicle_stages vs on vs.vehicle_id=ov.id
left join tracking.stages s on s.id=vs.stage_id
group by v.id,o.id,ov.id;

create table if not exists operations.vehicle_archives (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null unique references operations.vehicles(id) on delete restrict,
  archived_by uuid not null references core.users(id),
  archived_by_name text not null,
  reason text not null,
  tracking_order_id uuid references tracking.orders(id),
  snapshot jsonb not null,
  archived_at timestamptz not null default now()
);

create table if not exists operations.audit_events (
  id bigserial primary key,
  actor_id uuid references core.users(id),
  actor_name text,
  actor_role text,
  actor_branch text,
  system_code text not null default 'operations',
  page_code text,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  reason text,
  is_override boolean not null default false,
  session_data jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);
create index if not exists operations_audit_entity_idx on operations.audit_events(entity_type,entity_id,created_at desc);
create index if not exists operations_audit_actor_idx on operations.audit_events(actor_id,created_at desc);
create index if not exists operations_audit_created_idx on operations.audit_events(created_at desc);

create or replace rule operations_audit_events_no_update as on update to operations.audit_events do instead nothing;
create or replace rule operations_audit_events_no_delete as on delete to operations.audit_events do instead nothing;
create or replace rule operations_request_stage_events_no_update as on update to operations.request_stage_events do instead nothing;
create or replace rule operations_request_stage_events_no_delete as on delete to operations.request_stage_events do instead nothing;
create or replace rule operations_approval_history_no_update as on update to operations.vehicle_approval_history do instead nothing;
create or replace rule operations_approval_history_no_delete as on delete to operations.vehicle_approval_history do instead nothing;

create table if not exists operations.event_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  source_system text not null default 'operations',
  entity_type text not null,
  entity_id text,
  request_no text,
  vehicle_id uuid references operations.vehicles(id),
  vin text,
  actor_id uuid references core.users(id),
  source_branch_id uuid references core.branches(id),
  destination_branch_id uuid references core.branches(id),
  target_roles text[] not null default '{}',
  target_user_ids uuid[] not null default '{}',
  title text not null,
  description text,
  internal_path text,
  metadata jsonb not null default '{}'::jsonb,
  processing_status text not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists operations_event_outbox_pending_idx on operations.event_outbox(processing_status,available_at,created_at);
create index if not exists operations_event_outbox_entity_idx on operations.event_outbox(entity_type,entity_id,created_at desc);

insert into core.permissions(code,name,system_code) values
('operations.view','عرض العمليات','operations'),
('operations.vehicles.view','عرض السيارات','operations'),
('operations.vehicles.create','إضافة سيارة','operations'),
('operations.vehicles.update','تعديل سيارة','operations'),
('operations.vehicles.change_vin','تغيير رقم الهيكل','operations'),
('operations.vehicles.import','استيراد السيارات','operations'),
('operations.vehicles.export','تصدير السيارات','operations'),
('operations.movements.execute','تنفيذ حركة فردية','operations'),
('operations.movements.bulk','تنفيذ حركة جماعية','operations'),
('operations.movements.view','عرض سجل الحركات','operations'),
('operations.movements.export','تصدير سجل الحركات','operations'),
('operations.requests.create','إنشاء طلب نقل أو تصوير','operations'),
('operations.requests.view_outgoing','عرض الطلبات الصادرة','operations'),
('operations.requests.view_incoming','عرض الطلبات الواردة','operations'),
('operations.requests.view_all','عرض جميع الطلبات','operations'),
('operations.requests.receive_order','تنفيذ مرحلة استلام الطلب','operations'),
('operations.requests.send_vehicle','تنفيذ مرحلة إرسال السيارة','operations'),
('operations.requests.receive_vehicle','تنفيذ مرحلة استلام السيارة','operations'),
('operations.requests.complete','تنفيذ مرحلة انتهاء الطلب','operations'),
('operations.requests.delete','حذف الطلب قبل بدء التنفيذ','operations'),
('operations.requests.cancel','إلغاء الطلب','operations'),
('operations.checks.update','تعديل التشيك','operations'),
('operations.shortages.update','تعديل الحجز والنواقص وتحديد المكان','operations'),
('operations.approvals.view','عرض كارت الموافقة المالية والإدارية','operations'),
('operations.approvals.financial','تنفيذ الموافقة المالية','operations'),
('operations.approvals.administrative','تنفيذ الموافقة الإدارية','operations'),
('operations.approvals.revert','التراجع عن الموافقات','operations'),
('operations.approvals.notes','تعديل ملاحظات الموافقات','operations'),
('operations.archive','أرشفة السيارات','operations'),
('operations.archive.view','عرض الأرشيف','operations'),
('operations.tracking.view','عرض حالة التراكينج','operations'),
('operations.tracking.open','فتح طلب التراكينج','operations'),
('operations.audit.view','عرض سجل التدقيق','operations'),
('operations.settings.manage','إدارة إعدادات العمليات','operations')
on conflict (code) do update set name=excluded.name,system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id
from core.roles r
cross join core.permissions p
where r.code='system_admin'
on conflict do nothing;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id
from core.roles r
join core.permissions p on p.code in (
  'operations.view','operations.vehicles.view','operations.movements.view',
  'operations.requests.create','operations.requests.view_outgoing','operations.requests.view_incoming',
  'operations.tracking.view'
)
where r.code in ('sales_manager','branch_manager','operations_user')
on conflict do nothing;
