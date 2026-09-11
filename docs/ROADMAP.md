# RAVIN Roadmap

**Last updated:** 2026-09-11

## North star

Build the RAVIN software platform first: a strong standalone AI product that can later be embedded into Resonant Assist products and eventually inhabit the physical RAVIN Core/dock ecosystem.

## Current milestone — Software Foundation v0.2

### 1. Security and capability boundaries
- [x] Remove customer Work access to source-code tools
- [x] Move privileged development tools into a separate developer registry
- [x] Route self-building through a dedicated developer agent
- [x] Disable `/api/build` by default in production
- [x] Remove remaining public memory RLS bypass policies
- [x] Add private per-user Storage RLS for RAVIN attachments

### 2. Standalone chat product
- [x] Conversation / Work explicit modes
- [x] Persistent authenticated conversations
- [x] Stream responses over SSE in v0.2
- [x] Markdown and code-block rendering
- [x] Copy/edit/retry/stop message controls
- [x] Dark/light themes
- [x] Mac-first layout with mobile/iOS support
- [x] Persistent spatial Core with live text reflow
- [ ] Stabilize v0.2 UX from real browser testing
- [ ] Add true conversation branching/regeneration rather than prompt reload
- [ ] Add richer citations/source surfaces when tools arrive

### 3. Functional RAVIN memory
- [x] Conversation/session/project/permanent memory schema
- [x] Relevant permanent/project/session retrieval in v0.2 chat
- [x] Relevance ranking before model injection
- [x] Automatic durable fact/preference extraction
- [x] Periodic session summaries
- [x] Memory inspection/add/delete UI
- [x] User memory on/off control for v0.2 requests
- [ ] Upgrade retrieval to vector-semantic embeddings
- [ ] Add durable memory edit/merge/deduplication UX
- [ ] Add project-aware memory management UI

### 4. Files and image input
- [x] Private `ravin-files` Supabase Storage bucket
- [x] Authenticated attachment metadata rows
- [x] Text/code/data attachment context
- [x] Work-mode image attachment pipeline
- [x] Drag/drop and mobile file/photo picker
- [ ] Add PDF/document extraction
- [ ] Add image/file preview cards in conversation history
- [ ] Add attachment deletion/lifecycle cleanup

### 5. Capability Environment layer
- [x] Define common RAVIN environment contract
- [x] Desktop and phone environments
- [x] Simulated Portable Core environment
- [x] Simulated Relay environment
- [x] Simulated Vehicle environment
- [x] Simulated Garage environment
- [x] Environment selector/simulator in the web UI
- [ ] Persist registered real devices/capabilities
- [ ] Add capability permission grants/revocation
- [ ] Add provider interface for real hardware/software integrations

## Deferred after v0.2 stabilization

### 6. Realtime voice
- [ ] Reconnect the existing voice prototype to the live server
- [ ] Browser push-to-talk first
- [ ] Core listening/thinking/speaking states
- [ ] Earpiece/portable voice transport later

### 7. RAVIN inside Relay / Resonant Assist
- [ ] Define authenticated RAVIN SDK/API
- [ ] Create scoped permissions for Relay data/actions
- [ ] Allow RAVIN to read permitted Relay tasks/calendar/notes/messages
- [ ] Add proposal/approval pattern for write actions

### 8. Agents and GitHub-backed self-development
- [ ] Build safe customer-agent orchestration
- [ ] Add long-running task state and resumability
- [ ] Move self-development from live-container edits to GitHub branches
- [ ] Run automated tests/checks on proposed changes
- [ ] Deploy previews
- [ ] Require approval for sensitive/production changes
- [ ] Allow low-risk autonomous fixes only after permission design is mature

## Later hardware phase

- [ ] Physical RAVIN Core prototype
- [ ] Bluetooth earpiece/camera accessories
- [ ] Desk dock
- [ ] Vehicle dock + safe diagnostics/navigation/HUD interfaces
- [ ] Garage dock + workshop perception
- [ ] Hardware safety interlocks and explicit physical-action permissions
