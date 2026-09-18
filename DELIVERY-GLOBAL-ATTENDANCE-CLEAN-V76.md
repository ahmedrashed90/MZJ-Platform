# MZJ Platform - Global Attendance CLEAN v76

This release is rebuilt directly from the CLEAN v75 source. The attendance implementation is integrated into the main source; it is not an overlay or runtime patch.

## Changes

- Work schedules may contain overlapping alternative periods, including a continuous period such as 12:00-21:00 alongside split-shift periods.
- Each user assignment stores the exact selected period IDs. Overlapping periods are rejected only when they are assigned to the same user.
- Existing assignments snapshot their current active periods during schema migration, so adding a new alternative period does not silently assign it to existing users.
- The user assignment screen supports direct per-user editing of schedule, selected periods, branch, required location, and weekly leave day.
- Attendance branch resolution prefers the CRM system-specific primary branch for CRM delegates, with an attendance-specific branch override available to the system manager.
- Weekly day-off wording is now "Leave" in the implementation/UI equivalent and reports use the Arabic label for leave rather than holiday.
- The personal/current attendance UI and its public self endpoint were removed. The attendance page is now report-only and restricted to the system manager.
- The report heading is centered and report period headers use the configured period names directly, with no hard-coded period numbers or time suffixes.
- Manual platform logout closes any open attendance record before clearing the session. Automatic checkout still closes open records at the configured period end.
- Attendance CSS was consolidated into the original attendance stylesheet section; no version-specific override block remains.

## Verification

- Global attendance checks: 23/23 passed.
- TypeScript/TSX transpile syntax check: 267/267 passed.
- API/server import extension check passed.
- Merge-conflict marker check passed.
- Full dependency build was not executable in this workspace because node_modules is absent and pnpm is not installed.
