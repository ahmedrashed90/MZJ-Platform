begin;

update crm.automation_settings
set closed_statuses=jsonb_set(
      jsonb_set(coalesce(closed_statuses,'{}'::jsonb),'{cash}','["تم البيع","غير مؤهل"]'::jsonb,true),
      '{finance}','["تم البيع","غير مؤهل"]'::jsonb,true
    ),
    updated_at=now()
where id='default';

insert into core.schema_migrations(version)
values('crm-closed-not-qualified-v1.17.2')
on conflict(version) do nothing;

commit;
