-- MZJ Platform v1.13.4
-- Clean native operations rebuild migration.
-- Run first on a staging copy after a database backup.
-- Idempotent: safe to run more than once.

BEGIN;
SELECT pg_advisory_xact_lock(hashtext('mzj_operations_clean_rebuild_v1'));

create schema if not exists operations;

create schema if not exists audit;

create table if not exists operations.locations (
    id uuid primary key default gen_random_uuid(),
    code text not null unique,
    name text not null,
    sort_order integer not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
  );

insert into operations.locations(code,name,sort_order) values
    ('warehouse','المستودع',10),('agency','الوكالة',20),('hall','الصالة',30),('qadisiyah','القادسية',40),('multaqa','الملتقى',50)
    on conflict(code) do update set name=excluded.name,sort_order=excluded.sort_order;

create table if not exists operations.vehicles (
    id uuid primary key default gen_random_uuid(),
    vin text not null unique,
    car_name text, statement text, agent_name text, exterior_color text, interior_color text, model_year text, plate_no text, batch_no text,
    location_id uuid references operations.locations(id),
    status_code text not null default 'available_for_sale',
    source_type text, has_notes boolean not null default false, notes text, is_deleted boolean not null default false,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );

create table if not exists operations.vehicle_approvals (
    id uuid primary key default gen_random_uuid(), vehicle_id uuid not null references operations.vehicles(id),
    financial_approved boolean not null default false, administrative_approved boolean not null default false,
    financial_approved_by uuid references core.users(id), administrative_approved_by uuid references core.users(id), updated_at timestamptz not null default now()
  );

create table if not exists operations.vehicle_shortages (
    id uuid primary key default gen_random_uuid(), vehicle_id uuid not null references operations.vehicles(id), shortage_type text not null, note text,
    is_resolved boolean not null default false, resolved_by uuid references core.users(id), resolved_at timestamptz, created_at timestamptz not null default now()
  );

create table if not exists operations.transfer_requests (
    id uuid primary key default gen_random_uuid(), request_no text unique, department_code text, transfer_type text,
    source_location_id uuid references operations.locations(id), destination_location_id uuid references operations.locations(id),
    status text not null default 'request_received', requested_by uuid references core.users(id), requested_at timestamptz not null default now(), completed_at timestamptz
  );

create table if not exists operations.transfer_request_vehicles (
    transfer_request_id uuid not null references operations.transfer_requests(id), vehicle_id uuid not null references operations.vehicles(id),
    primary key(transfer_request_id,vehicle_id)
  );

create table if not exists operations.movements (
    id uuid primary key default gen_random_uuid(), vehicle_id uuid not null references operations.vehicles(id),
    from_location_id uuid references operations.locations(id), to_location_id uuid references operations.locations(id),
    old_status text, new_status text, note text, performed_by uuid references core.users(id), created_at timestamptz not null default now()
  );

create table if not exists operations.vehicle_statuses (
    code text primary key,
    name text not null unique,
    sort_order integer not null default 0,
    is_inventory boolean not null default true,
    requires_note boolean not null default false,
    requires_approvals boolean not null default false,
    is_final boolean not null default false,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

insert into operations.vehicle_statuses(code,name,sort_order,is_inventory,requires_note,requires_approvals,is_final) values
    ('available_for_sale','متاح للبيع',10,true,false,false,false),
    ('reserved','حجز',20,true,false,false,false),
    ('has_notes','بها ملاحظات',30,true,true,false,false),
    ('under_delivery','مباع تحت التسليم',40,false,false,true,false),
    ('delivered','مباع تم التسليم',50,false,false,false,true)
   on conflict (code) do update set name=excluded.name,sort_order=excluded.sort_order,is_inventory=excluded.is_inventory,
     requires_note=excluded.requires_note,requires_approvals=excluded.requires_approvals,is_final=excluded.is_final,is_active=true,updated_at=now();

update operations.vehicles set status_code=case
     when btrim(coalesce(status_code,'')) in ('','متاح','متاح للبيع') then 'available_for_sale'
     when btrim(status_code) in ('حجز','محجوز') then 'reserved'
     when btrim(status_code)='بها ملاحظات' then 'has_notes'
     when btrim(status_code)='مباع تحت التسليم' then 'under_delivery'
     when btrim(status_code)='مباع تم التسليم' then 'delivered'
     else status_code end;

alter table operations.locations add column if not exists updated_at timestamptz not null default now();

create table if not exists operations.location_branches (
    location_id uuid not null references operations.locations(id) on delete cascade,
    branch_id uuid not null references core.branches(id) on delete cascade,
    primary key(location_id,branch_id)
  );

insert into operations.location_branches(location_id,branch_id)
   select l.id,b.id from operations.locations l join core.branches b on b.code=l.code on conflict do nothing;

alter table operations.vehicles add column if not exists status_note text;

alter table operations.vehicles add column if not exists shortage_location_note text;

alter table operations.vehicles add column if not exists created_by uuid references core.users(id);

alter table operations.vehicles add column if not exists updated_by uuid references core.users(id);

alter table operations.vehicles add column if not exists archived_at timestamptz;

alter table operations.vehicles add column if not exists archived_by uuid references core.users(id);

alter table operations.vehicles add column if not exists archive_reason text;

alter table operations.vehicles add column if not exists version integer not null default 1;

create index if not exists operations_vehicles_vin_pattern_idx on operations.vehicles(vin text_pattern_ops);

create index if not exists operations_vehicles_active_search_idx on operations.vehicles(is_deleted,archived_at,location_id,status_code);

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

create index if not exists operations_movements_vehicle_date_idx on operations.movements(vehicle_id,created_at desc);

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

create unique index if not exists operations_vehicle_active_cycle_idx on operations.vehicle_approval_cycles(vehicle_id) where is_active=true;

insert into operations.vehicle_approval_cycles(vehicle_id,cycle_no,is_active,financial_approved,administrative_approved,financial_approved_by,financial_approved_by_name,financial_approved_at,administrative_approved_by,administrative_approved_by_name,administrative_approved_at,started_at,updated_at)
   select distinct on (va.vehicle_id) va.vehicle_id,1,true,va.financial_approved,va.administrative_approved,va.financial_approved_by,fu.full_name,case when va.financial_approved then va.updated_at else null end,va.administrative_approved_by,au.full_name,case when va.administrative_approved then va.updated_at else null end,coalesce(v.created_at,va.updated_at),va.updated_at
   from operations.vehicle_approvals va join operations.vehicles v on v.id=va.vehicle_id
   left join core.users fu on fu.id=va.financial_approved_by left join core.users au on au.id=va.administrative_approved_by
   where v.status_code='under_delivery' and not exists(select 1 from operations.vehicle_approval_cycles c where c.vehicle_id=va.vehicle_id)
   order by va.vehicle_id,va.updated_at desc on conflict do nothing;

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

alter table operations.transfer_request_vehicles add column if not exists source_location_id uuid references operations.locations(id);

alter table operations.transfer_request_vehicles add column if not exists source_status text;

alter table operations.transfer_request_vehicles add column if not exists vehicle_snapshot jsonb not null default '{}'::jsonb;

update operations.transfer_requests set status=case btrim(coalesce(status,''))
     when 'تم استلام الطلب' then 'request_received' when 'تم إرسال السيارة' then 'vehicle_sent' when 'تم استلام السيارة' then 'vehicle_received' when 'تم الانتهاء' then 'completed' when 'ملغي' then 'cancelled' else status end;

create table if not exists operations.transfer_request_events (
    id uuid primary key default gen_random_uuid(),
    transfer_request_id uuid not null references operations.transfer_requests(id),
    stage_code text not null,
    action text not null,
    note text,
    actor_id uuid references core.users(id),
    actor_name text,
    actor_role text,
    actor_branch text,
    before_data jsonb not null default '{}'::jsonb,
    after_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );

create table if not exists operations.vehicle_archives (
    id uuid primary key default gen_random_uuid(),
    vehicle_id uuid not null references operations.vehicles(id),
    reason text not null,
    snapshot jsonb not null default '{}'::jsonb,
    archived_by uuid references core.users(id),
    archived_by_name text,
    archived_at timestamptz not null default now()
  );

create table if not exists operations.import_batches (
    id uuid primary key default gen_random_uuid(),
    mode text not null,
    file_name text,
    total_rows integer not null default 0,
    inserted_rows integer not null default 0,
    updated_rows integer not null default 0,
    skipped_rows integer not null default 0,
    failed_rows integer not null default 0,
    status text not null default 'completed',
    created_by uuid references core.users(id),
    created_by_name text,
    created_at timestamptz not null default now()
  );

create table if not exists operations.import_batch_rows (
    id bigserial primary key,
    batch_id uuid not null references operations.import_batches(id),
    row_number integer not null,
    vin text,
    action text,
    status text not null,
    error_message text,
    row_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );

create index if not exists operations_import_batch_rows_batch_idx on operations.import_batch_rows(batch_id,row_number);

create table if not exists operations.event_outbox (
    id uuid primary key default gen_random_uuid(),
    event_type text not null,
    aggregate_type text not null,
    aggregate_id text not null,
    payload jsonb not null default '{}'::jsonb,
    status text not null default 'pending',
    attempts integer not null default 0,
    created_at timestamptz not null default now(),
    processed_at timestamptz
  );

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
    ('operations.approval.financial','الموافقة المالية','operations'),
    ('operations.approval.administrative','الموافقة الإدارية','operations'),
    ('operations.approval.reset','مسح الموافقات','operations'),
    ('operations.import','استيراد مخزون السيارات','operations'),
    ('operations.import.replace','الاستبدال الكامل لمخزون السيارات','operations'),
    ('operations.export','تصدير بيانات العمليات','operations'),
    ('tracking.orders.delete','حذف طلبات التراكينج','tracking')
   on conflict (code) do update set name=excluded.name,system_code=excluded.system_code;

insert into core.role_permissions(role_id,permission_id)
   select r.id,p.id from core.roles r cross join core.permissions p
   where r.code='admin' and (p.code like 'operations.%' or p.code='tracking.orders.delete') on conflict do nothing;

do $$ begin
     if to_regclass('tracking.order_vehicles') is not null then
       alter table tracking.order_vehicles add column if not exists operations_vehicle_id uuid references operations.vehicles(id);
       create index if not exists tracking_order_vehicles_operations_vehicle_idx on tracking.order_vehicles(operations_vehicle_id);
     end if;
   end $$;
COMMIT;
