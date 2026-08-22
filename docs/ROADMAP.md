# RAVIN Roadmap

**Last updated:** 2026-08-22

## Current phase

### Phase 1 — Backend foundation
- [x] Design production-oriented Supabase schema
- [x] Add user/profile/settings tables
- [x] Add four-layer memory storage
- [x] Add projects, devices, files, and AI usage tables
- [x] Enable Row Level Security
- [x] Deploy authenticated `ravin-api` Edge Function
- [x] Document architecture

### Phase 2 — Connect the existing app
- [x] Add RAVIN account sign-up/sign-in
- [x] Remove BYO Supabase credentials from the frontend
- [x] Remove BYO AI API key requirement from the customer experience
- [x] Connect existing `/api/chat` flow to the authenticated RAVIN backend
- [x] Persist conversations and messages through the backend
- [x] Connect existing memory endpoints to the new memory API
- [x] Load persisted conversation context into the existing RAVIN agent
- [x] Add access-token refresh/session-expiration handling
- [ ] Test the complete auth/chat/memory flow in the live Codespace deployment

### Phase 3 — AI infrastructure
- [x] Establish OmniRoute as the backend AI gateway
- [x] Use OmniRoute automatic routing (`auto/best-chat`) as the default conversation model
- [x] Add AI/agent latency instrumentation
- [ ] Measure real RAVIN response breakdown in Codespace
- [ ] Add model selection by task complexity (`best-fast`, `best-chat`, `best-reasoning`, `best-coding`)
- [ ] Add server-side provider secrets
- [ ] Record AI usage/cost data
- [ ] Add rate limits and user quotas
- [ ] Keep provider-specific model IDs out of RAVIN application logic

### Phase 4 — Performance
- [ ] Reduce unnecessary AI calls for simple conversations
- [ ] Optimize context assembly and memory retrieval
- [ ] Parallelize independent backend operations
- [ ] Stream model responses to the UI
- [ ] Move non-critical memory work off the response path
- [ ] Add safe caching for reusable/static context
- [ ] Establish response-time targets and regression tests

### Phase 5 — Product infrastructure
- [ ] Configure Supabase Storage
- [ ] Add file upload/download APIs
- [ ] Add device registration
- [ ] Add account/profile management
- [ ] Add production error logging and monitoring
- [ ] Add automated tests

### Phase 6 — Developer platform
- [ ] Separate developer/self-building tools from customer tools
- [ ] Add safe tool permissions
- [ ] Improve project inspection/build workflows
- [ ] Add GitHub/deployment workflows

### Phase 7 — Beta/productization
- [ ] Polish onboarding
- [ ] Add subscription/billing system
- [ ] Establish usage limits and pricing
- [ ] Test with beta users
- [ ] Monitor infrastructure cost per user

### Phase 8 — Personal second brain
- [ ] Design Obsidian integration
- [ ] Allow AI to propose/update durable notes
- [ ] Keep Obsidian as personal/project knowledge rather than RAVIN's production user database
