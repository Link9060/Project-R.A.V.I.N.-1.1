# RAVIN ARRAY authenticated mission API

Implemented alongside the existing RAVIN Express web API in `ravin/server.js`. This service enables **text-only AI missions**, not external tool executions.

## Status

- Source integrated: yes.
- Auth: existing Supabase bearer-token user verification.
- Runner: existing `runAgent` function, **tool-free conversation path** with server-selected model by class.
- Live public server: **not verified or deployed as part of this change**.
- Storage: in-process memory only. Missions disappear if the server restarts.
- External actions: not available. Operations and Intelligence workers provide text plans, writing and code examples only.
- Cancel: queued jobs only; a running provider call cannot yet be stopped.
- ETA: not available. No fake progress percentage.
- Concurrency: 2 workers total, 2 outstanding jobs per user, max 300 retained jobs, 2-hour retention.

## Endpoints

All API routes below require `Authorization: Bearer <Supabase access token>` (from RAVIN's existing sign-in flow). Requests from another web origin additionally require that exact origin in `ARRAY_ALLOWED_ORIGINS`.

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/array/agents` | Allowlisted text-only agent roles |
| GET | `/api/array/missions` | Up to 50 recent jobs for signed-in owner |
| POST | `/api/array/missions` | Queue a text-only job; returns 202 |
| GET | `/api/array/missions/:id` | Owner-scoped job details |
| POST | `/api/array/missions/:id/cancel` | Cancel queued job only; 409 if already running |

Request body:

```json
{
  "agentId": "operations-01",
  "objective": "Draft a TypeScript component for review.",
  "policy": "assist",
  "operationsMode": "coding"
}
```

There are 12 logical agent slots: six `intelligence-01` through `intelligence-06` and six `operations-01` through `operations-06`. They are interchangeable workers per class, not separate permanently running language models. The model is selected only by the server:

| Class/mode | Workers AI model |
| --- | --- |
| Intelligence | RAVIN conversation model (Granite 4.0 H Micro by default) |
| Operations + General | RAVIN work model (Gemma 4 26B A4B by default), with **no tools** |
| Operations + Coding | `@cf/qwen/qwen3.8-27b`, with **no tools** |

The client sends `operationsMode: "general" | "coding"`. Coding is valid only for Operations; malformed modes are rejected. The server stores the resolved `model` in the mission result to prevent the UI from claiming an unsupported model. The policy may be `assist` or `review`; `authorized` and any tool use are explicitly blocked by the server. The job status is `queued`, `running`, `succeeded`, `failed`, or `canceled`.

Example response (shape only):

```json
{
  "mission": {
    "id": "uuid",
    "agentId": "operations-01",
    "objective": "Summarize this design idea with assumptions and next steps.",
    "policy": "assist",
    "status": "queued",
    "createdAt": 0,
    "updatedAt": 0
  }
}
```

When a mission succeeds, the same object includes `output` (text), `startedAt`, and `finishedAt`. It contains no server token, user ID, or sensitive connection parameters.

## Cross-origin setup

Set `ARRAY_ALLOWED_ORIGINS` to the **exact browser origin** of the ARRAY site (for example, your deployed custom domain). For non-production local development, `NODE_ENV=development` enables localhost/127.0.0.1 frontend origins. Do not use wildcards or arbitrary origins, and never store Supabase or Cloudflare provider secrets in a frontend repository.

The ARRAY frontend needs `VITE_RAVIN_ARRAY_API_URL` set to the actual, accessible RAVIN Express origin. Without a real, working URL, ARRAY remains in honest simulation mode. Providing a URL is configuration, **not** proof the backend is deployed.

## Non-goals and limitations

There is no durable database job store, real-time streaming, tool execution, developer code edit, cost tracking, event logs, background scheduler, distributed queue, or verified live ETA. Results are produced only after a successful Cloudflare model request. Process restarts destroy the local queue and records; multiple workers do not share state. Avoid production use until storage, cancellation, auth integration and reliability are hardened.

## Validation

The repository validation workflow runs `node --check` on the backend entry points and `node --test ravin/tests/array.test.mjs`. An actual authenticated external deployment test remains pending.

## Staged rollout and operating limits

Deploy the backend before the new ARRAY frontend. Old clients with the 24 original agent role IDs remain accepted temporarily and are assigned one of the two new model classes. The new `GET /agents` registry advertises **only 12 logical workers**. Once old clients are retired, the compatibility aliases can be removed in a separately reviewed change.

The ARRAY request always specifies a server-validated class and optional operations mode, not an arbitrary provider model. Each mission includes the requested model ID, and completed jobs update it from Cloudflare's routed-model metadata when supplied. Coding jobs still create **text only**, not GitHub patches or purchases.

**Cost caution:** Cloudflare publishes an inference price for Qwen 3.8 27B ($0.45 per million input tokens and $3.20 per million output tokens as of October 2026). A Cloudflare free daily allowance is *not* proof that an account with paid usage enabled cannot incur charges. Check the Cloudflare account's plan, usage and billing settings before enabling live coding for regular use. This change neither provisions payment instruments nor makes any background Qwen calls. There is no automatic provider-level spending cap implemented here.

**Deployment validation:** GitHub tests use a mocked provider call with no credentials and no paid usage. A genuine authenticated Qwen inference test, live session test and browser/mobile QA still need to be run against the owner's deployment.


## Response policy and optional instructions

The live ARRAY UI offers two enforced, tool-free response policies:

- `review`: Return a proposed draft, assumptions, risks and a checklist for human verification before adoption.
- `assist`: Answer the objective directly with informational text, drafts or code examples. No side effects.

The request may also contain `"instructions": "Return a concise report and note uncertainties."` (optional, 400-character maximum). These are lower-priority formatting and acceptance-criteria preferences, not authority to gain tools, run code, place orders, deploy or send messages. The server rejects non-string or overlength values and stores the exact validated preferences with the owner-scoped mission record.

Older UI versions that do not send `instructions` still work. The frontend must not promise execution privileges for either policy. Preview mode never sends a mission to this backend.
