import { runSqlScript } from "./_db.js";

let trackingSchemaPromise: Promise<void> | null = null;

const TRACKING_SCHEMA_SQL = String.raw`
create schema if not exists tracking;

alter table tracking.orders add column if not exists customer_vat text;
alter table tracking.orders add column if not exists branch text;
alter table tracking.orders add column if not exists delivery_date date;
alter table tracking.orders add column if not exists sales_person text;
alter table tracking.orders add column if not exists subtotal_before_tax numeric(14,2) not null default 0;
alter table tracking.orders add column if not exists tax_value numeric(14,2) not null default 0;
alter table tracking.orders add column if not exists total_incl_vat numeric(14,2) not null default 0;
alter table tracking.orders add column if not exists registration_fee numeric(14,2) not null default 0;
alter table tracking.orders add column if not exists source text;
alter table tracking.orders add column if not exists source_payload jsonb not null default '{}'::jsonb;
alter table tracking.orders add column if not exists source_updated_at timestamptz;
alter table tracking.orders add column if not exists is_deleted boolean not null default false;
alter table tracking.orders add column if not exists deleted_at timestamptz;
alter table tracking.orders add column if not exists deleted_by uuid references core.users(id);
alter table tracking.orders add column if not exists deleted_reason text;
alter table tracking.orders add column if not exists archived_at timestamptz;
alter table tracking.orders add column if not exists archived_by uuid references core.users(id);
alter table tracking.orders add column if not exists archived_by_name text;
alter table tracking.orders add column if not exists archive_reason text;
alter table tracking.orders add column if not exists source_key text;
alter table tracking.orders add column if not exists source_identity text;
alter table tracking.orders add column if not exists source_fingerprint text;
alter table tracking.orders add column if not exists source_row_number text;
alter table tracking.orders add column if not exists source_sheet_id text;
alter table tracking.orders add column if not exists source_sheet_name text;
alter table tracking.orders add column if not exists source_message_id text;
alter table tracking.orders add column if not exists source_original_id text;
update tracking.orders set source_key='legacy:'||id::text where source_key is null;
alter table tracking.orders drop constraint if exists orders_sales_order_no_key;
alter table tracking.orders drop constraint if exists tracking_orders_sales_order_no_key;
create unique index if not exists tracking_orders_source_key_unique_idx on tracking.orders(source_key) where source_key is not null;
create index if not exists tracking_orders_sales_order_no_idx on tracking.orders(sales_order_no,created_at desc);

alter table tracking.order_vehicles add column if not exists item_no text;
alter table tracking.order_vehicles add column if not exists item_type text;
alter table tracking.order_vehicles add column if not exists item_category text;
alter table tracking.order_vehicles add column if not exists item_model text;
alter table tracking.order_vehicles add column if not exists interior_color text;
alter table tracking.order_vehicles add column if not exists exterior_color text;
alter table tracking.order_vehicles add column if not exists dealer text;
alter table tracking.order_vehicles add column if not exists qty numeric(12,2) not null default 1;
alter table tracking.order_vehicles add column if not exists unit_price numeric(14,2) not null default 0;
alter table tracking.order_vehicles add column if not exists item_value numeric(14,2) not null default 0;
alter table tracking.order_vehicles add column if not exists subtotal_excl_vat numeric(14,2) not null default 0;
alter table tracking.order_vehicles add column if not exists tax_value numeric(14,2) not null default 0;
alter table tracking.order_vehicles add column if not exists total_incl_vat numeric(14,2) not null default 0;
alter table tracking.order_vehicles add column if not exists registration_fee numeric(14,2) not null default 0;
alter table tracking.order_vehicles add column if not exists raw_payload jsonb not null default '{}'::jsonb;
alter table tracking.order_vehicles add column if not exists created_at timestamptz not null default now();
alter table tracking.order_vehicles add column if not exists updated_at timestamptz not null default now();
create index if not exists tracking_order_vehicles_item_idx on tracking.order_vehicles(order_id, item_no);
create index if not exists tracking_order_vehicles_vin_idx on tracking.order_vehicles(vin);

alter table tracking.stages add column if not exists description text;
alter table tracking.stages add column if not exists updated_at timestamptz not null default now();

create table if not exists tracking.vehicle_stages (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references tracking.order_vehicles(id) on delete cascade,
  stage_id uuid not null references tracking.stages(id),
  status text not null default 'pending' check (status in ('pending','completed')),
  completed_by uuid references core.users(id),
  completed_at timestamptz,
  reverted_by uuid references core.users(id),
  reverted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(vehicle_id, stage_id)
);
create index if not exists tracking_vehicle_stages_vehicle_idx on tracking.vehicle_stages(vehicle_id);

create table if not exists tracking.stage_events (
  id bigserial primary key,
  order_id uuid not null references tracking.orders(id) on delete cascade,
  vehicle_id uuid not null references tracking.order_vehicles(id) on delete cascade,
  stage_id uuid not null references tracking.stages(id),
  action text not null check (action in ('completed','reverted')),
  actor_id uuid references core.users(id),
  actor_name text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists tracking_stage_events_order_idx on tracking.stage_events(order_id, created_at desc);

create table if not exists tracking.deleted_orders (
  id uuid primary key default gen_random_uuid(),
  sales_order_no text not null,
  customer_name text,
  customer_mobile text,
  reason text not null,
  snapshot jsonb not null default '{}'::jsonb,
  deleted_by uuid references core.users(id),
  deleted_by_name text,
  deleted_at timestamptz not null default now()
);
create index if not exists tracking_deleted_orders_no_idx on tracking.deleted_orders(sales_order_no, deleted_at desc);
alter table tracking.deleted_orders add column if not exists order_internal_id uuid;
alter table tracking.deleted_orders add column if not exists source_key text;
alter table tracking.deleted_orders add column if not exists source_identity text;
alter table tracking.deleted_orders add column if not exists source_fingerprint text;
alter table tracking.deleted_orders add column if not exists source_payload jsonb not null default '{}'::jsonb;
alter table tracking.deleted_orders add column if not exists request_id text;
alter table tracking.deleted_orders add column if not exists deleted_by_email text;
alter table tracking.deleted_orders add column if not exists deleted_by_role text;
create index if not exists tracking_deleted_orders_source_key_idx on tracking.deleted_orders(source_key,deleted_at desc);


create table if not exists tracking.sms_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references tracking.orders(id) on delete set null,
  vehicle_id uuid references tracking.order_vehicles(id) on delete set null,
  stage_id uuid references tracking.stages(id) on delete set null,
  phone text not null,
  message text not null,
  firestore_document_id text,
  status text not null default 'pending',
  queued_by uuid references core.users(id),
  queued_by_name text,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  error_message text
);
create index if not exists tracking_sms_messages_order_idx on tracking.sms_messages(order_id, queued_at desc);

create table if not exists tracking.system_migrations (
  migration_key text primary key,
  applied_at timestamptz not null default now()
);

with applied as (
  insert into tracking.system_migrations(migration_key)
  values ('archive_initial_tracking_history_except_active_7_v1')
  on conflict (migration_key) do nothing
  returning migration_key
)
update tracking.orders
set is_archived=true,
    archived_at=coalesce(archived_at, now()),
    archived_by_name=coalesce(archived_by_name, 'ترحيل النظام القديم'),
    archive_reason=coalesce(archive_reason, 'طلبات مكتملة قبل تشغيل نظام التتبع داخل المنصة'),
    updated_at=now()
where exists (select 1 from applied)
  and coalesce(is_deleted,false)=false
  and sales_order_no <= 'SAL-ORD-2026-00759'
  and sales_order_no not in (
    'SAL-ORD-2026-00711',
    'SAL-ORD-2026-00758',
    'SAL-ORD-2026-00757',
    'SAL-ORD-2026-00753',
    'SAL-ORD-2026-00754',
    'SAL-ORD-2026-00751',
    'SAL-ORD-2026-00748'
  );

insert into tracking.stages(code,name,description,owner_type,sort_order,sms_enabled,is_active) values
('stage_1','طلب الشراء (خاص بالعميل)','تم تسجيل طلب الشراء في النظام بنجاح.','customer',1,true,true),
('stage_2','إيصال الدفع (خاص بالعميل)','يتم استلام مبلغ الدفعة أو ترتيب خيار الدفع المناسب.','customer',2,false,true),
('stage_3','التواصل من قِبل ممثلي خدمة العملاء بإرسال البطاقة الجمركية (خاص بالمعرض)','خدمة العملاء تتواصل مع العميل لاستكمال البيانات وإرسال البطاقة الجمركية.','showroom',3,false,true),
('stage_4','سداد رسوم التسجيل (خاص بالعميل)','يتم سداد رسوم التسجيل الرسمية الخاصة بالمركبة.','customer',4,false,true),
('stage_5','التأمين – شرط الربط على السيستم (خاص بالعميل)','إصدار وثيقة التأمين وربطها بنظام المرور.','customer',5,false,true),
('stage_6','استيفاء المبالغ المتبقية (خاص بالعميل)','استكمال جميع المبالغ المطلوبة لإتمام الطلب.','customer',6,false,true),
('stage_7','استيفاء الأوراق المتبقية (خاص بالعميل)','استكمال جميع المستندات والأوراق المطلوبة.','customer',7,false,true),
('stage_8','إصدار اللوحات أو نقل الملكية (خاص بالمعرض)','إصدار اللوحات الجديدة أو إتمام إجراء نقل الملكية.','showroom',8,false,true),
('stage_9','جاهزية السيارة للاستلام (خاص بالمعرض)','السيارة جاهزة للاستلام من المعرض أو لطلب الشحن للمدينة المطلوبة.','showroom',9,true,true),
('stage_10','إتمام عملية التسليم بنجاح','تم تسليم السيارة وإغلاق الطلب بنجاح.','showroom',10,true,true)
on conflict (code) do nothing;
`;

export function ensureTrackingSchema() {
  if (!trackingSchemaPromise) {
    trackingSchemaPromise = runSqlScript(TRACKING_SCHEMA_SQL).catch((error) => {
      trackingSchemaPromise = null;
      throw error;
    });
  }
  return trackingSchemaPromise;
}
