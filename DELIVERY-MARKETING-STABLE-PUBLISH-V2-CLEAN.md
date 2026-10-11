# MZJ Marketing V2 - Stable Publishing CLEAN FULL

Source: MZJ-Platform-MARKETING-V2-PRO-UI-BUILD-CLEAN-FULL.zip

## Scope
- Marketing-only development. No changes to CRM, Operations, Tracking, website, subscriptions or stock logic.
- Approved product publishing preparation: show task + independent requested product, platforms/post types/sizes, ready final files, separate caption and hashtag fields, save a reusable preparation draft, then select product for Agenda (publication date) or Campaign (funding date).
- Preserve legacy native publishing integrations, engagement history, platform account settings and manual independent publication flow.
- Dashboard and database UX: marketing branded styling, centered creation choices, confirm-and-permission protected soft delete for new tasks and existing campaigns. Deletion blocks linked publication and retains historical files/data.

## Stability changes
- Workflow API no longer executes Operations / legacy Marketing DDL on every new-workflow read or approval request.
- The existing legacy Marketing schema version is respected; workflow upgrades are additive/versioned with bounded lock waits, an advisory migration lock and a short retriable error during a parallel migration.
- Marketing read operations use bounded front-end timeouts and throttled refresh polling; failed reloads preserve already displayed data.
- The new publishing draft is stored independently of scheduling in `marketing.work_product_drafts` and carried into new agenda/campaign entries.

## Checks performed
- `node scripts/check-marketing-workflow-v2.cjs`: 74/74 passed (mock/database-boundary/static checks).
- `node scripts/check-marketing-manual-publish-standalone-v1230.mjs`: 14/14 passed.
- `node scripts/check-marketing-platform-connections-rebuild-v1212.mjs`: 25/25 passed.
- `node scripts/check-marketing-task-any-file-v43.mjs`: 13/13 passed.
- `node scripts/check-api-imports.mjs`: passed.
- `node scripts/check-no-merge-conflicts.mjs`: passed.
- TypeScript changed-file transpile/syntax diagnostics: passed; not a full typechecked build.

## Environment limitations and release precautions
- This environment does not have installed project npm dependencies. `pnpm build` and full TypeScript typechecking have NOT been completed here.
- Live Neon Postgres migration lock behavior, uploads to real providers, Vercel performance and real social-media posting have NOT been verified here.
- Test on a staging deployment connected to a staging database before production. Avoid concurrent first-time migrations, confirm no 504/40P01 errors, and exercise the entire product -> review -> prepare -> agenda/campaign -> publish flow.
- This is a full source archive, not an add-on patch. Do not extract over a mixed older source tree; deploy it as one consistent version.
