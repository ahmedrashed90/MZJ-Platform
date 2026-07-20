import { getSql } from "./_db.js";

let schemaPromise: Promise<void> | null = null;

const statements = [
  `create table if not exists operations.statuses (
    code text primary key,
    label text not null,
    sort_order integer not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `insert into operations.statuses(code,label,sort_order) values
    ('available_for_sale','متاح للبيع',10),
    ('reserved','حجز',20),
    ('has_notes','بها ملاحظات',30),
    ('under_delivery','مباع تحت التسليم',40),
    ('delivered','مباع تم التسليم',50)
    on conflict (code) do update set label=excluded.label,sort_order=excluded.sort_order,is_active=true`,
  `create table if not exists operations.interior_colors (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    sort_order integer not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
  )`,
  `alter table operations.vehicles add column if not exists location_note text`,
  `alter table operations.vehicles add column if not exists shortage_note text`,
  `alter table operations.vehicles add column if not exists car_note text`,
  `alter table operations.vehicles add column if not exists tracking_url text`,
  `alter table operations.vehicles add column if not exists is_archived boolean not null default false`,
  `alter table operations.vehicles add column if not exists archived_at timestamptz`,
  `alter table operations.vehicles add column if not exists archived_by uuid references core.users(id)`,
  `alter table operations.vehicles add column if not exists imported_at timestamptz`,
  `create index if not exists operations_vehicles_active_search_idx on operations.vehicles(vin,location_id,status_code) where is_deleted=false and is_archived=false`,
  `create table if not exists operations.vehicle_checklists (
    vehicle_id uuid primary key references operations.vehicles(id) on delete cascade,
    items jsonb not null default '{}'::jsonb,
    updated_by uuid references core.users(id),
    updated_at timestamptz not null default now()
  )`,
  `alter table operations.vehicle_approvals add column if not exists financial_note text`,
  `alter table operations.vehicle_approvals add column if not exists administrative_note text`,
  `alter table operations.vehicle_approvals add column if not exists financial_approved_at timestamptz`,
  `alter table operations.vehicle_approvals add column if not exists administrative_approved_at timestamptz`,
  `delete from operations.vehicle_approvals a using operations.vehicle_approvals b where a.vehicle_id=b.vehicle_id and a.id<b.id`,
  `create unique index if not exists operations_vehicle_approvals_vehicle_unique on operations.vehicle_approvals(vehicle_id)`,
  `alter table operations.transfer_requests add column if not exists photo_date date`,
  `alter table operations.transfer_requests add column if not exists target_status_code text`,
  `alter table operations.transfer_requests add column if not exists notes text`,
  `alter table operations.transfer_requests add column if not exists updated_at timestamptz not null default now()`,
  `alter table operations.transfer_requests add column if not exists deleted_at timestamptz`,
  `alter table operations.transfer_request_vehicles add column if not exists note text`,
  `create table if not exists operations.request_events (
    id uuid primary key default gen_random_uuid(),
    transfer_request_id uuid not null references operations.transfer_requests(id) on delete cascade,
    stage_code text not null,
    note text,
    performed_by uuid references core.users(id),
    created_at timestamptz not null default now(),
    unique(transfer_request_id,stage_code)
  )`,
  `create index if not exists operations_request_events_request_idx on operations.request_events(transfer_request_id,created_at)`,
  `create table if not exists operations.movement_batches (
    id uuid primary key default gen_random_uuid(),
    movement_type text not null default 'direct',
    destination_location_id uuid references operations.locations(id),
    new_status text,
    note text,
    performed_by uuid references core.users(id),
    created_at timestamptz not null default now()
  )`,
  `alter table operations.movements add column if not exists batch_id uuid references operations.movement_batches(id)`,
  `alter table operations.movements add column if not exists transfer_request_id uuid references operations.transfer_requests(id)`,
  `alter table operations.movements add column if not exists movement_type text not null default 'direct'`,
  `alter table operations.movements add column if not exists before_data jsonb`,
  `alter table operations.movements add column if not exists after_data jsonb`,
  `insert into core.permissions(code,name,system_code) values
    ('operations.view','عرض نظام العمليات','operations'),
    ('operations.vehicles.read','قراءة السيارات','operations'),
    ('operations.vehicles.create','إضافة السيارات','operations'),
    ('operations.vehicles.update','تعديل السيارات','operations'),
    ('operations.vehicles.import','استيراد السيارات','operations'),
    ('operations.vehicles.export','تصدير السيارات','operations'),
    ('operations.vehicles.archive','أرشفة السيارات','operations'),
    ('operations.movements.read','قراءة الحركات','operations'),
    ('operations.movements.execute','تنفيذ الحركات','operations'),
    ('operations.requests.read','قراءة طلبات النقل','operations'),
    ('operations.requests.create','إنشاء طلبات النقل','operations'),
    ('operations.requests.delete','حذف طلبات النقل','operations'),
    ('operations.requests.advance','تنفيذ مراحل الطلب','operations'),
    ('operations.approvals.manage','إدارة الموافقات','operations'),
    ('operations.settings.manage','إدارة إعدادات العمليات','operations')
    on conflict (code) do update set name=excluded.name,system_code=excluded.system_code`,
  `insert into core.role_permissions(role_id,permission_id)
    select r.id,p.id from core.roles r cross join core.permissions p
    where r.code='operations_user' and p.system_code='operations'
    on conflict do nothing`,
  `insert into core.role_permissions(role_id,permission_id)
    select r.id,p.id from core.roles r cross join core.permissions p
    where r.code='admin' and p.system_code='operations'
    on conflict do nothing`,
];

export async function ensureOperationsSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql();
      for (const statement of statements) await sql.unsafe(statement);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}
