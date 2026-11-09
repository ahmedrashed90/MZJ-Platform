-- تشغيل هذا الملف قبل Migration CRM v39 لحفظ صورة واضحة عن البيانات الحالية.
-- لا ينفذ أي تعديل.

select now() at time zone 'Asia/Riyadh' as checked_at_riyadh;

select count(*)::bigint as active_leads
from crm.leads
where is_deleted=false;

select department_code,status_label,count(*)::bigint as customers
from crm.leads
where is_deleted=false
group by department_code,status_label
order by department_code,status_label;

select count(*)::bigint as cash_potential_to_migrate
from crm.leads
where is_deleted=false
  and status_label='محتمل'
  and coalesce(department_code,'') in ('cash','cash_sales');

select count(*)::bigint as service_requests_cash_potential_to_migrate
from crm.service_requests
where status_label='محتمل'
  and coalesce(department_code,'') in ('cash','cash_sales');

select phone_normalized,count(*)::bigint as duplicate_count
from crm.leads
where is_deleted=false and nullif(phone_normalized,'') is not null
group by phone_normalized
having count(*) > 1
order by duplicate_count desc,phone_normalized;

select coalesce(source_code,'<NULL>') as source_code,count(*)::bigint as customers
from crm.leads
where is_deleted=false
group by source_code
order by customers desc,source_code;

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
