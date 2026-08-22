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
- [x] Connect existing memory tools to the new memory API
- [ ] Test the complete auth/chat/memory flow in the live Codespace deployment
- [ ] Add token refresh/session expiration handling

### Phase 3 — AI infrastructure
- [ ] Build provider-agnostic AI router
- [ ] Keep OmniRoute behind the backend
- [ ] Add model selection by task complexity
- [ ] Add server-side provider secrets
- [ ] Record AI usage/cost data
- [ ] Add rate limits and user quotas

### Phase 4 — Product infrastructure
- [ ] Configure Supabase Storage
- [ ] Add file upload/download APIs
- [ ] Add device registration
- [ ] Add account/profile management
- [ ] Add production error logging and monitoring
- [ ] Add automated tests

### Phase 5 — Developer platform
- [ ] Separate developer/self-building tools from customer tools
- [ ] Add safe tool permissions
- [ ] Improve project inspection/build workflows
- [ ] Add GitHub/deployment workflows

### Phase 6 — Beta/productization
- [ ] Polish onboarding
- [ ] Add subscription/billing system
- [ ] Establish usage limits and pricing
- [ ] Test with beta users
- [ ] Monitor infrastructure cost per user

### Phase 7 — Personal second brain
- [ ] Design Obsidian integration
- [ ] Allow AI to propose/update durable notes
- [ ] Keep Obsidian as personal/project knowledge rather than RAVIN's production user database
