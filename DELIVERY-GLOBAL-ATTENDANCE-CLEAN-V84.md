# MZJ Platform — Global Attendance CLEAN v84

Built directly from CLEAN v83. No patch-on-patch release layer was added.

## Attendance location precision
- Attendance capture uses only fresh browser geolocation requests with `enableHighAccuracy: true` and `maximumAge: 0`.
- The previous standard/cached location race has been removed.
- The browser samples multiple readings and keeps the best accuracy.
- A reading of 10 meters or better is accepted immediately.
- A reading between 10 and 15 meters is accepted after a short sampling window if no better reading arrives.
- Any reading worse than 15 meters is rejected and attendance is not saved with that location.
- The server independently enforces the same 15-meter maximum accuracy for required attendance locations.
- Branch matching still uses the configured `radius_m` from Attendance Settings; this release does not change the configured allowed radius or attendance/report logic.
