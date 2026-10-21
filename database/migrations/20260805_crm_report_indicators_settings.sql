begin;

alter table crm.report_quality_settings add column if not exists qualified_statuses text[] not null default array['مؤهل'];
alter table crm.report_quality_settings add column if not exists total_mode text not null default 'all';
alter table crm.report_quality_settings add column if not exists total_statuses text[] not null default '{}';
alter table crm.report_quality_settings add column if not exists not_contacted_statuses text[] not null default array['عميل جديد'];
alter table crm.report_quality_settings add column if not exists summary_cards text[] not null default array['marketing','total','notContacted','waste','qualified','potential','sold','sales'];
alter table crm.report_quality_settings add column if not exists summary_cards_version integer not null default 2;

with sales_statuses as (
  select trim(value) as value,min(sort_order)::int as sort_order
  from crm.dashboard_statuses
  where is_active=true
    and department_code in ('cash','finance')
    and nullif(trim(value),'') is not null
  group by trim(value)
), qualified as (
  select value,sort_order
  from sales_statuses
  where value not in ('عميل جديد','لم يتم الرد','غير مؤهل','تم الاتصال','تم الرد','تم البيع','تم الانتهاء','تم الإنتهاء','جاري العمل')
), marketing_numerator as (
  select value,sort_order from qualified
  union all
  select 'تم البيع',100000
  where exists(select 1 from sales_statuses where value='تم البيع')
), marketing_denominator as (
  select value,sort_order
  from sales_statuses
  where value not in ('عميل جديد','لم يتم الرد')
)
update crm.report_quality_settings
set total_mode='all',
    total_statuses=array[]::text[],
    not_contacted_statuses=array['عميل جديد'],
    qualified_statuses=coalesce((select array_agg(value order by sort_order,value) from qualified),array['مؤهل']::text[]),
    marketing_numerator_statuses=coalesce((select array_agg(value order by sort_order,value) from marketing_numerator),array['مؤهل','تم البيع']::text[]),
    marketing_denominator_mode='statuses',
    marketing_denominator_statuses=coalesce((select array_agg(value order by sort_order,value) from marketing_denominator),array['غير مؤهل','مؤهل','تم البيع']::text[]),
    sales_numerator_statuses=array['تم البيع'],
    sales_denominator_mode='statuses',
    sales_denominator_statuses=coalesce((select array_agg(value order by sort_order,value) from sales_statuses),array['عميل جديد','لم يتم الرد','غير مؤهل','مؤهل','تم البيع']::text[]),
    summary_cards=array['marketing','total','notContacted','potential','waste','qualified','sold','sales'],
    summary_cards_version=2,
    updated_at=now()
where id='default';

insert into core.schema_migrations(version)
values('crm-report-indicators-settings-20260805')
on conflict(version) do nothing;

commit;
