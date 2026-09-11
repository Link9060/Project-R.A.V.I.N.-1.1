# RAVIN Architecture

**Project:** RAVIN 1.1 / software foundation  
**Status:** Active development  
**Last updated:** 2026-09-11

## Product direction

RAVIN is being built software-first as a standalone AI product and as the intelligence layer for future Resonant Assist software and hardware.

The same RAVIN identity should eventually be able to move between environments such as desktop, phone, Relay, a portable Core, a vehicle dock, or a garage dock. Hardware is intentionally deferred until the software platform is mature.

```text
RAVIN clients
(chat / phone / future Resonant products)
        |
        v
RAVIN backend / platform API
        |
        |------------------------------|
        v                              v
Supabase                           Cloudflare Workers AI
users / chats / memory /           Conversation: Granite
projects / files / devices          Work: Gemma
        |
        v
Capability Environment layer
(desktop / phone / simulated future docks)
```

## AI modes

RAVIN currently exposes two explicit user-selected modes:

- **Conversation** — `@cf/ibm-granite/granite-4.0-h-micro`
- **Work** — `@cf/google/gemma-4-26b-a4b-it`

The application does not silently auto-route between these modes. Provider credentials remain server-side.

## Chat

The v0.2 chat path uses authenticated server-sent events (SSE) for streamed responses.

The browser shell supports persistent conversations, message history, Markdown/code rendering, stop/copy/edit/retry controls, attachments, memory controls, and the persistent spatial RAVIN Core.

Legacy `/api/chat` remains available while v0.2 stabilizes. New product work should target `/api/v2/chat/stream`.

## Memory architecture

RAVIN keeps four conceptual memory layers:

1. Conversation memory — immediate conversation context.
2. Session memory — summarized recent conversation segments.
3. Project memory — durable information tied to a project.
4. Permanent memory — durable user facts/preferences/goals.

The v0.2 chat path retrieves relevant durable/session memory, ranks it for the request, and injects only useful memory into model context. It can also extract a small number of explicit durable facts/preferences from user messages and create periodic session summaries.

Users can inspect/add/delete permanent memories in the RAVIN UI and disable durable memory use/learning per request.

`memory_embeddings` remains available for a later vector-semantic retrieval upgrade; v0.2 retrieval currently uses safe lexical/relevance ranking.

## Files and images

Supabase Storage bucket `ravin-files` is private. Objects are stored under the authenticated user's UID prefix and protected by Storage RLS policies.

PostgreSQL `files` rows store ownership and metadata. v0.2 supports:

- text/code/data attachments with extracted text context,
- private attachment storage,
- image attachments in Work mode through multimodal message content,
- drag/drop and mobile photo/file selection.

The current upload limit is 8 MB per attachment and four attachments per message.

## Capability Environment layer

RAVIN now has a software capability registry. An environment tells RAVIN which senses, outputs, connected systems, and constraints are available.

Current definitions:

- `desktop`
- `phone`
- `portable_core` (simulated)
- `relay` (simulated)
- `vehicle` (simulated)
- `garage` (simulated)

The simulated environments are deliberately honest: they change RAVIN's capability context but never claim physical devices are actually connected. Future hardware/providers should implement the same capability contract instead of changing RAVIN's core intelligence.

## Developer / self-building boundary

Customer Work mode and RAVIN self-development are separate security domains.

- Normal Work mode receives **no source-code read/write/command tools**.
- Privileged source tools live in `src/agent/developerTools.js`.
- The self-builder uses `src/agent/developerAgent.js`.
- `/api/build` is disabled by default unless the server explicitly sets `RAVIN_ENABLE_SELF_BUILD=true`.

Self-development is not considered production-ready yet. The future design should use GitHub branches, tests, previews, review, and explicit deployment permissions rather than mutating a live container.

## Database security

User-owned production tables use authenticated-owner Row Level Security. Legacy public bypass policies on conversations, messages, permanent memories, project memory, and session summaries have been removed.

Storage objects in `ravin-files` are restricted to the authenticated user's UID prefix.

## Deferred platform stages

These remain intentionally later-stage work:

- first-class realtime voice,
- RAVIN SDK/API embedding inside Relay and other Resonant Assist products,
- production agent orchestration and GitHub-backed self-development,
- physical RAVIN Core and dock hardware.
