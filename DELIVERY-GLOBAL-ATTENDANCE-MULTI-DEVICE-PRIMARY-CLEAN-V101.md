# CLEAN V101 — Multi-device approval with one primary attendance device

- Multiple approved Windows devices are allowed for the same user.
- Exactly one approved device is marked primary when approved devices exist.
- First approved device becomes primary automatically.
- Additional approved devices are secondary and can log in normally.
- Attendance check-in/out is only allowed from the primary device for users with device verification required.
- Secondary-device sessions bypass attendance enforcement and cannot open/close attendance records.
- Admin can switch the primary device without revoking the other approved devices.
- Revoking the primary automatically promotes the most recently used approved secondary device.
- Existing UI layout is preserved; only the device controls gain a primary marker/action.
