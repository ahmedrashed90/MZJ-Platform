# MZJ Marketing: Campaign and Agenda Reviewer Ownership (2026-11-02)

## Business flow

- The only campaign/agenda reviewers are the two active, Marketing-enabled users selected at Marketing Settings > Notes and Evaluation > Campaign and Agenda Reviewers.
- The initial one-time schema upgrade seeds mr.ahmed_rashed@outlook.sa and ceo@mzjcars.com when BOTH accounts are active and Marketing-enabled. If either account is absent, the two reviewer slots must be selected in Settings before any approval can occur.
- Even a platform administrator is NOT implicitly a campaign/agenda reviewer. The approval API and the review dialog both check the persisted reviewer list.
- Reviewers can approve or send a free-text revision note, but cannot change the campaign funding period through the review request.
- The creator receives an internal Marketing notification with an actionable link to the campaign/agenda. The creator can view all notes, update the campaign funding dates and/or the schedule/products, and save the changes. Saving the revision resubmits the plan and notifies the selected reviewers.
- Other Marketing task approval and executor grading permissions are unchanged.

## Deployment prerequisite

This release adds the table marketing.work_plan_reviewers and schema-15 to the EXISTING additive workflow-schema migration system. It does not delete or replace historical data.

After deployment, a platform superadministrator must visit the Marketing dashboard and click 'Update Marketing Database' when prompted. Then in Marketing Settings > Notes and Evaluation, confirm that the two expected users are selected and click Save Reviewers if needed.

If automated schema upgrade is not available, an administrator with database access can apply `database/migrations/20261102_marketing_plan_reviewers.sql` ONCE. Do not run both options unless troubleshooting; both are idempotent. Until the table exists and contains two valid reviewers, plan approval fails closed.

## Verification

1. With a nonreviewer account, open an unapproved campaign and confirm the review/approval action is not shown and direct API review is rejected.
2. With one of the configured reviewer accounts, request a change with a textual note. Confirm the reviewer does not have editable funding dates.
3. With the creator account, open the internal notification, view the revision note, change 'Funding from' and 'Funding to', and save. Confirm status becomes 'submitted' and reviewers receive a notification.
4. For an agenda, repeat the workflow using the editable publish schedule (no funding editor).
5. Reviewer reopens the resubmitted plan and approves.

Targeted checks: `node scripts/test-marketing-plan-reviewers-20261102.cjs`, `node scripts/test-marketing-plan-review-calendar-20261102.cjs`, and `node scripts/test-marketing-plan-review-funding-ui-20261102.cjs`.

Note: Production Vercel build and live-DB behavior must be verified after upload. Project dependency packages were not available in the local verification environment.
