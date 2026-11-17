-- MZJ CRM canonical sold snapshot reconciliation
-- Safe/idempotent: derives lead sold_quantity/sold_at only from active crm.sales_transactions.
-- Does not create/delete leads or sales transactions.

begin;

with canonical as (
  select
    st.lead_id,
    sum(greatest(coalesce(st.quantity,1),1))::int as sold_quantity,
    max(st.sale_at) as sold_at
  from crm.sales_transactions st
  where coalesce(st.is_cancelled,false)=false
  group by st.lead_id
)
update crm.leads l
set
  sold_quantity=c.sold_quantity,
  sold_at=c.sold_at,
  updated_at=now()
from canonical c
where l.id=c.lead_id
  and l.is_deleted=false
  and (
    l.sold_quantity is distinct from c.sold_quantity
    or l.sold_at is distinct from c.sold_at
  );

-- Sold leads with no active canonical transaction are not guessed or modified.
-- They are returned for review instead.
select
  l.id::text as lead_id,
  l.customer_name,
  l.phone,
  l.status_label,
  l.sold_quantity,
  l.sold_at
from crm.leads l
where l.is_deleted=false
  and l.status_label='تم البيع'
  and not exists (
    select 1
    from crm.sales_transactions st
    where st.lead_id=l.id and coalesce(st.is_cancelled,false)=false
  )
order by l.updated_at desc;

commit;
