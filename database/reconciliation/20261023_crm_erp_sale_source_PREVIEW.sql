-- READ ONLY. Run in Neon SQL Editor; makes no database changes.
-- A NEXT ERP Sales Order identifies the order's origin, NOT how the customer
-- originally arrived. The direct CRM lead's source is the best current evidence
-- for older ERP sales transaction rows. If the current lead source is also NEXT
-- ERP but the lead was originally created manually, it is only safe to restore
-- its historic source if the original manual request row still stores it.
-- NEVER infer an old source_code from the event_type alone.
WITH manual_request_source AS (
  SELECT DISTINCT ON (l.id)
    l.id,r.source_code AS recovered_source_code,r.created_at AS request_created_at
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
          WHERE erp.lead_id=l.id
            AND erp.details->>'origin'='erpnext-sales-order'
            AND erp.created_at>manual.created_at
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM crm.lead_events erp_created
      WHERE erp_created.lead_id=l.id AND erp_created.event_type='lead_created'
        AND erp_created.details->>'origin'='erpnext-sales-order'
    )
  ORDER BY l.id,r.created_at ASC
),
manual_without_verification AS (
  SELECT l.id
  FROM crm.leads l
  WHERE l.is_deleted IS DISTINCT FROM TRUE AND l.source_code='next_erp'
    AND EXISTS (
      SELECT 1 FROM crm.lead_events manual
      WHERE manual.lead_id=l.id AND manual.event_type='manual_lead_created'
        AND EXISTS (
          SELECT 1 FROM crm.lead_events erp
          WHERE erp.lead_id=l.id AND erp.details->>'origin'='erpnext-sales-order'
            AND erp.created_at>manual.created_at
        )
    )
    AND NOT EXISTS (SELECT 1 FROM manual_request_source proof WHERE proof.id=l.id)
),
known_source AS (
  SELECT l.id,
    coalesce(m.recovered_source_code,l.source_code) AS verified_source_code
  FROM crm.leads l LEFT JOIN manual_request_source m ON m.id=l.id
  WHERE l.is_deleted IS DISTINCT FROM TRUE
)
SELECT 'LEADS_WITH_DIRECT_MANUAL_REQUEST_SOURCE' AS check_name,count(*)::int AS rows
FROM manual_request_source
UNION ALL
SELECT 'MANUAL_ORIGIN_WITHOUT_VERIFIABLE_SOURCE',count(*)::int FROM manual_without_verification
UNION ALL
SELECT 'ERP_TRANSACTIONS_WITH_STALE_TECHNICAL_SOURCE',count(*)::int
FROM crm.sales_transactions st JOIN known_source k ON k.id=st.lead_id
WHERE st.source_type IN ('erpnext_sales_order','erp_reconciliation')
  AND lower(coalesce(st.source_code,'')) IN ('next_erp','website')
  AND lower(coalesce(k.verified_source_code,'')) NOT IN ('','next_erp','website')
  AND st.source_code IS DISTINCT FROM k.verified_source_code;

-- Independently inspect current sales whose source is the order's technical origin
-- rather than the customer's known acquisition source.
SELECT st.id::text AS transaction_id,l.id::text AS lead_id,l.customer_name,
  st.source_reference AS sales_order_no,st.sale_at,st.source_type,
  st.source_code AS current_sale_source, l.source_code AS known_crm_lead_source,
  st.source_name AS current_sale_source_name,l.source_name AS known_crm_source_name
FROM crm.sales_transactions st
JOIN crm.leads l ON l.id=st.lead_id AND l.is_deleted IS DISTINCT FROM TRUE
WHERE st.source_type IN ('erpnext_sales_order','erp_reconciliation')
  AND lower(coalesce(st.source_code,'')) IN ('next_erp','website')
  AND lower(coalesce(l.source_code,'')) NOT IN ('','next_erp','website')
  AND st.source_code IS DISTINCT FROM l.source_code
ORDER BY st.sale_at,st.source_reference,st.id;

-- Look up ORIGINAL manual request source (if it still exists), before approving
-- any lead-source restoration for a previously manual-created customer.
SELECT l.id::text AS lead_id,l.customer_name,l.source_code AS current_source,
  r.id::text AS original_request_id,r.source_code AS original_request_source,
  r.created_at AS original_request_created_at,l.created_at AS lead_created_at
FROM crm.leads l
JOIN crm.manual_lead_requests r ON r.created_lead_id=l.id
  AND r.created_at BETWEEN l.created_at - interval '5 minutes' AND l.created_at + interval '5 minutes'
WHERE l.is_deleted IS DISTINCT FROM TRUE AND l.source_code='next_erp'
  AND EXISTS (SELECT 1 FROM crm.lead_events e WHERE e.lead_id=l.id AND e.event_type='manual_lead_created')
ORDER BY l.created_at,r.created_at;

-- Separate investigation only: some historic ERP events also changed the
-- customer's department/branch/salesperson. Do NOT restore these automatically:
-- the CRM user may have legitimately transferred them again afterward.
SELECT l.id::text AS lead_id,l.customer_name,so.sales_order_no,
  so.crm_previous_state->>'departmentCode' AS prior_department,l.department_code AS current_department,
  so.crm_previous_state->>'branchCode' AS prior_branch,l.branch_code AS current_branch,
  so.crm_previous_state->>'assignedTo' AS prior_assigned_to,l.assigned_to::text AS current_assigned_to
FROM integrations.erpnext_sales_orders so
JOIN crm.leads l ON l.id=so.crm_lead_id AND l.is_deleted IS DISTINCT FROM TRUE
WHERE so.crm_previous_state IS NOT NULL
  AND coalesce(so.crm_created_by_integration,false)=false
  AND (
    l.department_code IS DISTINCT FROM so.crm_previous_state->>'departmentCode'
    OR l.branch_code IS DISTINCT FROM so.crm_previous_state->>'branchCode'
    OR l.assigned_to::text IS DISTINCT FROM so.crm_previous_state->>'assignedTo'
  )
ORDER BY so.received_at,so.sales_order_no;
