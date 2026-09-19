# MZJ Platform — MZJ Club Design Switch CLEAN v94

## Build consistency correction

This full clean source keeps the v93 runtime schema migration and MZJ Club design selector unchanged.

The canonical Owners Community verification script was corrected to read the actual schema readiness version directly from `server/_owners-schema.ts` instead of accepting only the older hard-coded versions 1224/1225/1226.

The v93 runtime correctly requires schema version 1227 because `portal_design` is part of the canonical Owners settings schema. The previous verification condition was stale and caused a false build failure at 81/83 even though the runtime migration checks passed.

No runtime business logic, permissions, CRM flow, attendance logic, Owners points/rewards logic, or design-switch behavior was changed in v94.

## Verification cleanup included in the clean source

Two pre-existing verification assertions were tied to the exact old schema readiness versions even though the canonical schema had advanced to v1227:

- `scripts/check-owners-community-v1200.mjs`
- `scripts/check-owners-production-points-reset-v37.mjs`

Both canonical checks now derive the active readiness version from `server/_owners-schema.ts` and validate the required minimum semantics. No extra compatibility script, override, fallback, or release patch was added.
