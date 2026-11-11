# MZJ Marketing | Complete source update | 2026-11-11

This directory contains the **entire Marketing source tree**, not a patch or set of overlay files.

## What changed

- Strategy task integration supports multiple work items, separate Marketing executors, independent due dates, and creative text fields.
- Work items with `delivery_mode=drive_link` are photography deliverables; they submit one Google Drive URL with a recorded immutable first submission timestamp. They are visible within the task, but are **not counted as published/approved media products**.
- Work items with `delivery_mode=files` continue with existing final-file uploads and review.
- Task dashboard differentiates on-time/late photography from final-file delivery, per configured due date.
- Requirement information is shown as image/video deliverable, creative brief with approved vehicle names, audience/goal/message, and a downloadable RTL Arabic DOCX creative treatment (hook / VO / detailed scenario).
- Files remain immutable when a revision is requested until the executor chooses **Accept revision** (editing). Declining revision returns the item to review, with original files preserved. The restriction is server-side, not only visual.
- Existing task IDs, products, uploads, publishing, reviews and analytics are not migrated or deleted.

## Deployment requirements

1. Back up the current Marketing database, existing Vercel project, and environment configuration; preserve all secrets, users and task data.
2. Publish the complete tree to the **existing** Marketing Vercel project. Existing server variables must be preserved; the integration uses `MZJ_STRATEGY_READ_KEY`, `MZJ_STRATEGY_ASSIGN_KEY`, `MZJ_STRATEGY_INTEGRATION_USER_ID` already documented in `MZJ-STRATEGY-API-DEPLOY-README.md`.
3. On the database, the existing workflow migration mechanism performs **additive `schema-17`** and adds `delivery_mode`, `capture_url`, `capture_submitted_at`, `creative_treatment` to `marketing.work_items` with defaults preserving old items. Confirm schema is ready and no migration errors occur **before** enabling new strategy-created tasks.
4. Publish the complete Strategy update to its **own** Vercel project (not on top of Marketing); retain the existing Firebase project, database, environment secrets and Firestore data.
5. In preview, create one test strategy task with a photographer and editor, check their different deadlines and submit methods, both deadline badges, and download/read the DOCX. Test revision accept/decline and rejection; check that normal historical tasks and approved products are unaffected.

## Local checks

```sh
node scripts/check-marketing-workflow-v2.cjs
node scripts/check-marketing-schema-upgrade-clean.cjs
node scripts/test-strategy-integration-api.mjs
node scripts/test-marketing-brief-save-20261101.cjs
node scripts/test-marketing-calendar-rating-navigation-20261101.cjs
```

The complete application build requires the original dependencies (`pnpm install --frozen-lockfile` then `pnpm build`) and a network-enabled dependency installation environment. Automated source tests here do not constitute a live PostgreSQL/Firebase/Vercel end-to-end test.
