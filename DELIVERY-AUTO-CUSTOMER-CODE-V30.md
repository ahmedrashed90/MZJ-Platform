# MZJ Platform v30 - Automatic Checkout Customer Code

Full clean platform source based on CASH-QR-CLUB-ATOMIC-CLEAN v29.

Changes are limited to the existing Owners Commerce API contract:
- New authenticated `commerce_customer_by_phone` action.
- Sold MZJ Club member -> `old_customer` + personal referral code.
- Active non-sold legacy/new customer -> `new_customer` + customer code.
- Unknown phone -> 404 / registration required.
- Existing `commerce_new_customer_code` still preserves CRM routing and MZJ Club code creation, and now queues a dedicated SMS+ containing that code and returns delivery diagnostics.

No unrelated CRM/Owners/tracking/operations UI or workflow is replaced.
