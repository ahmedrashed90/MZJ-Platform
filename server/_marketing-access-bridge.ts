import { getSql, runSqlScript, withDatabaseAdvisoryLock } from "./_db.js";

let ready: Promise<void> | null = null;
let readyTableOid: string | null = null;

const MARKETING_ACCESS_BRIDGE_SQL = String.raw`begin;

alter table marketing.departments add column if not exists core_department_id uuid;

do $marketing_department_core_fk$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'marketing_departments_core_department_fk'
      and conrelid = 'marketing.departments'::regclass
  ) then
    alter table marketing.departments
      add constraint marketing_departments_core_department_fk
      foreign key(core_department_id) references core.departments(id) on delete restrict;
  end if;
end
$marketing_department_core_fk$;

create unique index if not exists marketing_departments_core_department_uq
on marketing.departments(core_department_id)
where core_department_id is not null;

do $marketing_department_core_link$
declare
  department_row record;
  linked_core_id uuid;
begin
  for department_row in
    select id,name,is_active,core_department_id
    from marketing.departments
    order by created_at,id
  loop
    linked_core_id := department_row.core_department_id;

    if linked_core_id is null then
      select core_department.id
      into linked_core_id
      from core.departments core_department
      where core_department.system_code='marketing'
        and lower(trim(core_department.name))=lower(trim(department_row.name))
        and not exists (
          select 1
          from marketing.departments linked_department
          where linked_department.core_department_id=core_department.id
        )
      order by core_department.created_at,core_department.id
      limit 1;
    end if;

    if linked_core_id is null then
      insert into core.departments(code,name,system_code,is_active)
      values(
        'marketing_' || substr(replace(department_row.id::text,'-',''),1,12),
        department_row.name,
        'marketing',
        department_row.is_active
      )
      on conflict(code) do update set
        name=excluded.name,
        system_code='marketing',
        is_active=excluded.is_active,
        updated_at=now()
      returning id into linked_core_id;
    else
      update core.departments
      set name=department_row.name,
          system_code='marketing',
          is_active=department_row.is_active,
          updated_at=now()
      where id=linked_core_id;
    end if;

    update marketing.departments
    set core_department_id=linked_core_id
    where id=department_row.id
      and core_department_id is distinct from linked_core_id;
  end loop;
end
$marketing_department_core_link$;

with legacy_memberships as (
  select
    department_user.user_id,
    department.core_department_id as department_id,
    row_number() over (
      partition by department_user.user_id
      order by department.is_content desc,department.name,department.id
    ) as membership_order
  from marketing.department_users department_user
  join marketing.departments department on department.id=department_user.department_id
  join core.user_systems user_system
    on user_system.user_id=department_user.user_id
   and user_system.system_code='marketing'
   and user_system.is_enabled=true
  where department.core_department_id is not null
)
insert into core.user_system_departments(user_id,system_code,department_id,is_primary)
select
  membership.user_id,
  'marketing',
  membership.department_id,
  membership.membership_order=1
    and not exists (
      select 1
      from core.user_system_departments existing
      where existing.user_id=membership.user_id
        and existing.system_code='marketing'
    )
from legacy_memberships membership
on conflict(user_id,system_code,department_id) do nothing;

update core.departments placeholder
set is_active=false,updated_at=now()
where placeholder.code='marketing'
  and placeholder.system_code='marketing'
  and not exists (
    select 1
    from marketing.departments department
    where department.core_department_id=placeholder.id
  )
  and exists (select 1 from marketing.departments);

delete from core.user_system_departments user_department
using core.departments placeholder
where user_department.department_id=placeholder.id
  and user_department.system_code='marketing'
  and placeholder.code='marketing'
  and placeholder.system_code='marketing'
  and placeholder.is_active=false
  and not exists (
    select 1
    from marketing.departments department
    where department.core_department_id=placeholder.id
  );

delete from core.user_system_departments user_department
using core.departments core_department
where user_department.department_id=core_department.id
  and user_department.system_code='marketing'
  and core_department.system_code='marketing'
  and core_department.is_active=false;

delete from core.user_departments user_department
using core.departments placeholder
where user_department.department_id=placeholder.id
  and placeholder.code='marketing'
  and placeholder.system_code='marketing'
  and placeholder.is_active=false
  and not exists (
    select 1
    from marketing.departments department
    where department.core_department_id=placeholder.id
  );

with ranked as (
  select
    user_department.user_id,
    user_department.department_id,
    row_number() over (
      partition by user_department.user_id
      order by user_department.is_primary desc,core_department.name,user_department.department_id
    ) as department_order
  from core.user_system_departments user_department
  join core.departments core_department on core_department.id=user_department.department_id
  where user_department.system_code='marketing'
    and core_department.system_code='marketing'
    and core_department.is_active=true
)
update core.user_system_departments target
set is_primary=(ranked.department_order=1)
from ranked
where target.user_id=ranked.user_id
  and target.system_code='marketing'
  and target.department_id=ranked.department_id
  and target.is_primary is distinct from (ranked.department_order=1);

delete from core.user_departments user_department
using core.departments core_department
where user_department.department_id=core_department.id
  and core_department.system_code='marketing';

insert into core.user_departments(user_id,department_id,is_primary)
select
  user_department.user_id,
  user_department.department_id,
  bool_or(user_department.is_primary)
from core.user_system_departments user_department
join core.departments core_department on core_department.id=user_department.department_id
where user_department.system_code='marketing'
  and core_department.system_code='marketing'
  and core_department.is_active=true
group by user_department.user_id,user_department.department_id
on conflict(user_id,department_id) do update set is_primary=excluded.is_primary;

delete from marketing.department_users projection
where not exists (
  select 1
  from marketing.departments department
  join core.user_system_departments user_department
    on user_department.department_id=department.core_department_id
   and user_department.system_code='marketing'
  join core.user_systems user_system
    on user_system.user_id=user_department.user_id
   and user_system.system_code='marketing'
   and user_system.is_enabled=true
  join core.users platform_user
    on platform_user.id=user_department.user_id
   and platform_user.is_active=true
  where department.id=projection.department_id
    and user_department.user_id=projection.user_id
    and department.is_active=true
);

insert into marketing.department_users(department_id,user_id)
select department.id,user_department.user_id
from marketing.departments department
join core.user_system_departments user_department
  on user_department.department_id=department.core_department_id
 and user_department.system_code='marketing'
join core.user_systems user_system
  on user_system.user_id=user_department.user_id
 and user_system.system_code='marketing'
 and user_system.is_enabled=true
join core.users platform_user
  on platform_user.id=user_department.user_id
 and platform_user.is_active=true
where department.is_active=true
on conflict(department_id,user_id) do nothing;

commit;`;

export async function ensureMarketingAccessBridge() {
  const sql = getSql();
  const [state] = await sql<{ table_oid: string | null }[]>`
    select relation.oid::text as table_oid
    from pg_class relation
    join pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='marketing'
      and relation.relname='departments'
      and relation.relkind in ('r','p')
    limit 1
  `;
  const tableOid=String(state?.table_oid || "").trim();
  if (!tableOid) return;
  if (readyTableOid!==tableOid) {
    ready=null;
    readyTableOid=tableOid;
  }

  if (!ready) {
    ready = withDatabaseAdvisoryLock("mzj:marketing-access-bridge:v1", async () => {
      await runSqlScript(MARKETING_ACCESS_BRIDGE_SQL);
    }).catch((error) => {
      ready = null;
      readyTableOid = null;
      throw error;
    });
  }
  await ready;
}

export async function syncMarketingDepartmentUsersForUsers(database: any, userIds: string[]) {
  const ids = [...new Set(userIds.map((value) => String(value || "").trim()).filter(Boolean))];
  if (!ids.length) return;

  await database`delete from marketing.department_users where user_id in ${database(ids)}`;
  await database`
    insert into marketing.department_users(department_id,user_id)
    select department.id,user_department.user_id
    from core.user_system_departments user_department
    join marketing.departments department
      on department.core_department_id=user_department.department_id
     and department.is_active=true
    join core.user_systems user_system
      on user_system.user_id=user_department.user_id
     and user_system.system_code='marketing'
     and user_system.is_enabled=true
    join core.users platform_user
      on platform_user.id=user_department.user_id
     and platform_user.is_active=true
    where user_department.system_code='marketing'
      and user_department.user_id in ${database(ids)}
    on conflict(department_id,user_id) do nothing
  `;
}

export { MARKETING_ACCESS_BRIDGE_SQL };
