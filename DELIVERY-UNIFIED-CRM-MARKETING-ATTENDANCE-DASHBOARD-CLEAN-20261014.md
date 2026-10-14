# MZJ — Integrated CLEAN full source delivery (14 October 2026)

## Base
- The sole source of this build was the user-supplied `MZJ-Platform-CRM-SHEET-IMPORT-STABILITY-CLEAN-FULL(2).zip` (859 original files).
- All original files are preserved. Only original program files and original test expectations were updated for the requested workflows; one additional integration regression test and this delivery report were added.
- This is a complete source package, not a patch bundle. No production database changes were performed.

## CRM
- The branch manager's access is restricted to their **current primary CRM branch**, including customer lists, conversation lists, contact/history/media/data-review/unread, edit/delete, reports and KPI. Historical transaction branch values are retained for business attribution but cannot authorize viewing another branch's current customers.
- Customer/agent selectors use real CRM branches. The defunct `online` branch is no longer the default for finance lead entry or finance selectors. Sales and finance representatives can share one rep pool according to the existing settings.
- CRM cash/finance dashboard has a default current-month filter and custom date range. Customer entry-based statuses use registered/created date; “غير مؤهل” uses its latest status-change event with a legacy fallback; “تم البيع” uses sale transaction date. All filters include the current user, branch and agent scope.
- CRM manual sheet import retains the original import-stability workflow, pre-checks normalized phone numbers, and performs expensive source/legacy checks before the short write/assignment lock. Already imported customers keep their assigned salesperson, branch and source on retries. It does not overwrite malformed historic phone numbers.

## Marketing
- Campaign and agenda creation no longer displays a separate product search field. The selection is grouped by task, with individually selectable required deliverables and the idea for each item.
- A read-only preview shows date, task/required product, idea, platform and publishing type. Campaign preview also shows the budget. Preview does not save or publish.
- Existing separate task-requirement approval and saved caption/hashtag checkmarks are retained from the source and verified by workflow tests.

## Attendance
- Friday uses one configured evening period rather than a morning period, respecting configured Friday start/end times.
- Early-leave authorization validates the requested time against the employee's assigned period; the report shows “إجازة” while preserving the actual authorization timing in records.
- Actual, expected and difference hours/minutes are summarized per employee and in total at the end of the report; also added to PDF and Excel exports.

## Main dashboard
- Replaced “آخر المحادثات” widget with “المناديب”; names, current branches and unique assigned customer counts come from CRM.
- Total customers, daily growth, department distribution, and representatives share one scope-filtered deduplicated lead cohort; unassigned and unclassified customers are accounted for instead of disappearing from summed counts.
- Week starts Sunday in the Riyadh time zone. The same saved date range is applied to the unified CRM cohort.

## Testing and deployment limitations
- 112 existing check scripts were passed on the integrated source (see terminal run logs), plus a new 16-check integrated regression script and 86/86 workflow checks.
- 308 TS/TSX source files passed syntax parsing by TypeScript compiler API.
- A production `tsc -b`/Vite build cannot be certified in this environment: React, Vite, Phosphor Icons, Recharts and Node type dependencies were not present. Errors from that attempt were predominantly missing modules/JSX types; no live Vercel deployment or Neon test was performed.
- Before production adoption: run `pnpm install`, `pnpm run build` in a normal CI/Vercel installation and test real CRM branch transfer, duplicate import, the October date filter and attendance Friday behavior against a staging DB. Preserve a DB backup before deployment.
