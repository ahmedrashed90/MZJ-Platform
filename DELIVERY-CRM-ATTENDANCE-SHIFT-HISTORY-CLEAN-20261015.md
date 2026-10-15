# MZJ — CRM dashboard histories and attendance permission shifts (CLEAN full source)

## Source
- Based on `MZJ-Platform-CRM-REPORTS-QUERY-CONTEXT-CLEAN-FULL.zip` (the latest full source provided immediately before this correction).
- Direct changes to existing CRM and attendance modules; no overlay, hotfix, or parallel implementation.

## Attendance: choose the employee's work shift before granting early departure
- The admin chooses permission date, one or more employees, then the **work shift** for each employee.
- Each available shift displays its name and exact beginning/end time from the employee's effective attendance schedule and period overrides on that day.
- The `من الساعة` / `إلى الساعة` controls activate only after a shift is selected and must remain inside its permitted hours.
- The server requires the selected shift ID and validates it against the employee's actual effective schedule **before** storing the permission, independently from prior check-in.
- Friday with configured Friday hours presents only `الفترة المسائية`, using the configured Friday start/end.
- No changes to the current attendance permission table or already-saved attendance records, and the reported state continues to read `إجازة`.

## CRM dashboard: keep historical customers except nonqualified
- Applies to **مبيعات الكاش** and **مبيعات التمويل** dashboard. Old customers in all statuses except `غير مؤهل` remain visible, regardless of the chosen month/date range.
- For `غير مؤهل`, date filtering uses the most recent actual `crm.lead_events` status-change event; if there is no event, the fallback is the customer's registration date, rather than general `updated_at`.
- The dashboard summary API uses the same customer cohort for totals and keeps canonical sales facts attached to that cohort. Standalone CRM report date filtering remains unchanged.
- Branch/agent filtering and the existing current-branch security restrictions are retained.
- Reload the dashboard after saving a status change so customers newly moved into/out of `غير مؤهل` immediately obey the chosen dates.

## Verification (local only)
- 8/8 new CRM history and attendance shift regression checks passed.
- 16/16 integrated MZJ checks passed.
- 31/31 attendance v100 and 20/20 attendance v101 regression checks passed.
- 12/12 CRM report SQL context checks passed.
- In the broader scripted test suite, 1,278 `PASS` results were observed with no `FAIL` results before dependency-dependent TypeScript build.
- TypeScript syntax parsing for 297 source TS/TSX files completed with zero parsing diagnostics.
- Full `tsc -b` / Vercel production Build **not verified** here because React, Vite and `@types/node` are not locally installed. The missing-dependency errors are not evidence of a successful production build.
- Live Neon or Vercel data was not accessed, migrated or modified.

## Suggested deployment smoke tests
1. At attendance reports, pick a normal working day and an assigned employee with two shifts; verify both options and their actual times. Choose the evening one; verify out-of-shift times are rejected.
2. Choose Friday for the same employee; verify only the evening Friday shift appears and the saved permission reports `إجازة`.
3. In cash and finance dashboards, select the current month. Verify customers from previous months remain in all states except old `غير مؤهل` customers; for `غير مؤهل` only recent status-change dates remain.
4. Compare dashboard unique customer total with its listed cards for the same branch/agent filters. Verify regular CRM reports continue to use their standard period filter.
