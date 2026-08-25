# MZJ Owners Community - Open Login + Referral Reuse v1223

## Scope

Clean full-source update based on the approved platform v20 source. No unrelated CRM, operations, marketing, tracking, or ERP logic was changed.

## Changes

- New customers registered through QR/link and present in `owners.legacy_customer_codes` can authenticate with OTP and open their Owners page before a completed purchase.
- The pre-sale profile keeps the customer in the new-customers segment, shows membership identity, current points (0 until qualifying purchase logic awards them), and the customer code.
- The new-customer customer code remains valid only in the checkout `new_customer` context and only for its owner phone.
- Friend referral codes can be used by multiple different customers and multiple different purchase orders.
- The same buyer phone cannot use the same member friend code twice. The unique rule is `(referrer_member_id, used_by_phone_normalized)`.
- Cancelled orders release the friend-code use record.
- Historical friend-code purchase benefits are backfilled into `owners.friend_code_uses`, so the new rule also respects prior successful uses.
- Both commerce confirmation endpoints enforce the friend-code/phone rule.

## Schema

Owners schema state: `1223`.
