begin;

-- Conservative rollback: do not drop additive columns or reverse customer statuses.
-- Older application versions safely ignore the added columns, while dropping them could destroy
-- report settings or manual-lead data created after deployment.
drop index if exists crm.crm_leads_registered_filter_idx;
drop index if exists crm.crm_leads_report_source_idx;
drop index if exists crm.crm_leads_report_agents_idx;

delete from core.schema_migrations where version='crm-reference-v39-20260720';

insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data)
values (null,'crm','crm_reference_v39_code_rollback','migration','crm-reference-v39-20260720',
        jsonb_build_object('note','Additive columns and migrated customer statuses were intentionally preserved'));

commit;
