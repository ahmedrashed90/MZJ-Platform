# MZJ Platform - MZJ Club Design Switch CLEAN v93

## Fix included
- Fixed the production database migration for `owners.settings.portal_design`.
- The owners schema readiness check now requires the `portal_design` column.
- Added schema migration v1227 so databases created before the design selector automatically receive the new column and validation constraint.
- No changes to CRM, attendance, marketing, points, referrals, packages, rewards, or checkout business logic.

## Root cause fixed
v92 contained the new column in the schema SQL, but the schema readiness test did not require that column. Existing databases could therefore be considered already ready and skip the migration, causing `PostgresError 42703` when saving MZJ Club settings.
