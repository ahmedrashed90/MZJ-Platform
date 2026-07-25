import { getSql, runSqlScript, withDatabaseAdvisoryLock } from "./_db.js";

let ready: Promise<void> | null = null;
let readyTableOid: string | null = null;

const MARKETING_DEPARTMENT_ACCESS_SQL = String.raw`begin;

alter table marketing.departments add column if not exists core_department_id uuid;

do $marketing_department_core_fk$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname='marketing_departments_core_department_fk'
      and conrelid='marketing.departments'::regclass
  ) then
    alter table marketing.departments
      add constraint marketing_departments_core_department_fk
      foreign key(core_department_id) references core.departments(id) on delete restrict;
  end if;
end
$marketing_department_core_fk$;

-- Reuse an existing dedicated marketing department when it is unambiguous.
update marketing.departments md
set core_department_id=(
  select cd.id
  from core.departments cd
  where cd.system_code='marketing'
    and translate(regexp_replace(lower(trim(cd.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
      = translate(regexp_replace(lower(trim(md.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
    and not exists(
      select 1 from marketing.departments linked
      where linked.core_department_id=cd.id and linked.id<>md.id
    )
  order by cd.is_active desc,cd.created_at,cd.id
  limit 1
)
where md.core_department_id is null
  and exists(
    select 1
    from core.departments cd
    where cd.system_code='marketing'
      and translate(regexp_replace(lower(trim(cd.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
        = translate(regexp_replace(lower(trim(md.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
      and not exists(
        select 1 from marketing.departments linked
        where linked.core_department_id=cd.id and linked.id<>md.id
      )
  );

-- Every marketing department gets one canonical row in the central directory.
insert into core.departments(code,name,system_code,is_active)
select 'marketing_'||left(replace(md.id::text,'-',''),20),md.name,'marketing',md.is_active
from marketing.departments md
where md.core_department_id is null
on conflict(code) do update set
  name=excluded.name,
  system_code='marketing',
  is_active=excluded.is_active,
  updated_at=now();

update marketing.departments md
set core_department_id=cd.id
from core.departments cd
where md.core_department_id is null
  and cd.code='marketing_'||left(replace(md.id::text,'-',''),20);

update core.departments cd
set name=md.name,system_code='marketing',is_active=md.is_active,updated_at=now()
from marketing.departments md
where md.core_department_id=cd.id
  and (
    cd.name is distinct from md.name
    or cd.system_code is distinct from 'marketing'
    or cd.is_active is distinct from md.is_active
  );

create unique index if not exists marketing_departments_core_department_uidx
  on marketing.departments(core_department_id)
  where core_department_id is not null;

-- Old data may point to a generic department row (system_code is null) or to a
-- duplicate marketing row. Move every marketing membership with the same visible
-- department name to the canonical row. This is the missing case that caused a
-- user to appear only in the primary department.
with source_links as (
  select distinct
    source.id as source_id,
    md.core_department_id as canonical_id
  from marketing.departments md
  join core.departments source
    on source.id<>md.core_department_id
   and translate(regexp_replace(lower(trim(source.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
     = translate(regexp_replace(lower(trim(md.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
  where md.core_department_id is not null
)
insert into core.user_system_departments(user_id,system_code,department_id,is_primary)
select usd.user_id,'marketing',links.canonical_id,usd.is_primary
from source_links links
join core.user_system_departments usd
  on usd.department_id=links.source_id
 and usd.system_code='marketing'
on conflict(user_id,system_code,department_id) do update
set is_primary=core.user_system_departments.is_primary or excluded.is_primary;

with source_links as (
  select distinct
    source.id as source_id,
    md.core_department_id as canonical_id
  from marketing.departments md
  join core.departments source
    on source.id<>md.core_department_id
   and translate(regexp_replace(lower(trim(source.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
     = translate(regexp_replace(lower(trim(md.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
  where md.core_department_id is not null
)
delete from core.user_system_departments usd
using source_links links
where usd.system_code='marketing'
  and usd.department_id=links.source_id;

-- Import legacy assignments only for users who have never been configured from
-- the centralized users and permissions screen.
with legacy_memberships as (
  select
    du.user_id,
    md.core_department_id as department_id,
    row_number() over(
      partition by du.user_id
      order by md.is_content desc,md.name,md.id
    )=1 as is_primary
  from marketing.department_users du
  join marketing.departments md on md.id=du.department_id and md.is_active=true
  join core.user_systems us
    on us.user_id=du.user_id
   and us.system_code='marketing'
   and us.is_enabled=true
  where md.core_department_id is not null
    and not exists(
      select 1
      from core.user_system_departments current_membership
      where current_membership.user_id=du.user_id
        and current_membership.system_code='marketing'
    )
)
insert into core.user_system_departments(user_id,system_code,department_id,is_primary)
select user_id,'marketing',department_id,is_primary
from legacy_memberships
on conflict(user_id,system_code,department_id) do nothing;

insert into core.user_departments(user_id,department_id,is_primary)
select user_id,department_id,is_primary
from core.user_system_departments
where system_code='marketing'
on conflict(user_id,department_id) do update
set is_primary=core.user_departments.is_primary or excluded.is_primary;

-- Remove stale global-directory rows only when no system still uses them.
with source_links as (
  select distinct source.id as source_id
  from marketing.departments md
  join core.departments source
    on source.id<>md.core_department_id
   and translate(regexp_replace(lower(trim(source.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
     = translate(regexp_replace(lower(trim(md.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
  where md.core_department_id is not null
)
delete from core.user_departments ud
using source_links links
where ud.department_id=links.source_id
  and not exists(
    select 1
    from core.user_system_departments usd
    where usd.user_id=ud.user_id and usd.department_id=ud.department_id
  );

-- Duplicate dedicated marketing rows are hidden from the marketing permissions
-- picker after their memberships have been moved. Generic shared rows are left
-- untouched because another system may still use them.
with duplicate_marketing_rows as (
  select distinct duplicate.id
  from marketing.departments md
  join core.departments duplicate
    on duplicate.system_code='marketing'
   and duplicate.id<>md.core_department_id
   and translate(regexp_replace(lower(trim(duplicate.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
     = translate(regexp_replace(lower(trim(md.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
)
update core.departments duplicate
set is_active=false,updated_at=now()
from duplicate_marketing_rows stale
where duplicate.id=stale.id;

-- One read model for every marketing page. Membership comes only from the
-- centralized user_system_departments table; primary department is not used as a
-- filter. Name matching remains as a safe fallback for historical generic rows.
create or replace view marketing.department_memberships as
select
  md.id as department_id,
  usd.user_id,
  bool_or(usd.is_primary) as is_primary
from marketing.departments md
join core.user_system_departments usd on usd.system_code='marketing'
join core.user_systems us
  on us.user_id=usd.user_id
 and us.system_code='marketing'
 and us.is_enabled=true
join core.departments assigned on assigned.id=usd.department_id
where md.is_active=true
  and (
    usd.department_id=md.core_department_id
    or translate(regexp_replace(lower(trim(assigned.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
      = translate(regexp_replace(lower(trim(md.name)),'[[:space:]]+','','g'),chr(8203)||chr(8204)||chr(8205)||chr(65279),'')
  )
group by md.id,usd.user_id;

commit;`;

async function currentMarketingDepartmentsOid() {
  const sql = getSql();
  const [row] = await sql<{ oid: string | null }[]>`
    select case
      when to_regclass('marketing.departments') is null then null
      else (to_regclass('marketing.departments')::oid)::text
    end as oid
  `;
  return row?.oid || null;
}

export async function ensureMarketingDepartmentAccess() {
  const tableOid = await currentMarketingDepartmentsOid();
  if (!tableOid) return;
  if (readyTableOid !== tableOid) {
    ready = null;
    readyTableOid = tableOid;
  }
  if (!ready) {
    ready = withDatabaseAdvisoryLock("marketing-department-access-v1197", () => runSqlScript(MARKETING_DEPARTMENT_ACCESS_SQL)).catch((error) => {
      ready = null;
      throw error;
    });
  }
  await ready;
}

export { MARKETING_DEPARTMENT_ACCESS_SQL };
