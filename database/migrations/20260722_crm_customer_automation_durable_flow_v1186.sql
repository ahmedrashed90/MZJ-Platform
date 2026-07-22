alter table crm.customer_automation_runs add column if not exists pending_stage text;
alter table crm.customer_automation_runs add column if not exists pending_text text;
alter table crm.customer_automation_runs add column if not exists pending_buttons jsonb not null default '[]'::jsonb;
alter table crm.customer_automation_runs add column if not exists pending_target_status text;
alter table crm.customer_automation_runs add column if not exists pending_step_key text;
alter table crm.customer_automation_runs add column if not exists pending_step_index integer;
alter table crm.customer_automation_runs add column if not exists pending_event_key text;
alter table crm.customer_automation_runs add column if not exists delivery_attempts integer not null default 0;
alter table crm.customer_automation_runs add column if not exists last_delivery_error text;

drop index if exists crm.crm_customer_automation_runs_one_active;
drop index if exists crm.crm_customer_automation_runs_one_active_contact;
drop index if exists crm_customer_automation_runs_one_active;
drop index if exists crm_customer_automation_runs_one_active_contact;

create unique index if not exists crm_customer_automation_runs_one_active
  on crm.customer_automation_runs(conversation_id)
  where status in ('awaiting_service','classifying','awaiting_step','pending_delivery');
create unique index if not exists crm_customer_automation_runs_one_active_contact
  on crm.customer_automation_runs(contact_id)
  where contact_id is not null and status in ('awaiting_service','classifying','awaiting_step','pending_delivery');

insert into core.schema_migrations(version)
values('crm-customer-automation-durable-flow-v1.18.6')
on conflict(version) do nothing;
