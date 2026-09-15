# RAVIN Production Guide

This document defines the minimum production standard for the RAVIN web/API stack.

## Release gates

Before deploying a release:

1. Run `npm ci` from `ravin/`.
2. Run `npm run check` and require a clean result.
3. Verify Conversation and Work mode can authenticate, create a conversation, stream a response, reload history, and reopen the conversation.
4. Verify file upload, file deletion, memory read/write/delete, and sign-out.
5. Check light/dark mode, all experience modes, mobile layout, keyboard navigation, and reduced-motion behavior.
6. Confirm `RAVIN_ENABLE_SELF_BUILD` is **not** enabled in customer production.
7. Confirm Cloudflare and Supabase credentials are configured only in the server environment.

## Required environment variables

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Recommended:

- `FRONTEND_ORIGIN` — additional allowed frontend origin.
- `RAVIN_RELEASE` — release identifier exposed by the health endpoint.
- `RAVIN_AI_SMOKE_TESTS=true` — opt-in provider smoke tests at server start. Keep disabled by default to avoid unnecessary inference calls.

Developer-only:

- `RAVIN_ENABLE_SELF_BUILD=true` — enables the privileged self-build route. Never enable this for normal customer environments.

## Health and diagnostics

`GET /api/health` returns a minimal readiness response. Production logs include a request ID, HTTP method, path, status, and duration. Internal provider/database errors are logged server-side while 5xx responses return a stable public error and request ID.

Do not log access tokens, refresh tokens, passwords, message contents, private file contents, or raw personal memory.

## Browser security

The current GitHub Pages + separate API architecture requires browser-managed Supabase sessions. All rendered assistant Markdown is escaped before formatting and provider credentials never reach the browser.

For a later high-assurance deployment, prefer a same-origin application with secure, HttpOnly session cookies so long-lived tokens do not need browser storage.

## CORS

The API allows only the configured RAVIN origins. Add an origin through `FRONTEND_ORIGIN` rather than widening CORS globally.

## Deployment topology

```text
GitHub Pages / browser client
        |
        | authenticated HTTPS + SSE
        v
RAVIN API service
        |---------------------|
        v                     v
Supabase                 Cloudflare Workers AI
```

The frontend is static. The API owns provider credentials, model calls, authenticated server-side orchestration, and privileged capabilities.

## Rollback

Keep deployments tied to immutable Git commits. If a release is broken, move the deployment branch or hosting service back to the last verified commit instead of hot-editing production files.
