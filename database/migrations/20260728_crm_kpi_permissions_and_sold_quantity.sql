begin;

alter table crm.leads
  add column if not exists sold_quantity integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'crm_leads_sold_quantity_positive'
      and conrelid = 'crm.leads'::regclass
  ) then
    alter table crm.leads
      add constraint crm_leads_sold_quantity_positive
      check (sold_quantity is null or sold_quantity >= 1);
  end if;
end $$;

create table if not exists crm.kpi_section_permissions (
  section_code text not null check (section_code in ('speed','efficiency')),
  user_id uuid not null references core.users(id) on delete cascade,
  created_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (section_code,user_id)
);

create index if not exists crm_kpi_section_permissions_user_idx
  on crm.kpi_section_permissions(user_id,section_code);

insert into core.schema_migrations(version)
values('crm-kpi-permissions-sold-quantity-20260728')
on conflict(version) do nothing;

commit;
