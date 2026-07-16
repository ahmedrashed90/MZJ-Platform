# MZJ Unified Platform v1.8.0 — CRM Settings Review

## Scope
Only `Settings > CRM Settings` was rebuilt. No dashboard, reports, KPI, permissions, customer distribution engine, customer statuses, or other system pages were changed.

## Implemented layout
- Customer statuses: full-width editor above a full-width registered-statuses table.
- Customer data fields: full-width editor above a full-width fields table.
- Sources: full-width editor above a full-width unified-sources table.
- Templates and messages: full-width manual-message editor above a full-width templates table.
- Status-template mappings: full-width mapping editor above a full-width mappings table.
- Customer distribution: rebuilt as a full-width professional workflow with rule summary, scope, sources, eligible employees, ordered distribution queue, preview, rule cards, and full assignment log.

## Mersal synchronization
- Added server route: `POST /api/crm/mersal-templates` inside the existing single Vercel API function.
- Uses the same legacy Mersal endpoint logic: `/api/wpbox/getTemplates?token=...`.
- Environment variables:
  - `MERSAL_TOKEN` (or legacy fallback `MERSAL_API_TOKEN`).
  - Optional `MERSAL_API_ENDPOINT`, default `https://w-mersal.com`.
- Approved templates are saved/updated in PostgreSQL `crm.message_templates` with provider `mersal` and can be linked to CRM statuses.
- Manual messages remain supported.

## Preserved behavior
- Existing CRM permissions and manager-only settings access.
- Existing status save/delete logic and ordering.
- Existing dynamic customer fields and completion-percentage logic.
- Existing central sources and delivery routes.
- Existing status-template mapping behavior.
- Existing round-robin distribution engine, branch/source matching, no-consecutive option, state, and logs.

## Automated checks completed
- `npm ci --ignore-scripts` completed using the Vercel-compatible lock file.
- API import-extension check passed.
- CRM module/no-sample-data check passed.
- Dynamic customer completion check passed.
- CRM v27 reference checks passed.
- CRM settings v1.8 layout/Mersal/distribution structure check passed.
- TypeScript build passed.
- Vite production build passed.

## Production-only verification
The Mersal sync button requires a valid `MERSAL_TOKEN` in Vercel. A live template pull was not executed in the local build environment because the production secret is not available there.
