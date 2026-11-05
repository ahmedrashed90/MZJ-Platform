# MZJ Marketing | Unique campaign summary, PDF export and fullscreen preparation

## What changed

- `campaignContentSummary`: consolidates repeated requirement **display names** across products/platforms/post types. It preserves distinct deliverable ideas. Every original publication row, ID, scheduled date, platform budget and total remains unchanged.
- The same de-duplicated overview is used by read-only campaign report, preparation chooser, and campaign review.
- Campaign report and campaign preparation now offer **تصدير PDF — ملخص الحملة**. It opens a clean Arabic/RTL A4 print page; choose **Save as PDF** in the browser destination. The PDF contains only the campaign header/creator/creation date, publication counts, funding window, total budget, individual platform totals, unique requirements and distinct ideas, not the full post-by-post table/captions/links.
- Both the plan preparation chooser and each individual publication editor now use the same existing full-screen modal layout as the report, including responsive resizing.
- The dashboard's plan-line query now includes the plan creator's name so the preparation PDF contains that detail without guessing it.

## Compatibility and integrity

- No database migration or new dependency.
- Legacy campaigns without `funding_to` display an unassigned end date; they do not acquire an invented end date.
- Existing campaign post rows and budget amounts remain intact; display-only de-duplication never changes totals.
- Export uses native browser printing with the **Save as PDF** destination, not an unverified server-side PDF API.

## Verification

- `node scripts/test-marketing-campaign-summary-export-fullscreen-20261101.cjs`
- `node scripts/test-marketing-funding-period-brief-20261101.cjs`
- `node scripts/test-marketing-campaign-approval-prep-20261101.cjs`
- `node scripts/test-marketing-campaign-post-type-contract-20261101.cjs`
- `node scripts/test-marketing-status-and-free-review-20261101.cjs`
- `node scripts/test-marketing-plan-free-note-server-20261101.cjs`
- `node scripts/test-marketing-auto-submit-calendar-ratings-20261101.cjs`
- `node scripts/test-marketing-calendar-rating-navigation-20261101.cjs`
- `node scripts/check-marketing-workflow-v2.cjs`
- `node scripts/check-central-access-control-v1190.mjs`
- `node scripts/check-owners-community-v1200.mjs`

A sample Arabic PDF generated from the print-only HTML with a 20-post fixture rendered as one A4 page during QA. Production Vercel build and live database were not exercised in this sandbox.
