-- MANUAL ONE-TIME HISTORICAL RECONCILIATION. NEVER AUTO-EXECUTED.
-- DO NOT RUN without (1) a verified Neon backup, (2) reviewed PREVIEW results,
-- and (3) explicit production-data change approval.
-- No inference from 'manual_lead_created' alone; restore historic lead source
-- ONLY when the original CRM manual request (created at the same time as the
-- lead) has a catalog-valid, non-ERP source and ERP created the sale later.
-- Does not modify sale count, quantity, date, value, assigned salesperson,
-- department, branch, or source_reference.
BEGIN;

CREATE TEMP TABLE _verified_historical_manual_sources ON COMMIT DROP AS
SELECT DISTINCT ON (l.id)
  l.id,l.source_code AS old_source_code,l.source_name AS old_source_name,
  r.id AS request_id,r.source_code AS verified_source_code,s.name AS verified_source_name
FROM crm.leads l
JOIN crm.manual_lead_requests r ON r.created_lead_id=l.id
  AND r.created_at BETWEEN l.created_at - interval '5 minutes' AND l.created_at + interval '5 minutes'
JOIN core.sources s ON s.code=r.source_code
WHERE l.is_deleted IS DISTINCT FROM TRUE AND l.source_code='next_erp'
  AND lower(coalesce(r.source_code,'')) NOT IN ('','next_erp','website')
  AND EXISTS (
    SELECT 1 FROM crm.lead_events manual
    WHERE manual.lead_id=l.id AND manual.event_type='manual_lead_created'
      AND EXISTS (
        SELECT 1 FROM crm.lead_events erp
        WHERE erp.lead_id=l.id AND erp.details->>'origin'='erpnext-sales-order'
          AND erp.created_at>manual.created_at
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM crm.lead_events erp_created
    WHERE erp_created.lead_id=l.id AND erp_created.event_type='lead_created'
      AND erp_created.details->>'origin'='erpnext-sales-order'
  )
ORDER BY l.id,r.created_at ASC;

UPDATE crm.leads l SET
  source_code=m.verified_source_code,
  source_name=m.verified_source_name,
  source_history=coalesce(l.source_history,'[]'::jsonb)||jsonb_build_array(
    jsonb_build_object('source',m.verified_source_code,'at',now(),
      'reason','verified_source_from_original_manual_lead_request','requestId',m.request_id)
  ),
  updated_at=now()
FROM _verified_historical_manual_sources m WHERE l.id=m.id AND l.source_code=m.old_source_code;

INSERT INTO crm.lead_events(lead_id,event_type,note,details,created_at)
SELECT m.id,'source_reconciled',
  'تصحيح المصدر بعد التحقق من مصدر طلب الإضافة اليدوية الأصلي السابق لطلب البيع',
  jsonb_build_object('from',m.old_source_code,'to',m.verified_source_code,
    'originalRequestId',m.request_id,'evidence','manual_request_source_before_erp_order',
    'reconciledBy','approved_manual_sql'),now()
FROM _verified_historical_manual_sources m;

-- Correct legacy ERP transaction source attribution only where the source of
-- the linked CRM lead is known and distinct from the technical ERP origin.
UPDATE crm.sales_transactions st SET
  source_code=l.source_code,
  source_name=coalesce(src.name,nullif(l.source_name,''),st.source_name),
  metadata=coalesce(st.metadata,'{}'::jsonb)||jsonb_build_object(
    'sourceAttributionCorrection',jsonb_build_object(
      'at',now(),'previousSourceCode',st.source_code,
      'previousSourceName',st.source_name,
      'restoredSourceCode',l.source_code,
      'evidence','linked_crm_lead_known_acquisition_source'
    )
  ),
  updated_at=now()
FROM crm.leads l
LEFT JOIN core.sources src ON src.code=l.source_code
WHERE st.lead_id=l.id
  AND l.is_deleted IS DISTINCT FROM TRUE
  AND st.source_type IN ('erpnext_sales_order','erp_reconciliation')
  AND lower(coalesce(st.source_code,'')) IN ('next_erp','website')
  AND lower(coalesce(l.source_code,'')) NOT IN ('','next_erp','website')
  AND st.source_code IS DISTINCT FROM l.source_code;

COMMIT;
