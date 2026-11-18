# MZJ Marketing - Ratings date/month filter synchronization (2026-11-03)

## Scope

Only the Marketing > Performer Ratings date controls, their shared filter calculation, and a regression test have changed. No score formula, rating record, ranking logic, database table, or other Marketing page was modified.

## New behavior

- Choosing a month and year immediately fills the visible From/To inputs with the first and last Gregorian days of the selected month. Applying the filter fetches ratings for precisely that range.
- Choosing "All months" within one year fills January 1 - December 31 of that year.
- Changing either From/To date manually reflects the date interval in the month/year dropdowns: a single month selects that month, a cross-month interval within a year selects "All months" and that year, and a cross-year interval selects "All months" and "All years".
- Applying a custom interval uses those exact days and does NOT filter the results a second time by month or year. This ensures monthly winners, ranking, count and average all use one consistent query.
- To remain within the server's existing five-year maximum, choosing "All years" sets a contiguous range spanning the current calendar year plus the previous four years. Choosing a specific month from that state chooses the current year rather than pretending an intermittent multi-year selection is one contiguous interval.
- Date inputs are not restricted by each other's currently selected value during editing, allowing future-period edits in either order. Invalid or excessively large ranges cannot be applied.

## Tests

`node scripts/test-marketing-ratings-filter-sync-20261103.cjs`

Tests cover the original October-versus-November bug, dropdown selection, reverse synchronization, period boundaries, leap years, year selection, cross-month custom dates, all-year semantics, and preservation of rating formulas. The test is part of the normal `typecheck` chain after existing Marketing tests; Owners and Central Access checks remain first.

No database migration is needed. Full Vercel production compilation must still be checked in the deployment environment with production dependencies installed.
