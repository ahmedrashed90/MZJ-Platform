# MZJ Marketing — Dashboard cards, PDF summaries and ratings (2026-11-02)

## Scope

1. Dashboard: unified compact base styling for execution and publishing cards; six repeating restrained cream/brown tonal variants per section to visually separate adjacent tasks. Original labels, counters, buttons, publication statuses and data logic remain intact.
2. Campaign PDF: creator beside creation date, publishing state and published count, most recent `approved` history actor and Saudi approval timestamp, funding dates, inclusive duration and total campaign budget, platform budget totals, deduplicated deliverables and ideas.
3. Agenda PDF: separate export button within the existing read-only agenda report; creator, creation date, publication state and published count, approval actor/timestamp, agenda start/end and inclusive duration, **all configured marketing platforms even with zero posts**, deduplicated requirements with image/video type and deduplicated creative ideas. The detailed publication tables were not modified.
4. Manual publication: caption and hashtag fields are optional for saving preparation or recording a definitive publication URL. First saved link remains immutable and the actual publication date is recorded in Saudi time. The existing automatic provider checks that require publication copy remain unchanged.
5. Executor ratings: default date range and selected month/year reflect the current Gregorian month in Asia/Riyadh. Monthly leaderboard follows the selected month/year and applied date range; apply button is restyled within the MZJ identity.

## Approval metadata

The approver comes from the **actual latest `approved` event in `marketing.work_plan_reviews`**, not from `reviewed_by` (which changes on revisions/resubmissions). The approval is shown only while the plan is approved/publishing/published. Old plans without approval history show `لم يتم الاعتماد بعد` rather than fabricating a name or time.

## Durations

Duration is the number of calendar days between start and end **including both endpoints**; unknown end date is shown as an unspecified duration. This calculation does not modify funding/agenda dates or individual publication dates.

## Data and compatibility

- No new database tables or migrations.
- The plan-details read additionally retrieves configured platform names and codes from `marketing.platforms`; the dashboard plan-lines read includes an approval audit lookup.
- The native browser Print -> Save as PDF workflow remains in place (no new PDF package dependency).
- The two PDF layouts were rendered with WeasyPrint against representative test data and visually checked on A4; one-page samples. Chromium/Playwright execution was unavailable in this runtime.
- The full JavaScript functional pre-checks finished successfully; `tsc -b` could not complete because this environment lacks React, React type declarations and Node type declarations. A production Vercel build must be verified after upload.
