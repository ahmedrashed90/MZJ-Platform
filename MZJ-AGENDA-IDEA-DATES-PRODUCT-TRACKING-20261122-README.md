# MZJ Marketing - Approved agenda dates and product tracking

Source baseline: user-provided MZJ-Marketing-Dashboard-Spotlight-Dec-Full-.zip.
This ZIP contains the complete original application with integrated source edits, not a patch package.

## Approved agenda: adjust one date per idea

Open Marketing > Dashboard > Publishing > approved agenda > Report OR Prepare Publishing.
Both screens now expose **Edit agenda idea publication dates** at the top for users who
are authorized to edit this approved agenda. The former Review/PlanDetail screen
is not used to edit approved-agenda publication dates. The report and preparation
must refresh their displayed dates after a successful save.
Idea rows are keyed by the saved strategy idea code, not by text or platform.
Expand any idea and enter a new planned date. Stage multiple edits and save once.
The server atomically updates all matching plan items and eligible waiting/failed schedules, draft agenda dates, creative plan days, and the agenda date window. Approval status and actual publication history are preserved. Already published/external scheduled posts block changes for their entire idea; unmapped posts are warned and never guessed.
One audit.activity_log record is written for the batch. No new database tables or migrations.

## Products

Product order references are now aggregated from both agenda and campaign links. Funding dates come from actual campaign draft entries or linked line metadata; publication dates come from agenda lines. No missing funding date is fabricated. The product table has two fixed header rows (section grouping and column labels) while its body scrolls.

## Verification

Run: node scripts/test-marketing-agenda-idea-reschedule-20261122.cjs
This test is also part of `pnpm run typecheck`.
Synthetic regression covers 36 ideas and 316 planned post rows, including rollback checks, permissions, published-post protection, and linked product references. Additional existing marketing tests passed locally.

Production build and live database mutations were NOT run. Install exact project dependencies from the lockfile, run `pnpm run build` and perform an authorized staging verification before deploying to Production. Do not upload `.env` secrets or OAuth token files to GitHub.
