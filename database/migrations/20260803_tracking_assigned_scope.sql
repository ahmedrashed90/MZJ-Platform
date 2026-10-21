begin;

alter table tracking.orders
  add column if not exists assigned_to uuid references core.users(id) on delete set null;

create index if not exists tracking_orders_assigned_to_idx
  on tracking.orders(assigned_to,updated_at desc);

with mapped as (
  select distinct on (o.id)
    o.id as order_id,
    so.platform_user_id
  from tracking.orders o
  join integrations.erpnext_sales_orders so
    on so.platform_user_id is not null
   and coalesce(so.is_cancelled,false)=false
   and (
     so.tracking_order_id=o.id
     or (so.tracking_order_id is null and nullif(trim(o.source_instance_key),'') is not null and so.source_instance_key=o.source_instance_key)
     or (so.tracking_order_id is null and nullif(trim(o.source_instance_key),'') is null and so.sales_order_no=o.sales_order_no)
   )
  where o.assigned_to is null
  order by
    o.id,
    case
      when so.tracking_order_id=o.id then 0
      when nullif(trim(o.source_instance_key),'') is not null and so.source_instance_key=o.source_instance_key then 1
      else 2
    end,
    so.updated_at desc
)
update tracking.orders o
set assigned_to=m.platform_user_id
from mapped m
where o.id=m.order_id and o.assigned_to is null;

commit;
