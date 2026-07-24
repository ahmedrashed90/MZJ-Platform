-- MZJ Platform v1.19.5
-- Safe user account deletion: soft delete, credential release, audit preservation.

begin;

alter table core.users add column if not exists deleted_at timestamptz;
alter table core.users add column if not exists deleted_by uuid references core.users(id);
alter table core.users add column if not exists deleted_reason text;

insert into core.permissions(
  code,name,system_code,page_code,action_code,name_ar,description_ar,category,is_sensitive,sort_order,is_active
) values (
  'settings.users.delete','حذف مستخدم','core','settings','users_delete','حذف مستخدم',
  'حذف الحساب وإزالة بيانات دخوله مع الاحتفاظ بالسجلات السابقة','settings',true,105,true
)
on conflict(code) do update set
  name=excluded.name,
  system_code=excluded.system_code,
  page_code=excluded.page_code,
  action_code=excluded.action_code,
  name_ar=excluded.name_ar,
  description_ar=excluded.description_ar,
  category=excluded.category,
  is_sensitive=excluded.is_sensitive,
  sort_order=excluded.sort_order,
  is_active=true;

insert into core.role_permissions(role_id,permission_id)
select r.id,p.id
from core.roles r
join core.permissions p on p.code='settings.users.delete'
where r.code in ('admin','system_admin')
on conflict do nothing;

commit;
