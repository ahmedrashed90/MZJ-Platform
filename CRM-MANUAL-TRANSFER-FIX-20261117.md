# CRM Manual Duplicate Transfer Fix — 2026-11-17

## Problem
Approval of a duplicate manual-lead request overwrote the canonical CRM customer's name, phone, car data, location, and notes, and approved requests without confirming the target update. The branch did not follow the selected representative.

## Fix
- Approval is reserved for CRM managers and pending duplicate requests.
- Approval validates the original canonical lead and normalized phone match, then locks both request and customer rows.
- The selected active representative is verified and their primary active branch read from core.user_branches.
- Only assigned_to, branch_code (if changed), updated_by, updated_at on crm.leads are updated.
- Request approval and CRM lead_events audit record happen in the same database transaction.
- Repeat approvals and rejected requests cannot be approved again.
- Approved linked manual requests cannot silently edit the customer record via the request-edit screen.
- UI success text reflects a transfer instead of a data replacement.

## Validation
- `tsc --noEmit -p tsconfig.json`: PASS
- `node scripts/check-crm-manual-leads-v1160.mjs`: PASS
- `node scripts/test-crm-manual-duplicate-transfer-20261117.mjs`: PASS

## Deployment and live data
- Deploy this updated full source to the server to activate changes. No live CRM database was accessed or modified.
- The existing approved request for 966507545153 and the customer 'ابو ريتاج' are NOT automatically changed; they require separate verification of current assigned user's primary branch, if a historical correction is desired.
- No migration is necessary for the revised transfer logic; the existing lead_events table is reused.
- This patch guards manual registration approval; other CRM ingestion paths should be independently audited before claiming system-wide name immutability.
