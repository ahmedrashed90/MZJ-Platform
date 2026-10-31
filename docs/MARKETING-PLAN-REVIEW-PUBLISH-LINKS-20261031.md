# MZJ Marketing — Publishing workflow (integrated clean release, 2026-10-31)

## Included in the source
- Publishing section on the dashboard is closed initially and opens/closes via its title. Individual agenda/campaign cards also start collapsed.
- In a plan card, **one row per scheduled calendar day** summarizes all matching products/platforms/post types. Multiple platforms or post types on the same date are not repeated on the dashboard. Their original individual publication lines are preserved in the database.
- The old dashboard **جدول النشر** control is **التقرير**. **تجهيز النشر** comes before **التقرير**. The full detailed report shows a separate line for every product/platform/post type, including planned date, plan creation date, actual publication date, publication timing, state, and post URL.
- Plan creation date is shown in the collapsed card and inside the report. Editing the plan does not change its original creation date.
- Executor task detail no longer displays caption and hashtags editing. Existing stored copy is retained, and copy is edited during **تجهيز النشر** for each line separately. Preparation's selection action reads **فتح**.
- Preparation and detailed report both allow recording the actual post URL and actual publication date (after plan approval and with the existing authorized roles). Links and dates are stored on the individual plan publication line. URL saving does not itself publish a post.
- An actual publication date on/before the scheduled day produces green **نشر في الموعد**. A later date produces red **تأخر في النشر**. Pending items are not labelled as published; legacy URLs without a confirmed actual date show **تاريخ النشر غير مسجل**, never an invented result. Provider-published posts use their confirmed publish timestamp converted to the Riyadh calendar date.
- Editing an agenda/campaign's product or schedule rows and pressing **حفظ التعديلات وإرسالها للمراجعة** now makes one atomic database transaction: validate/edit rows, mark the plan as **submitted / قيد المراجعة**, and append a review event. There is no separate required second review submission step after an edit. Initial plans with no edits retain their existing initial submission control.
- All earlier agenda/campaign review notes remain in the append-only review history and are displayed when editing or reviewing. Current note is not erased by submitting or approving. Task review workflows and other modules are unchanged.

## Database and operational steps
- Existing additive schema-12/13 migrations remain. **New schema-14** adds `marketing.work_plan_items.manual_published_on date` without dropping rows or overwriting existing publication links.
- Deploy the **complete ZIP source**. After deployment, a platform superadmin must use the existing **تحديث قاعدة بيانات التسويق** control once, before using manual actual publication dates. The upgrade is an explicit administrator POST; dashboard GET operations do not perform database DDL.
- Existing automatic publication adapters, access control, campaign budgets, agenda selection, tasks, CRM and other work modules are retained. Publication dates are stored separately from the date a link was entered or edited.
- Where an old manually recorded URL has no verifiable publication date, the UI deliberately requests a real date instead of classifying it as on-time or late.

## Validation and boundaries
- Regression tests cover date grouping, link/date acceptance and approval requirements, accurate timing classification, historical notes, atomic edit-and-submit, schema status/migration, and existing marketing dashboard workflow.
- Source TypeScript files passed syntax/transpilation diagnostics in the working environment. A full dependency-based Vite/TypeScript production build and a live database/provider deployment were **not** performed: the project dependencies were not installed and registry access was unavailable.
