# MZJ Platform - Owners Ledger Columns CLEAN v35

## Base
This delivery is a complete source package rebuilt from the full v34 source tree. It is not a patch, diff, hotfix overlay, or patch-on-patch package.

## Requested change
Customer page -> سجل الحركة now presents the columns in this order:

1. التاريخ
2. البيان
3. النقاط

The same presentation is applied to both the public customer portal and the admin/member preview page.

## Preserved behavior
- Point values and ledger calculations are unchanged.
- Movement labels are unchanged; only the column title الحركة becomes البيان.
- Purchase vehicle details stay inside the البيان column.
- NEXT ERP invoice actions stay inside the البيان column.
- Positive/negative point formatting is unchanged.
- On mobile, البيان and النقاط remain on the primary row and التاريخ remains visible beneath them.

## Files changed from v34
- src/owners/OwnersPortalPage.tsx
- src/owners/OwnersMemberPreviewPage.tsx
- src/styles.css
- package.json (adds the v35 static contract check only; internal application version remains 1.19.16)
- scripts/check-owners-ledger-columns-v35.mjs
- scripts/check-owners-community-v1200.mjs (updates the existing regression assertion to the new column label)

No .patch or .diff file is included.
