# RAVIN Evolution Lab — V2

The `evolution` branch is RAVIN's isolated autonomous R&D lane. Production remains on `main`.

## Core loop

```text
sync current main
      ↓
benchmark baseline
      ↓
Explorer chooses ONE bounded experiment
      ↓
Engineer inspects + implements
      ↓
deterministic security gates
      ↓
behavioral benchmark suite
      ↓
independent Critic review
      ↓
accept + commit OR revert + record failure
```

## What V2 does

- keeps all autonomous product edits inside `ravin/`
- synchronizes new production changes from `main` before starting fresh experiments
- refuses to overwrite the protected `.evolution/` control plane during sync
- uses separate Explorer, Engineer, and Critic roles
- benchmarks RAVIN before and after each experiment
- validates JavaScript and every JSON file
- verifies package/lock consistency
- checks ARROW/UI contracts and missing local assets
- launches an isolated RAVIN server smoke test
- confirms protected API routes still reject unauthenticated requests
- scans diffs for security regressions, secrets, unsafe execution patterns, and new external destinations
- rejects changes to high-leverage auth/tool/credential/dependency files for human review
- treats source-code text as untrusted data during Critic review
- remembers experiment history in `history.jsonl`
- tracks AI usage when Cloudflare reports it
- creates a human-readable `REPORT.md` and machine-readable `status.json`
- retries temporary Workers AI/network errors with bounded backoff
- imposes hard AI-call timeouts
- checkpoints unfinished work before the GitHub job time budget expires
- stores an in-flight git patch so quota/time interruptions can resume the SAME experiment
- includes newly created/untracked files in review and resume patches
- compacts long agent context safely and makes the Engineer re-read files when needed

## Control plane

- `.evolution/runner.mjs` — orchestration
- `.evolution/lib/cloudflare.mjs` — timeout/retry/quota-aware Workers AI client
- `.evolution/lib/security.mjs` — path, diff, secret, and network safety gates
- `.evolution/lib/validation.mjs` — behavioral benchmark suite
- `.evolution/lib/state.mjs` — atomic persistent state + history
- `.evolution/selftest.mjs` — control-plane regression tests
- `.evolution/state.json` — persistent evolution state
- `.evolution/history.jsonl` — structured experiment history
- `.evolution/journal.md` — readable chronological log
- `.evolution/inflight.patch` — temporary resumable experiment patch
- `.evolution/status.json` — dashboard-friendly status
- `.evolution/REPORT.md` — readable evolution report

## Activation

The production scheduler is intentionally **fail-closed**.

Scheduled evolution runs only when the repository variable below is exactly:

```text
RAVIN_EVOLUTION_ENABLED=true
```

If that variable is absent, blank, or anything other than `true`, autonomous evolution does not run.

The read-only **RAVIN Evolution CI** workflow is separate. It may test the evolution branch without activating autonomous evolution.

## Required Actions secrets

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

These may use the same Workers AI account/token as RAVIN.

## Optional model variables

- `RAVIN_EVOLUTION_MODEL`
- `RAVIN_EVOLUTION_EXPLORER_MODEL`
- `RAVIN_EVOLUTION_CRITIC_MODEL`

Default roles currently route Engineer to the work model, Critic to the conversation model, and Explorer to the Engineer model unless overridden.

## Human-review-only surfaces

Autonomous changes are rejected if they touch high-leverage files such as backend auth, tool execution, credential routing, frontend auth/API plumbing, environment configuration, or dependency manifests. EVO may identify ideas involving these areas, but they must be reviewed manually before entering RAVIN.

## Production boundary

EVO never merges itself into `main`. Accepted experiments remain on `evolution` until a human deliberately promotes them.
