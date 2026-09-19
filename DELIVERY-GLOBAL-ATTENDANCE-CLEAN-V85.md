# MZJ Platform – Global Attendance CLEAN v85

Built directly from CLEAN v84 with the desktop geolocation policy integrated in source.

## Attendance location
- Fresh geolocation only (`maximumAge: 0`).
- High accuracy requested; the browser keeps multiple fresh readings and stores the best result.
- Preferred desktop reading: 15 m or better.
- Practical maximum accepted browser accuracy for PCs: 75 m.
- Readings worse than 75 m are rejected.
- The configured branch radius remains unchanged and is still the rule for `matched / mismatched`.
- The report shows both browser accuracy and calculated distance from the configured branch location.

No attendance schedule, checkout, report filtering, permissions, or other platform logic was changed.
