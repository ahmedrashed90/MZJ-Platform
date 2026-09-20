# MZJ Platform — Attendance + Device Agent CLEAN v97

- Source base: user-provided CLEAN v96.
- Attendance report: added branch filter integrated with date and employee filters; Excel export uses the same current filter set.
- Session logout no longer records attendance checkout. A user can log out and log back in during the same open work period without closing the attendance record.
- Manual attendance checkout is now a separate explicit action; it records checkout and then logs the user out.
- Device Agent updated to v1.1.0. Production installer is built for Windows x86 compatibility so one EXE can run on both 32-bit and 64-bit Intel/AMD Windows.
- Existing Device IDs remain compatible because identity.json and DPAPI key material are preserved on reinstall.
- Device verification/exempt policy remains unchanged. Android/iPhone users can be marked exempt; secure mobile device verification is outside this Windows Agent version.
