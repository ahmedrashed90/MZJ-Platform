begin;

alter table crm.crm_runtime_settings
  add column if not exists tracking_final_delivery_welcome_enabled boolean not null default false;

insert into core.schema_migrations(version)
values('crm-tracking-final-delivery-welcome-20260822')
on conflict(version) do nothing;

commit;
