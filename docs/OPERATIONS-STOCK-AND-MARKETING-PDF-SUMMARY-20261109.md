# MZJ | Operations stock order and Marketing print summary (2026-11-09)

## Operations - active vehicle inventory

- In `server/operations/index.ts`, the inventory query sorts `is_tajyeer=false` **before** `is_tajyeer=true` while retaining `updated_at DESC, vin` ordering within each group.
- The condition applies only when `inventory=1` and the default *active stock* view is requested. Archive, all-vehicle views and other operational listings retain their existing ordering.
- Ordering is in the SQL query **before** pagination. This also preserves the stock order when exporting all filtered rows to Excel.
- There is no database migration, permission change or modified vehicle data.

## Marketing - agenda and campaign PDF summary

- `src/marketing/workflow/campaignPdfExport.ts`: the summary includes a five-column RTL table **التاريخ | المنتج | الفكرة | المنفذ | المنصة**.
- A normalized **product + creative idea** pair appears in one display row rather than once for every scheduled publication. Different ideas for the same product remain distinct so that no genuine creative idea disappears.
- Dates, platforms and assignees stay aligned in repeated sub-lines inside the same row. Duplicate display entries on the same date/platform/assignee collapse, without changing publication counts, budgets, source plan lines or schedule data.
- Missing/invalid dates display **غير محدد** rather than an invented date. Dates are the **planned publish dates** (`scheduled_on`).
- The old separate printable idea/requirement lists are represented by their counts in the compact-table caption instead of reproducing their names again below the new table.
- Agenda and campaign PDF exports use the same grouping rules. `PlanReport` already offered both buttons; the dashboard preparation chooser now also offers **تصدير PDF — ملخص الأجندة** for multi-post agendas, using the existing client-side print flow.
- Printed pages use A4 portrait with repeating table header when the compact schedule spans pages. Preview documents were rendered for campaign and agenda using an offline print renderer for QA.

## Verification

- `node scripts/test-operations-inventory-order-and-marketing-pdf-summary-20261109.cjs` - 13 targeted checks.
- `node scripts/check-operations-inventory-tajyeer-clean.mjs` - 29 checks.
- `node scripts/check-operations-inventory-row-presentation-clean.mjs` - 9 checks.
- `node scripts/test-marketing-campaign-summary-export-fullscreen-20261101.cjs` - 11 checks.
- `node scripts/test-marketing-dashboard-pdf-ratings-20261102.cjs` - 13 checks.
- `node scripts/test-marketing-agenda-report-visible-parity-20261103.cjs` - 14 checks.
- `node scripts/test-marketing-campaign-goals-20261105.cjs` - 20 checks.
- Operations native and workflow regression checks also passed.

Test runtime may require local project dependencies; all tests above ran using the available TypeScript runtime. Full production Vercel build, authenticated integration and live data verification were not performed. No production database or deployment was modified.
