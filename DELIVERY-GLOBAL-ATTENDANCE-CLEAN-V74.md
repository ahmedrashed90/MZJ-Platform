# MZJ Platform Global Attendance - CLEAN V74

## Scope
- Attendance is now a core platform module, not a Marketing-only feature.
- Existing Marketing attendance rows are preserved and migrated into the core attendance history.
- The old Marketing attendance route redirects to the global `/attendance` route.

## Work schedules
- System Manager can create any number of work schedules.
- Each schedule can contain one or more non-overlapping periods.
- Every period has start time, end time and check-in grace minutes.
- Schedules support periods that cross midnight; the 01:00 checkout remains attached to the prior work date.
- Users are assigned individually to a schedule, so a 12:00-start user is never logged out by another schedule that ends at 13:00.

## Attendance lifecycle
- Assigned users must have an active attendance record before a platform session is created.
- If a required work location exists, browser geolocation is requested only while checking in.
- Location mismatch does not block check-in; it is recorded as matched or mismatched.
- If no required location is assigned, location is not requested and the result is not required.
- Manual checkout closes the attendance record and invalidates all platform sessions for that user.
- The backend cron closes still-open attendance records at each record's scheduled period end and invalidates that user's sessions.
- Session validation also prevents an old browser session from surviving beyond the user's own active work period.

## Administration and reports
- Attendance settings and reports require `platform.superadmin` on both UI and API layers.
- Settings include attendance locations, geofence radius, schedules/periods and bulk user assignment.
- Report filters: From date, To date and Employee.
- With no date filter, the current day is shown for all active users.
- Report columns preserve the requested structure: sequence, date, day, branch, name, location group and dynamic period groups.
- Period columns are generated from the schedules applicable to the selected users/dates.
- Each period result includes attendance status, actual work duration and delay.

## Deployment
- Runtime schema setup is idempotent through `ensureAttendanceSchema`.
- Optional SQL migration: `database/migrations/20260918_global_attendance_core.sql`.
- Vercel cron path: `/api/internal/attendance-tick`, scheduled every minute.
- `CRON_SECRET` is optional in code but recommended in production.

## Verification
- `scripts/check-global-attendance-v74.mjs` validates the release wiring and critical attendance invariants.
