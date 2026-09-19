# MZJ Platform — Attendance Closest Location CLEAN v88

Built directly from CLEAN v87 source. No hotfix or patch-on-patch layer.

## Attendance location rule
- Browser returns the best available fresh PC location reading.
- The client no longer waits for a 75m accuracy threshold before continuing.
- Matching uses the nearest possible point inside the browser accuracy circle:
  `nearest_distance = max(0, center_distance - accuracy)`
- The configured attendance location radius remains the final allowed radius.
- A valid PC coordinate is not rejected only because accuracy is 83m, 85m, or another value.
- If no coordinates are returned, the existing branch-network fallback remains available.
- If coordinates are returned but the nearest possible point is outside the configured radius, the result remains mismatched. Network fallback does not override an out-of-range GPS reading.

## Audit/reporting
Attendance records now store both center distance and nearest possible distance. The report shows:
- accuracy
- center distance
- nearest possible distance

This keeps the decision auditable while allowing desktop users to enter based on the closest plausible location point.
