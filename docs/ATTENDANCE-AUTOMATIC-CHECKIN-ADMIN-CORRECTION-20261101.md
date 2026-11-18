# Attendance automatic check-in and administrator corrections (2026-11-01)

This build starts from `MZJ-Platform-ATTENDANCE-DEVICE-EXEMPT-CHECKIN-CLEAN-FULL-20261101.zip`, preserving the Marketing publishing fixes and other platform modules.

## Login
- Primary verified device and device-exempt users automatically check in as part of login if they have an active assigned period. No second punch button is required.
- Device-exempt users may still sign in outside working hours without a false attendance record.
- Secondary verified devices never create attendance punches; all existing device access conditions remain in force.
- Restored browser sessions also attempt their first check-in when an assigned shift becomes active, once per user/day/period; the attendance API is idempotent for this shift.
- Existing scheduled automatic checkout remains unchanged.

## Corrections
- On the Attendance Report screen, the correction action appears only when the `canCorrectAttendance` flag is returned by the protected server endpoint.
- The server additionally requires an active account with email `mr.ahmed_rashed@outlook.sa` **and** the `platform.superadmin` permission; the database account identity is checked again before mutation.
- The authorized administrator can correct a real shift's check-in and check-out times (or create a missing punch for an assigned shift), with mandatory reason. Times are interpreted in `Asia/Riyadh`.
- The server recalculates delay minutes, work minutes, and the attendance status in the canonical attendance record. Existing report/export calculations then use those values.
- A correction never modifies an approved leave/early-departure authorization, other employees, or dates outside the validated correction window.
- The attendance row change and an append-only correction entry (old/new timestamps and durations, reason, editor account, timestamp) commit in one database transaction.
- The `corrected` checkout source preserves administrator-updated timestamps against auto-checkout schedule synchronization.

## Database
An additive update in `server/_attendance-schema.ts` creates `core.attendance_record_corrections` and allows the `corrected` checkout source. The existing attendance schema preparation runs this update as needed. Existing attendance records are not overwritten in bulk.

## Verification
Passed the new automatic-checkin/admin-correction tests and the existing device exemption, device role, shift checkout, attendance permission, effective-minutes, leave, and employee-hour tests. TS/TSX syntax parsed successfully. A complete application build, live database migration, and interactive Vercel browser tests were not possible in this environment.
