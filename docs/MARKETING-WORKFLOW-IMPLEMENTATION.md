# Marketing workflow implementation and rollout notes

## Integration boundaries

The workflow lives under `src/marketing/workflow`, `shared/marketing-workflow*`, and `server/marketing/workflow.ts`. It is routed through the existing authenticated marketing API; it is not a separate server or plugin. Stock, subscription and engagement pages remain the original components. Native provider implementations, media storage connectors, shared CSS, API authorization infrastructure and notification infrastructure remain the original implementation.

The two retained old creator URLs redirect into the unified creation page. The removed old POST create/import operations return a retired-flow response instead of accepting invalid legacy creations. Legacy edit/read helpers required by historic records and native publishing are retained; guards prevent those routes from mutating the new canonical workflow entities.

## Canonical entities

- `work_reservations`: per-user idempotent task-number reservation. A PostgreSQL sequence, not a local browser counter, supplies the number.
- `work_tasks`: parent task and optimistic version, its settings-derived type and creation identity.
- `work_items`: executor requirements, idea, formats snapshot, personal deadline and approval state.
- `work_uploads` / `work_item_files`: staged uploads and attached final/idea files. An upload belongs to exactly one reservation or item. Final files may cover selected publishing formats.
- `work_history` / `work_action_progress`: minimal audit trail and non-terminal action state; neither replaces the approval requirement.
- `work_plans` / `work_plan_items`: campaign funding or agenda publishing dates and released product selections, with idempotent creation keys.
- `work_publish_targets` / `work_publish_files`: mapping from a planned product's format-specific approved files into native publishing schedules.

The canonical schema string is in `server/_marketing-workflow-schema.ts`; its export is `database/marketing-workflow.sql`. The permission extension has its own canonical string in `server/_marketing-workflow-access.ts` and corresponding SQL export. The `workflow_migrations` ledger and advisory locks prevent repeated application in normal application initialization. Existing tables are not truncated or dropped.

## Approval, file integrity and personal access

Final-file upload, submit, approval, revision and deletion share a consistent parent-task -> requirement lock order. An item version protects against stale updates. Submission requires complete final coverage for every selected format and no unfinished upload. An image carousel requires multiple images; a video target has a single ready final video.

Approval applies to a submitted requirement only and requires the explicit review permission. Returning for revision requires a note. Rejecting deletes that requirement and its links, recalculates the parent's denominator and never reassigns it to the executor. Minimal audit history and privately stored historical bytes are not a new active/rejected product. No background deletion of shared cloud files occurs.

Product release requires all remaining parent requirements to be approved with final coverage. Product selection and preparation recheck authorization and the release gate on the server. Permission denies take priority; hiding UI controls is not the security boundary. The calendar query always includes the signed-in executor ID and the selected date window.

File previews/downloads use the native authenticated stream after workflow ownership checks. Google Drive upload confirmation uses the existing file-ID ownership metadata verification and expected byte count; R2 confirmation checks object existence and expected bytes. Existing upload connectors and settings are reused. The application does not claim to transcode or inspect every pixel/duration/codec; platform-native validation can still reject incompatible media.

## Publishing safety and compatibility

A planned product is adapted into existing marketing publishing records while retaining its workflow identity. Existing published posts, provider response data and engagement/CRM relationships are not recreated or deleted.

Preparation persists the selected final files, formats, caption and YouTube options. Unselected unprocessed targets are cancelled rather than cascaded away. Published/processing/uncertain targets are protected from destructive preparation edits.

Publication uses the original provider engine and a server-side claim/advisory lock. An already published schedule is idempotent. Uncertain provider results enter `verification_required`; they do not automatically retry and risk duplicate posts. Reset requires permission plus an explicit confirmation that no post exists on the target account. A stale processing claim requires the same verification path after its waiting period.

A campaign funding date is a planning record only. It never sends an organic publishing command or spends money. There is no new cron service and no assertion that publication will automatically run at its planned date. Native unsupported platform/format combinations remain unsupported and must produce an explicit validation error instead of a fabricated success.

## UI and existing data

Native MZJ tokens and existing marketing/global styles are reused; additional rules are scoped under `.mkw`. No font assets or foreign UI theme were added. The global app's non-marketing routes and all non-marketing permission catalog entries compare identically to the baseline.

The database table unifies workflow tasks/plans with legacy campaign/agenda summaries while filtering out workflow adapter duplicates. Old records are shown read-only; they have not been silently converted into invented new task outputs. The explicit independent manual-publishing entry point retains the native component and filters it to standalone manual records.

Live lists use visibility-aware timestamp-version checks at a 20-second interval, reload on focus and after successful local mutations, and preserve displayed data when a transient live check fails. No one-second full-data loop was added.

## Verification boundary

See the JSON verification report for exact script names and browser scenarios. SQL/API tests use a scripted query boundary, not a PostgreSQL engine. The browser harness renders the actual new components against mock fixtures without contacting production; external routing/auth/provider boundaries are mocked. Test-only global tools and runtime files are NOT included in the delivered application.

A dependency-complete production build and staging PostgreSQL/provider smoke test are required before rollout. Unchanged file hashes prove code preservation; they do not prove that production configuration, network access or provider approvals are correct.

## Rollback

Back up the previous source and production database before deployment. If staging or rollout reveals a blocking issue, revert to that source snapshot. Preserve the new additive workflow tables for diagnosis; do not drop the marketing schema. Provider posts already published must be reconciled on the actual platform before retrying or rolling back a publication action. No rollback operation was run during this work.
