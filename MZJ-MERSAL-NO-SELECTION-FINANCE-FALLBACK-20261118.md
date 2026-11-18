# MZJ Mersal — fallback to finance after second inbound message (2026-11-18)

## Baseline and preservation
- Based on `MZJ-CRM-MARKETING-GOOGLE-ADS-IMPRESSIONS-VIDEO-VIEWS-CLEAN-FULL-20261118(1).zip` (MZJ Platform v1.19.16), preserving all existing project directories, files and marketing work.
- That ZIP's bundled Mersal worker was v1.12.4, older than the user-provided v1.12.7. Incorporated the user-provided v1.12.7 worker before adding read-only routing diagnostics; the resulting worker is v1.12.8. Previous audio/document sending and receipt logic are retained.
- Resulting complete platform package version: v1.19.17. Not deployed.

## Precise trigger
On a **second distinct inbound customer message** to the same Mersal WhatsApp conversation, for a Mersal conversation whose entry menu is provider-owned, and without a trusted/explicit service choice, the CRM attempts to classify the lead as **finance**.

The fallback explicitly **does not** run if:
- The inbound message is the first one for that conversation.
- The customer selected cash, finance or customer service (including a selection recognized by the CRM automation).
- There is an open service request, existing assigned owner, or the conversation has already been classified.
- The provider is not Mersal with `providerEntryFlowHandled=true` and the worker emits `crmNoSelectionFallbackPolicy=finance_after_second_inbound`.

No timeout-based reassignment occurs after silence alone; the second customer message is the trigger.

## Ownership, database and branches
- Calls the existing PostgreSQL `classifyConversationService()` with `serviceKey=finance` and a **non-explicit** `classificationMethod=mersal_no_selection_default` (does not override a pre-existing service).
- Reuses `chooseAssignment('finance', '', 'whatsapp')` through the CRM service lifecycle, selecting active finance assignment rules and the assignee's actual physical branch. No branch or salesperson is hardcoded; applies existing CRM priority/round-robin rules.
- `requirePrimaryAssignment=true`: if no eligible CRM salesperson is available, fail instead of silently saving an assigned-to-null request. The integration returns an error so the Mersal webhook is retried; inspect active finance assignment rules and representative availability.
- Preserves existing lead status, source, prior ownership and deduplication. Newly created finance fallback leads trigger the regular CRM channel lead notification. No manual reassignment of pre-existing classified customers.
- Skips automatic entry templates from the fallback (Mersal/automation owns customer-facing welcome messages). An unanswered CRM choice session is marked complete after successful finance assignment to avoid repeat unanswered-choice prompts.

## Diagnostics
- Integration API returns `assignedUserId`, `assignedBranchCode`, `assignmentAcknowledged` and `defaultFinanceFallback` in `result`.
- Worker `/debug/last` forward section reports `assignedUserId`, `assignedBranchCode` and `defaultFinanceFallbackApplied` (requires `DEBUG_KV` binding).
- Only the PostgreSQL CRM database performs assignment, never the Worker.

## Changed files
- `server/_integration-processor.ts`: guarded second-message fallback.
- `server/_crm-lifecycle.ts`: optional strict assignment requirement for this fallback.
- `server/integrations/[source].ts`: read-only diagnostics in integration response.
- `mersal-worker/src/index.js`, `mersal-worker/package.json`: merge latest user worker, add diagnostics.
- `mersal-worker/test-worker.mjs`: retain worker regression tests for image send, templates, routing and webhook forwarding.
- `scripts/check-crm-service-reclassification-v1156.mjs`: existing CRM regression version assertion updated for the preserved newer worker.
- `workers/MZJ-Mersal-CRM-Worker-v1.12.8-DEFAULT-FINANCE-FULL.txt`: standalone current worker source.
- `scripts/test-crm-mersal-no-choice-fallback-20261118.cjs`: isolated fallback policy tests.
- `package.json`, `package-lock.json`: release metadata only.

## Release requirements
1. Update **PostgreSQL platform API** and **Cloudflare Mersal Worker** together. Updating only the Worker will not classify or assign the customer.
2. Verify active finance rules, CRM salesperson eligibility and actual branch membership. Do not enable production traffic until configuration is verified.
3. Test with a new WhatsApp number: first message → welcome; second free text without choice → finance + assigned salesperson/branch; explicit service button must still override; existing customer owner must stay the same.
4. No database migrations, credentials, environment variable changes or live deployment were performed by this package.

## Source validation (local)
- Mersal Worker integration/media/selection regression checks: passed.
- CRM fallback policy tests (15 mocked cases): passed.
- Existing CRM service reclassification, automation flow, cash/finance branch routing and percentage/branch report checks: passed.
- Targeted TypeScript transpile/syntax validation: passed.
- Full project dependency installation exceeded the available timeout; a complete app build and production PostgreSQL end-to-end test were not performed. Do not treat source-only checks as a production validation.
