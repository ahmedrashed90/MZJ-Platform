# MZJ Marketing — ratings and delivery calendar refinements (2026-10-22)

This complete source archive is based on the latest workflow-build-corrected full release.

## Scoped changes

- Archived rejected deliverable ratings appear in the same executor ratings report as approved ones. The report includes archived rows whenever a percentage exists; an older row without a rated_at timestamp uses its rejection date for the report date. Archived requirements remain excluded from execution, products, and task readiness.
- Rejected deliverables display the saved grade, percentage, and stars in task details, matching the approved deliverable presentation.
- The evaluation entry modal no longer displays total points, calculated percentage, final grade, or stars before saving. The original 0–3 rules (with 0/3 for acceptance/rejection) and server-side calculation remain unchanged.
- Delivery Calendar shows task readiness on every dated deliverable card, using the same shared per-format uploaded/approved calculation as task details. The total includes all current requirements visible to that user, even when due on another day.
- The monthly top-rating card shows the quality label, numeric score percentage, and stars. Ratings refresh on successful marketing workflow changes.

## Deployment

Replace the previous source in full and redeploy. No new environment variables or SQL migrations were introduced for these refinements. The existing rejected-rating archive migration (`database/migrations/20261022_marketing_rejected_item_ratings.sql`) must already be applied, as for the prior release.

## Verification

Offline SQL-boundary workflow tests, saved rating/report tests, and TypeScript syntax tests pass. Live database integration and a full Vercel production build were not performed in the execution environment due to unavailable external runtime dependencies.
