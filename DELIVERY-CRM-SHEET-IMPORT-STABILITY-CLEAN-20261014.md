# MZJ — CRM lead-sheet import stability (CLEAN full source)

## Problem observed
The CRM "Add Lead" import stayed at 12/101 without terminating. The prior browser request had no timeout, and the backend waited on a blocking session advisory lock while executing repeated legacy-phone scans and slow ancillary CRM work.

## Source-level changes
1. `src/crm/sheetLeadImportTransport.ts` (new): each import request has a finite timeout, transient HTTP 408/423/429/500/502/503/504 and network failures have a bounded automatic retry; permanent permission/validation failures do not loop. An aborted request may have committed data: the server always checks the phone before assigning an agent.
2. `src/crm/components/CrmSheetLeadsImport.tsx`: progress shown as "processed X of Y" with current row group and retry status; handles incomplete responses; retains successful batches and resumes after recoverable interruption; splits permanently failing 3-row groups to identify affected rows and continue where safe. No repeated assignments for existing customers.
3. `server/_crm-sheet-import.ts`: non-blocking advisory lock for sheet import (423 when another update is active), exact indexed phone lookup first, only one legacy-format phone scan per batch, and short lock duration (only unique checks, representative selection and creation). CRM contact linking, audit and notifications run after the lock is released; a committed lead is never reported as uncreated merely because ancillary work failed.
4. `server/crm/sheet-leads.ts`: HTTP 423 + Retry-After for a busy import lock, with errors logged server-side.
5. Updated the existing CRM tests and added `scripts/test-crm-sheet-import-resilience.mjs` to the standard typecheck/test command.

## Safety behavior
- This change does not change CRM marketing attribution, branches, departments, distribution rules, or assignments of existing customers.
- No migration and no destructive SQL is required.
- Re-uploading the same 101-row sheet is safe: already-saved numbers are skipped unchanged and only new numbers are routed.
- Source phone normalization (e.g. `p:+966…`) and damaged-number rejection are preserved.
- When the backend is persistently unavailable, the UI stops with a real error and a resume action; it never claims all customers succeeded.

## Verification in the current environment
- CRM regression import tests passed.
- Deterministic 101-customer simulation passed, including four completed batches (12 rows), a lost response after the next batch was actually committed, transparent retries, and reimport with unchanged assignments.
- Server busy-lock test passed, as did 403 no-retry, 503 retry, and finite-timeout tests.
- Other project validation scripts produced 1,026 PASS lines before the dependency-dependent TypeScript build phase.
- Syntax checked on 309 TS/TSX code files with no parse errors; isolated transport TypeScript checking passed.
- Full Vercel production build NOT verified in this environment because installed dependencies such as React, Vite and Node types are absent; live Neon/Vercel was NOT modified.
