create table if not exists core.user_dashboard_layouts (
  user_id uuid primary key references core.users(id) on delete cascade,
  operation_widget_order jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
