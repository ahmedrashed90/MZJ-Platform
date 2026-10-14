# MZJ CRM — clean reports SQL query-context correction

## Failure
Vercel `GET /api/crm/reports`: PostgreSQL 42703 / `column l.current_assigned_to does not exist`.
`server/crm/reports.ts` was using the SQL expression for the `effective_leads` CTE in a different query that joins the **physical** `crm.leads l` table.

## Source correction
- In `server/crm/reports.ts`, one canonical function `assignedRepBranch(context)` builds the current-representative branch SQL for two explicitly different column contexts:
  - `effective`: computed `l.current_assigned_to`, `l.current_branch_code` from the `effective_leads` CTE.
  - `base`: physical `l.assigned_to`, `l.branch_code` from `crm.leads`.
- The sales-facts SELECT, branch-name join, scoped visibility predicate, and date-filter branch predicate all use the **base** expression. The lead CTE uses the **effective** expression.
- Sales transactions keep their historical branch for financial attribution; current assigned representative's branch controls access for branch managers.
- No table/column DDL, data migration, data deletion, or customer reassignment is required.

## Verification
- Full dependency-independent project suite: **1054 PASS, 0 FAIL**.
- New query-context regression: **12/12 PASS**, including checks that the raw sales query never references CTE-only virtual columns.
- CRM TypeScript source parsing: **23 files, 0 syntax errors**; updated JS tests pass `node --check`.
- ZIP integrity and original-file completeness checked against previous CLEAN source package.
- Full `pnpm run build` could not run here: `pnpm` and project React/Vite/Node dependencies are unavailable. PostgreSQL production queries were not executed against Neon.

## Production verification
Deploy the complete ZIP to Vercel, confirm `pnpm run build` succeeds in Vercel's installed-dependencies environment, open CRM Reports for a system administrator and a branch manager, and inspect `GET /api/crm/reports` logs. Branch restriction must follow the manager and representative's current branches.
