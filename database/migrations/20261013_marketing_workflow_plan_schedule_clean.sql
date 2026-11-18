begin;
set local lock_timeout = '3s';
set local statement_timeout = '12s';
alter table marketing.work_plans add column if not exists is_deleted boolean not null default false;
alter table marketing.work_plans add column if not exists activated_at timestamptz;
alter table marketing.work_plans add column if not exists activated_by uuid references core.users(id);
alter table marketing.work_plans add column if not exists deleted_at timestamptz;
alter table marketing.work_plans add column if not exists deleted_by uuid references core.users(id);
alter table marketing.work_plan_items add column if not exists is_deleted boolean not null default false;
alter table marketing.work_plan_items add column if not exists post_type_id uuid references marketing.platform_post_types(id);
alter table marketing.work_plan_items add column if not exists budget_amount numeric(15,2) not null default 0;
alter table marketing.work_plan_items drop constraint if exists work_plan_items_plan_id_product_id_scheduled_on_key;
create unique index if not exists work_plan_unique_entry
  on marketing.work_plan_items(plan_id,product_id,scheduled_on,(coalesce(post_type_id,'00000000-0000-0000-0000-000000000000'::uuid)));
insert into marketing.workflow_migrations(code) values('schema-4') on conflict do nothing;
commit;
