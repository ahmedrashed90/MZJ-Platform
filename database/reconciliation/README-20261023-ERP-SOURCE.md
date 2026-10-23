# MZJ CRM — one-time 2026-10-23 historical sales-source reconciliation

**This is a database-data correction, not a deployment-time patch.** It is
separate from the existing clean source fixes in `_erpnext-sales-order-sync.ts`
and `crm/reports.ts`. The production Neon database is **not connected in this
ChatGPT session**; packaging a script does not execute it.

## Verified input evidence from Neon (as supplied by the operator)

- Exactly 1 manual-created lead has an original, catalog-verifiable source:
  **دلال بنت خلف بن حاسن الحميدي**, lead
  `f4436112-8b3d-40ff-b71f-dafb087de3d4`, original manual request
  `26ed1593-1770-40f2-941d-2774a45c2b9a`, original source **`friend`**.
- Exactly 115 ERP transaction source fields are still technical `next_erp` /
  `website` but are attributed to an existing CRM lead with a distinct known
  acquisition source; these transactions represent 109 distinct customers.
  Distribution: `branch` 86 transactions / 83 customers, `haraj` 16 / 15,
  `other_website` 6 / 5, `whatsapp` 6 / 5,
  `unified_number` 1 / 1.
- Treat the *current* CRM lead source as the latest known attribution for the
  115 sale transactions. This does **not** prove an unrecorded original source
  for every historic lead. Unknown or ERP-created leads stay unchanged.

## Execution order in Neon SQL Editor

1. **Create and verify an independent Neon branch/restore-point backup first.**
   The in-database BEFORE snapshots created by APPLY are useful for specific-row
   reversals but are not a substitute for an independent recovery backup.
2. Run the full script
   `20261023_crm_erp_sale_source_APPLY_AFTER_APPROVAL.sql` exactly once.
   It creates two persistent snapshots in `crm_reconciliation` first, then
   changes only one verified lead's `source_code`, `source_name`,
   `source_history`, `updated_at`, appends one audit event, and corrects 115
   sale transactions' `source_code`, `source_name`, attribution metadata,
   and `updated_at`.
3. The script refuses to proceed unless live candidate totals still match
   exactly **1 lead**, **115 transactions**, **109 customers**, and the five
   individual source counts. An exception rolls back all changes atomically.
4. On success the trailing result query must show
   `lead_source_updated = 1`, `sales_transaction_sources_updated = 115`.
5. Run `20261023_crm_erp_sale_source_VERIFY.sql`; it must show
   1 corrected lead, 115 corrected transactions, 109 customers, and
   0 unexpected changes in sale facts. Validate the five grouped source totals.
6. `20261023_crm_erp_sale_source_ROLLBACK.sql` is an **emergency** rollback
   dependent on the saved snapshots. Do **not** run unless needed. It also
   refuses to overwrite later changed source records.

This update **does not change** customer sold status, sale quantities,
sale dates, sale values, customer names, phone numbers, assignments,
departments, branches, or ERP order references. It also does not retroactively
restore old assignment/department changes; those require a separate audit.

**If the script aborts because live data has changed, do not remove the guards
or run fragments.** Review new counts and the production state first.
