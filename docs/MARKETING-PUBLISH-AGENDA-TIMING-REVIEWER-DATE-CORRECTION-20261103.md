# MZJ Marketing — publication report, agenda punctuality, actual-date correction

## Scope

1. **Report only:** caption and hashtags in the existing agenda/campaign publication table now render on one line (`text-overflow: ellipsis`); the complete value remains available in the cell's `title` tooltip. No columns or labels were changed.
2. **Publishing cards only:** an agenda displays on-time/late counts derived from its existing `WorkPlanLine.publication_timing` values and `summarizePublishingDays`. Pending posts are excluded from these punctuality counts. Existing detailed rows and all task execution/delivery logic are unchanged.
3. **Preparation, restricted correction:** first save of a manual post URL still records the Saudi publication date and locks the URL. A reviewer specifically listed in `marketing.work_plan_reviewers` can subsequently correct the *date only*, after entering a reason of at least five characters. The URL, planned date, caption/hashtags, publishing budgets, and approval do not change. The correction is server-validated and recorded atomically in `audit.activity_log` as `work_correct_plan_published_on` with before/after values and the reason.

Reviewers can open preparation in read-only mode for this purpose even if they do not have normal copy-preparation privileges. That extension only applies to approved products belonging to activated/approved plans. Other users have no date correction control or API permission.

## Validation

- `node scripts/test-marketing-report-compact-agenda-timing-reviewer-date-20261103.cjs`
- `node scripts/test-marketing-publishing-integrated-20261101.cjs`
- `node scripts/test-marketing-campaign-approval-prep-20261101.cjs`
- `node scripts/test-marketing-plan-reviewers-20261102.cjs`
- `node scripts/check-marketing-workflow-v2.cjs`
- `node scripts/check-central-access-control-v1190.mjs`
- `node scripts/check-owners-community-v1200.mjs`

No new table or migration is required; the existing reviewer assignment table and central activity log are reused. Production Postgres and Vercel builds must still be validated after deployment.
