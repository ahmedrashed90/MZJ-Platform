# Historical ERP-to-CRM source correction — 2026-10-23

**No historical database changes are run by deploying the code.**

1. Code fixes in the main ERP sales path preserve existing CRM lead source,
   assignment, department, branch, and customer details. The ERP transaction
   retains its real sales actor and amount while storing the CRM lead's known
   acquisition source as the transaction source. The ERP order origin stays in
   transaction metadata.
2. The CRM reports have a **read-only fallback** for old ERP transactions whose
   source field still contains the technical `next_erp` / `website` marker while
   their linked CRM lead has a known non-ERP acquisition source. Reports reflect
   that customer's source after code deployment, with no DB mutation.
3. To permanently correct old records, first run
   `20261023_crm_erp_sale_source_PREVIEW.sql` in Neon SQL Editor (read-only).
   Review the listed customers and transactions and take a verified backup.
4. **Only after explicit approval**, manually run
   `20261023_crm_erp_sale_source_APPLY_AFTER_APPROVAL.sql`. This is separate from
   automatic schema migrations; it changes only source attribution, source
   history, and audit metadata on rows proven by the query. It does not modify
   sale dates, quantities, prices, sales actor, department, branch, or orders.
5. Existing leads with current source `next_erp` and manual creation events are
   NOT automatically assigned `branch`. That event alone does **not** prove the
   historical source. To restore one, the SQL requires a CRM manual request
   with `created_lead_id` matching the lead, created within 5 minutes of the
   original lead and storing a catalog-registered non-ERP source, plus an ERP
   sale event later than manual creation. Manual duplicate approvals are not
   considered original acquisition evidence.
6. Where the original CRM source cannot be verified from a request, audit log,
   authenticated import, or historical backup, neither script changes the
   customer's current acquisition source. Never bulk-change all `next_erp`
   leads or treat a newer `source_history` entry as proof of the original.
7. Compare grouped source totals, count of active sales transactions, sum of
   quantity, sales value, and sales dates before and after any approved APPLY.
   Exact historic correction counts are NOT knowable from the previous chat
   exports alone; do not assume 80 or 89.

The PREVIEW also lists department/branch/representative differences against
`integrations.erpnext_sales_orders.crm_previous_state`. These are for investigation
only; none are automatically restored, because a later legitimate CRM transfer
may have occurred after the ERP sync.
