-- ربط المواقع والفروع التشغيلية بدليل الفروع المركزي من نفس مصدر البيانات.
-- نطاق حالات السيارات محفوظ داخل core.user_systems.settings الموجود أصلًا؛ لذلك لا يحتاج جدول صلاحيات إضافيًا.

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
