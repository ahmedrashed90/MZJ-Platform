-- MZJ CRM v1.15.5
-- Canonical finance completion status and closed-request settings.

begin;

update crm.dashboard_statuses
set label='تم البيع',value='تم البيع',updated_at=now()
where id='finance-done-sale-request';

update crm.leads
set status_label='تم البيع',updated_at=now()
where department_code in ('finance_sales','call_center')
  and status_label in ('تم الانتهاء - إنشاء طلب البيع','تم الإنتهاء - إنشاء طلب البيع');

update crm.service_requests
set status_label='تم البيع',
    closure_reason=case when closure_reason in ('تم الانتهاء - إنشاء طلب البيع','تم الإنتهاء - إنشاء طلب البيع') then 'تم البيع' else closure_reason end,
    updated_at=now()
where department_code in ('finance_sales','call_center')
  and status_label in ('تم الانتهاء - إنشاء طلب البيع','تم الإنتهاء - إنشاء طلب البيع');

with preferred_old_mapping as (
  select id
  from crm.status_template_mappings
  where department_code='finance'
    and status_value in ('تم الانتهاء - إنشاء طلب البيع','تم الإنتهاء - إنشاء طلب البيع')
  order by updated_at desc,id desc
  limit 1
)
delete from crm.status_template_mappings old_mapping
where old_mapping.department_code='finance'
  and old_mapping.status_value in ('تم الانتهاء - إنشاء طلب البيع','تم الإنتهاء - إنشاء طلب البيع')
  and (
    exists (
      select 1 from crm.status_template_mappings sold_mapping
      where sold_mapping.department_code='finance' and sold_mapping.status_value='تم البيع'
    )
    or old_mapping.id<>(select id from preferred_old_mapping)
  );

update crm.status_template_mappings
set status_value='تم البيع',status_label='تم البيع',updated_at=now()
where department_code='finance'
  and status_value in ('تم الانتهاء - إنشاء طلب البيع','تم الإنتهاء - إنشاء طلب البيع');

update crm.report_quality_settings
set sales_numerator_statuses=array['تم البيع'],
    sales_denominator_statuses=(
      select coalesce(array_agg(value order by position),array[]::text[])
      from (
        select distinct on (value) value,position
        from (
          select case when item in ('تم الانتهاء - إنشاء طلب البيع','تم الإنتهاء - إنشاء طلب البيع') then 'تم البيع' else item end as value,
                 ordinality::int as position
          from unnest(coalesce(sales_denominator_statuses,array[]::text[])) with ordinality as statuses(item,ordinality)
          union all select 'تم البيع',100000
        ) normalized
        where nullif(trim(value),'') is not null
        order by value,position
      ) unique_values
    ),
    updated_at=now()
where id='default';

update crm.automation_settings
set closed_statuses=jsonb_set(coalesce(closed_statuses,'{}'::jsonb),'{finance}','["تم البيع"]'::jsonb,true),updated_at=now()
where id='default';

insert into core.schema_migrations(version)
values('crm-completed-workflow-v1.15.5')
on conflict(version) do nothing;

commit;
