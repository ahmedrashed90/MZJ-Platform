-- ربط إعدادات العمليات مع المستخدمين والصلاحيات دون إنشاء مسار بيانات موازٍ.

create table if not exists core.user_system_vehicle_statuses (
  user_id uuid not null references core.users(id) on delete cascade,
  system_code text not null default 'operations',
  status_code text not null,
  created_at timestamptz not null default now(),
  primary key(user_id,system_code,status_code)
);
create index if not exists user_system_vehicle_statuses_lookup_idx
  on core.user_system_vehicle_statuses(system_code,status_code,user_id);

alter table operations.locations
  add column if not exists core_branch_id uuid references core.branches(id) on delete set null;

insert into core.branches(code,name,is_active,sort_order)
select l.code,l.name,l.is_active,l.sort_order
from operations.locations l
on conflict(code) do update set
  name=excluded.name,
  is_active=excluded.is_active,
  sort_order=excluded.sort_order,
  updated_at=now();

update operations.locations l
set core_branch_id=b.id,updated_at=now()
from core.branches b
where b.code=l.code
  and l.core_branch_id is distinct from b.id;

create unique index if not exists operations_locations_core_branch_unique
  on operations.locations(core_branch_id)
  where core_branch_id is not null;
