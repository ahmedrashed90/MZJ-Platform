# Release checklist v1.8.1

## Scope
- Dedicated WhatsApp/Mersal Worker for template synchronization and outbound sending.
- Mersal token stored in Cloudflare only.
- CRM template synchronization calls the configured WhatsApp Worker.
- Existing routing, permissions, statuses, reports, and UI remain unchanged.

## Worker routes
- `GET /health`
- `GET /env-check`
- `POST /templates/mersal`
- `POST /send/mersal`

## Required secrets
### Cloudflare
- `MZJ_GATEWAY_SECRET`
- `MERSAL_TOKEN`

### Vercel
- `MZJ_GATEWAY_SECRET` with the same value.

## CRM endpoint
- Source code: `whatsapp`
- Send URL: `https://YOUR-WORKER/send/mersal`
- Health URL: `https://YOUR-WORKER/health`
- Secret name: `MZJ_GATEWAY_SECRET`

## Verification
- Worker syntax check.
- Mock template sync.
- Mock free-text send.
- Mock template send with params converted to Mersal components.
- TypeScript and production build.
