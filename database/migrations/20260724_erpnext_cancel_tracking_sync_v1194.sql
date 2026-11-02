-- MZJ Platform v1.19.4
-- ERPNext sales-order instance identity, cancellation flow, synchronized tracking stages,
-- persistent SMS state, and operations sales-order history.

begin;

alter table tracking.orders add column if not exists is_cancelled boolean not null default false;
alter table tracking.orders add column if not exists cancelled_at timestamptz;
alter table tracking.orders add column if not exists cancellation_reason text;
alter table tracking.orders add column if not exists cancellation_source text;
alter table tracking.orders add column if not exists source_instance_key text;
alter table tracking.orders add column if not exists erp_created_at timestamptz;

update tracking.orders
set source_instance_key=source_identity
where source_instance_key is null
  and nullif(source_identity,'') is not null
  and source_identity like 'next-erp:sales-order:%';

create index if not exists tracking_orders_cancelled_idx
on tracking.orders(is_cancelled,cancelled_at desc);
create index if not exists tracking_orders_source_instance_idx
on tracking.orders(source_instance_key);

alter table integrations.erpnext_sales_orders drop constraint if exists erpnext_sales_orders_sales_order_no_key;
alter table integrations.erpnext_sales_orders add column if not exists source_instance_key text;
alter table integrations.erpnext_sales_orders add column if not exists erp_created_at timestamptz;
alter table integrations.erpnext_sales_orders add column if not exists crm_previous_state jsonb;
alter table integrations.erpnext_sales_orders add column if not exists crm_created_by_integration boolean not null default false;
alter table integrations.erpnext_sales_orders add column if not exists is_cancelled boolean not null default false;
alter table integrations.erpnext_sales_orders add column if not exists cancelled_at timestamptz;
alter table integrations.erpnext_sales_orders add column if not exists cancellation_reason text;

update integrations.erpnext_sales_orders
set source_instance_key=coalesce(
  nullif(source_instance_key,''),
  'next-erp:sales-order:'||sales_order_no||':legacy:'||id::text
)
where source_instance_key is null or source_instance_key='';

create unique index if not exists erpnext_sales_orders_source_instance_unique
on integrations.erpnext_sales_orders(source_instance_key)
where nullif(source_instance_key,'') is not null;
create index if not exists erpnext_sales_orders_no_idx
on integrations.erpnext_sales_orders(sales_order_no,received_at desc);
create index if not exists erpnext_sales_orders_active_idx
on integrations.erpnext_sales_orders(sales_order_no,is_cancelled,received_at desc);

alter table integrations.erpnext_sales_order_vehicles add column if not exists is_cancelled boolean not null default false;
alter table integrations.erpnext_sales_order_vehicles add column if not exists cancelled_at timestamptz;

alter table operations.approval_events drop constraint if exists approval_events_action_check;
do $approval_events_native_action$
declare
  current_definition text;
begin
  select pg_get_constraintdef(oid)
  into current_definition
  from pg_constraint
  where conrelid='operations.approval_events'::regclass
    and conname='approval_events_action_native_check';

  if current_definition is null or position('cancelled' in lower(current_definition))=0 then
    alter table operations.approval_events drop constraint if exists approval_events_action_native_check;
    alter table operations.approval_events
      add constraint approval_events_action_native_check
      check (action in ('approve','revert','note','reset','cancelled')) not valid;
  end if;
end
$approval_events_native_action$;

commit;
