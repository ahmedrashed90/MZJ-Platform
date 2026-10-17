# MZJ Operations: Tajyeer and Inventory Field Permissions

## Source
This full-source build is derived from `MZJ-Platform-MARKETING-STOCK-LINKED-REQUESTS-CLEAN-FULL.zip`.

## Changes
- Operations > Vehicle Inventory: persistent per-VIN Tajyeer status, green YES / red NO badge, editor reserved for users explicitly granted `operations.inventory.tajyeer.update`, and ALL / YES / NO filtering.
- Record the employee and timestamp when Tajyeer changes. Audit writes contain before/after values.
- Operations inventory users can see the VIN and only the columns enabled in Settings > Users and Permissions > Operations > Vehicle Inventory. Existing viewers keep their columns by default unless denied explicitly. Exports use the same visible columns.
- Remove the obsolete notes, shortage, reservation, and reserved-admin fields from the stock table without deleting the underlying legacy values.
- Operations > Movement: one always-visible `Notes` input, required for the `has_notes` status and optional for other statuses. Removed redundant vehicle/shortage note inputs and the administrative-approval badge in the movement selection table. Existing financial approval and workflow remain unchanged.
- Permissions and non-destructive database columns are initialized through central access-control and operations vehicle schemas, respectively. No data reset was introduced.

## Verification
- `scripts/check-operations-inventory-tajyeer-clean.mjs`: 29/29 static contract checks.
- Local permission helper tests: 5/5.
- Operations native, movement workflow, movement note, inventory notifications, central permissions, access catalog, and import checks: passed.
- Marketing workflow regression: 74/74 passed.
- TypeScript syntax of changed modules: passed via TypeScript transpilation.

## Deployment limitations
- Full Vite/TypeScript project build was not possible in this environment because project React / Vite dependencies are not installed. Do not treat static checks as a successful production build.
- The new database columns/permissions have not been applied or exercised against the live Neon database, nor has Vercel Preview been tested here. Verify a Preview deployment, database migration, and edit permissions before production release.
- No changes have been made to live data or production services.
