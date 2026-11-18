begin;
      create schema if not exists marketing;
      create table if not exists marketing.workflow_migrations(code text primary key, applied_at timestamptz not null default now());
      insert into core.system_pages(system_code,code,name_ar,route,sort_order,is_active) values
        ('marketing','create','انشاء','/marketing/create',30,true),
        ('marketing','products','المنتجات','/marketing/products',40,true)
      on conflict(system_code,code) do update set name_ar=excluded.name_ar,route=excluded.route,sort_order=excluded.sort_order,is_active=true,updated_at=now();
      update core.system_pages set name_ar='تقويم تاريخ التسليم',sort_order=50 where system_code='marketing' and code='receipt_calendar';
      update core.system_pages set name_ar='النشر',sort_order=60 where system_code='marketing' and code='publish_prep';
      update core.system_pages set sort_order=20 where system_code='marketing' and code='database';
      update core.system_pages set is_active=false where system_code='marketing' and code in ('create_campaign','create_agenda','monitoring','calendar');
      insert into core.permissions(code,name,system_code,page_code,action_code,name_ar,description_ar,category,is_sensitive,sort_order,is_active) values
        ('marketing.create.view','انشاء','marketing','create','view','انشاء','انشاء','page',false,1445,true),
        ('marketing.task.create','إنشاء تاسك','marketing','create','task_create','إنشاء تاسك','إنشاء تاسك','action',true,1451,true),
        ('marketing.task.edit','تعديل تاسك','marketing','create','task_edit','تعديل تاسك','تعديل تاسك','action',true,1452,true),
        ('marketing.task.review','اعتماد - المنتج 100%','marketing','dashboard','task_review','اعتماد - المنتج 100%','اعتماد - المنتج 100%','workflow',true,1453,true),
        ('marketing.products.view','المنتجات','marketing','products','view','المنتجات','المنتجات','page',false,1454,true)
      on conflict(code) do update set name=excluded.name,name_ar=excluded.name_ar,page_code=excluded.page_code,is_active=true;
      update core.permissions set page_code='create' where system_code='marketing' and code in ('marketing.create_campaign.view','marketing.create_agenda.view','marketing.campaign.create','marketing.agenda.create');
      with mapping(old_code,new_code) as (values
        ('marketing.create_campaign.view','marketing.create.view'),('marketing.create_agenda.view','marketing.create.view'),
        ('marketing.campaign.create','marketing.task.create'),('marketing.agenda.create','marketing.task.create'),
        ('marketing.campaign.edit','marketing.task.edit'),('marketing.agenda.edit','marketing.task.edit'),
        ('marketing.assignment_action.admin','marketing.task.review'),('marketing.publish_prep.view','marketing.products.view'))
      insert into core.role_permissions(role_id,permission_id)
        select distinct rp.role_id,newp.id from mapping m
        join core.permissions oldp on oldp.code=m.old_code
        join core.permissions newp on newp.code=m.new_code
        join core.role_permissions rp on rp.permission_id=oldp.id
      on conflict do nothing;
      with mapping(old_code,new_code) as (values
        ('marketing.create_campaign.view','marketing.create.view'),('marketing.create_agenda.view','marketing.create.view'),
        ('marketing.campaign.create','marketing.task.create'),('marketing.agenda.create','marketing.task.create'),
        ('marketing.campaign.edit','marketing.task.edit'),('marketing.agenda.edit','marketing.task.edit'),
        ('marketing.assignment_action.admin','marketing.task.review'),('marketing.publish_prep.view','marketing.products.view'))
      insert into core.user_permission_overrides(user_id,permission_id,effect)
        select o.user_id,newp.id,case when bool_or(o.effect='deny') then 'deny' else 'allow' end
        from mapping m join core.permissions oldp on oldp.code=m.old_code
        join core.permissions newp on newp.code=m.new_code
        join core.user_permission_overrides o on o.permission_id=oldp.id
        group by o.user_id,newp.id
      on conflict(user_id,permission_id) do nothing;
      update core.users set permission_version=permission_version+1
        where id in (select user_id from core.user_systems where system_code='marketing' and is_enabled=true);
      insert into marketing.workflow_migrations(code) values('access-1') on conflict do nothing;
      commit;
