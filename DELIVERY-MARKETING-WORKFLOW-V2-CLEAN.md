# MZJ Marketing Workflow V2 - complete source delivery

**Input:** `MZJ-Platform-MARKETING-META-ENGAGEMENT-BUILD-TS2345-CLEAN-FULL (1).zip`

This is the complete platform source with the marketing workflow rebuilt in place. It is not a patch bundle, a second marketing application, a production deployment, or a verified live release. No production database, user account, advertising budget, or connected social account was modified during development.

## Implemented

- Nine marketing navigation tabs, using the existing platform shell, branding tokens, typography and shared modal components.
- Unified creation with task first, campaign second, agenda third. Old campaign/agenda creation routes redirect to the new entry point; old creation/import APIs no longer accept new legacy records.
- Sequential server-reserved task numbers and creation dates; task types, department users and publishing formats come from existing marketing settings.
- Multiple executors across departments, multiple image/video requirements per executor, separate idea text, Word/Excel attachments, filtered publishing sizes with select-all, and separate delivery dates.
- Executor upload and submission, permission-checked admin approval or return for revision. Rejection permanently removes the requirement from the task and its count; a minimal audit record remains. Rejected files never become products.
- Parent readiness is approved requirements with complete ready final-file coverage divided by remaining requirements. Upload alone does not count. An empty task is not 100% complete.
- Two dashboard columns: execution and publishing. No legacy required/readiness/archive dashboard columns.
- Products: the requested three columns, newest released products first, with protected media preview.
- Agenda publication dates and campaign funding dates select released products. Saving the plan makes its items appear in the dashboard publishing section.
- One unified database table with all/task/agenda/campaign filter. Existing legacy records remain accessible read-only without duplicate workflow plan entries.
- Personal delivery calendar: the signed-in user sees only their own requirements for the selected day, including when several people share one task.
- Publishing: approved/released products grouped by parent task, linked plan preparation and the existing publishing engines. Independent manual publishing remains available separately. Funding plans do not automatically publish an organic post or charge an advertising account.
- Terminal product approval is distinct from additive departmental action weights, so it does not cause the old total-over-100% validation problem.

## Preserved

CRM, operations, tracking, attendance, website and owner-community production files were not rewritten. Stock, subscriptions, engagement, native publisher implementations, storage connectors, base branding CSS and dependency versions are preserved. Shared changes are confined to marketing routes, marketing permission catalog entries and a marketing-only initialization hook. Details and before/after hashes are in the change manifest.

Existing marketing data and native publishing/CRM relationships are retained. No bulk deletion, old-system import or schema reset is included. The previous destructive marketing schema-reset branch was removed.

## Defaults for points not explicitly resolved in the discussion

1. A product is released to Products and publishing preparation only after **all remaining requirements in its parent task are approved with final files**. This follows the requested whole-task completion rule rather than silently releasing partial work.
2. The delivery calendar is personal for every account, including admin. Admin review remains available from task details according to permissions.
3. A date may contain multiple product rows in an agenda/campaign; a duplicate product on the same date in the same plan is deduplicated.
4. The dashboard shows a delivery-date range when a task has different requirement deadlines; the calendar still shows only the selected day's personal deliveries.
5. Task numbers are reserved on opening the task form. Abandoned forms can leave sequence gaps; numbers are never reused or produced using unsafe `MAX+1` logic.

## Verification and limitations

- 106 compatibility/check scripts passed in the working source, including the new workflow suite.
- The new suite passed 64 domain and mocked SQL/API-boundary checks.
- 31 browser interaction/layout checks passed using the actual new TSX/CSS and a mocked service boundary.
- 297 TypeScript/TSX files transpiled with zero syntax diagnostics.
- Baseline and working-source semantic checks with external-library stubs each produced 230 stub-related diagnostics; there were zero additional diagnostics relative to the baseline. This is **not** a dependency-complete TypeScript build.
- 80 obsolete marketing-only assertion groups were retired/replaced because they required the removed legacy creator/three-or-four-column UI. Their exact assertions and reasons are inventoried. Non-marketing assertions were retained.

**Not executed:** dependency-complete `pnpm run build`, a real PostgreSQL migration, real cloud uploads, or live social publication/funding. Dependency installation was unavailable in the development environment. Browser QA used an available React 18 test runtime with router/auth/API/icon mocks, not the project's installed production React dependency. Do not interpret these tests as production end-to-end certification.

## Before rollout

1. Keep a backup of the current source and database. Test this complete package in a staging environment first, not against production credentials.
2. Install the exact lockfile dependencies: `pnpm install --frozen-lockfile`.
3. Run `pnpm run build` and `pnpm run test:marketing-workflow` with the installed project dependencies.
4. Initialize the application against a staging database, inspect the two idempotent marketing migration records and review the mapped marketing permissions. Existing storage/provider settings are reused; no new credential was generated or embedded.
5. Verify a two-user task with different delivery dates, idea attachments, all required final sizes, revision, rejection, approval, product release, agenda/campaign selection, and personal calendar isolation.
6. Check stock/subscriptions/engagement and the other systems with representative accounts. Test publication only on an explicitly authorized test account after verifying the preview and target platform.

The application applies the canonical additive workflow schema when the workflow is first used, and the marketing permission extension during access initialization. SQL exports are supplied for inspection/staging, not as an instruction to run unreviewed SQL in production. Do not repeatedly run the access SQL manually; its application is controlled by the migration ledger.

See `docs/MARKETING-WORKFLOW-IMPLEMENTATION.md`, `docs/MARKETING-WORKFLOW-VERIFICATION.json`, `docs/MARKETING-WORKFLOW-CHANGE-MANIFEST.json`, and `docs/MARKETING-WORKFLOW-TEST-MIGRATION.json`.
