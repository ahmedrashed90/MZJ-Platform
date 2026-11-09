begin;
set local lock_timeout = '3s';
set local statement_timeout = '12s';
create table if not exists marketing.work_plan_reviewers (
 slot smallint primary key check(slot in (1,2)),
 user_id uuid not null unique references core.users(id),
 updated_by uuid references core.users(id),
 updated_at timestamptz not null default now()
);
with candidates as (
 select u.id,case when lower(u.email)='mr.ahmed_rashed@outlook.sa' then 1
   when lower(u.email)='ceo@mzjcars.com' then 2 end as slot
 from core.users u join core.user_systems us on us.user_id=u.id
 where u.is_active=true and coalesce(u.is_archived,false)=false
   and us.system_code='marketing' and us.is_enabled=true
   and lower(u.email) in ('mr.ahmed_rashed@outlook.sa','ceo@mzjcars.com')
)
insert into marketing.work_plan_reviewers(slot,user_id)
select slot,id from candidates where (select count(*) from candidates)=2
on conflict do nothing;
insert into marketing.workflow_migrations(code) values('schema-15') on conflict do nothing;
commit;
