# RAVIN Architecture

**Project:** RAVIN 1.1  
**Status:** Active development  
**Last updated:** 2026-08-22

## System overview

RAVIN is moving toward a backend-controlled architecture:

```text
RAVIN App
   |
   v
RAVIN Backend / API
   |-------------------|
   v                   v
Supabase             AI Router
   |                   |
Users, memory,       OmniRoute / AI
conversations,       providers
projects, files
```

## Backend

- Existing application: Node.js + Express.
- Existing API routes include chat/build/health.
- Supabase Edge Function `ravin-api` is the first authenticated backend API layer.
- Client applications should not require users to supply their own Supabase project or AI provider credentials.

## Database

Supabase PostgreSQL is the source of truth for RAVIN production data.

Current logical areas:

- `profiles` — user profile data.
- `user_settings` — RAVIN preferences/settings.
- `conversations` — conversation records.
- `messages` — conversation messages.
- `conversation_memory` — short-lived conversation memory.
- `session_summaries` — summarized session context.
- `project_memory` — project-specific knowledge.
- `permanent_memories` — long-lived user facts/preferences.
- `memory_embeddings` — future semantic/vector retrieval layer.
- `projects` — user projects.
- `devices` — registered RAVIN devices.
- `files` — metadata for files stored in object storage.
- `ai_usage` — model/provider usage and cost tracking.

Row Level Security is enabled for user-owned data. User data must be isolated by authenticated user ID.

## Memory architecture

RAVIN uses four conceptual memory layers:

1. Conversation memory — immediate context.
2. Session memory — summarized recent session context.
3. Project memory — durable knowledge tied to a project.
4. Permanent memory — durable personal facts/preferences.

Semantic embeddings are a supporting retrieval mechanism, not a replacement for the four-layer model.

## AI architecture

The existing project uses OmniRoute as an AI gateway. The long-term design is to place an AI router behind the RAVIN backend so the frontend does not depend directly on a provider.

The router should eventually select models based on complexity, task type, cost, context requirements, and availability.

Provider credentials must remain server-side.

## Files

Large binary data should use Supabase Storage/object storage. PostgreSQL stores file metadata and ownership information rather than large file contents.

## Developer tools

The existing self-building/developer tooling is powerful and should remain separated from normal customer-facing capabilities. Customer requests must not receive unrestricted access to RAVIN source files or deployment credentials.

## Personal knowledge vs product data

Obsidian is intended as Levi's personal/project knowledge system. Supabase is RAVIN's production data store. They should not be treated as the same database.
