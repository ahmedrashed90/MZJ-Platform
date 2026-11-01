-- Operations Native V2 compatibility fix for an existing vehicle_statuses table.
-- Safe and idempotent: no rows are deleted.
begin;

create schema if not exists operations;
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

commit;
