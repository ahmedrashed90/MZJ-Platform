-- MZJ CRM / NEXT ERP canonical sales reconciliation
-- Scope: ONLY active duplicate crm.sales_transactions that share the same
-- source_reference with an active linked NEXT ERP Sales Order.
-- Safe/idempotent: non-duplicate sales are not touched.

BEGIN;

CREATE TEMP TABLE _erp_sales_duplicate_rows ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    st.id,
    st.source_reference AS sales_order_no,
    row_number() OVER (
      PARTITION BY st.source_reference
      ORDER BY
        CASE
          WHEN st.source_type = 'erpnext_sales_order' THEN 0
          WHEN st.source_type = 'erp_reconciliation' THEN 1
          ELSE 2
        END,
        st.created_at ASC,
        st.id ASC
    ) AS rn,
    count(*) OVER (PARTITION BY st.source_reference) AS active_count
  FROM crm.sales_transactions st
  JOIN integrations.erpnext_sales_orders so
    ON so.sales_order_no = st.source_reference
   AND coalesce(so.is_cancelled,false) = false
   AND so.crm_lead_id IS NOT NULL
  WHERE coalesce(st.is_cancelled,false) = false
    AND nullif(st.source_reference,'') IS NOT NULL
)
SELECT id,sales_order_no,rn,active_count
FROM ranked
WHERE active_count > 1;

-- Cancel only the extra rows. Keep one canonical row per Sales Order.
UPDATE crm.sales_transactions st
SET
  is_cancelled = true,
  cancelled_at = coalesce(st.cancelled_at,now()),
  metadata = coalesce(st.metadata,'{}'::jsonb) || jsonb_build_object(
    'mergedIntoCanonicalSalesOrder', d.sales_order_no,
    'mergedReason', 'erpnext_sales_order_deduplication',
    'reconciledAt', now()
  ),
  updated_at = now()
FROM _erp_sales_duplicate_rows d
WHERE d.rn > 1
  AND st.id = d.id;

-- Canonicalize the single row we kept using the linked NEXT ERP order snapshot.
WITH keepers AS (
  SELECT d.id,d.sales_order_no
  FROM _erp_sales_duplicate_rows d
  WHERE d.rn = 1
),
erp AS (
  SELECT DISTINCT ON (so.sales_order_no)
    so.sales_order_no,
    so.crm_lead_id,
    so.order_date,
    so.total_incl_vat,
    so.platform_user_id,
    so.platform_user_name,
    so.platform_department_code,
    so.platform_branch_code,
    coalesce(v.quantity,1)::int AS quantity
  FROM integrations.erpnext_sales_orders so
  LEFT JOIN LATERAL (
    SELECT nullif(sum(greatest(coalesce(sov.qty,1),1)) FILTER (WHERE coalesce(sov.is_cancelled,false)=false),0)::int AS quantity
    FROM integrations.erpnext_sales_order_vehicles sov
    WHERE sov.sales_order_id = so.id
  ) v ON true
  WHERE coalesce(so.is_cancelled,false)=false
    AND so.crm_lead_id IS NOT NULL
  ORDER BY so.sales_order_no,so.updated_at DESC
)
UPDATE crm.sales_transactions st
SET
  source_type = 'erpnext_sales_order',
  lead_id = erp.crm_lead_id,
  sale_at = coalesce((erp.order_date::timestamp AT TIME ZONE 'Asia/Riyadh'),st.sale_at),
  quantity = greatest(coalesce(erp.quantity,st.quantity,1),1),
  total_amount = greatest(coalesce(erp.total_incl_vat,st.total_amount,0),0),
  assigned_to = coalesce(erp.platform_user_id,st.assigned_to),
  assigned_name = coalesce(nullif(erp.platform_user_name,''),st.assigned_name),
  department_code = coalesce(nullif(erp.platform_department_code,''),st.department_code),
  branch_code = coalesce(nullif(erp.platform_branch_code,''),st.branch_code),
  source_code = 'next_erp',
  source_name = 'NEXT ERP',
  metadata = coalesce(st.metadata,'{}'::jsonb) || jsonb_build_object(
    'canonicalSalesTransaction', true,
    'salesOrderNo', erp.sales_order_no,
    'reconciledAt', now()
  ),
  is_cancelled = false,
  cancelled_at = null,
  cancelled_by = null,
  updated_at = now()
FROM keepers k
JOIN erp ON erp.sales_order_no = k.sales_order_no
WHERE st.id = k.id;

DO $$
DECLARE
  remaining integer;
BEGIN
  SELECT count(*) INTO remaining
  FROM (
    SELECT st.source_reference
    FROM crm.sales_transactions st
    JOIN integrations.erpnext_sales_orders so
      ON so.sales_order_no = st.source_reference
     AND coalesce(so.is_cancelled,false)=false
    WHERE coalesce(st.is_cancelled,false)=false
      AND nullif(st.source_reference,'') IS NOT NULL
    GROUP BY st.source_reference
    HAVING count(*) > 1
  ) d;

  IF remaining <> 0 THEN
    RAISE EXCEPTION 'Canonical sales reconciliation failed: % duplicate Sales Orders remain', remaining;
  END IF;
END $$;

COMMIT;
