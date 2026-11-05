begin;

DO $$
BEGIN
  if exists(select 1 from core.schema_migrations where version='crm-reference-v39-20260720') then
    raise exception 'CRM reference v39 migration was already applied';
  end if;
END $$;

alter table core.sources add column if not exists report_group text not null default 'other';

update core.sources
set report_group = case
  when code in ('facebook','instagram','tiktok','snapchat','whatsapp','tiktok_lead','snapchat_lead','installment_calculator','unified_number') then 'digital'
  when code in ('haraj','other_website','branch','friend','manual') then 'direct'
  else case when report_group in ('digital','direct','other') then report_group else 'other' end
end,
updated_at = now();

alter table core.sources drop constraint if exists core_sources_report_group_check;
alter table core.sources add constraint core_sources_report_group_check check(report_group in ('digital','direct','other')) not valid;
alter table core.sources validate constraint core_sources_report_group_check;

alter table crm.report_quality_settings add column if not exists qualified_statuses text[] not null default array['مؤهل'];
alter table crm.report_quality_settings add column if not exists total_mode text not null default 'all';
alter table crm.report_quality_settings add column if not exists total_statuses text[] not null default '{}';
alter table crm.report_quality_settings add column if not exists not_contacted_statuses text[] not null default array['عميل جديد'];
alter table crm.report_quality_settings add column if not exists summary_cards text[] not null default array['marketing','total','notContacted','waste','qualified','potential','sold','sales'];
alter table crm.report_quality_settings add column if not exists summary_cards_version integer not null default 2;

alter table crm.manual_lead_requests add column if not exists car_category text;
alter table crm.manual_lead_requests add column if not exists car_model text;
alter table crm.manual_lead_requests add column if not exists color text;
alter table crm.manual_lead_requests add column if not exists finance_type text;
alter table crm.manual_lead_requests add column if not exists registered_at timestamptz;
alter table crm.manual_lead_requests add column if not exists is_deleted boolean not null default false;
alter table crm.manual_lead_requests add column if not exists deleted_by uuid references core.users(id);
alter table crm.manual_lead_requests add column if not exists deleted_at timestamptz;

update crm.dashboard_statuses
set label='لم يتم الرد', value='لم يتم الرد', sort_order=50, updated_at=now()
where id='cash-potential';

update crm.dashboard_statuses set sort_order=30, updated_at=now() where id='finance-not-qualified';
update crm.dashboard_statuses set sort_order=40, updated_at=now() where id='finance-delayed';
update crm.dashboard_statuses set sort_order=50, updated_at=now() where id='finance-qualified-no-docs';
update crm.dashboard_statuses set sort_order=60, updated_at=now() where id='finance-qualified-late-docs';
update crm.dashboard_statuses set sort_order=70, updated_at=now() where id='finance-qualified-docs-sent';
update crm.dashboard_statuses set sort_order=80, updated_at=now() where id='finance-request-raised';
update crm.dashboard_statuses set sort_order=90, updated_at=now() where id='finance-need-docs';
update crm.dashboard_statuses set sort_order=100, updated_at=now() where id='finance-callcenter-support';
update crm.dashboard_statuses set sort_order=110, updated_at=now() where id='finance-car-selected';
update crm.dashboard_statuses set sort_order=120, updated_at=now() where id='finance-car-docs-raised';
update crm.dashboard_statuses set sort_order=130, updated_at=now() where id='finance-advanced';
update crm.dashboard_statuses set sort_order=140, updated_at=now() where id='finance-rejected';
update crm.dashboard_statuses set sort_order=150, updated_at=now() where id='finance-approved';
update crm.dashboard_statuses set sort_order=160, updated_at=now() where id='finance-contract-issued';
update crm.dashboard_statuses set sort_order=170, updated_at=now() where id='finance-contract-call';
update crm.dashboard_statuses set sort_order=180, updated_at=now() where id='finance-contract-not-signed';
update crm.dashboard_statuses set sort_order=190, updated_at=now() where id='finance-contract-signed';
update crm.dashboard_statuses set sort_order=200, updated_at=now() where id='finance-done-sale-request';
update crm.dashboard_statuses set sort_order=210, updated_at=now() where id='finance-no-answer';

with migrated as (
  update crm.leads
  set status_label='لم يتم الرد', updated_at=now()
  where status_label='محتمل' and coalesce(department_code,'') in ('cash','cash_sales')
  returning id
)
insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data)
select null,'crm','crm_reference_v39_cash_status_migrated','migration','crm-reference-v39-20260720',
       jsonb_build_object('status','محتمل'),
       jsonb_build_object('status','لم يتم الرد','affected_leads',count(*))
from migrated;

with migrated as (
  update crm.service_requests
  set status_label='لم يتم الرد', updated_at=now()
  where status_label='محتمل' and coalesce(department_code,'') in ('cash','cash_sales')
  returning id
)
insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,before_data,after_data)
select null,'crm','crm_reference_v39_service_status_migrated','migration','crm-reference-v39-20260720',
       jsonb_build_object('status','محتمل'),
       jsonb_build_object('status','لم يتم الرد','affected_requests',count(*))
from migrated;

update crm.report_quality_settings
set marketing_numerator_statuses=array_replace(marketing_numerator_statuses,'محتمل','لم يتم الرد'),
    marketing_denominator_statuses=array_replace(marketing_denominator_statuses,'محتمل','لم يتم الرد'),
    sales_numerator_statuses=array_replace(sales_numerator_statuses,'محتمل','لم يتم الرد'),
    sales_denominator_statuses=array_replace(sales_denominator_statuses,'محتمل','لم يتم الرد'),
    qualified_statuses=array_replace(qualified_statuses,'محتمل','لم يتم الرد'),
    total_statuses=array_replace(total_statuses,'محتمل','لم يتم الرد'),
    not_contacted_statuses=array_replace(not_contacted_statuses,'محتمل','لم يتم الرد'),
    updated_at=now()
where id='default';

create index if not exists crm_leads_registered_filter_idx on crm.leads(registered_at, department_code, branch_code, status_label) where is_deleted=false;
create index if not exists crm_leads_report_source_idx on crm.leads(source_code, registered_at) where is_deleted=false;
create index if not exists crm_leads_report_agents_idx on crm.leads(assigned_to, call_center_assigned_to, registered_at) where is_deleted=false;

insert into core.schema_migrations(version) values ('crm-reference-v39-20260720') on conflict(version) do nothing;

commit;
