begin;

alter table marketing.publish_schedule
  add column if not exists publish_options jsonb not null default '{}'::jsonb;

create table if not exists marketing.platform_publish_settings (
  platform text primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references core.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_publish_settings_platform_check check(platform in ('youtube'))
);

insert into marketing.platform_publish_settings(platform,settings)
values(
  'youtube',
  '{"privacyStatus":"unlisted","madeForKids":false,"categoryId":"2","defaultLanguage":"ar","defaultPlaylistId":"","notifySubscribers":true,"embeddable":true,"license":"youtube","publicStatsViewable":true,"defaultTags":[],"descriptionTemplate":""}'::jsonb
)
on conflict(platform) do nothing;

insert into marketing.platform_post_types(platform_id,name,width,height,is_active)
select p.id,seed.name,seed.width,seed.height,true
from marketing.platforms p
cross join (values ('فيديو',1920,1080),('Shorts',1080,1920)) as seed(name,width,height)
where lower(p.code)='youtube'
on conflict(platform_id,name) do update
set width=excluded.width,height=excluded.height,is_active=true,updated_at=now();

update marketing.platform_post_types pt
set is_active=false,updated_at=now()
from marketing.platforms p
where p.id=pt.platform_id and lower(p.code)='youtube'
  and lower(btrim(pt.name)) in ('عام','غير مدرج','خاص','public','unlisted','private');

commit;
