# MZJ Platform — Global Attendance CLEAN v82

- Built directly from CLEAN v81 source; no patch/diff runtime layer.
- Attendance report now reads records by business work_date **and** actual Riyadh check-in/check-out timestamps so a saved open attendance record cannot disappear from the current-day report because of a legacy/malformed work_date.
- Report record mapping uses the requested day with timestamp fallback while preserving correct overnight business-day behavior when work_date is valid.
- Fixed duplicate SQL `where` in attendance admin bootstrap.
- Browser location capture now races standard GPS, high-accuracy GPS and `watchPosition`; first valid fresh coordinates win and all providers are cleaned up.
- Attendance report is a compact grouped table that fits 100% of the page width without horizontal scrolling.
- Employee filter remains multi-select.
- Check-in, check-out and actual saved coordinates are shown directly from `core.attendance_records`.
