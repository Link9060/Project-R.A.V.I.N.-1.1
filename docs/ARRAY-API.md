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
