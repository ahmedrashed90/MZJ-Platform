import { runSqlScript } from "./_db.js";

let userMappingSchemaPromise: Promise<void> | null = null;
let salesOrderSchemaPromise: Promise<void> | null = null;

export const ERPNEXT_USER_MAPPING_SCHEMA_SQL = String.raw`
alter table core.users add column if not exists next_erp_user_id text;
alter table core.users add column if not exists next_erp_branch text;

create unique index if not exists core_users_next_erp_user_id_unique
on core.users(lower(trim(next_erp_user_id)))
where nullif(trim(next_erp_user_id),'') is not null;

create index if not exists core_users_next_erp_branch_idx
on core.users(lower(trim(next_erp_branch)))
where nullif(trim(next_erp_branch),'') is not null;
`;

export const ERPNEXT_SALES_ORDER_SCHEMA_SQL = String.raw`
create schema if not exists integrations;

create table if not exists crm.sources (
  code text primary key,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

insert into crm.sources(code,name,sort_order,is_active)
values ('next_erp','NEXT ERP',140,true)
on conflict(code) do update set name=excluded.name,sort_order=excluded.sort_order,is_active=true;

create table if not exists integrations.erpnext_sales_orders (
  id uuid primary key default gen_random_uuid(),
  sales_order_no text not null unique,
  erp_status text,
  erp_event text,
  erp_sales_person text,
  accounting_customer_name text,
  actual_customer_name text,
  actual_customer_phone text,
  actual_customer_phone_normalized text,
  customer_vat text,
  order_date date,
  delivery_date date,
  erp_user_id text,
  erp_branch text,
  platform_user_id uuid references core.users(id) on delete set null,
  platform_user_name text,
  platform_department_code text,
  platform_department_name text,
  platform_branch_code text,
  platform_branch_name text,
  crm_lead_id uuid references crm.leads(id) on delete set null,
  tracking_order_id uuid references tracking.orders(id) on delete set null,
  subtotal_before_tax numeric(14,2) not null default 0,
  tax_value numeric(14,2) not null default 0,
  total_incl_vat numeric(14,2) not null default 0,
  registration_fee numeric(14,2) not null default 0,
  user_link_status text not null default 'pending',
  crm_link_status text not null default 'pending',
  operations_link_status text not null default 'pending',
  warnings jsonb not null default '[]'::jsonb,
  source_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table integrations.erpnext_sales_orders add column if not exists erp_status text;
alter table integrations.erpnext_sales_orders add column if not exists erp_event text;
alter table integrations.erpnext_sales_orders add column if not exists erp_sales_person text;
alter table integrations.erpnext_sales_orders add column if not exists accounting_customer_name text;
alter table integrations.erpnext_sales_orders add column if not exists actual_customer_name text;
alter table integrations.erpnext_sales_orders add column if not exists actual_customer_phone text;
alter table integrations.erpnext_sales_orders add column if not exists actual_customer_phone_normalized text;
alter table integrations.erpnext_sales_orders add column if not exists customer_vat text;
alter table integrations.erpnext_sales_orders add column if not exists order_date date;
alter table integrations.erpnext_sales_orders add column if not exists delivery_date date;
alter table integrations.erpnext_sales_orders add column if not exists erp_user_id text;
alter table integrations.erpnext_sales_orders add column if not exists erp_branch text;
alter table integrations.erpnext_sales_orders add column if not exists platform_user_id uuid references core.users(id) on delete set null;
alter table integrations.erpnext_sales_orders add column if not exists platform_user_name text;
alter table integrations.erpnext_sales_orders add column if not exists platform_department_code text;
alter table integrations.erpnext_sales_orders add column if not exists platform_department_name text;
alter table integrations.erpnext_sales_orders add column if not exists platform_branch_code text;
alter table integrations.erpnext_sales_orders add column if not exists platform_branch_name text;
alter table integrations.erpnext_sales_orders add column if not exists crm_lead_id uuid references crm.leads(id) on delete set null;
alter table integrations.erpnext_sales_orders add column if not exists tracking_order_id uuid references tracking.orders(id) on delete set null;
alter table integrations.erpnext_sales_orders add column if not exists subtotal_before_tax numeric(14,2) not null default 0;
alter table integrations.erpnext_sales_orders add column if not exists tax_value numeric(14,2) not null default 0;
alter table integrations.erpnext_sales_orders add column if not exists total_incl_vat numeric(14,2) not null default 0;
alter table integrations.erpnext_sales_orders add column if not exists registration_fee numeric(14,2) not null default 0;
alter table integrations.erpnext_sales_orders add column if not exists user_link_status text not null default 'pending';
alter table integrations.erpnext_sales_orders add column if not exists crm_link_status text not null default 'pending';
alter table integrations.erpnext_sales_orders add column if not exists operations_link_status text not null default 'pending';
alter table integrations.erpnext_sales_orders add column if not exists warnings jsonb not null default '[]'::jsonb;
alter table integrations.erpnext_sales_orders add column if not exists source_payload jsonb not null default '{}'::jsonb;
alter table integrations.erpnext_sales_orders add column if not exists received_at timestamptz not null default now();
alter table integrations.erpnext_sales_orders add column if not exists updated_at timestamptz not null default now();

create index if not exists erpnext_sales_orders_phone_idx
on integrations.erpnext_sales_orders(actual_customer_phone_normalized);
create index if not exists erpnext_sales_orders_user_idx
on integrations.erpnext_sales_orders(platform_user_id,updated_at desc);
create index if not exists erpnext_sales_orders_crm_idx
on integrations.erpnext_sales_orders(crm_lead_id,updated_at desc);

create table if not exists integrations.erpnext_sales_order_vehicles (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references integrations.erpnext_sales_orders(id) on delete cascade,
  item_identity text not null,
  item_no text,
  vin text,
  item_type text,
  item_category text,
  item_model text,
  interior_color text,
  exterior_color text,
  dealer text,
  qty numeric(12,2) not null default 1,
  unit_price numeric(14,2) not null default 0,
  item_value numeric(14,2) not null default 0,
  total_incl_vat numeric(14,2) not null default 0,
  tracking_vehicle_id uuid references tracking.order_vehicles(id) on delete set null,
  operations_vehicle_id uuid references operations.vehicles(id) on delete set null,
  operations_status_code text,
  operations_status_applied_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(sales_order_id,item_identity)
);

alter table integrations.erpnext_sales_order_vehicles add column if not exists item_no text;
alter table integrations.erpnext_sales_order_vehicles add column if not exists vin text;
alter table integrations.erpnext_sales_order_vehicles add column if not exists item_type text;
alter table integrations.erpnext_sales_order_vehicles add column if not exists item_category text;
alter table integrations.erpnext_sales_order_vehicles add column if not exists item_model text;
alter table integrations.erpnext_sales_order_vehicles add column if not exists interior_color text;
alter table integrations.erpnext_sales_order_vehicles add column if not exists exterior_color text;
alter table integrations.erpnext_sales_order_vehicles add column if not exists dealer text;
alter table integrations.erpnext_sales_order_vehicles add column if not exists qty numeric(12,2) not null default 1;
alter table integrations.erpnext_sales_order_vehicles add column if not exists unit_price numeric(14,2) not null default 0;
alter table integrations.erpnext_sales_order_vehicles add column if not exists item_value numeric(14,2) not null default 0;
alter table integrations.erpnext_sales_order_vehicles add column if not exists total_incl_vat numeric(14,2) not null default 0;
alter table integrations.erpnext_sales_order_vehicles add column if not exists tracking_vehicle_id uuid references tracking.order_vehicles(id) on delete set null;
alter table integrations.erpnext_sales_order_vehicles add column if not exists operations_vehicle_id uuid references operations.vehicles(id) on delete set null;
alter table integrations.erpnext_sales_order_vehicles add column if not exists operations_status_code text;
alter table integrations.erpnext_sales_order_vehicles add column if not exists operations_status_applied_at timestamptz;
alter table integrations.erpnext_sales_order_vehicles add column if not exists raw_payload jsonb not null default '{}'::jsonb;
alter table integrations.erpnext_sales_order_vehicles add column if not exists created_at timestamptz not null default now();
alter table integrations.erpnext_sales_order_vehicles add column if not exists updated_at timestamptz not null default now();

create index if not exists erpnext_sales_order_vehicles_vin_idx
on integrations.erpnext_sales_order_vehicles(upper(trim(vin)))
where nullif(trim(vin),'') is not null;
create index if not exists erpnext_sales_order_vehicles_operations_idx
on integrations.erpnext_sales_order_vehicles(operations_vehicle_id,updated_at desc);
`;

export function ensureErpNextUserMappingSchema() {
  if (!userMappingSchemaPromise) {
    userMappingSchemaPromise = runSqlScript(ERPNEXT_USER_MAPPING_SCHEMA_SQL).catch((error) => {
      userMappingSchemaPromise = null;
      throw error;
    });
  }
  return userMappingSchemaPromise;
}

export function ensureErpNextSalesOrderSchema() {
  if (!salesOrderSchemaPromise) {
    salesOrderSchemaPromise = runSqlScript(ERPNEXT_SALES_ORDER_SCHEMA_SQL).catch((error) => {
      salesOrderSchemaPromise = null;
      throw error;
    });
  }
  return salesOrderSchemaPromise;
}
