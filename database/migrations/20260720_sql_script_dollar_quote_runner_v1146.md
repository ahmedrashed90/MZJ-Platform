# v1.14.6 SQL script runner fix

No destructive database reset is required.

The production failure `unterminated dollar-quoted string` was caused by the application SQL runner splitting schema scripts at every line-ending semicolon, including semicolons inside PostgreSQL `DO $$ ... $$` blocks.

Version 1.14.6 updates `server/_db.ts` to split SQL only at semicolons outside:

- single-quoted strings
- double-quoted identifiers
- dollar-quoted blocks (`$$` and tagged `$name$` blocks)
- line comments
- block comments

After deployment, the existing idempotent schema initializer can continue from the current database state. Do not reset or drop schemas.
