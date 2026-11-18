begin;
set local lock_timeout = '3s';
set local statement_timeout = '12s';
create table if not exists marketing.production_dimensions (
  id uuid primary key default gen_random_uuid(),
  width integer not null check(width between 1 and 16384),
  height integer not null check(height between 1 and 16384),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(width,height)
);
insert into marketing.production_dimensions(width,height)
select distinct pt.width,pt.height
from marketing.platform_post_types pt
join marketing.platforms p on p.id=pt.platform_id
where pt.is_active=true and p.is_active=true
  and pt.width between 1 and 16384 and pt.height between 1 and 16384
on conflict(width,height) do nothing;
update marketing.schema_state set version=greatest(version,4),updated_at=now() where id=1;
commit;
