-- تشغيل هذا الملف بعد Migration CRM v39 وقبل نشر الواجهة/API.
-- يحتوي على Assertions للمتطلبات البنيوية ثم تقارير تحقق للبيانات.

DO $$
DECLARE
  missing_columns text[];
BEGIN
  select array_agg(required.column_name order by required.column_name)
  into missing_columns
  from (values
    ('core','sources','report_group'),
    ('crm','report_quality_settings','qualified_statuses'),
    ('crm','report_quality_settings','total_mode'),
    ('crm','report_quality_settings','total_statuses'),
    ('crm','report_quality_settings','not_contacted_statuses'),
    ('crm','report_quality_settings','summary_cards'),
    ('crm','manual_lead_requests','car_category'),
    ('crm','manual_lead_requests','car_model'),
    ('crm','manual_lead_requests','color'),
    ('crm','manual_lead_requests','finance_type'),
    ('crm','manual_lead_requests','registered_at'),
    ('crm','manual_lead_requests','is_deleted'),
    ('crm','manual_lead_requests','deleted_by'),
    ('crm','manual_lead_requests','deleted_at')
  ) as required(table_schema,table_name,column_name)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema=required.table_schema
      and c.table_name=required.table_name
      and c.column_name=required.column_name
  );
  if missing_columns is not null then
    raise exception 'CRM v39 missing columns: %',array_to_string(missing_columns,', ');
  end if;
END $$;

DO $$
BEGIN
  if not exists(select 1 from core.schema_migrations where version='crm-reference-v39-20260720') then
    raise exception 'CRM v39 migration marker is missing';
  end if;
  if not exists(select 1 from crm.dashboard_statuses where id='cash-potential' and value='لم يتم الرد' and label='لم يتم الرد' and sort_order=50) then
    raise exception 'Cash status cash-potential was not migrated to لم يتم الرد';
  end if;
  if not exists(select 1 from crm.dashboard_statuses where id='finance-no-answer' and sort_order=210) then
    raise exception 'Finance لم يتم الرد order is not 210';
  end if;
  if exists(
    select 1 from crm.leads
    where is_deleted=false and status_label='محتمل' and coalesce(department_code,'') in ('cash','cash_sales')
  ) then
    raise exception 'Legacy cash status محتمل still exists in active leads';
  end if;
END $$;

select now() at time zone 'Asia/Riyadh' as checked_at_riyadh;

select version,applied_at
from core.schema_migrations
where version='crm-reference-v39-20260720';

select report_group,count(*)::bigint as sources
from core.sources
group by report_group
order by report_group;

select code,name,report_group,is_active
from core.sources
where code in ('facebook','instagram','tiktok','snapchat','whatsapp','installment_calculator','unified_number','branch','haraj','other_website')
order by report_group,sort_order,name;

select id,marketing_numerator_statuses,marketing_denominator_mode,marketing_denominator_statuses,
       sales_numerator_statuses,sales_denominator_mode,sales_denominator_statuses,
       qualified_statuses,total_mode,total_statuses,not_contacted_statuses,summary_cards,updated_at
from crm.report_quality_settings
where id='default';

select department_code,status_label,count(*)::bigint as customers
from crm.leads
where is_deleted=false
group by department_code,status_label
order by department_code,status_label;

select phone_normalized,count(*)::bigint as duplicate_count
from crm.leads
where is_deleted=false and nullif(phone_normalized,'') is not null
group by phone_normalized
having count(*) > 1
order by duplicate_count desc,phone_normalized;

select l.department_code,l.status_label,count(*)::bigint as unknown_status_customers
from crm.leads l
where l.is_deleted=false
  and not exists (
    select 1
    from crm.dashboard_statuses s
    where s.is_active=true
      and s.value=l.status_label
      and (case s.department_code when 'cash' then 'cash_sales' when 'finance' then 'finance_sales' when 'service' then 'customer_service' else s.department_code end)=l.department_code
  )
group by l.department_code,l.status_label
order by unknown_status_customers desc;

select l.source_code,count(*)::bigint as unknown_source_customers
from crm.leads l
where l.is_deleted=false
  and nullif(l.source_code,'') is not null
  and not exists(select 1 from core.sources s where s.code=l.source_code)
group by l.source_code
order by unknown_source_customers desc;
