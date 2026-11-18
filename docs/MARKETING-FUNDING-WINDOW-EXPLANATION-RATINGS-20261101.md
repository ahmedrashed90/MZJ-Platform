# MZJ Marketing - Funding window, creative explanation and reporting (2026-11-01)

## Scope

- Calendar: the whole "تقييمات التاسكات" section starts collapsed under the calendar. Each delivery card displays the saved performer rating percentage and stars, or "لم يُقيّم بعد".
- Task creation/editing: add a free-text "الشرح" field to each individual requirement, separate from its idea; preserve it using the existing append-only work history data and show it to the assignee.
- Campaign creation: new UI requires the global funding start/end dates, without replacing individual planned publishing dates. New funding metadata uses the existing `marketing.campaigns.payload` JSONB field; no database migration is needed.
- Existing campaigns with no funding end continue to load. The details/review screen shows "غير محدد" for the end and permits the campaign creator or authorized reviewer to set/update the funding start/end, even after publication approval. Funding edits do not reset budgets, approval or scheduled posts.
- Campaign detail/review, read-only report and publishing preparation show the same funding dates, total campaign budget, summed budget per platform, distinct requirements and distinct requirement ideas.
- Report and publishing-preparation rows are sorted contiguously by platform, then by planned publish date and type. Individual platform/post budgets are not combined or overwritten.

## Backward compatibility

- Existing API requests that do not include the new dates are accepted; the new Create Campaign UI still requires both.
- Missing historic funding end stays null, not invented.
- A missing historic funding start falls back to the earliest scheduled row date for display/editing only.
- No change to the existing publication adapter, post URLs, attendance, CRM, approver roles or database schema.

## Verification

- `node scripts/test-marketing-funding-period-brief-20261101.cjs`
- `node scripts/test-marketing-plan-ui-20261017.mjs`
- `node scripts/test-marketing-plan-multiplatform-20261017.mjs`
- `node scripts/test-marketing-campaign-report-20261021.mjs`
- `node scripts/check-marketing-workflow-v2.cjs`
- `node scripts/check-central-access-control-v1190.mjs`
- `node scripts/check-owners-community-v1200.mjs`

> Local regression tests are not a substitute for a production build or a live-database acceptance test. Install project dependencies before running `pnpm run build` in an environment with registry access.
