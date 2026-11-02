-- Apply once on the production database after deploying the new permission catalog.
-- Grants exactly one account (if active); does not alter existing role permissions.
-- Revocation remains possible from central user permission settings.
begin;

-- Fail clearly rather than silently granting nobody or multiple lookalike users.
do $$
declare target_count integer;
begin
  select count(*) into target_count from core.users u
  where u.is_active=true and lower(btrim(u.email))='mr.ahmed_rashed@outlook.sa';
  if target_count<>1 then
    raise exception 'Expected one active attendance correction account, found %',target_count;
  end if;
end $$;

insert into core.permissions(code,name,system_code,page_code,action_code,name_ar,description_ar,category,is_sensitive,sort_order,is_active)
values ('attendance.records.correct','تصحيح سجلات الحضور والانصراف','core','attendance','correct',
  'تصحيح سجلات الحضور والانصراف','تصحيح بصمات الحضور مع سبب وسجل تدقيق','action',true,8651,true)
on conflict(code) do update set is_active=true;

with target as (
  select u.id as user_id, p.id as permission_id
  from core.users u cross join core.permissions p
  where lower(btrim(u.email))='mr.ahmed_rashed@outlook.sa'
    and u.is_active=true and p.code='attendance.records.correct' and p.is_active=true
    and (select count(*) from core.users exact_user
         where exact_user.is_active=true
           and lower(btrim(exact_user.email))='mr.ahmed_rashed@outlook.sa')=1
), granted as (
  insert into core.user_permission_overrides(user_id,permission_id,effect,reason,created_by)
  select user_id,permission_id,'allow','صلاحية تصحيح الحضور لمدير النظام المعتمد',null
  from target
  on conflict(user_id,permission_id) do nothing
  returning user_id
)
insert into core.permission_change_log(target_user_id,changed_by,change_type,permission_code,reason)
select user_id,null,'attendance_correction_permission_granted','attendance.records.correct',
  'منح صلاحية التصحيح للحساب المحدد دون تعميمها على مديري النظام'
from granted;

commit;

-- Verification (read-only):
-- select u.email,o.effect from core.user_permission_overrides o
-- join core.users u on u.id=o.user_id join core.permissions p on p.id=o.permission_id
-- where p.code='attendance.records.correct';
