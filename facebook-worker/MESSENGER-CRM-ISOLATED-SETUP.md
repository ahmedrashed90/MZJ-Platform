# MZJ Facebook Messenger -> CRM | Isolated inbound setup

## What was actually wrong

At the time of the screenshots (25 Oct 2026), Meta app **MZJ Platform Publishing** had a `Page` webhook callback at:

`https://mzj-platform.vercel.app/api/integrations/meta/engagement-webhook`

That app's Page subscription was **feed only**. The fields `messages` and `messaging_postbacks` were **Unsubscribed**. As a result, inbound Messenger customer replies were not sent to the Facebook Worker. The marketing callback currently configured does not transform Messenger messages into CRM conversations.

The existing Facebook Worker already supports `GET/POST /meta/webhook` and forwards normalized `messages`, `postbacks`, and `standby` events to `https://mzj-platform.vercel.app/api/integrations/facebook`. No change to the marketing webhook is required or authorized.

## Isolation requirement (do not modify marketing)

**Do not change** the Meta app `MZJ Platform Publishing` Page callback or its `feed` subscription. Do not change the marketing webhook endpoint or its related source files.

**Create/use a separate Meta app** for CRM Messenger inbound (e.g. `MZJ Messenger CRM`) and configure the `Messenger from Meta` use case in that **separate app**. This preserves the original app's single Page callback endpoint and keeps its publishing/marketing functionality independent.

## Deployment

1. In Cloudflare, deploy the complete `facebook-worker/src/index.js` version `v2.0.8-isolated-messenger-inbound` to the **existing** `facebook` Worker. The separate Meta app will use the already existing Worker URL; no new Worker or CRM service is necessary.
2. In Cloudflare Worker Settings > Variables and Secrets, create **new secrets**:
   - `FB_MESSENGER_VERIFY_TOKEN`: a strong random verification text you invent, known only to you and the new Meta Messenger app.
   - `FB_MESSENGER_APP_SECRET`: the **App Secret of the new dedicated Messenger app**, not the publishing app's secret.
3. Keep existing `FB_VERIFY_TOKEN`, `FB_APP_SECRET`, `FB_PAGE_ACCESS_TOKEN`, `FB_PAGE_ID`, `MZJ_GATEWAY_SECRET`, ManyChat tokens, and `PLATFORM_INBOUND_URL` unchanged, apart from routine rotation of any previously disclosed/expired tokens. `FB_PAGE_ID` must be `616836628446846`.
4. In the **new Messenger app**: Messenger from Meta > Webhooks > Page:
   - Callback URL: `https://facebook.next-erp-mzj.workers.dev/meta/webhook`
   - Verify token: the same value as `FB_MESSENGER_VERIFY_TOKEN` in Cloudflare
   - Verify and save. The Worker responds to Meta's `hub.challenge` after verifying the token.
5. In the **new Messenger app**, subscribe its **Page webhook fields** to **`messages`, `messaging_postbacks`, `standby`**. `standby` is important if ManyChat owns the conversation thread. Optionally enable `message_echoes` if needed for outgoing-message synchronization; no change to the `feed` subscription in the publishing app.
6. In the new app's Messenger API Settings, connect Page `616836628446846` and **subscribe that Page to the new app** for the same fields. App-level webhook field selection and Page-to-app subscription are separate requirements. Confirm that the Page lists the new app and its subscribed fields, including `standby`, in the app configuration or Graph API.
7. Ensure the app is eligible to receive messages from actual customers. During development/testing, access may be limited to app roles/testers. Non-role customers can require appropriate `pages_messaging` advanced access/App Review and live mode. Do not change ManyChat's Primary Receiver/thread control just to make inbound work.

## Verify without exposing secrets

- Cloudflare `GET https://facebook.next-erp-mzj.workers.dev/health`: expect `env_check.messenger_receiver_ready=true`. This is a **configuration check**, not proof of Meta's Page subscription.
- Send an actual customer message on Messenger while viewing Cloudflare Observability > Live. Expect a `POST /meta/webhook` event and a sanitized `Messenger inbound webhook forwarded to CRM` log with `forwardedCount > 0`.
- If ManyChat is the Page's Primary Receiver, check incoming events in `standby`. The Worker handles both `entry[].messaging` and `entry[].standby`.
- In CRM, check the same customer conversation. The Worker forwards the real Page Scoped ID (PSID) to `/api/integrations/facebook`, which saves the message and runs the existing CRM automation. The new code does not assign a service when the customer has not selected one.
- If `POST /meta/webhook` does not appear, check **the new Messenger app**'s actual Page subscription and status; do not change the publishing app's callback.
- If `/meta/webhook` appears but message not in CRM, look for `Facebook Meta inbound processing failed` / HTTP errors, and inspect `integrations.inbound_events` for the event key. The CRM pipeline remains unchanged in this release.

## Local tests

```
node facebook-worker/test-worker.mjs
node facebook-worker/test-messenger-inbound-v208.mjs
node --check facebook-worker/src/index.js
```

Tests use mocked Meta/Graph API and mocked CRM endpoint; they do not send real customer data or prove Meta app configuration.

## Change scope

Only the Facebook Worker `src/index.js`, its Worker-local tests, and this Worker-local runbook were updated. `server/_marketing-engagement.ts`, `server/integrations/meta-engagement-webhook.ts`, the marketing modules, CRM business-flow engine, and UI were not modified.

`FB_MESSENGER_VERIFY_TOKEN` and `FB_MESSENGER_APP_SECRET` are inbound-only; the existing outbound Page token and Graph send endpoint stay as in the previously deployed `v2.0.7`.
