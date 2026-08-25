# MZJ Owners — Repeat old-customer code + optional checkout rewards

- Schema target: 1224.
- Removed the former global one-use constraint from `owners.personal_code_uses`; the same sold member can use their own code on later purchases.
- Kept one ledger row per website order for idempotency and audit history.
- Old-customer code still must match the member phone.
- Friend-code rule is unchanged: the same buyer phone cannot use the same friend code twice.
- Existing cancellation reconciliation continues to release only the rows linked to the cancelled website order.
