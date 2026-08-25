# Owners / Website Checkout Discount Code

Added the authenticated Owners Commerce action `commerce_new_customer_code` to the existing `/api/owners/public` endpoint.

Behavior:
- Validates customer name and Saudi mobile.
- Reuses an existing non-sold CRM lead without overwriting its acquisition source or salesperson ownership.
- Creates a brand-new lead with `source=website`, `branch=website`, department `cash_sales`, and responsible user `Website` when the phone is not in CRM.
- Does not distribute a newly-created website checkout lead to salespeople.
- Rejects sold customers and directs them to the old-customer flow.
- Returns or creates the authoritative legacy customer code from `owners.legacy_customer_codes`.
- Requires `OWNERS_COMMERCE_API_KEY`; the secret remains server-to-server.
