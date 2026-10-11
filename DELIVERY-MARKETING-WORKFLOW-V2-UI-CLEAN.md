# MZJ Marketing V2 — Professional UI CLEAN

## Baseline

The complete source is based on the latest user-supplied archive:
`MZJ-Platform-MARKETING-META-ENGAGEMENT-BUILD-TS2345-CLEAN-FULL (1).zip`, with Marketing Workflow V2 incorporated.

## Implemented in this complete ZIP

- Centered nine-tab Marketing navigation, keeping its original MZJ labels, color system, Tajawal font and responsive layouts.
- Redesigned task-creation, dashboard, publishing-group and database UI using the original MZJ CSS tokens (`--brand: #6c3329`, `--bg: #fbfaf9`, etc.). No secondary styling plugin or hotfix package.
- Fast task-assignee selection: one native grouped dropdown lists active Marketing users by the existing department membership; choosing a user fills their department automatically. Multiple assignees and independent required products remain supported.
- Space-saving platform size selector with per-media filtering and a "Select all" control; preserves existing format IDs and validation.
- Full-screen task details with clear task summary, independent required products, ideas, due dates, attachment links, final-file uploads, and existing admin Approve / Return for revision / Reject operations. Obsolete legacy assignment-action checkboxes are absent from this V2 screen.
- Unified task/agenda/campaign database with a visible "Delete" control on campaign rows for users with `marketing.campaign.delete`; explicit confirmation; existing soft-delete API, preserving previously published files/posts and historical records.
- Arabic human-readable status labels for legacy publication statuses.
- Marketing-only database DDL synchronization: the base Marketing schema and the new workflow schema use the same PostgreSQL advisory lock to serialize concurrent Marketing DDL on Vercel cold starts, reducing the source of `40P01` deadlocks. This is not a proof that a live deadlock can never recur.

## Boundaries

All original non-Marketing feature files (CRM, Operations, Tracking, Website and other systems) remain identical to the source archive. Stock, Subscriptions, Engagement and original Marketing design CSS stay unchanged. Publishing provider code was protected by automated integrity comparisons. No bulk data deletion, schema drop or truncation is added.

## Verification

- 69/69 workflow tests (business rules, SQL boundary mocks, UI safeguards)
- 31/31 browser interaction tests using actual workflow TSX/CSS with mocked API responses
- 106/106 source compatibility test scripts
- Boundary integrity audit passed; all protected files and 15 protected Marketing provider functions verified unchanged
- Stub-based TS diagnostics: 230 both before and after this UI pass; zero findings in the changed workflow files. This is NOT a full production typecheck.

## Before production

The runtime lacks project package dependencies and live DB/social-platform credentials; therefore a dependency-complete Vite build, live Postgres `40P01` concurrency reproduction, production file uploads, and real publication are NOT verified here. Run the real CI build and staging smoke tests before deploying over production, with backups of Marketing data.
