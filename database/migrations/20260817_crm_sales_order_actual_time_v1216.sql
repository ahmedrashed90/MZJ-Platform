begin;

create temporary table _crm_sale_time_affected_leads (
  lead_id uuid primary key
) on commit drop;

with corrected as (
  update crm.sales_transactions st
  set
    sale_at=(
      (st.sale_at at time zone 'Asia/Riyadh')::date
      + (st.created_at at time zone 'Asia/Riyadh')::time
    ) at time zone 'Asia/Riyadh',
    metadata=coalesce(st.metadata,'{}'::jsonb)||jsonb_build_object(
      'soldTimeCorrectedAt',now(),
      'soldTimeCorrectionReason','replace_default_midnight_or_noon_with_sales_order_entry_time',
      'previousSaleAt',st.sale_at
    ),
    updated_at=now()
  from integrations.erpnext_sales_orders so
  where so.sales_order_no=st.source_reference
    and st.source_type in ('erpnext_sales_order','crm_contact_sales_order','erp_reconciliation')
    and coalesce(st.is_cancelled,false)=false
    and (st.sale_at at time zone 'Asia/Riyadh')::time in (time '00:00:00',time '12:00:00')
  returning st.lead_id
)
insert into _crm_sale_time_affected_leads(lead_id)
select distinct lead_id
from corrected
where lead_id is not null
on conflict(lead_id) do nothing;

with sales_summary as (
  select
    st.lead_id,
    coalesce(sum(greatest(coalesce(st.quantity,1),1)),0)::int as sold_quantity,
    max(st.sale_at) as sold_at
  from crm.sales_transactions st
  join _crm_sale_time_affected_leads a on a.lead_id=st.lead_id
  where coalesce(st.is_cancelled,false)=false
  group by st.lead_id
)
update crm.leads l
set
  sold_quantity=s.sold_quantity,
  sold_at=s.sold_at
from sales_summary s
where l.id=s.lead_id
  and (
    l.sold_quantity is distinct from s.sold_quantity
    or l.sold_at is distinct from s.sold_at
  );

insert into core.schema_migrations(version)
values('crm-sales-order-actual-time-20260817')
on conflict(version) do nothing;

commit;
