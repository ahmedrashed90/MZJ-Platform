-- MZJ CRM / NEXT ERP canonical sales reconciliation
-- Version: 1.19.10
-- Purpose: collapse duplicate CRM sales rows for the same active NEXT ERP Sales Order
-- into exactly one canonical transaction without touching unrelated sales.
--
-- Important safety rules:
-- 1) Scope is limited to source_reference values that equal an active NEXT ERP Sales Order number.
-- 2) The script is idempotent.
-- 3) It preserves one canonical row and only cancels extra active rows.
-- 4) It handles ERP orders whose crm_lead_id is still NULL by falling back to the unique phone match,
--    then to a unanimous lead_id across the duplicate transaction rows.
-- 5) If a duplicate Sales Order points to conflicting CRM leads and ERP/phone cannot resolve it,
--    the script stops BEFORE changing data.

BEGIN;

-- Latest active ERP snapshot for every Sales Order number.
CREATE TEMP TABLE _erp_active_orders ON COMMIT DROP AS
WITH latest AS (
  SELECT DISTINCT ON (so.sales_order_no)
    so.id,
    so.sales_order_no,
    so.crm_lead_id,
    so.actual_customer_phone_normalized,
    so.order_date,
    so.total_incl_vat,
    so.platform_user_id,
    so.platform_user_name,
    so.platform_department_code,
    so.platform_branch_code,
    so.updated_at
  FROM integrations.erpnext_sales_orders so
  WHERE coalesce(so.is_cancelled,false)=false
    AND nullif(so.sales_order_no,'') IS NOT NULL
  ORDER BY so.sales_order_no,so.updated_at DESC,so.id DESC
), with_phone_match AS (
  SELECT
    latest.*,
    phone_match.lead_id AS phone_lead_id
  FROM latest
  LEFT JOIN LATERAL (
    SELECT l.id AS lead_id
    FROM crm.leads l
    WHERE l.is_deleted=false
      AND nullif(latest.actual_customer_phone_normalized,'') IS NOT NULL
      AND l.phone_normalized=latest.actual_customer_phone_normalized
    ORDER BY l.updated_at DESC,l.id
    LIMIT 1
  ) phone_match ON true
)
SELECT * FROM with_phone_match;

-- Only Sales Orders that currently have more than one ACTIVE sales transaction are in scope.
CREATE TEMP TABLE _erp_duplicate_orders ON COMMIT DROP AS
SELECT
  st.source_reference AS sales_order_no,
  count(*)::int AS active_rows,
  count(DISTINCT st.lead_id)::int AS distinct_active_leads,
  min(st.lead_id::text)::uuid AS unanimous_lead_id
FROM crm.sales_transactions st
JOIN _erp_active_orders erp
  ON erp.sales_order_no=st.source_reference
WHERE coalesce(st.is_cancelled,false)=false
  AND nullif(st.source_reference,'') IS NOT NULL
GROUP BY st.source_reference
HAVING count(*)>1;

-- Stop before any update when the Sales Order cannot be tied safely to one CRM lead.
DO $$
DECLARE
  ambiguous integer;
BEGIN
  SELECT count(*) INTO ambiguous
  FROM _erp_duplicate_orders d
  JOIN _erp_active_orders erp ON erp.sales_order_no=d.sales_order_no
  WHERE erp.crm_lead_id IS NULL
    AND erp.phone_lead_id IS NULL
    AND d.distinct_active_leads>1;

  IF ambiguous<>0 THEN
    RAISE EXCEPTION
      'Canonical sales reconciliation stopped safely: % duplicate Sales Orders have conflicting CRM leads and no ERP/phone match',
      ambiguous;
  END IF;
END $$;

-- Pick exactly one canonical physical row per duplicate order.
-- Reuse an existing erpnext_sales_order row even if it was cancelled previously; this avoids
-- colliding with the existing unique index on (source_type,source_reference).
CREATE TEMP TABLE _erp_canonical_rows ON COMMIT DROP AS
SELECT DISTINCT ON (d.sales_order_no)
  d.sales_order_no,
  st.id AS canonical_id
FROM _erp_duplicate_orders d
JOIN crm.sales_transactions st
  ON st.source_reference=d.sales_order_no
ORDER BY
  d.sales_order_no,
  CASE
    WHEN st.source_type='erpnext_sales_order' THEN 0
    WHEN coalesce(st.is_cancelled,false)=false AND st.source_type='erp_reconciliation' THEN 1
    WHEN coalesce(st.is_cancelled,false)=false THEN 2
    WHEN st.source_type='erp_reconciliation' THEN 3
    ELSE 4
  END,
  st.created_at ASC,
  st.id ASC;

-- Cancel ONLY active extras for the duplicate Sales Orders.
UPDATE crm.sales_transactions st
SET
  is_cancelled=true,
  cancelled_at=coalesce(st.cancelled_at,now()),
  metadata=coalesce(st.metadata,'{}'::jsonb) || jsonb_build_object(
    'mergedIntoCanonicalSalesOrder', c.sales_order_no,
    'mergedReason', 'erpnext_sales_order_deduplication',
    'reconciledAt', now()
  ),
  updated_at=now()
FROM _erp_canonical_rows c
WHERE st.source_reference=c.sales_order_no
  AND st.id<>c.canonical_id
  AND coalesce(st.is_cancelled,false)=false;

-- Canonicalize/re-activate the selected row from the ERP snapshot.
WITH vehicle_qty AS (
  SELECT
    so.id AS sales_order_id,
    coalesce(
      nullif(sum(greatest(coalesce(sov.qty,1),1)) FILTER (WHERE coalesce(sov.is_cancelled,false)=false),0),
      1
    )::int AS quantity
  FROM _erp_active_orders erp
  JOIN integrations.erpnext_sales_orders so ON so.id=erp.id
  LEFT JOIN integrations.erpnext_sales_order_vehicles sov ON sov.sales_order_id=so.id
  GROUP BY so.id
), resolved AS (
  SELECT
    erp.sales_order_no,
    c.canonical_id,
    coalesce(
      erp.crm_lead_id,
      erp.phone_lead_id,
      CASE WHEN d.distinct_active_leads=1 THEN d.unanimous_lead_id ELSE NULL END
    ) AS resolved_lead_id,
    erp.order_date,
    erp.total_incl_vat,
    erp.platform_user_id,
    erp.platform_user_name,
    erp.platform_department_code,
    erp.platform_branch_code,
    v.quantity
  FROM _erp_duplicate_orders d
  JOIN _erp_active_orders erp ON erp.sales_order_no=d.sales_order_no
  JOIN _erp_canonical_rows c ON c.sales_order_no=d.sales_order_no
  LEFT JOIN vehicle_qty v ON v.sales_order_id=erp.id
)
UPDATE crm.sales_transactions st
SET
  source_type='erpnext_sales_order',
  source_reference=r.sales_order_no,
  lead_id=coalesce(r.resolved_lead_id,st.lead_id),
  sale_at=coalesce((r.order_date::timestamp AT TIME ZONE 'Asia/Riyadh'),st.sale_at),
  quantity=greatest(coalesce(r.quantity,st.quantity,1),1),
  total_amount=greatest(coalesce(r.total_incl_vat,st.total_amount,0),0),
  assigned_to=coalesce(r.platform_user_id,st.assigned_to),
  assigned_name=coalesce(nullif(r.platform_user_name,''),st.assigned_name),
  department_code=coalesce(nullif(r.platform_department_code,''),st.department_code),
  branch_code=coalesce(nullif(r.platform_branch_code,''),st.branch_code),
  source_code='next_erp',
  source_name='NEXT ERP',
  metadata=coalesce(st.metadata,'{}'::jsonb) || jsonb_build_object(
    'canonicalSalesTransaction', true,
    'salesOrderNo', r.sales_order_no,
    'reconciledAt', now(),
    'reconciliationVersion', '1.19.10'
  ),
  is_cancelled=false,
  cancelled_at=null,
  cancelled_by=null,
  updated_at=now()
FROM resolved r
WHERE st.id=r.canonical_id;

-- Final invariant: every active NEXT ERP Sales Order may have at most ONE active CRM sales transaction.
DO $$
DECLARE
  remaining integer;
BEGIN
  SELECT count(*) INTO remaining
  FROM (
    SELECT st.source_reference
    FROM crm.sales_transactions st
    JOIN _erp_active_orders erp
      ON erp.sales_order_no=st.source_reference
    WHERE coalesce(st.is_cancelled,false)=false
      AND nullif(st.source_reference,'') IS NOT NULL
    GROUP BY st.source_reference
    HAVING count(*)>1
  ) d;

  IF remaining<>0 THEN
    RAISE EXCEPTION
      'Canonical sales reconciliation failed: % duplicate Sales Orders remain',
      remaining;
  END IF;
END $$;

-- Return a compact verification result before commit.
SELECT
  count(*)::int AS reconciled_sales_orders,
  coalesce(sum(d.active_rows-1),0)::int AS cancelled_duplicate_rows
FROM _erp_duplicate_orders d;

COMMIT;
