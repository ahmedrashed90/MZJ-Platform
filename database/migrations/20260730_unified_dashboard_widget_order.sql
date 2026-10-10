begin;

alter table core.user_dashboard_layouts
  add column if not exists dashboard_widget_order jsonb not null default '[]'::jsonb;

update core.user_dashboard_layouts
set dashboard_widget_order=coalesce(main_widget_order,'[]'::jsonb)||coalesce(operation_widget_order,'[]'::jsonb)
where dashboard_widget_order='[]'::jsonb
  and (main_widget_order<>'[]'::jsonb or operation_widget_order<>'[]'::jsonb);

commit;
