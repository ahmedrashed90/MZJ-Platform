MZJ CRM - Complete Clean Source - 2026-11-07
===============================================
This is the FULL original project, not a patch package. All 891 original files
are retained. No database values, existing customer records, schema migrations,
Vercel settings or external running systems were changed during preparation.

Scope of the change
-------------------
1. server/_crm-lead-import.ts
   - Serializes inbound imports from all supported lead platforms for the same
     normalized customer phone using a shared PostgreSQL advisory lock.
   - Existing CRM leads are NOT reclassified, assigned, redistributed or reset
     even when an open finance request lacks an assigned user.
   - Their original source_code, source_name, platform_code, customer record,
     status, branch, department, representative and request are preserved.
   - Only new source provenance (source_history and non-operational import
     metadata) is updated on an existing lead; original source is backfilled
     into source_history if absent.
   - Existing conversations preserve the current routing/ownership and linked
     request. Imported events are de-duplicated by route, source and event ID.
   - Newly created leads retain the existing classification and routing code.

2. server/marketing/lead-forms-crm.ts
   - Existing CRM customers are passed through the same protected import path
     to record a newly arrived advertising source (previously the form bridge
     returned early without recording the new source in CRM).
   - Sales team eligibility is checked ONLY for genuinely new customers.
   - The linked/existing result is determined from the locked import processor
     to handle cross-platform races, with no repeat new-lead notification.

3. Validation scripts
   - scripts/test-crm-preserve-status-on-repeat-import-20261107.mjs (updated)
   - scripts/test-crm-import-phone-lock-runtime-20261107.mjs (new)
   - scripts/test-marketing-form-crm-existing-provenance-20261107.mjs (new)

Local validation
----------------
PASS: structural repeat-import checks
PASS: simulated concurrent inbound imports from different platforms
PASS: existing status/source/owner/request preserved (including finance)
PASS: new lead follows the original classification and distribution code
PASS: existing marketing form source recorded without reclassification
PASS: new marketing form eligibility and notification path
PASS: existing CRM service, automation, data, manual lead, ERP source tests
PASS: existing marketing lead forms and spreadsheet import tests
PASS: imports, source structure and conflict marker checks

Known baseline limitation: check-crm-routing-v71.mjs has two unrelated failures
concerning ERP sales ownership in the UNMODIFIED original ZIP too. No ERP
source code was modified to disguise those failures.

A complete Vercel build/typecheck and production database integration test were
not possible in this offline runtime because project node_modules were absent
and the npm registry was unreachable. Source syntax, isolated runtime mock tests
and the existing checks listed above were executed. Run the project's normal
build in the deployment environment (install with its pnpm-lock.yaml).

Release notes
-------------
Deploy the complete project from this archive in the normal Vercel process.
No manual SQL execution is required for this source-level fix. Do not re-run the
54-customer recovery: those records were restored already, separately.
Archive does not deploy automatically, change customer data or touch the
production environment. Test a real phone submission only after deployment.
