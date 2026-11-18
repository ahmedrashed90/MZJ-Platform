# MZJ Marketing — Publishing dashboard and read-only reporting (1 November 2026)

This delivery is a full source archive based on the latest supplied `MZJ-Marketing-Final.zip`. Files were edited within their existing modules; unrelated integrations and business modules are unchanged.

## Dashboard — قسم النشر

- The section is collapsed on page entry; clicking its header expands/collapses the section without leaving unused whitespace.
- Each agenda/campaign card stays visible when the section is open. Its product/day rows are *independently* collapsed until the user clicks that agenda/campaign name.
- Dashboard rows aggregate by scheduled calendar day: one day = one row even if the plan has multiple platforms and post types on that date. The day shows distinct platforms, distinct post types, progress and date-based publication status. Raw platform rows are never merged or deleted in the database.
- Card counts distinguish unique products from individual publication lines; creation date comes from the `work_plans.created_at` value (not the publication date).
- Existing preparation, campaign budget and permission-gated automatic publishing actions remain active.

## Report — التقرير

- The dashboard's **التقرير** action opens a separate full-screen, read-only `PlanReport` component, *not* the plan management/review editor.
- Displays plan creation date, planned date, product, platform, post type, campaign budget (if applicable), caption, hashtags, publication timing, status, and the saved post URL as a plain link.
- Contains no editable inputs, save buttons, publication-date editor or posting actions. Actual publication date is used in the calculation but is not an editable or displayed report field.
- The plan management/review workflow remains accessible from the marketing Database; its post URL column is read-only as well.

## Preparing the post — تجهيز النشر

- The `PreparationEditor` owns the manual post URL and actual publication date input, alongside caption and hashtags. Its own permissions and approval gating remain enforced server-side.
- Server stores the link and verified publication date separately on the *individual* publication line. Automatic provider publishing dates are read from the provider's confirmed `published_at` timestamp in Riyadh time.
- Existing manual links without an actual date remain published but unclassified for timing; no date is guessed from when the link was saved.
- Timing is `on_time` if actual date <= scheduled date, `late` if actual date > scheduled date, and `pending/undated` otherwise. Status is displayed with appropriate distinct colors.
- Caption and hashtags editor is removed from the execution task display, while historical copy data remains in storage for backwards compatibility.

## Plan edits and approvals

- Saving agenda/campaign row changes atomically sets `work_plans.review_status='submitted'` and appends a review-history event **inside the same database transaction**. No second click on `إرسال للمراجعة` is required after *editing*.
- Previous review notes and categories are retained, and no existing review history is deleted. Creating a new plan may still require a first-time submission when no edits were saved.

## Database migration

- New additive `schema-14` adds `marketing.work_plan_items.manual_published_on date`. No old publication URLs or histories are rewritten. Trigger it once after deploying through the existing admin-only **تحديث قاعدة بيانات التسويق** button, if the dashboard indicates an upgrade is available.
- Application GET requests do not execute schema DDL. If the migration is pending, the dashboard asks the superadmin to upgrade.

## Local QA and limitations

- `node scripts/test-marketing-publishing-integrated-20261101.cjs`
- `node scripts/test-marketing-publishing-review-20261031.cjs`
- `node scripts/test-marketing-publishing-controls-20261031.cjs`
- `node scripts/check-marketing-schema-upgrade-clean.cjs`
- `node scripts/test-marketing-schema-status-review-upgrade-20261028.cjs`
- `node scripts/check-marketing-workflow-v2.cjs`
- These tests use static parsing, pure logic and mocked SQL; they do not operate on production data. A full Vercel production build and browser-based QA still require dependencies and the deployment environment.
