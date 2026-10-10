begin;

alter table core.user_devices add column if not exists is_primary boolean not null default false;

drop index if exists core.user_devices_one_approved_per_user_idx;

with ranked_approved as (
  select id,row_number() over(partition by user_id order by is_primary desc,approved_at desc nulls last,updated_at desc,id desc) as rn
  from core.user_devices
  where status='approved'
)
update core.user_devices d
set is_primary=(r.rn=1),updated_at=case when d.is_primary is distinct from (r.rn=1) then now() else d.updated_at end
from ranked_approved r
where d.id=r.id;

update core.user_devices set is_primary=false where status<>'approved' and is_primary=true;

create unique index if not exists user_devices_one_primary_per_user_idx
  on core.user_devices(user_id)
  where status='approved' and is_primary=true;

commit;
