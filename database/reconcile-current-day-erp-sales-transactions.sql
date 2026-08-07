-- Optional one-time reconciliation for ERP sales orders already processed today
-- before v1.19.8 was deployed. This script is NOT executed automatically.
-- It only inserts active, linked ERP orders from the current Riyadh date that
-- do not already have a canonical/reconciliation sales transaction.

begin;

with candidates as (
  select
    so.crm_lead_id as lead_id,
    so.sales_order_no,
    (so.order_date::timestamp at time zone 'Asia/Riyadh') as sale_at,
    greatest(coalesce(vehicle_stats.quantity,1),1)::int as quantity,
    coalesce(so.total_incl_vat,0) as total_amount,
    so.platform_user_id as assigned_to,
    coalesce(so.platform_user_name,so.erp_sales_person,'غير موزع') as assigned_name,
    so.platform_department_code as department_code,
    case
      when so.platform_department_code in ('wholesale','wholesale_sales') then null
      else so.platform_branch_code
    end as branch_code,
    first_vehicle.item_type as car_name,
    first_vehicle.item_category as car_category,
    so.id as integration_order_id,
    so.source_instance_key,
    so.erp_created_at,
    so.erp_user_id,
    so.erp_sales_person
  from integrations.erpnext_sales_orders so
  left join lateral (
    select nullif(sum(greatest(coalesce(sov.qty,1),1)) filter(where coalesce(sov.is_cancelled,false)=false),0)::int as quantity
    from integrations.erpnext_sales_order_vehicles sov
    where sov.sales_order_id=so.id
  ) vehicle_stats on true
  left join lateral (
    select sov.item_type,sov.item_category
    from integrations.erpnext_sales_order_vehicles sov
    where sov.sales_order_id=so.id and coalesce(sov.is_cancelled,false)=false
    order by sov.created_at,sov.id
    limit 1
  ) first_vehicle on true
  where coalesce(so.is_cancelled,false)=false
    and so.crm_lead_id is not null
    and so.platform_user_id is not null
    and so.order_date=(now() at time zone 'Asia/Riyadh')::date
    and not exists (
      select 1
      from crm.sales_transactions st
      where st.source_reference=so.sales_order_no
        and st.source_type in ('erpnext_sales_order','erp_reconciliation')
    )
)
insert into crm.sales_transactions(
  lead_id,source_type,source_reference,sale_at,quantity,total_amount,
  assigned_to,assigned_name,department_code,branch_code,source_code,source_name,
  car_name,car_category,created_by,updated_by,metadata,is_cancelled
)
select
  c.lead_id,'erpnext_sales_order',c.sales_order_no,c.sale_at,c.quantity,c.total_amount,
  c.assigned_to,c.assigned_name,c.department_code,c.branch_code,'next_erp','NEXT ERP',
  c.car_name,c.car_category,c.assigned_to,c.assigned_to,
  jsonb_build_object(
    'origin','erpnext-sales-order',
    'integrationOrderId',c.integration_order_id,
    'salesOrderNo',c.sales_order_no,
    'sourceInstanceKey',c.source_instance_key,
    'erpCreatedAt',c.erp_created_at,
    'erpUserId',c.erp_user_id,
    'erpSalesPerson',c.erp_sales_person,
    'canonicalSalesTransaction',true,
    'reconciledExistingOrder',true
  ),
  false
from candidates c;

commit;
