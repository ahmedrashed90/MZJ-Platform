-- MZJ CRM: approved, one-time, evidence-based historical source reconciliation.
-- Run the ENTIRE file as ONE script in Neon SQL Editor, only after a VERIFIED
-- independent Neon backup/restore branch has been created and checked.
-- Last reviewed evidence (2026-10-23): 1 original lead friend source, and
-- 115 ERP sale transactions across 109 customers (86 branch, 16 haraj,
-- 6 other_website, 6 whatsapp, 1 unified_number).
-- This script self-ABORTS (and rolls back everything) if those counts differ.
-- Never run automatically on deploy. Never infer original source from ERP alone.
-- This script does not change sale dates, amounts, quantities, departments,
-- branches, salespeople, order references, customer statuses or phone data.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(20261023, 115109);

-- Persistent, run-specific BEFORE snapshots for exact affected records.
-- Intentional CREATE TABLE (not IF NOT EXISTS): rerunning the script will fail
-- rather than overwriting the one-time backup or applying it twice.
CREATE SCHEMA IF NOT EXISTS crm_reconciliation;

CREATE TABLE crm_reconciliation.crm_erp_source_lead_20261023_before AS
SELECT
  l.id,
  l.source_code AS before_source_code,
  l.source_name AS before_source_name,
  l.source_history AS before_source_history,
  l.updated_at AS before_updated_at,
  'friend'::text AS target_source_code,
  src.name AS target_source_name
FROM crm.leads l
JOIN crm.manual_lead_requests r
  ON r.id = '26ed1593-1770-40f2-941d-2774a45c2b9a'::uuid
 AND r.created_lead_id = l.id
 AND r.source_code = 'friend'
 AND r.created_at BETWEEN l.created_at - INTERVAL '5 minutes'
                      AND l.created_at + INTERVAL '5 minutes'
JOIN core.sources src ON src.code = r.source_code
WHERE l.id = 'f4436112-8b3d-40ff-b71f-dafb087de3d4'::uuid
  AND l.is_deleted IS DISTINCT FROM TRUE
  AND l.source_code = 'next_erp'
  AND EXISTS (
    SELECT 1
    FROM crm.lead_events m
    JOIN crm.lead_events e ON e.lead_id = m.lead_id
      AND e.details->>'origin' = 'erpnext-sales-order'
      AND e.created_at > m.created_at
    WHERE m.lead_id = l.id AND m.event_type = 'manual_lead_created'
  )
  AND NOT EXISTS (
    SELECT 1 FROM crm.lead_events ec
    WHERE ec.lead_id = l.id AND ec.event_type = 'lead_created'
      AND ec.details->>'origin' = 'erpnext-sales-order'
  );

CREATE TABLE crm_reconciliation.crm_erp_source_sales_20261023_before AS
SELECT
  st.id,
  st.lead_id,
  st.source_type,
  st.source_reference,
  st.source_code AS before_source_code,
  st.source_name AS before_source_name,
  st.metadata AS before_metadata,
  st.updated_at AS before_updated_at,
  st.sale_at AS before_sale_at,
  st.quantity AS before_quantity,
  st.total_amount AS before_total_amount,
  st.assigned_to AS before_assigned_to,
  st.department_code AS before_department_code,
  st.branch_code AS before_branch_code,
  st.is_cancelled AS before_is_cancelled,
  src.code AS target_source_code,
  src.name AS target_source_name
FROM crm.sales_transactions st
JOIN crm.leads l
  ON l.id = st.lead_id AND l.is_deleted IS DISTINCT FROM TRUE
LEFT JOIN crm_reconciliation.crm_erp_source_lead_20261023_before ml
  ON ml.id = l.id
JOIN core.sources src
  ON src.code = coalesce(ml.target_source_code, l.source_code)
WHERE st.source_type IN ('erpnext_sales_order', 'erp_reconciliation')
  AND lower(coalesce(st.source_code,'')) IN ('next_erp','website')
  AND lower(coalesce(src.code,'')) NOT IN ('','next_erp','website')
  AND st.source_code IS DISTINCT FROM src.code;

-- Keep these backups restricted; they are for the SQL Editor owner only.
REVOKE ALL ON TABLE crm_reconciliation.crm_erp_source_lead_20261023_before FROM PUBLIC;
REVOKE ALL ON TABLE crm_reconciliation.crm_erp_source_sales_20261023_before FROM PUBLIC;

-- Preflight and all writes happen atomically; failures abort the entire BEGIN.
DO $mzj_reconcile$
DECLARE
  lead_n integer;
  sales_n integer;
  distinct_customers_n integer;
  changed_n integer;
BEGIN
  SELECT count(*) INTO lead_n
  FROM crm_reconciliation.crm_erp_source_lead_20261023_before;
  SELECT count(*),count(DISTINCT lead_id)
  INTO sales_n, distinct_customers_n
  FROM crm_reconciliation.crm_erp_source_sales_20261023_before;

  IF lead_n <> 1 OR sales_n <> 115 OR distinct_customers_n <> 109 THEN
    RAISE EXCEPTION
      'ABORT: unexpected candidate counts: lead %, transactions %, customers %; expected 1/115/109. Database unchanged.',
      lead_n,sales_n,distinct_customers_n;
  END IF;

  IF (SELECT count(*) FROM crm_reconciliation.crm_erp_source_sales_20261023_before WHERE target_source_code='branch') <> 86
    OR (SELECT count(*) FROM crm_reconciliation.crm_erp_source_sales_20261023_before WHERE target_source_code='haraj') <> 16
    OR (SELECT count(*) FROM crm_reconciliation.crm_erp_source_sales_20261023_before WHERE target_source_code='other_website') <> 6
    OR (SELECT count(*) FROM crm_reconciliation.crm_erp_source_sales_20261023_before WHERE target_source_code='whatsapp') <> 6
    OR (SELECT count(*) FROM crm_reconciliation.crm_erp_source_sales_20261023_before WHERE target_source_code='unified_number') <> 1
  THEN
    RAISE EXCEPTION 'ABORT: historic source distribution changed. Database unchanged.';
  END IF;

  UPDATE crm.leads l SET
    source_code=b.target_source_code,
    source_name=b.target_source_name,
    source_history=coalesce(l.source_history,'[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'source',b.target_source_code,
        'at',clock_timestamp(),
        'reason','verified_original_manual_request_source',
        'originalRequestId','26ed1593-1770-40f2-941d-2774a45c2b9a',
        'runId','MZJ-CRM-ERP-SOURCE-20261023'
      )
    ),
    updated_at=clock_timestamp()
  FROM crm_reconciliation.crm_erp_source_lead_20261023_before b
  WHERE l.id=b.id AND l.source_code IS NOT DISTINCT FROM b.before_source_code;
  GET DIAGNOSTICS changed_n = ROW_COUNT;
  IF changed_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: updated % lead(s), expected 1',changed_n;
  END IF;

  INSERT INTO crm.lead_events(lead_id,event_type,note,details,created_at)
  SELECT b.id,'source_reconciled',
    'تصحيح مصدر العميل بناءً على طلب الإضافة الأصلي المثبت قبل طلب البيع',
    jsonb_build_object(
      'runId','MZJ-CRM-ERP-SOURCE-20261023',
      'from',b.before_source_code,
      'to',b.target_source_code,
      'originalRequestId','26ed1593-1770-40f2-941d-2774a45c2b9a',
      'evidence','original_manual_request_precedes_erp_sales_order'
    ),clock_timestamp()
  FROM crm_reconciliation.crm_erp_source_lead_20261023_before b;
  GET DIAGNOSTICS changed_n = ROW_COUNT;
  IF changed_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: inserted % audit event(s), expected 1',changed_n;
  END IF;

  UPDATE crm.sales_transactions st SET
    source_code=b.target_source_code,
    source_name=b.target_source_name,
    metadata=coalesce(st.metadata,'{}'::jsonb) || jsonb_build_object(
      'sourceAttributionCorrection',jsonb_build_object(
        'runId','MZJ-CRM-ERP-SOURCE-20261023',
        'at',clock_timestamp(),
        'previousSourceCode',b.before_source_code,
        'previousSourceName',b.before_source_name,
        'restoredSourceCode',b.target_source_code,
        'evidence','linked_crm_lead_acquisition_source'
      )
    ),
    updated_at=clock_timestamp()
  FROM crm_reconciliation.crm_erp_source_sales_20261023_before b
  WHERE st.id=b.id
    AND st.lead_id=b.lead_id
    AND st.source_type=b.source_type
    AND st.source_code IS NOT DISTINCT FROM b.before_source_code;
  GET DIAGNOSTICS changed_n = ROW_COUNT;
  IF changed_n <> 115 THEN
    RAISE EXCEPTION 'ABORT: updated % sale(s), expected 115',changed_n;
  END IF;

  -- Verify every expected source was applied, provenance stamped, and
  -- absolutely no sale fact (amount/date/quantity/rep/branch/department) changed.
  IF EXISTS (
    SELECT 1
    FROM crm_reconciliation.crm_erp_source_sales_20261023_before b
    LEFT JOIN crm.sales_transactions st ON st.id=b.id
    WHERE st.id IS NULL
      OR st.source_code IS DISTINCT FROM b.target_source_code
      OR st.source_name IS DISTINCT FROM b.target_source_name
      OR st.metadata#>>'{sourceAttributionCorrection,runId}' IS DISTINCT FROM 'MZJ-CRM-ERP-SOURCE-20261023'
      OR st.sale_at IS DISTINCT FROM b.before_sale_at
      OR st.quantity IS DISTINCT FROM b.before_quantity
      OR st.total_amount IS DISTINCT FROM b.before_total_amount
      OR st.assigned_to IS DISTINCT FROM b.before_assigned_to
      OR st.department_code IS DISTINCT FROM b.before_department_code
      OR st.branch_code IS DISTINCT FROM b.before_branch_code
      OR st.is_cancelled IS DISTINCT FROM b.before_is_cancelled
      OR st.source_reference IS DISTINCT FROM b.source_reference
  ) THEN
    RAISE EXCEPTION 'ABORT: post-update verification failed; transaction rolled back.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM crm.leads l
    JOIN crm_reconciliation.crm_erp_source_lead_20261023_before b ON b.id=l.id
    WHERE l.source_code='friend' AND l.source_name=b.target_source_name
      AND (l.source_history->-1)->>'runId'='MZJ-CRM-ERP-SOURCE-20261023'
  ) THEN
    RAISE EXCEPTION 'ABORT: historical manual source verification failed.';
  END IF;
END;
$mzj_reconcile$;

COMMIT;

-- Output for user confirmation after a successful COMMIT.
SELECT 'lead_source_updated' AS check_name,count(*)::integer AS rows
FROM crm_reconciliation.crm_erp_source_lead_20261023_before b
JOIN crm.leads l ON l.id=b.id AND l.source_code=b.target_source_code
UNION ALL
SELECT 'sales_transaction_sources_updated',count(*)::integer
FROM crm_reconciliation.crm_erp_source_sales_20261023_before b
JOIN crm.sales_transactions st ON st.id=b.id
  AND st.source_code=b.target_source_code
  AND st.metadata#>>'{sourceAttributionCorrection,runId}'='MZJ-CRM-ERP-SOURCE-20261023';
