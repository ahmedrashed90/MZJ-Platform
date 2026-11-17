-- READ ONLY. Use the same Riyadh-local date window on the main dashboard,
-- CRM cash/finance/service dashboards and CRM reports.
-- This query checks the customer cohort, NOT dated sales transaction quantities.
WITH limits AS (
  SELECT DATE '2026-10-01' AS date_from, DATE '2026-10-31' AS date_to
), customers AS (
  SELECT l.id,
         COALESCE(NULLIF(l.phone_normalized,''),
                  NULLIF(regexp_replace(l.phone,'[^0-9]','','g'),''),l.id::text) AS phone_key,
         l.department_code,
         CASE WHEN src.report_group IN ('digital','direct')
              THEN src.report_group ELSE 'other' END AS source_group
  FROM crm.leads l
  LEFT JOIN core.sources src ON src.code=l.source_code
  CROSS JOIN limits date_window
  WHERE l.is_deleted=false
    AND (
      l.status_label IS DISTINCT FROM 'غير مؤهل'
      OR (
        COALESCE(
          (SELECT MAX(e.created_at) FROM crm.lead_events e
           WHERE e.lead_id=l.id AND e.new_status='غير مؤهل'
             AND e.event_type IN ('status_change','department_transfer','manual_status_change')),
          l.registered_at,l.created_at
        ) AT TIME ZONE 'Asia/Riyadh'
      )::date BETWEEN date_window.date_from AND date_window.date_to
    )
)
SELECT
  COUNT(DISTINCT id)::int AS customer_records,
  COUNT(DISTINCT phone_key)::int AS unique_phone_keys,
  COUNT(*) FILTER (WHERE department_code IN ('cash_sales','wholesale','wholesale_sales'))::int AS cash,
  COUNT(*) FILTER (WHERE department_code IN ('finance_sales','call_center'))::int AS finance,
  COUNT(*) FILTER (WHERE department_code='customer_service')::int AS service,
  COUNT(*) FILTER (WHERE department_code IS NULL OR department_code NOT IN
    ('cash_sales','wholesale','wholesale_sales','finance_sales','call_center','customer_service'))::int AS unclassified,
  COUNT(*) FILTER (WHERE source_group='digital')::int AS digital,
  COUNT(*) FILTER (WHERE source_group='direct')::int AS direct,
  COUNT(*) FILTER (WHERE source_group='other')::int AS other,
  (COUNT(*) = COUNT(*) FILTER (WHERE department_code IN
    ('cash_sales','wholesale','wholesale_sales','finance_sales','call_center','customer_service'))
    + COUNT(*) FILTER (WHERE department_code IS NULL OR department_code NOT IN
    ('cash_sales','wholesale','wholesale_sales','finance_sales','call_center','customer_service'))
  ) AS departments_reconcile,
  (COUNT(*) = COUNT(*) FILTER (WHERE source_group IN ('digital','direct','other'))) AS sources_reconcile
FROM customers;
