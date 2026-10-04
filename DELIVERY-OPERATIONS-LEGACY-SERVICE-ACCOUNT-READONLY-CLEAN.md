# Operations Legacy History - Service Account Read Only

- Scope: Movement History only.
- Legacy Firebase is accessed only from server route `/api/operations/legacy-history`.
- Required Vercel variables:
  - `LEGACY_FIREBASE_PROJECT_ID`
  - `LEGACY_FIREBASE_CLIENT_EMAIL`
  - `LEGACY_FIREBASE_PRIVATE_KEY`
- Legacy collections read: `logs`, `requests`, `transfers`, and `cars/{VIN}` for display enrichment only.
- No legacy write/update/delete/batch/commit APIs are present in the legacy route.
- Recommended IAM role on the service account: Cloud Datastore Viewer.
