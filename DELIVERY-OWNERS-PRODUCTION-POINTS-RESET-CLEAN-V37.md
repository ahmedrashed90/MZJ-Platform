# MZJ Club Community — Production Points Reset CLEAN v37

- Full clean source based on v36.
- One-time production reset for active sold members: points balance = 500, lifetime points = 500, tier history reset to the base state.
- Existing points ledger is cleared so the customer activity log starts empty.
- The 500 opening balance is virtual member state, not a ledger movement.
- Historical purchases before the production launch timestamp are ignored by future purchase reconciliation.
- The first real purchase after launch for a reset existing member is treated as repurchase; a genuinely new sold customer receives the normal first-purchase 500-point movement once.
- Historical referral conversions are blocked from recreating experimental points after reset.
- Existing points/reward/referral flow is preserved for post-launch activity.
- No patch/diff delivery.
