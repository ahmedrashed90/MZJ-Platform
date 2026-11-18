begin;

alter table operations.movement_batches add column if not exists batch_no text;
update operations.movement_batches
set batch_no='MB-LEGACY-' || upper(substr(replace(id::text,'-',''),1,12))
where batch_no is null or btrim(batch_no)='';
alter table operations.movement_batches alter column batch_no set default ('MB-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)));
alter table operations.movement_batches alter column batch_no set not null;

commit;
