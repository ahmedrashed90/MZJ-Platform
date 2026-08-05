begin;

alter table marketing.platform_post_types add column if not exists publish_format text not null default 'post';
alter table marketing.platform_post_types drop constraint if exists platform_post_types_publish_format_check;
alter table marketing.platform_post_types add constraint platform_post_types_publish_format_check check(publish_format in ('story','reel','short','photo_post','carousel','video','post'));

alter table marketing.files add column if not exists media_width integer;
alter table marketing.files add column if not exists media_height integer;
alter table marketing.files add column if not exists duration_seconds numeric(12,3);

insert into marketing.platform_post_types(platform_id,name,width,height,publish_format,is_active)
select p.id,seed.name,seed.width,seed.height,seed.publish_format,true
from marketing.platforms p
join (values
  ('instagram','بوست صور',1080,1080,'photo_post'),
  ('instagram','ريل',1080,1920,'reel'),
  ('instagram','ستوري',1080,1920,'story'),
  ('tiktok','ريل/فيديو',1080,1920,'video'),
  ('tiktok','ستوري',1080,1920,'story'),
  ('snapchat','Spotlight',1080,1920,'short'),
  ('snapchat','Story',1080,1920,'story'),
  ('facebook','بوست صور',1080,1080,'photo_post'),
  ('facebook','ريل',1080,1920,'reel'),
  ('facebook','ستوري',1080,1920,'story'),
  ('linkedin','بوست',1080,1080,'photo_post'),
  ('linkedin','فيديو',1080,1920,'video'),
  ('youtube','Shorts',1080,1920,'short'),
  ('youtube','فيديو',1920,1080,'video')
) as seed(platform_code,name,width,height,publish_format) on lower(p.code)=seed.platform_code
on conflict(platform_id,name) do update
  set width=excluded.width,height=excluded.height,publish_format=excluded.publish_format,is_active=true,updated_at=now();

update marketing.platform_post_types pt
set is_active=false,updated_at=now()
from marketing.platforms p
where p.id=pt.platform_id
  and lower(p.code) in ('instagram','tiktok','snapchat','facebook','linkedin','youtube')
  and not exists (
    select 1
    from (values
      ('instagram','بوست صور'),('instagram','ريل'),('instagram','ستوري'),
      ('tiktok','ريل/فيديو'),('tiktok','ستوري'),
      ('snapchat','Spotlight'),('snapchat','Story'),
      ('facebook','بوست صور'),('facebook','ريل'),('facebook','ستوري'),
      ('linkedin','بوست'),('linkedin','فيديو'),
      ('youtube','Shorts'),('youtube','فيديو')
    ) as allowed(platform_code,name)
    where allowed.platform_code=lower(p.code) and lower(btrim(allowed.name))=lower(btrim(pt.name))
  );

insert into marketing.data_migrations(migration_key,details)
values('20260805_marketing_platform_publish_types_v1227','{"platforms":["instagram","tiktok","snapchat","facebook","linkedin","youtube"],"manual_publish":"new_source"}'::jsonb)
on conflict(migration_key) do update set details=excluded.details;

commit;
