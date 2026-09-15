# RAVIN

**Resonant Artificial Virtual Intelligence Network** — the AI workspace and intelligence platform for Resonant Assist.

RAVIN is being built as a software-first assistant with two explicit modes: a fast conversational mode and a more capable Work mode for reasoning, planning, code, files, images, and tool-assisted tasks. The same platform is intended to support future Resonant products and hardware without changing the core intelligence contract.

## Current product

- **Conversation** — fast everyday interaction powered by IBM Granite 4.0 H Micro.
- **Work** — reasoning, coding, file/image analysis, planning, and heavier tasks powered by Gemma 4 26B A4B.
- Authenticated persistent conversations.
- Streamed responses over server-sent events.
- Private file uploads with text extraction for supported formats.
- Four conceptual memory layers: conversation, session, project, and permanent.
- Explicit environment/capability simulation for future Resonant devices.
- Relay-derived experience modes and color palettes with a RAVIN-specific professional workspace shell.

## Repository structure

```text
.github/workflows/       CI and GitHub Pages deployment

docs/                    architecture, roadmap, production notes
ravin/
  public/                 browser client served by GitHub Pages / Express
  src/                    backend AI, agent, memory, files, capability code
  supabase/               database/storage migrations and policies
  server.js               production web/API entrypoint
  env.example             required environment variables
```

## Local development

Requirements: **Node.js 22+**.

```bash
cd ravin
cp env.example .env
npm ci
npm run check
npm run web
```

The web server defaults to `http://localhost:3000`. Never commit production secrets or Cloudflare tokens.

## Quality checks

```bash
npm run check
```

The check script parses every JavaScript module under `server.js`, `src/`, and `public/`. GitHub Actions runs the same check before deployment so syntax-broken builds are not published.

## Deployment

The `deployment-prep` branch deploys `ravin/public` to GitHub Pages. The API runs separately and keeps provider credentials server-side. Production deployments should define the environment variables documented in `ravin/env.example`.

## Security model

- Cloudflare provider credentials are server-side only.
- User-owned Supabase tables and file storage are protected by authenticated-owner RLS policies.
- Customer Work mode does not receive source-code mutation tools.
- The self-build endpoint is disabled unless `RAVIN_ENABLE_SELF_BUILD=true` is explicitly set.
- Browser auth currently uses the RAVIN Supabase flow and client-side session storage; moving to a same-origin, HttpOnly-cookie deployment is a future hardening target.

See [Architecture](docs/ARCHITECTURE.md), [Roadmap](docs/ROADMAP.md), and [Production](docs/PRODUCTION.md) for more detail.
