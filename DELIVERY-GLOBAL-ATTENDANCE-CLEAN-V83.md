# GLOBAL ATTENDANCE CLEAN V83

- Removed **سجل التسويق السابق** from dynamic attendance report period headers.
- Legacy marketing attendance data remains preserved in `core.attendance_records`; it is only excluded from the report period columns.
- Report periods now come only from configured attendance schedules/periods or non-legacy attendance records.
- No patch-on-patch markers or release-specific runtime overrides were added.
