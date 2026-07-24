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
-- Compatibility with partially-created or legacy production tables. CREATE TABLE IF NOT EXISTS
-- does not add newly-required columns to a table that already exists.
alter table operations.vehicle_statuses add column if not exists name text;
alter table operations.vehicle_statuses add column if not exists sort_order integer not null default 0;
alter table operations.vehicle_statuses add column if not exists is_active boolean not null default true;
alter table operations.vehicle_statuses add column if not exists is_actual_stock boolean not null default false;
alter table operations.vehicle_statuses add column if not exists is_delivery_status boolean not null default false;
alter table operations.vehicle_statuses add column if not exists is_terminal boolean not null default false;
alter table operations.vehicle_statuses add column if not exists created_at timestamptz not null default now();
alter table operations.vehicle_statuses add column if not exists updated_at timestamptz not null default now();
update operations.vehicle_statuses set name=coalesce(nullif(trim(name),''),code),updated_at=coalesce(updated_at,now());
alter table operations.vehicle_statuses alter column name set not null;

with seed(code,name,sort_order,is_actual_stock,is_delivery_status,is_terminal) as (values
  ('available_for_sale','متاح للبيع',10,true,false,false),
  ('reserved','حجز',20,true,false,false),
  ('has_notes','بها ملاحظات',30,true,false,false),
  ('under_delivery','مباع تحت التسليم',40,false,true,false),
  ('delivered','مباع تم التسليم',50,false,true,true)
)
update operations.vehicle_statuses s
set name=seed.name,sort_order=seed.sort_order,is_actual_stock=seed.is_actual_stock,
    is_delivery_status=seed.is_delivery_status,is_terminal=seed.is_terminal,is_active=true,updated_at=now()
from seed where s.code=seed.code;

with seed(code,name,sort_order,is_actual_stock,is_delivery_status,is_terminal) as (values
  ('available_for_sale','متاح للبيع',10,true,false,false),
  ('reserved','حجز',20,true,false,false),
  ('has_notes','بها ملاحظات',30,true,false,false),
  ('under_delivery','مباع تحت التسليم',40,false,true,false),
  ('delivered','مباع تم التسليم',50,false,true,true)
)
insert into operations.vehicle_statuses(code,name,sort_order,is_actual_stock,is_delivery_status,is_terminal,is_active)
select seed.code,seed.name,seed.sort_order,seed.is_actual_stock,seed.is_delivery_status,seed.is_terminal,true
from seed where not exists (select 1 from operations.vehicle_statuses s where s.code=seed.code);

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
alter table operations.vehicle_status_notes add column if not exists movement_id uuid;
alter table operations.vehicle_status_notes add column if not exists created_by uuid references core.users(id);
alter table operations.vehicle_status_notes add column if not exists created_by_name text;
alter table operations.vehicle_status_notes add column if not exists created_at timestamptz not null default now();
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
-- Upgrade older production copies of the history table in place. CREATE TABLE IF NOT EXISTS
-- does not add columns to a table that already exists.
alter table operations.vehicle_check_history add column if not exists vehicle_id uuid references operations.vehicles(id);
alter table operations.vehicle_check_history add column if not exists item_code text;
alter table operations.vehicle_check_history add column if not exists old_status text;
alter table operations.vehicle_check_history add column if not exists new_status text;
alter table operations.vehicle_check_history add column if not exists note text;
alter table operations.vehicle_check_history add column if not exists movement_id uuid;
alter table operations.vehicle_check_history add column if not exists changed_by uuid references core.users(id);
alter table operations.vehicle_check_history add column if not exists changed_by_name text;
alter table operations.vehicle_check_history add column if not exists created_at timestamptz not null default now();

-- Production compatibility: an older copy of vehicle_check_history referenced
-- operations.check_items. The native operations module uses the canonical
-- operations.check_item_definitions table. Preserve every historical code,
-- then repoint the foreign key to the canonical table before movements write.
insert into operations.check_item_definitions(code,name,sort_order,is_active)
select distinct h.item_code,h.item_code,1000,true
from operations.vehicle_check_history h
where nullif(trim(h.item_code),'') is not null
on conflict (code) do nothing;
do $operations_check_history_fk$
declare
  fk record;
  canonical_fk_exists boolean := false;
begin
  for fk in
    select c.conname,n_ref.nspname as ref_schema,t_ref.relname as ref_table
    from pg_constraint c
    join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    join pg_class t_ref on t_ref.oid=c.confrelid
    join pg_namespace n_ref on n_ref.oid=t_ref.relnamespace
    where n.nspname='operations' and t.relname='vehicle_check_history' and c.contype='f'
      and exists (
        select 1 from unnest(c.conkey) as k(attnum)
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
        where a.attname='item_code'
      )
  loop
    if fk.ref_schema='operations' and fk.ref_table='check_item_definitions' then
      canonical_fk_exists := true;
    else
      execute format('alter table operations.vehicle_check_history drop constraint %I',fk.conname);
    end if;
  end loop;
  if not canonical_fk_exists then
    alter table operations.vehicle_check_history
      add constraint vehicle_check_history_item_code_fkey
      foreign key (item_code) references operations.check_item_definitions(code);
  end if;
end
$operations_check_history_fk$;
create index if not exists operations_vehicle_check_history_idx on operations.vehicle_check_history(vehicle_id,created_at desc);

alter table operations.vehicle_approvals add column if not exists cycle_no integer not null default 1;
alter table operations.vehicle_approvals add column if not exists financial_note text;
alter table operations.vehicle_approvals add column if not exists administrative_note text;
alter table operations.vehicle_approvals add column if not exists financial_approved_at timestamptz;
alter table operations.vehicle_approvals add column if not exists administrative_approved_at timestamptz;
alter table operations.vehicle_approvals add column if not exists financial_approved_by_name text;
alter table operations.vehicle_approvals add column if not exists administrative_approved_by_name text;
alter table operations.vehicle_approvals add column if not exists pending_delivery jsonb;
alter table operations.vehicle_approvals add column if not exists is_active boolean not null default true;
alter table operations.vehicle_approvals add column if not exists created_at timestamptz not null default now();

-- Remove legacy one-row-per-vehicle uniqueness. Approval history is cycle-based:
-- only the current active cycle is unique, while prior inactive cycles remain.
alter table operations.vehicle_approvals drop constraint if exists operations_vehicle_current_approval_unique;
drop index if exists operations.operations_vehicle_current_approval_unique;
do $operations_approval_legacy_unique$
declare
  legacy_constraint record;
  legacy_index record;
begin
  for legacy_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid='operations.vehicle_approvals'::regclass
      and c.contype='u'
      and regexp_replace(pg_get_constraintdef(c.oid),'\s+','','g')='UNIQUE(vehicle_id)'
  loop
    execute format('alter table operations.vehicle_approvals drop constraint %I',legacy_constraint.conname);
  end loop;

  for legacy_index in
    select ns.nspname as schema_name,idx.relname as index_name
    from pg_index i
    join pg_class tbl on tbl.oid=i.indrelid
    join pg_class idx on idx.oid=i.indexrelid
    join pg_namespace ns on ns.oid=idx.relnamespace
    where i.indrelid='operations.vehicle_approvals'::regclass
      and i.indisunique=true
      and i.indisprimary=false
      and i.indpred is null
      and i.indnkeyatts=1
      and i.indkey[0]=(select attnum from pg_attribute where attrelid=i.indrelid and attname='vehicle_id' and not attisdropped)
  loop
    execute format('drop index if exists %I.%I',legacy_index.schema_name,legacy_index.index_name);
  end loop;
end
$operations_approval_legacy_unique$;

with ranked as (
  select id,row_number() over(partition by vehicle_id order by created_at desc,id desc) as row_no
  from operations.vehicle_approvals where is_active=true
) update operations.vehicle_approvals a set is_active=false from ranked r where a.id=r.id and r.row_no>1;
create unique index if not exists operations_vehicle_approvals_active_unique on operations.vehicle_approvals(vehicle_id) where is_active=true;

create table if not exists operations.approval_events (
  id bigserial primary key,
  approval_id uuid references operations.vehicle_approvals(id),
  vehicle_id uuid not null references operations.vehicles(id),
  cycle_no integer not null default 1,
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
-- One canonical compatibility definition for native approval events. This upgrades legacy
-- tables without deleting their rows and replaces the old action constraint that rejected
-- the native actions used by the API.
alter table operations.approval_events add column if not exists approval_id uuid references operations.vehicle_approvals(id);
alter table operations.approval_events add column if not exists vehicle_id uuid references operations.vehicles(id);
alter table operations.approval_events add column if not exists cycle_no integer;
alter table operations.approval_events add column if not exists approval_type text;
alter table operations.approval_events add column if not exists action text;
alter table operations.approval_events add column if not exists note text;
alter table operations.approval_events add column if not exists actor_id uuid references core.users(id);
alter table operations.approval_events add column if not exists actor_name text;
alter table operations.approval_events add column if not exists actor_role text;
alter table operations.approval_events add column if not exists before_data jsonb;
alter table operations.approval_events add column if not exists after_data jsonb;
alter table operations.approval_events add column if not exists created_at timestamptz default now();
update operations.approval_events e
set cycle_no=coalesce(a.cycle_no,1)
from operations.vehicle_approvals a
where e.approval_id=a.id and (e.cycle_no is null or e.cycle_no<1);
update operations.approval_events set cycle_no=1 where cycle_no is null or cycle_no<1;
alter table operations.approval_events alter column cycle_no set default 1;
alter table operations.approval_events alter column cycle_no set not null;
update operations.approval_events set created_at=now() where created_at is null;
alter table operations.approval_events alter column created_at set default now();
alter table operations.approval_events drop constraint if exists approval_events_action_check;
do $approval_events_native_action$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid='operations.approval_events'::regclass
      and conname='approval_events_action_native_check'
  ) then
    alter table operations.approval_events
      add constraint approval_events_action_native_check
      check (action in ('approve','revert','note','reset')) not valid;
  end if;
end
$approval_events_native_action$;
create index if not exists operations_approval_events_vehicle_idx on operations.approval_events(vehicle_id,created_at desc);

create table if not exists operations.movement_batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text not null default ('MB-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
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
alter table operations.movement_batches add column if not exists batch_no text;
update operations.movement_batches
set batch_no='MB-LEGACY-' || upper(substr(replace(id::text,'-',''),1,12))
where batch_no is null or btrim(batch_no)='';
alter table operations.movement_batches alter column batch_no set default ('MB-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)));
alter table operations.movement_batches alter column batch_no set not null;
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
create index if not exists operations_movements_vehicle_time_idx on operations.movements(vehicle_id,created_at desc);
create index if not exists operations_movements_batch_idx on operations.movements(batch_id);

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
create index if not exists operations_transfer_requests_status_idx on operations.transfer_requests(request_kind,status,is_deleted,requested_at desc);

alter table operations.transfer_request_vehicles add column if not exists transfer_request_id uuid references operations.transfer_requests(id) on delete cascade;
alter table operations.transfer_request_vehicles add column if not exists vehicle_id uuid references operations.vehicles(id) on delete cascade;
alter table operations.transfer_request_vehicles add column if not exists source_location_id uuid references operations.locations(id);
alter table operations.transfer_request_vehicles add column if not exists source_status text;
alter table operations.transfer_request_vehicles add column if not exists item_note text;
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
-- Legacy versions used other request-link columns and sometimes marked them NOT NULL.
-- They must not block new native events after transfer_request_id is added.
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
-- Compatibility with any partially-created or legacy outbox table. The three
-- critical flows (movement, transfer requests, tracking delete) must never fail
-- because an optional notification table is missing a newer column.
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
