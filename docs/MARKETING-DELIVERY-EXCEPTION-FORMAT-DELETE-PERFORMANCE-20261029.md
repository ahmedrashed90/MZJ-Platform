# MZJ Marketing — Delivery exception, format removal and task-loading performance

Full source update, 2026-10-29. This package preserves the original source tree, integrations, and pnpm@10.12.1 lockfile from the latest available Vercel-ready source.

## Correct delivery accounting

- The task dashboard treats a fully approved requirement with an approved deadline exception as **on-time** and never also as **late**.
- The on-time card filter includes requirements with `delivery_status = exception_approved`.
- Original due dates, actual submitted dates and exception approval records remain unchanged.
- Example: five approved on-time requirements and one approved late exception display 6 on-time / 0 late (not 6 / 1).

## Administrator-only format removal

- The Marketing administrator (`marketing_admin` with review access) or platform superadmin can remove a selected format from an existing requirement.
- All remaining formats stay mandatory; the last remaining format cannot be removed.
- Approved formats require undoing approval before deletion; formats currently submitted for review must first be returned for revision.
- A confirmation prompt explains the effect and the action is audited in `marketing.work_history` with detached-file metadata.
- Links for the removed format are detached; the physical media object and immutable review notes are not deleted.
- The requirement status, version, final approval timestamp when appropriate, and parent-task readiness are recalculated within the same transaction.
- API access is validated on the server, not just by hiding the button.

## Task-loading speed

- Added a one-time, additive **schema-11** performance migration for indexes used by task history, final-file lookup, pending uploads and review notes.
- Normal dashboard GET requests do not execute DDL or migration scripts.
- After deploying, sign in as platform superadmin, open Marketing > Dashboard and click **تحسين سرعة تحميل التسويق** once. The action is idempotent and preserves existing records.
- Actual production response times require testing against the deployed database; no production DB was available to benchmark here.

## Validation

- `node scripts/check-marketing-workflow-v2.cjs` — 134/134 checks.
- `node scripts/test-marketing-delivery-formats-performance-20261029.cjs` — 7/7 checks.
- `node scripts/check-marketing-schema-upgrade-clean.cjs` — passed.
- `node scripts/test-marketing-20261021-reviews-kpi.cjs` — 20/20 checks.
- `node scripts/check-no-merge-conflicts.mjs` — passed.
- Changed TypeScript/TSX files transpiled without syntax errors.
- A full `pnpm install` / Vite build could not be run in this environment because registry access was unavailable; the source and lockfile remain unchanged for the normal Vercel build.
