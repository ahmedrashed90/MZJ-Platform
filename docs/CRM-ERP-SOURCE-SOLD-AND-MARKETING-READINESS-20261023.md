# CRM sales source / NEXT ERP and marketing task readiness — 2026-10-23

## Direct source changes (not runtime patches)

- `server/_erpnext-sales-order-sync.ts`: Existing CRM customer records keep
  their acquisition source/name/history/platform, customer name/phone, original
  salesperson, department, branch and service. Receipt of a new ERP sale changes
  sales status / sale metadata only; the original service request is closed
  without reassignment. Existing contact name/phone is preserved unless blank.
- Canonical `crm.sales_transactions` still records the actual ERP salesperson,
  branch, department, amount, quantity and sale date, **but stores the CRM
  customer's known acquisition source** instead of blindly writing `next_erp`.
  The order origin remains explicitly recorded in metadata. A previously
  recorded non-technical acquisition source survives an ERP retry/replay.
- `server/crm/reports.ts`: Historical ERP sale transactions with technical
  `next_erp`/`website` source markers are read under the linked customer's
  known non-ERP source. No separate sale-fact source is introduced; date,
  count, quantity, value, assignment and department reporting remain based on
  the canonical sales transactions.
- `database/reconcile-duplicate-erp-sales-transactions.sql`: Existing manual
  deduplication reconciliation is consistent with the corrected attribution
  logic and preserves a known transaction-source snapshot.
- `src/marketing/workflow/workflow.css`: Only the overall task readiness inside
  the task detail overview has green text, percent and progress bar. Individual
  required item's readiness color and all readiness computations are unchanged.

## Historical data handling

**Deploying the source does not mutate existing Neon rows to fix their sources.**
The report read-time fallback addresses old ERP-origin transactions when the
linked CRM lead's known current acquisition source differs from the technical
transaction source. The one-time SQL reconciliation is included ONLY as a
manual review/approval package in `database/reconciliation/`:

- `20261023_crm_erp_sale_source_PREVIEW.sql` — read-only evidence and candidate list.
- `20261023_crm_erp_sale_source_APPLY_AFTER_APPROVAL.sql` — **never automatic**;
  requires inspected preview, a verified backup and explicit approval.

The SQL does not infer an original acquisition source from an ERP-created lead,
from `source_history` alone, or from a manual-creation event without an original
manual request source. Clients with no independently verifiable original source
remain unchanged pending genuine historic evidence.

Historic rep/department/branch drift can be inspected via the read-only
PREVIEW's final query; it is not automatically rewritten because customer
transfer history may have changed legitimately since the original ERP order.

## Local validation

- ERP transaction canonical sync: passed 12/12.
- ERP sales deduplication: passed 12/12.
- CRM canonical sold facts: passed 8/8.
- CRM report SQL contexts: passed 12/12.
- ERP cancellation/tracking sync: passed 20/20.
- Marketing workflow: passed 106/106.
- Marketing review KPI: passed 18/18.
- New focused regression covering source preservation, replay, report fallback,
  existing customer fields and task-only green readiness: passed.
- TypeScript source syntax and CSS parsing: passed.
- Full pnpm/Vite build: **not executed**; package dependencies are not present
  in the provided ZIP and the local environment cannot retrieve them.
- Existing `check-erpnext-advance-paid-sales-followup-20260805.mjs` has three
  failures in the ORIGINAL uploaded ZIP; the same three exist before/after
  these requested changes. They are unrelated to source attribution/readiness.
