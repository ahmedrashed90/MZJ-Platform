# Dashboard Agency Inventory — CLEAN complete release

- Badge inventory: branch actual stock plus agency inventory in the four statuses: available_for_sale, under_delivery, reserved, has_notes.
- Primary actual total display: inventory badge less agency under-delivery count.
- Agency drilldown: shares the same canonical `agency_inventory` status predicate as its counter.
- Existing non-agency actual-total predicate remains unchanged.
- Updated the two existing dashboard checks to verify this intentional agency-specific rule instead of their obsolete assumption.
- Local checks passed: operations dashboard inventory/PDF (11/11), dashboard card calculations (7/7), dashboard operations, conflict markers, and API imports.
- Full `pnpm run build` was NOT executable in this environment: pnpm/dependencies are not installed and package registry access failed. Please verify build on Vercel.
