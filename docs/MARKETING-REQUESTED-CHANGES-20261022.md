# MZJ Platform — Scoped full-source changes (2026-10-22)

This is one complete application source tree based on the latest delivered
`MZJ-Platform-MARKETING-BULKPUBLISH-TIKTOK-SNAPCHAT-SEPARATE-API-KEYS-CLEAN-FULL-20261022.zip`.
It is not an overlay/hotfix. Existing providers, credentials and user-facing names
not mentioned below have been preserved.

## Features

1. Main dashboard representatives widget has a bounded height matching the
   adjacent analytics widgets, with vertical scrolling only inside the list.
2. Executor ratings: new grades only after every format is approved (100%),
   or after rejection (the rejected requirement is archived for grading but does
   not reappear as an active deliverable or contribute to readiness).
3. Acceptance/rejection criterion is binary 0 or 3; other criteria 0–3.
   Both frontend and backend validate these rules.
4. Reviewers first select **تعديل** on a submitted requirement, then **إضافة
   ملاحظة** becomes available; existing note edit/deletion capabilities remain.
5. More visible task-header styling and distinct branded requirement cards.
6. Paid campaign chart bars and labels open the corresponding campaign details
   in the table. Authorized editors can write and save campaign managers, which
   appear in chart labels/tooltips. Report spend/CPL retain USD × 3.75 => SAR.
7. Delivery calendar: administrator/system manager roles with global Marketing
   privileges can see all executors' due requirements; regular users see only
   their assigned requirements. The task dialog opened from one day remains
   filtered to requirements due on that day.
8. TikTok organic: an unverified BulkPublish state preserves existing follower
   snapshots and is labeled as historical/pending, rather than categorically
   inactive. A 429 still reflects a real provider rate limit and is not hidden
   as success. TikTok/Snapchat use distinct BulkPublish keys.
9. Removed the verbose technical Snapchat/Windsor informational note from
   successful paid-campaign report views. Real loading failures still appear.

## REQUIRED DATABASE MIGRATIONS

Execute **once** on the target PostgreSQL database, in order, using the usual
controlled migration/SQL execution process before relying on the new features:

1. `database/migrations/20261022_marketing_rejected_item_ratings.sql`
2. `database/migrations/20261022_marketing_campaign_report_managers.sql`

Existing earlier Marketing and BulkPublish migrations remain required according
 to the previously deployed version. The rejected-rating table is independent
from active requirements; do not reinsert rejected requirements into `work_items`.
Migrations do not supply live API keys, refresh tokens, or account authorizations.

## API configuration

- TikTok organic: `BULKPUBLISH_API_KEY`, `BULKPUBLISH_TIKTOK_CHANNEL_ID`.
- Snapchat organic: `BULKPUBLISH_SNAPCHAT_API_KEY` (and optional
  `BULKPUBLISH_SNAPCHAT_CHANNEL_ID`).
- Snapchat paid campaigns: `WINDSOR_SNAPCHAT_API_KEY`.

Keep credentials **server-side** in Vercel environment variables; no secrets are
included in this archive. A BulkPublish 429 may persist until the provider
resets its rate limit, independent of UI/backend changes.

## Verification in this environment

- `node scripts/test-marketing-20261022-requested-changes.cjs`: 10/10 PASS.
- `node scripts/test-marketing-20261021-reviews-kpi.cjs`: 16/16 PASS.
- `node scripts/test-marketing-campaign-report-20261021.mjs`: 27/27 PASS.
- Additional organic, BulkPublish, split-key and Snapchat/Windsor tests: PASS.
- `src`/`server` modified TypeScript and TSX parse/transpile tests: PASS.
- A complete clean `npm install` / production bundle was **not** verifiable:
  dependency installation timed out in the current environment. Run normal
  Vercel/CI production build and a live smoke test after deployment; no live
  provider account or database was modified while preparing this archive.
