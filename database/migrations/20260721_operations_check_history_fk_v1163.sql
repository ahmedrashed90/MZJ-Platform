begin;

create table if not exists operations.check_item_definitions (
  code text primary key,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

insert into operations.check_item_definitions(code,name,sort_order,is_active) values
('mats','فرشات',10),('extinguisher','طفاية',20),('safety_bag','شنطة',30),('spare_tire','اسبير',40),
('remote','ريموت',50),('screen','شاشة',60),('radio','مسجل',70),('ac','مكيف',80),('camera','كاميرا',90),('sensor','حساس',100)
on conflict (code) do update set name=excluded.name,sort_order=excluded.sort_order,is_active=true;

alter table operations.vehicle_check_history add column if not exists item_code text;

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

commit;
