# MZJ Content Strategy <-> Marketing API | 2026-11-11

## Purpose and boundaries

The existing Marketing Vercel project `https://mzj-platform.vercel.app/` stays the source of truth for the Marketing executors, live stock, task types, platform output formats and the original **Create Task** workflow. The separate Content Strategy Vercel project handles review, selection and explicit assignment. The Marketing API introduced here is **read-only except for one authorized `Create Task` action**; it cannot update stock, delete tasks, modify customers or mutate anything else.

Stock output has **EXACTLY five fields** and no VIN or vehicle ID:

| API key | Stock UI (Arabic) |
|---|---|
| `car_name` | `السيارة` |
| `statement` | `البيان` |
| `model_year` | `الموديل` |
| `exterior_color` | `اللون الخارجي` |
| `interior_color` | `اللون الداخلي` |

Rows are distinct by these five normalized text values, and only active non-deleted operations stock is included. Identical cars are combined; the API intentionally does not reveal how many individual VINs exist behind a row.

## Marketing API endpoints (new)

`GET /api/strategy-integration/stock` -- Read key; returns only `cars` with the exact five stock fields, with no VIN/serial fields.

`GET /api/strategy-integration/executors` -- Read key; returns active eligible Marketing employees and department memberships.

`GET /api/strategy-integration/catalog` -- Read key; returns active task types and compatible output format IDs.

`GET /api/strategy-integration/assignments?taskId=<uuid>` -- Read key; returns status of a task created by this bridge; only bridge-created tasks can be queried.

`POST /api/strategy-integration/assignments` -- **Assignment key**; validates the complete body and creates a task using the *existing* `marketing.work_reservations` -> `marketing.work_tasks` -> `marketing.work_items` flow and existing approvals/notifications/history. Idempotent by a saved `requestKey`. No general-purpose write API is provided.

Each endpoint accepts `Authorization: Bearer <key>` but these keys **must never be used in browser JavaScript**. The browser calls only the Strategy project's `/api/marketing-bridge` endpoint, which validates the Firebase Owner ID token and forwards to Marketing server-to-server.

## Deploy order

1. Back up the existing **Marketing** source and keep its current Postgres database. Unzip `MZJ-MARKETING-STRATEGY-INTEGRATION-...zip` and deploy this **whole Marketing source** to the existing Vercel project for `mzj-platform.vercel.app`. Do not change its existing `DATABASE_URL` or any other current environment setting.
2. On the **Marketing Vercel project**, set new server-side Environment Variables:
   - `MZJ_STRATEGY_READ_KEY` = a unique randomly generated secret with at least 32 characters.
   - `MZJ_STRATEGY_ASSIGN_KEY` = a **different** randomly generated secret with at least 32 characters.
   - `MZJ_STRATEGY_INTEGRATION_USER_ID` = UUID of an **existing active Marketing user** with the `marketing.task.create` permission, used as the authenticated task creator/audit identity. This is the Marketing database UUID, **not** the Firebase UID.
3. Redeploy Marketing after environment settings are saved. Until keys/actor are set, read and assign endpoints refuse requests.
4. Back up the current **Content Strategy** source. Unzip `MZJ-CONTENT-STRATEGY-...zip`, deploy the full root to the separate Vercel project; Framework: Other; Output Directory: `site` as defined in `vercel.json`. The function `api/marketing-bridge.js` is private server-side code and not inside `site`.
5. On the **Strategy Vercel project**, configure:
   - `MZJ_STRATEGY_READ_KEY` = **same** READ secret from Marketing.
   - `MZJ_STRATEGY_ASSIGN_KEY` = **same** ASSIGN secret from Marketing.
   - `MZJ_MARKETING_API_BASE_URL` = `https://mzj-platform.vercel.app`.
   - `MZJ_STRATEGY_FIREBASE_PROJECT_ID` = Firebase project ID already present in `site/config.js`.
   - `MZJ_STRATEGY_OWNER_UID` = Firebase `OWNER_UID` already present in `site/config.js`.
6. Update the Content Strategy project's **Firestore Rules** with the accompanying `firestore.rules`. This expands edit permissions only on content-plan assets for vehicle approvals/task links. The historical baselines remain unchanged and non-editable. **Never delete or reimport existing Firestore data.**
7. Redeploy Strategy. Sign in to Strategy with the existing Firebase owner account. Select **`ربط سيستم التسويق`**. Click refresh to retrieve stock, eligible employees, and task options. Open an idea; select no car, one/more cars or comparison (2+) as appropriate, and approve the selection. Then choose the Marketing executor and configured output formats and press **`إنشاء تاسك في سيستم التسويق`**. Nothing is written to Marketing before this explicit button click. The returned task number and individual item IDs are saved to the existing strategy plan. You may refresh a linked task's current status in read-only mode.
8. Open Marketing -> **`إنشاء تاسك`** / task list and confirm the created task and each requirement appear for the selected executor. Test with ONE safe internal task, then inspect review and approval before proceeding with the remaining creative briefs.

## Operational and security notes

- Only the original Marketing task creation workflow is invoked. Creating a task also creates its normal task number, history, work items and existing internal notifications.
- A strategy approval is **not** a Marketing approval. Executors and reviewers continue their normal Marketing workflow. Changing a linked idea or executor in Strategy later does **not** silently overwrite the Marketing task; edit that task through the Marketing system.
- The Strategy UI only permits selecting `صورة` or `فيديو` as its production media type; a four-image group is created as four image requirements inside one task. Supporting story text does not create another task by itself.
- Identical stock rows are deduplicated and no VIN is transmitted or stored in the strategy approval. For a comparison, select at least 2 distinct five-field stock choices. Stock is reloaded using the refresh action before final review.
- Do not upload private environment values, database passwords, service-account keys or API credentials to the chat or Git repository. Generate two strong random secrets and set them through Vercel's environment configuration (Production, and other environments only if needed). Rotate them together on both projects.
- The original social-platform baseline snapshots were not altered. This release does **not** publish content automatically, change CRM records, modify operations vehicles, or perform a live production database migration.
- This bridge works with the previously created **first 28-day plan**. Multi-cycle JSON ingestion, enhanced creative idea regeneration and redesign of the full publishing calendar are distinct features and are **not** claimed to be completed by this integration build.

## Local regression checks

In Marketing source:

```sh
node scripts/check-api-imports.mjs
node scripts/check-marketing-workflow-v2.cjs
node scripts/check-marketing-schema-upgrade-clean.cjs
node scripts/test-strategy-integration-api.mjs
```

In Content Strategy source:

```sh
node --check api/marketing-bridge.js
node --check site/marketing-bridge.js
node --check site/app.js
node scripts/test-marketing-bridge.mjs
node scripts/qa-plan.mjs
node scripts/qa-plan-storage.mjs
```

Tests simulate auth/SQL and run without live marketing Postgres, Firebase or Vercel credentials. They validate code contracts, not the live production integration. **Live end-to-end verification requires setting both sets of Vercel environment variables and deploying both projects.**
