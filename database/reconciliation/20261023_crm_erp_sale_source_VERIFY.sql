-- Read-only verification of MZJ historical correction; execute AFTER APPLY.
-- Expected: 1 lead, 115 sales, 109 distinct customers, 0 exceptions.
SELECT 'corrected_lead' AS metric,count(*)::integer AS value
FROM crm_reconciliation.crm_erp_source_lead_20261023_before b
JOIN crm.leads l ON l.id=b.id AND l.source_code=b.target_source_code
UNION ALL
SELECT 'corrected_sales',count(*)::integer
FROM crm_reconciliation.crm_erp_source_sales_20261023_before b
JOIN crm.sales_transactions st ON st.id=b.id
WHERE st.source_code=b.target_source_code
  AND st.metadata#>>'{sourceAttributionCorrection,runId}'='MZJ-CRM-ERP-SOURCE-20261023'
UNION ALL
SELECT 'unique_customers',count(DISTINCT lead_id)::integer
FROM crm_reconciliation.crm_erp_source_sales_20261023_before
UNION ALL
SELECT 'unexpected_sale_fact_changes',count(*)::integer
FROM crm_reconciliation.crm_erp_source_sales_20261023_before b
JOIN crm.sales_transactions st ON st.id=b.id
WHERE st.sale_at IS DISTINCT FROM b.before_sale_at
  OR st.quantity IS DISTINCT FROM b.before_quantity
  OR st.total_amount IS DISTINCT FROM b.before_total_amount
  OR st.assigned_to IS DISTINCT FROM b.before_assigned_to
  OR st.department_code IS DISTINCT FROM b.before_department_code
  OR st.branch_code IS DISTINCT FROM b.before_branch_code
  OR st.source_reference IS DISTINCT FROM b.source_reference;

SELECT b.target_source_code AS corrected_source,
  b.target_source_name AS source_name,
  count(*)::integer AS sales_transactions,
  count(DISTINCT b.lead_id)::integer AS unique_customers
FROM crm_reconciliation.crm_erp_source_sales_20261023_before b
JOIN crm.sales_transactions st ON st.id=b.id
  AND st.source_code=b.target_source_code
GROUP BY b.target_source_code,b.target_source_name
ORDER BY sales_transactions DESC;
