# MZJ Marketing — Campaign/Agenda review, publication preparation, and reporting

## Scope

This is one full-source update based on `MZJ-Attendance-Correction-Canonical-FULL-20261101.zip`.
Only marketing publication workflow modules, its shared API type, tests and this document changed. Attendance, CRM, and unrelated integrations are not modified.

1. Dashboard: removed the separate **Budget Table** action/modal. Publication preparation selection now has columns **Product → Deliverable idea → Scheduled date → Platform → Post type → Campaign budget → Caption/hashtags state → Open**. Agenda rows omit the budget column. Campaign budgets retain the original once-per-platform allocation (multiple formats can show zero additional allocation).
2. Clicking **Open** in preparation shows the exact approved deliverable idea from `marketing.work_items.idea` (`product.idea`), not the parent task title; it also shows that campaign line's saved budget.
3. Read-only publication report: removed the repeated creation-date table column (the creation date remains in the summary); added the **Deliverable idea** after Product. Caption, hashtags, status, and URL remain read only.
4. Creating an agenda or campaign now redirects to `/marketing?plan=<created-id>` so the persisted full schedule opens immediately for review, totals and row budgets. Existing plans also have a **Review/Approve** action on the dashboard. Approval uses the unchanged authorization and review-history routes; plan authors can edit while waiting for review, and changes automatically resubmit for approval.
5. The first successful manual post-link save records `manual_published_on` using the PostgreSQL day in `Asia/Riyadh`. Subsequent URL edits and clears **never change that stored date**. Client-sent dates are ignored; the input is now read-only. Previously saved publication dates remain untouched. No DB schema upgrade required.

## Validation performed

- `node scripts/test-marketing-campaign-approval-prep-20261101.cjs` — 15/15 passed.
- `node scripts/test-marketing-plan-ui-20261017.mjs` — 14/14 passed.
- `node scripts/test-marketing-plan-multiplatform-20261017.mjs` — 33/33 passed.
- `node scripts/test-marketing-campaign-report-20261021.mjs` — 31/31 passed.
- `node scripts/check-marketing-workflow-v2.cjs` — 134/134 passed.
- `node scripts/check-owners-community-v1200.mjs` — 83/83 passed.
- `node scripts/check-central-access-control-v1190.mjs` — 93/93 passed.
- Existing publishing-integration and review tests passed.
- All changed TS/TSX files parsed without syntax errors.

**Limitations:** Full `tsc -b` / Vercel production build and live database publishing were not verified in this environment because project dependencies (React, other node modules) are not installed. The mock SQL test verifies the first-link contract but is not a production database integration test. Deploy to a preview environment before promoting to production.
