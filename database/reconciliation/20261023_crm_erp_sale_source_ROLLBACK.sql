-- Emergency rollback of the MZJ CRM historical source reconciliation.
-- Run only when rollback is actually required and after investigating whether
-- legitimate later changes occurred to any of the 116 affected records.
-- Uses the original, persistent BEFORE snapshots created by APPLY.
-- Does not delete audit history: it appends a reversal audit event.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(20261023, 115109);
DO $mzj_rollback$
DECLARE
  changed_n integer;
BEGIN
  IF (SELECT count(*) FROM crm_reconciliation.crm_erp_source_lead_20261023_before) <> 1
    OR (SELECT count(*) FROM crm_reconciliation.crm_erp_source_sales_20261023_before) <> 115
  THEN
    RAISE EXCEPTION 'ABORT: backup counts are incomplete. No rollback performed.';
  END IF;

  -- If any lead/source has since changed or the run's metadata is missing,
  -- refuse to overwrite possibly legitimate later work.
  IF EXISTS (
    SELECT 1 FROM crm_reconciliation.crm_erp_source_sales_20261023_before b
    LEFT JOIN crm.sales_transactions st ON st.id=b.id
    WHERE st.id IS NULL
      OR st.source_code IS DISTINCT FROM b.target_source_code
      OR st.metadata#>>'{sourceAttributionCorrection,runId}' IS DISTINCT FROM 'MZJ-CRM-ERP-SOURCE-20261023'
  ) OR EXISTS (
    SELECT 1 FROM crm_reconciliation.crm_erp_source_lead_20261023_before b
    LEFT JOIN crm.leads l ON l.id=b.id
    WHERE l.id IS NULL OR l.source_code IS DISTINCT FROM b.target_source_code
      OR (l.source_history->-1)->>'runId' IS DISTINCT FROM 'MZJ-CRM-ERP-SOURCE-20261023'
  ) THEN
    RAISE EXCEPTION 'ABORT: record changed since APPLY, manual review required before rollback.';
  END IF;

  UPDATE crm.sales_transactions st SET
    source_code=b.before_source_code,
    source_name=b.before_source_name,
    metadata=b.before_metadata,
    updated_at=b.before_updated_at
  FROM crm_reconciliation.crm_erp_source_sales_20261023_before b
  WHERE st.id=b.id;
  GET DIAGNOSTICS changed_n = ROW_COUNT;
  IF changed_n <> 115 THEN RAISE EXCEPTION 'ABORT: rollback affected % sale(s), expected 115',changed_n; END IF;

  UPDATE crm.leads l SET
    source_code=b.before_source_code,
    source_name=b.before_source_name,
    source_history=b.before_source_history,
    updated_at=b.before_updated_at
  FROM crm_reconciliation.crm_erp_source_lead_20261023_before b
  WHERE l.id=b.id;
  GET DIAGNOSTICS changed_n = ROW_COUNT;
  IF changed_n <> 1 THEN RAISE EXCEPTION 'ABORT: rollback affected % lead(s), expected 1',changed_n; END IF;

  INSERT INTO crm.lead_events(lead_id,event_type,note,details,created_at)
  SELECT b.id,'source_reconciliation_reverted',
    'تراجع موثق عن تصحيح مصادر CRM وعمليات البيع التاريخية',
    jsonb_build_object('runId','MZJ-CRM-ERP-SOURCE-20261023',
      'restoredSourceCode',b.before_source_code),clock_timestamp()
  FROM crm_reconciliation.crm_erp_source_lead_20261023_before b;
END;
$mzj_rollback$;
COMMIT;
SELECT 'rollback_leads' AS check_name,count(*)::integer AS rows
FROM crm_reconciliation.crm_erp_source_lead_20261023_before b
JOIN crm.leads l ON l.id=b.id AND l.source_code=b.before_source_code
UNION ALL
SELECT 'rollback_sales',count(*)::integer
FROM crm_reconciliation.crm_erp_source_sales_20261023_before b
JOIN crm.sales_transactions st ON st.id=b.id AND st.source_code=b.before_source_code;
